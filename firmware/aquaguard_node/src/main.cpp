// AquaGuard sensor node - ESP32 development board.
// Contract with the app and the server: docs/FIRMWARE.md. Reference behaviour: src/device/DemoNode.ts.
//
// Wiring
//   Water sensor (Scout, floor)   S -> GPIO34 (analog in), + -> 3V3, - -> GND
//   DHT22 (air humidity / temp)   DATA -> GPIO4 (10k pull-up to 3V3)
//   Ultrasonic HC-SR04 (tray)     TRIG -> GPIO5, ECHO -> GPIO19 through a divider (5V echo -> 3.3V)
//   Servo (Guardian valve)        signal -> GPIO18, power from 5V
//   Buzzer (alarm at home)        + -> GPIO27, - -> GND
//   BOOT button (GPIO0, on board) "I have seen it" during an alert, and pairing confirmation
//   On-board LED (GPIO2)          status
//
// Every second (loop task, never waits for the network):
//   read sensors -> window of 8 readings -> 6 features -> AI leak score (model.h) + rule
//   3 leak windows in a row -> CLOSE THE VALVE FIRST, buzzer, then queue the event for the server
// A second task (core 0) talks to the server over ONE kept-alive HTTPS connection (no new
// TLS handshake per request): emergency events first, then PUT /device/live every second
// (answer = config, valve target, pressure-test request, alert closed in the app).
//
// Sensor failures, each sent as a notification (sensor_fault with "sensor"):
//   water    floor sensor blocked: the tray ultrasonic sees water it does not -> water OFF (fail-safe)
//   humidity DHT22 silent for 6 s                                        -> notification only
//   level    ultrasonic without echo for 10 s                            -> notification only
//   (node offline: the server notices the silence and notifies by itself)
//
// Pressure and flow: no sensor on the prototype. A virtual Guardian pipe (same physics as the
// app's simulator) gives them, driven by the real valve and the real floor sensor. Serial
// commands t / w toggle an open tap / a hidden wall leak to demonstrate the night pressure test.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <ESP32Servo.h>
#include <HTTPClient.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "model.h"
#include "wifi_default.h"

#define FIRMWARE "ag-fw 0.1.0"
#define DEFAULT_API "https://aquaguard-api-one.vercel.app"

// ---------- pins ----------
#define PIN_WATER 34
#define PIN_DHT 4
#define PIN_TRIG 5
#define PIN_ECHO 19
#define PIN_SERVO 18
#define PIN_BUZZER 27
#define PIN_BUTTON 0
#define PIN_LED 2

// ---------- calibration (type k in Serial to see the raw values) ----------
#define WATER_DRY_RAW 60      // analogRead with the sensor dry
#define WATER_WET_RAW 2200    // analogRead with the sensor fully in water
#define TRAY_EMPTY_CM 12.0f   // ultrasonic distance to the empty tray bottom
#define TRAY_ALARM_CM 1.5f    // water this deep in the tray = leak, even if the Scout is blocked
#define VALVE_OPEN_DEG 0
#define VALVE_CLOSED_DEG 90

// ---------- Bluetooth (same UUIDs as src/device/protocol.ts) ----------
#define AG_SERVICE "a9a00001-8f1b-4c7e-9d3a-2b5f8a0c0001"
#define AG_EVENT "a9a00003-8f1b-4c7e-9d3a-2b5f8a0c0001"
#define AG_CONTROL "a9a00004-8f1b-4c7e-9d3a-2b5f8a0c0001"
#define AG_IDENTITY "a9a00005-8f1b-4c7e-9d3a-2b5f8a0c0001"
#define AG_PROVISION "a9a00006-8f1b-4c7e-9d3a-2b5f8a0c0001"
#define AG_NETWORK "a9a00007-8f1b-4c7e-9d3a-2b5f8a0c0001"
#define CMD_IDENTIFY 1
#define CMD_UNPROVISION 2
#define EV_PAIR_CONFIRM 5
#define EV_PROVISION_OK 6
#define EV_PROVISION_NO_NETWORK 7
#define EV_WIFI_OK 8
#define EV_WIFI_FAIL 9
#define EV_WIFI_DENIED 10

// ---------- settings (defaults = src/core/defaults.ts; the server sends the zone's values) ----------
struct Settings {
  float wetThreshold = 30;
  int windowSamples = 8;
  float leakScoreThreshold = 0.8f;
  int sustainSamples = 3;
  bool autoClose = true;
  bool failSafeClose = true;
  int calibrationSamples = 15;
  int flowAlarmSec = 45;
  int testSec = 15;
  float testDropBar = 0.2f;
};

// ---------- shared state (loop task <-> network task) ----------
SemaphoreHandle_t lock;
Settings cfg;
struct Reading {
  float water, humidity, temp, pressure, flow, level;  // NAN = no reading
};
#define MAX_WINDOW 20
Reading win[MAX_WINDOW];
int winCount = 0;
Reading latest = {0, NAN, NAN, NAN, NAN, NAN};

struct Baseline {
  float humidity = NAN, pressure = NAN;
  int samples = 0;
  bool calibrated = false;
} base;
bool baselineDirty = false;

float score = NAN, growthPerMin = NAN;
int streak = 0;
bool valveOpen = true;
String valveTarget = "open";
double testRequestedAt = 0, lastTestRequest = -1;
bool serverAlertOpen = false;  // the server has an open alert for this zone
bool localAlarm = false;       // buzzer sounding at home
bool leakLatched = false;      // one leak = one alert, until the floor dries
bool faultWater = false, faultHumidity = false, faultLevel = false;
String lang = "en";
String waterHealth = "ok", levelHealth = "ok";

// virtual Guardian pipe
bool simTap = false, simWall = false;
float pipeP = 2.0f, pipeFlow = 0, waterLost = 0;
int flowSeconds = 0;

// night pressure test (src/core/pressureTest.ts)
struct PTest {
  bool active = false;
  String state = "";  // running | passed | failed | cancelled
  int elapsed = 0;
  float p0 = NAN, drop = 0;
  bool autoStarted = false;
} test;

// events waiting for the network task
struct Event {
  char json[700];
};
QueueHandle_t events;

// identity / link
Preferences prefs;
String deviceId, claimCode, deviceKey, apiUrl, wifiSsid, wifiPass;
DHT dht(PIN_DHT, DHT22);
Servo valve;

// ---------- small helpers ----------
float clampf(float x, float lo, float hi) { return x < lo ? lo : x > hi ? hi : x; }
void lockOn() { xSemaphoreTake(lock, portMAX_DELAY); }
void lockOff() { xSemaphoreGive(lock); }

void setValve(bool open) {
  if (valveOpen == open) return;
  valveOpen = open;
  valve.write(open ? VALVE_OPEN_DEG : VALVE_CLOSED_DEG);
  Serial.printf("[valve] %s\n", open ? "OPEN" : "CLOSED");
}

void queueEvent(const char *type, const char *source, const String &reason, bool valveClosed, float pressureDrop = NAN, const char *sensor = nullptr) {
  JsonDocument d;
  d["type"] = type;
  if (sensor) d["sensor"] = sensor;
  if (source) d["source"] = source;
  if (reason.length()) d["reason"] = reason;
  d["valveClosed"] = valveClosed;
  JsonObject s = d["snapshot"].to<JsonObject>();
  s["water"] = latest.water;
  if (!isnan(latest.humidity)) s["humidity"] = latest.humidity;
  if (!isnan(base.humidity)) s["baselineHumidity"] = base.humidity;
  if (!isnan(latest.pressure)) s["pressure"] = latest.pressure;
  if (!isnan(base.pressure)) s["baselinePressure"] = base.pressure;
  if (!isnan(latest.flow)) s["flow"] = latest.flow;
  if (!isnan(latest.level)) s["levelCm"] = latest.level;
  if (!isnan(score)) s["mlScore"] = score;
  if (!isnan(growthPerMin)) s["growthPerMin"] = roundf(growthPerMin);
  if (!isnan(pressureDrop)) s["pressureDrop"] = pressureDrop;
  s["waterLost"] = roundf(waterLost * 10) / 10;
  s["valveClosed"] = valveClosed;
  Event e;
  serializeJson(d, e.json, sizeof e.json);
  if (xQueueSend(events, &e, 0) != pdTRUE) Serial.println("[event] queue full, dropped");
  Serial.printf("[event] %s: %s\n", type, reason.c_str());
}

// ---------- sensors ----------
float readWaterPct() {
  long sum = 0;
  for (int i = 0; i < 8; i++) sum += analogRead(PIN_WATER);
  float raw = sum / 8.0f;
  return clampf((raw - WATER_DRY_RAW) * 100.0f / (WATER_WET_RAW - WATER_DRY_RAW), 0, 100);
}

/** Water depth in the tray (cm) from the ultrasonic distance; NAN if no echo. */
float readLevelCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(3);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 25000);
  if (us == 0) return NAN;
  float dist = us / 58.0f;
  return clampf(TRAY_EMPTY_CM - dist, 0, TRAY_EMPTY_CM);
}

/** One second of the virtual pipe (src/device/simulator.ts). The sink leak = real water on the floor. */
void stepPipe(bool sinkLeak) {
  float leak = (sinkLeak ? 1.5f : 0) + (simWall ? 0.8f : 0);
  if (valveOpen) {
    pipeFlow = (simTap ? 6.0f : 0) + leak;
    float target = 2.0f - (simTap ? 0.35f : 0) - (sinkLeak ? 0.06f : 0) - (simWall ? 0.04f : 0);
    pipeP += (target - pipeP) * 0.5f;
    waterLost += leak / 60.0f;
  } else {
    pipeFlow = 0;
    float fall = (sinkLeak ? 0.05f : 0) + (simWall ? 0.035f : 0) + (simTap ? 0.6f : 0);
    pipeP = max(0.0f, pipeP - fall);
    if (pipeP > 0.1f) waterLost += leak / 600.0f;
  }
}

// ---------- detection (src/core/detection.ts) ----------
float slope(const float *y, int n) {
  if (n < 2) return 0;
  float mx = (n - 1) / 2.0f, my = 0;
  for (int i = 0; i < n; i++) my += y[i];
  my /= n;
  float num = 0, den = 0;
  for (int i = 0; i < n; i++) {
    num += (i - mx) * (y[i] - my);
    den += (i - mx) * (i - mx);
  }
  return num / den;
}

/** Returns "rule", "ml", "rule+ml" or nullptr; updates score / streak / growth. */
const char *assess() {
  int n = min(winCount, cfg.windowSamples);
  if (n < 3) {
    score = NAN;
    streak = 0;
    return nullptr;
  }
  const Reading *w = &win[winCount - n];
  float water[MAX_WINDOW];
  int wet = 0;
  float jump = 0, meanP = 0;
  int pCount = 0;
  for (int i = 0; i < n; i++) {
    water[i] = w[i].water;
    if (w[i].water >= cfg.wetThreshold) wet++;
    if (i > 0) jump = max(jump, w[i].water - w[i - 1].water);
    if (!isnan(w[i].pressure)) {
      meanP += w[i].pressure;
      pCount++;
    }
  }
  float wetFrac = (float)wet / n;
  float waterNow = (water[n - 1] + water[n - 2] + water[n - 3]) / 3.0f;
  int tail = min(4, n);
  growthPerMin = slope(&water[n - tail], tail) * 60.0f;  // 1 reading per second
  float humidityRise = (!isnan(w[n - 1].humidity) && !isnan(base.humidity)) ? w[n - 1].humidity - base.humidity : 0;
  float pressureDrop = (pCount && !isnan(base.pressure)) ? base.pressure - meanP / pCount : 0;

  float x[MODEL_FEATURES] = {wetFrac, waterNow / 100.0f, clampf(growthPerMin / 100.0f, -1, 1), clampf(humidityRise / 20.0f, -1, 1),
                             clampf(pressureDrop / 0.5f, -1, 1), clampf(jump / 50.0f, 0, 1)};
  float z = MODEL_BIAS;
  for (int i = 0; i < MODEL_FEATURES; i++) z += MODEL_WEIGHTS[i] * x[i];
  score = 1.0f / (1.0f + expf(-z));

  bool ruleHit = wetFrac >= 0.75f && waterNow >= cfg.wetThreshold && growthPerMin > 5 && jump < 25;
  // Second sensor: water standing in the tray is a leak even if the floor sensor is blocked.
  if (!isnan(w[n - 1].level) && w[n - 1].level >= TRAY_ALARM_CM) ruleHit = true;
  bool mlHit = score >= cfg.leakScoreThreshold;
  streak = (ruleHit || mlHit) ? streak + 1 : 0;
  if (streak < cfg.sustainSamples) return nullptr;
  return ruleHit && mlHit ? "rule+ml" : mlHit ? "ml" : "rule";
}

void updateBaseline(const Reading &r) {
  if (r.water >= cfg.wetThreshold / 2 || r.flow > 0.5f) return;
  if (base.calibrated) {
    const float a = 0.02f;
    if (!isnan(r.humidity)) base.humidity = isnan(base.humidity) ? r.humidity : base.humidity + a * (r.humidity - base.humidity);
    if (!isnan(r.pressure)) base.pressure = isnan(base.pressure) ? r.pressure : base.pressure + a * (r.pressure - base.pressure);
    return;
  }
  int n = ++base.samples;
  if (!isnan(r.humidity)) base.humidity = isnan(base.humidity) ? r.humidity : base.humidity + (r.humidity - base.humidity) / n;
  if (!isnan(r.pressure)) base.pressure = isnan(base.pressure) ? r.pressure : base.pressure + (r.pressure - base.pressure) / n;
  if (n >= cfg.calibrationSamples) {
    base.calibrated = true;
    baselineDirty = true;
    Serial.printf("[learn] usual humidity %.1f%%, pressure %.2f bar\n", base.humidity, base.pressure);
  }
}

// ---------- pressure test (src/core/pressureTest.ts) ----------
void startTest(bool autoStarted) {
  if (test.active) return;
  test = PTest();
  test.active = true;
  test.state = "running";
  test.autoStarted = autoStarted;
  setValve(false);
  Serial.printf("[test] night pressure test started%s\n", autoStarted ? " (water never stopped)" : "");
}

void stepTest(float p) {
  if (!test.active) return;
  test.elapsed++;
  if (isnan(p)) test.state = "cancelled";
  else if (test.elapsed == 2) test.p0 = p;
  else if (!isnan(test.p0)) {
    test.drop = roundf((test.p0 - p) * 100) / 100;
    if (test.elapsed < 7 && test.drop > 0.8f) test.state = "cancelled";
    else if (test.elapsed >= cfg.testSec) test.state = test.drop > cfg.testDropBar ? "failed" : "passed";
  }
  if (test.state == "running") return;
  test.active = false;
  flowSeconds = 0;
  Serial.printf("[test] %s, drop %.2f bar\n", test.state.c_str(), test.drop);
  if (test.state == "failed") {
    setValve(false);
    localAlarm = true;
    String r = lang == "fr" ? "Test de pression nocturne : la pression a baisse de " + String(test.drop, 2) + " bar avec tous les robinets fermes. Fuite cachee."
                            : "Night pressure test: the pressure fell " + String(test.drop, 2) + " bar with every tap closed. Hidden leak in the pipes or walls.";
    queueEvent("hidden_leak", "pressure_test", r, true, test.drop);
  } else {
    setValve(valveTarget == "open");
  }
}

// ---------- the 1 Hz node loop ----------
/** Floor sensor failed: it can no longer see leaks, so the water goes off (fail-safe) and the alarm sounds. */
void waterSensorFault(const char *why) {
  if (faultWater) return;
  faultWater = true;
  if (cfg.failSafeClose) setValve(false);
  localAlarm = true;
  queueEvent("sensor_fault", "watchdog", why, !valveOpen, NAN, "water");
}

/** A secondary sensor failed: notify the family, three short beeps, the water stays on. */
volatile int beepsLeft = 0;
void minorSensorFault(bool &flag, const char *sensor, const char *why) {
  if (flag) return;
  flag = true;
  beepsLeft = 3;
  queueEvent("sensor_fault", "watchdog", why, !valveOpen, NAN, sensor);
}

void nodeTick() {
  static uint32_t lastDht = 0;
  static float hum = NAN, temp = NAN;
  static int dhtFails = 0, echoFails = 0;
  if (millis() - lastDht >= 2000) {
    lastDht = millis();
    float h = dht.readHumidity(), t = dht.readTemperature();
    hum = isnan(h) ? NAN : h;
    temp = isnan(t) ? NAN : t;
    dhtFails = isnan(h) ? dhtFails + 1 : 0;
  }
  Reading r;
  r.water = readWaterPct();
  r.level = readLevelCm();
  r.humidity = hum;
  r.temp = temp;
  bool sinkLeak = r.water >= cfg.wetThreshold;
  stepPipe(sinkLeak);
  r.pressure = roundf(pipeP * 100) / 100;
  r.flow = roundf(pipeFlow * 10) / 10;

  lockOn();
  latest = r;
  if (winCount == MAX_WINDOW) {
    memmove(win, win + 1, sizeof(Reading) * (MAX_WINDOW - 1));
    winCount--;
  }
  win[winCount++] = r;
  updateBaseline(r);
  levelHealth = isnan(r.level) ? "missing" : "ok";
  echoFails = isnan(r.level) ? echoFails + 1 : 0;
  if (dhtFails >= 3)
    minorSensorFault(faultHumidity, "humidity", lang == "fr" ? "Le capteur d'humidite DHT22 ne repond plus (cable ou alimentation)." : "The DHT22 humidity sensor stopped answering (cable or power).");
  else if (dhtFails == 0) faultHumidity = false;
  if (echoFails >= 10)
    minorSensorFault(faultLevel, "level", lang == "fr" ? "Le capteur ultrason du bac ne repond plus (pas d'echo)." : "The tray ultrasonic sensor stopped answering (no echo).");
  else if (echoFails == 0) faultLevel = false;

  // Blocked floor sensor: the tray has water but the Scout says dry.
  static int disagree = 0;
  disagree = (!isnan(r.level) && r.level >= 1.0f && r.water < cfg.wetThreshold / 2) ? disagree + 1 : 0;
  waterHealth = disagree >= 10 ? "stuck" : "ok";
  if (disagree == 10) waterSensorFault(lang == "fr" ? "Le capteur au sol ne voit pas l'eau que voit le capteur ultrason : bloque ou sale." : "The floor sensor does not see the water the ultrasonic sensor sees: blocked or dirty.");
  if (disagree == 0 && !serverAlertOpen) faultWater = false;

  if (r.water < cfg.wetThreshold / 2) leakLatched = false;
  const char *source = assess();
  if (source && !leakLatched && !serverAlertOpen) {
    leakLatched = true;
    if (cfg.autoClose) setValve(false);  // RESPONSE: the water stops before anything else
    if (test.active) test.state = "cancelled", test.active = false;
    localAlarm = true;
    char reason[200];
    if (lang == "fr")
      snprintf(reason, sizeof reason, "De l'eau sur le capteur au sol (%.0f %%, +%.0f %%/min). Score de fuite IA %.0f %%.", r.water, growthPerMin, score * 100);
    else
      snprintf(reason, sizeof reason, "Water on the floor sensor (%.0f%%, growing %.0f%%/min). AI leak score %.0f%%.", r.water, growthPerMin, score * 100);
    queueEvent("leak", source, reason, !valveOpen);
  }

  stepTest(r.pressure);
  // Water flowing without a stop (a hidden leak never stops): test the pipe.
  if (valveOpen && r.flow > 0.1f && !test.active) {
    if (++flowSeconds == cfg.flowAlarmSec) startTest(true);
  } else if (!test.active) {
    flowSeconds = 0;
  }
  // The valve position the home wants. Never re-open on a wet floor.
  if (!test.active) {
    if (valveTarget == "closed") setValve(false);
    else if (!valveOpen && !sinkLeak) setValve(true);
  }
  lockOff();

  Serial.printf("[read] water %.0f%% level %s hum %.0f%% %.1fC  P %.2f bar  flow %.1f  score %s  valve %s%s\n", r.water,
                isnan(r.level) ? "--" : String(r.level, 1).c_str(), r.humidity, r.temp, r.pressure, r.flow,
                isnan(score) ? "--" : String(score * 100, 0).c_str(), valveOpen ? "open" : "CLOSED", localAlarm ? "  ALARM" : "");
}

// ---------- Bluetooth: link the node and give it the Wi-Fi ----------
NimBLECharacteristic *chEvent = nullptr;
volatile bool phoneConnected = false, identifyRequested = false, unprovisionRequested = false, provisionReceived = false, networkReceived = false;
String pendingKey, pendingApi, pendingSsid, pendingPass;
bool identifying = false;
uint32_t identifyStart = 0, confirmedAt = 0, wifiJoinStart = 0;

String jsonField(const String &json, const char *name) {
  JsonDocument d;
  if (deserializeJson(d, json)) return "";
  return d[name] | "";
}

void bleNotify(uint8_t ev) {
  if (!phoneConnected || !chEvent) return;
  chEvent->setValue(&ev, 1);
  chEvent->notify();
}

class ServerCb : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *, NimBLEConnInfo &) override { phoneConnected = true; }
  void onDisconnect(NimBLEServer *, NimBLEConnInfo &, int) override {
    phoneConnected = false;
    NimBLEDevice::startAdvertising();
  }
};
class ControlCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &) override {
    NimBLEAttValue v = c->getValue();
    if (v.length() < 1) return;
    if (v.data()[0] == CMD_IDENTIFY) identifyRequested = true;
    if (v.data()[0] == CMD_UNPROVISION) unprovisionRequested = true;
  }
};
class ProvisionCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &) override {
    String j = c->getValue().c_str();
    pendingKey = jsonField(j, "key");
    pendingApi = jsonField(j, "api");
    provisionReceived = true;
  }
};
class NetworkCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &) override {
    String j = c->getValue().c_str();
    pendingSsid = jsonField(j, "ssid");
    pendingPass = jsonField(j, "pass");
    networkReceived = true;
  }
};

void bleBegin() {
  String name = "AquaGuard " + deviceId;
  NimBLEDevice::init(name.c_str());
  NimBLEDevice::setMTU(247);
  NimBLEServer *server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCb());
  NimBLEService *svc = server->createService(AG_SERVICE);
  String identity = "{\"id\":\"" + deviceId + "\",\"claim\":\"" + claimCode + "\",\"fw\":\"" FIRMWARE "\",\"net\":{\"mode\":\"wifi\",\"ssid\":\"" + wifiSsid + "\"}}";
  svc->createCharacteristic(AG_IDENTITY, NIMBLE_PROPERTY::READ)->setValue(identity.c_str());
  chEvent = svc->createCharacteristic(AG_EVENT, NIMBLE_PROPERTY::NOTIFY);
  svc->createCharacteristic(AG_CONTROL, NIMBLE_PROPERTY::WRITE)->setCallbacks(new ControlCb());
  svc->createCharacteristic(AG_PROVISION, NIMBLE_PROPERTY::WRITE)->setCallbacks(new ProvisionCb());
  svc->createCharacteristic(AG_NETWORK, NIMBLE_PROPERTY::WRITE)->setCallbacks(new NetworkCb());
  svc->start();
  NimBLEAdvertisementData adv, scan;
  adv.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  adv.addServiceUUID(AG_SERVICE);
  scan.setName(name.c_str());
  NimBLEAdvertising *a = NimBLEDevice::getAdvertising();
  a->setAdvertisementData(adv);
  a->setScanResponseData(scan);
  NimBLEDevice::startAdvertising();
  Serial.printf("[ble] advertising as \"%s\"\n", name.c_str());
}

// ---------- server (network task, core 0) ----------
// One HTTPS connection kept open between requests: the TLS handshake (1-3 s on an ESP32)
// happens once, then each request costs one round trip.
WiFiClientSecure tls;
HTTPClient http;

int api(const char *method, const String &path, const String &body, String *out) {
  if (WiFi.status() != WL_CONNECTED || deviceKey.length() == 0) return -1;
  uint32_t t0 = millis();
  if (!http.begin(tls, apiUrl + path)) return -2;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Device " + deviceKey);
  int code = http.sendRequest(method, body);
  if (out) *out = http.getString();
  http.end();  // with setReuse(true) the socket stays open for the next request
  if (code <= 0) tls.stop();
  if (millis() - t0 > 1500) Serial.printf("[net] slow %s %s: %lu ms\n", method, path.c_str(), (unsigned long)(millis() - t0));
  return code;
}

void applyConfig(const String &json) {
  JsonDocument d;
  if (deserializeJson(d, json)) return;
  lockOn();
  valveTarget = d["valveTarget"] | "open";
  lang = d["lang"] | "en";
  serverAlertOpen = !d["activeAlert"].isNull();
  if (!serverAlertOpen) localAlarm = false;  // closed in the app: stop the buzzer
  testRequestedAt = d["testRequestedAt"] | 0.0;
  JsonObject s = d["settings"];
  cfg.wetThreshold = s["wetThreshold"] | cfg.wetThreshold;
  cfg.windowSamples = constrain((int)(s["windowSamples"] | cfg.windowSamples), 3, MAX_WINDOW);
  cfg.leakScoreThreshold = s["leakScoreThreshold"] | cfg.leakScoreThreshold;
  cfg.sustainSamples = s["sustainSamples"] | cfg.sustainSamples;
  cfg.autoClose = s["autoClose"] | cfg.autoClose;
  cfg.failSafeClose = s["failSafeClose"] | cfg.failSafeClose;
  cfg.flowAlarmSec = s["flowAlarmSec"] | cfg.flowAlarmSec;
  cfg.testSec = s["testSec"] | cfg.testSec;
  cfg.testDropBar = s["testDropBar"] | cfg.testDropBar;
  if (!base.calibrated && !d["baseline"].isNull() && (d["baseline"]["calibrated"] | false)) {
    base.humidity = d["baseline"]["humidity"] | NAN;
    base.pressure = d["baseline"]["pressure"] | NAN;
    base.samples = d["baseline"]["samples"] | 0;
    base.calibrated = true;
  }
  if (d["baseline"].isNull() && base.calibrated && !baselineDirty) base = Baseline();  // "Relearn" in the app
  // A pressure test asked from the app (ignore the old one found at boot).
  if (testRequestedAt > 0 && testRequestedAt != lastTestRequest) {
    if (lastTestRequest >= 0) startTest(false);
    lastTestRequest = testRequestedAt;
  } else if (lastTestRequest < 0) {
    lastTestRequest = testRequestedAt;
  }
  lockOff();
}

String liveJson() {
  JsonDocument d;
  lockOn();
  d["water"] = roundf(latest.water * 10) / 10;
  d["wet"] = latest.water >= cfg.wetThreshold;
  if (!isnan(latest.humidity)) d["humidity"] = latest.humidity;
  if (!isnan(latest.temp)) d["temp"] = latest.temp;
  d["pressure"] = latest.pressure;
  d["flow"] = latest.flow;
  if (!isnan(latest.level)) d["levelCm"] = latest.level;
  d["waterLost"] = roundf(waterLost * 10) / 10;
  if (!isnan(score)) d["mlScore"] = score;
  if (!isnan(growthPerMin)) d["growthPerMin"] = growthPerMin;
  d["valve"] = valveOpen ? "open" : "closed";
  d["battery"] = nullptr;
  d["rssi"] = WiFi.RSSI();
  d["calibrated"] = base.calibrated;
  d["samples"] = base.samples;
  d["firmware"] = FIRMWARE;
  JsonObject s = d["sensors"].to<JsonObject>();
  s["water"] = waterHealth;
  s["humidity"] = isnan(latest.humidity) ? "missing" : "ok";
  s["level"] = levelHealth;
  s["pressure"] = "simulated";
  s["flow"] = "simulated";
  if (test.state.length()) {
    JsonObject t = d["test"].to<JsonObject>();
    t["state"] = test.state;
    t["startedAt"] = 0;
    t["elapsed"] = test.elapsed;
    t["p0"] = isnan(test.p0) ? 0 : test.p0;
    t["drop"] = test.drop;
    t["auto"] = test.autoStarted;
  }
  JsonObject net = d["network"].to<JsonObject>();
  net["mode"] = "wifi";
  net["ssid"] = WiFi.SSID();
  lockOff();
  String out;
  serializeJson(d, out);
  return out;
}

void netTask(void *) {
  uint32_t lastLive = 0, lastWifiTry = 0;
  tls.setInsecure();  // prototype: TLS encrypts the traffic; pin the server certificate for production
  tls.setHandshakeTimeout(8);
  http.setReuse(true);
  http.setTimeout(5000);
  for (;;) {
    if (WiFi.status() != WL_CONNECTED && millis() - lastWifiTry > 10000) {
      lastWifiTry = millis();
      tls.stop();
      WiFi.disconnect();
      WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
    }
    if (WiFi.status() == WL_CONNECTED && deviceKey.length()) {
      Event e;
      bool sentEvent = false;
      while (xQueuePeek(events, &e, 0) == pdTRUE) {
        String out;
        int code = api("POST", "/device/events", e.json, &out);
        if (code > 0) xQueueReceive(events, &e, 0), sentEvent = true;  // delivered (or refused): drop it
        if (code == 401) break;
        if (code <= 0) break;                         // no network: retry next round
        if (code == 200 && out.indexOf("alertId") >= 0 && strstr(e.json, "\"sensor\":\"humidity\"") == nullptr && strstr(e.json, "\"sensor\":\"level\"") == nullptr) serverAlertOpen = true;
      }
      if (baselineDirty) {
        lockOn();
        String b = "{\"baseline\":{\"humidity\":" + String(base.humidity, 1) + ",\"pressure\":" + String(base.pressure, 2) + ",\"samples\":" + base.samples + ",\"calibrated\":true}}";
        baselineDirty = false;
        lockOff();
        api("PUT", "/device/baseline", b, nullptr);
      }
      // Every second, and at once after an event so the node learns the new alert state.
      if (sentEvent || millis() - lastLive >= 1000) {
        lastLive = millis();
        String out;
        int code = api("PUT", "/device/live", liveJson(), &out);
        if (code == 200) applyConfig(out);
        if (code == 401) {
          Serial.println("[net] key refused (sensor removed in the app): unlinked");
          deviceKey = "";
          prefs.remove("key");
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// ---------- setup / loop ----------
void storeBegin() {
  prefs.begin("ag", false);
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char id[16];
  snprintf(id, sizeof id, "AG-%02X%02X%02X", mac[3], mac[4], mac[5]);
  deviceId = id;
  claimCode = prefs.getString("claim", "");
  if (claimCode.length() == 0) {
    char c[8];
    snprintf(c, sizeof c, "%06lu", (unsigned long)(esp_random() % 1000000UL));
    claimCode = c;
    prefs.putString("claim", claimCode);
  }
  deviceKey = prefs.getString("key", "");
  apiUrl = prefs.getString("api", DEFAULT_API);
  wifiSsid = prefs.getString("ssid", WIFI_DEFAULT_SSID);
  wifiPass = prefs.getString("pass", WIFI_DEFAULT_PASS);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n[boot] AquaGuard node " FIRMWARE " model " MODEL_VERSION);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_WATER, ADC_11db);
  dht.begin();
  ESP32PWM::allocateTimer(0);
  valve.setPeriodHertz(50);
  valve.attach(PIN_SERVO, 500, 2400);
  valve.write(VALVE_OPEN_DEG);

  lock = xSemaphoreCreateMutex();
  events = xQueueCreate(6, sizeof(Event));
  storeBegin();
  Serial.printf("[boot] ID %s  claim %s  %s  Wi-Fi \"%s\"\n", deviceId.c_str(), claimCode.c_str(), deviceKey.length() ? "LINKED" : "NOT LINKED", wifiSsid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  bleBegin();
  xTaskCreatePinnedToCore(netTask, "net", 12288, nullptr, 1, nullptr, 0);
  Serial.println("[ready] Serial: b button, t tap, w wall leak, p pressure test, k raw sensors, r reset water lost, u unlink");
}

void handleSerialAndButton(bool &pressed) {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'b') pressed = true;
    if (c == 't') simTap = !simTap, Serial.printf("[sim] tap %s\n", simTap ? "OPEN" : "closed");
    if (c == 'w') simWall = !simWall, Serial.printf("[sim] hidden wall leak %s\n", simWall ? "ON" : "off");
    if (c == 'p') { lockOn(); startTest(false); lockOff(); }
    if (c == 'r') waterLost = 0;
    if (c == 'u') unprovisionRequested = true;
    if (c == 'k') Serial.printf("[cal] water raw %d (dry %d, wet %d)  ultrasonic level %.1f cm (empty %.1f)\n", analogRead(PIN_WATER), WATER_DRY_RAW, WATER_WET_RAW, readLevelCm(), TRAY_EMPTY_CM);
  }
  static bool wasDown = false;
  bool down = digitalRead(PIN_BUTTON) == LOW;
  if (down && !wasDown) pressed = true;
  wasDown = down;
}

void loop() {
  bool pressed = false;
  handleSerialAndButton(pressed);

  // Bluetooth linking
  if (identifyRequested) {
    identifyRequested = false;
    identifying = true;
    identifyStart = millis();
    Serial.println("[ble] the app asks to confirm: press BOOT (or type b)");
  }
  if (identifying && pressed) {
    identifying = false;
    pressed = false;
    confirmedAt = millis();
    bleNotify(EV_PAIR_CONFIRM);
  }
  if (identifying && millis() - identifyStart > 45000) identifying = false;
  if (provisionReceived) {
    provisionReceived = false;
    if (pendingKey.length() >= 10) {
      deviceKey = pendingKey;
      apiUrl = pendingApi.length() ? pendingApi : String(DEFAULT_API);
      prefs.putString("key", deviceKey);
      prefs.putString("api", apiUrl);
      bleNotify(WiFi.status() == WL_CONNECTED ? EV_PROVISION_OK : EV_PROVISION_NO_NETWORK);
      Serial.printf("[link] linked, server %s\n", apiUrl.c_str());
    }
  }
  if (networkReceived) {
    networkReceived = false;
    if (millis() - confirmedAt > 60000) {
      bleNotify(EV_WIFI_DENIED);  // the button was not pressed: nobody nearby changes our Wi-Fi
    } else {
      wifiSsid = pendingSsid;
      wifiPass = pendingPass;
      prefs.putString("ssid", wifiSsid);
      prefs.putString("pass", wifiPass);
      tls.stop();
      WiFi.disconnect();
      WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
      wifiJoinStart = millis();  // answered below, without blocking the leak watch
    }
  }
  if (wifiJoinStart && (WiFi.status() == WL_CONNECTED || millis() - wifiJoinStart > 10000)) {
    bleNotify(WiFi.status() == WL_CONNECTED ? EV_WIFI_OK : EV_WIFI_FAIL);
    wifiJoinStart = 0;
  }
  if (unprovisionRequested) {
    unprovisionRequested = false;
    deviceKey = "";
    prefs.remove("key");
    Serial.println("[link] unlinked");
  }

  // "I have seen it": stops the alarm at home and closes the alert for everyone.
  if (pressed && localAlarm) {
    localAlarm = false;
    queueEvent("local_ack", nullptr, "", !valveOpen);
  }

  static uint32_t lastTick = 0;
  if (millis() - lastTick >= 1000) {
    lastTick = millis();
    nodeTick();
  }

  // Buzzer: alarm pattern during an alert, short beeps while identifying.
  uint32_t ms = millis();
  static uint32_t beepStart = 0;
  if (beepsLeft > 0 && beepStart == 0) beepStart = ms;
  bool faultBeep = false;
  if (beepStart) {
    uint32_t e = ms - beepStart;
    faultBeep = (e % 300) < 120;
    if (e >= 900) beepStart = 0, beepsLeft = 0;
  }
  bool beep = localAlarm ? (ms % 1000) < 500 : identifying ? (ms % 400) < 80 : faultBeep;
  digitalWrite(PIN_BUZZER, beep);
  // LED: fast blink = alarm, slow blink = not linked / no Wi-Fi, on = all good.
  bool ok = WiFi.status() == WL_CONNECTED && deviceKey.length();
  digitalWrite(PIN_LED, localAlarm || identifying ? (ms % 300) < 150 : ok ? HIGH : (ms % 1000) < 100);
  delay(10);
}
