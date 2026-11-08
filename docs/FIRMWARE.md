# AquaGuard node: firmware contract

What the ESP32 node must do so the app and the server work with it. The demo node
(`src/device/DemoNode.ts`) follows exactly this contract: read it as the reference
implementation.

## Hardware (IoT Spark 4.0 Hardware Bank)

| Part | Role |
|---|---|
| ESP32 development board | Wi-Fi + Bluetooth, runs detection and the valve logic |
| Water level sensor (**Scout**) | Floor sensor, analog 0-100 % wet |
| DHT22 | Air humidity and temperature (humid air must not stop the water) |
| Servo motor (**Guardian** valve) | Turns the valve / clamp: open or closed |
| Buzzer + LED | Local alarm at home |
| Push button | "I have seen it" at home, and pairing confirmation |
| (no sensor) | Pipe pressure and flow: simulated / set from the app on the prototype |

## Every second

1. Read the Scout (0-100 %), the DHT22 (humidity %, °C) and, if fitted, pressure (bar) and flow (L/min).
2. Keep the last 8 readings (the **window**) and compute the 6 features (`features()` in `src/core/detection.ts`):
   `wetFrac`, `waterNow`, `growthPerMin` (last 4 s), `humidityRise`, `pressureDrop`, `jump`.
3. Leak probability = logistic regression with the weights in `src/core/model.ts`
   (`vectorize()` gives the exact scaling). Re-train with `npm run train`.
4. A leak window = score ≥ `leakScoreThreshold` **or** the rule (`ruleSaysLeak()`).
   **3 leak windows in a row** confirm a leak.
5. Confirmed leak: **close the valve first** (if `autoClose`), sound the buzzer, then `POST /device/events {type:"leak", valveClosed:true, ...}`.
   One leak = one event: report again only after the floor has dried below half the wet threshold.

## Every 2 seconds: `PUT /device/live`

Header `Authorization: Device <key>`. Body (overwritten, never stored as history):

```json
{ "water": 3.1, "wet": false, "humidity": 55.2, "temp": 22.4, "pressure": 2.0, "flow": 0,
  "waterLost": 0, "mlScore": 0.01, "growthPerMin": 0, "valve": "open",
  "battery": null, "rssi": -58, "calibrated": true, "samples": 40, "firmware": "ag-fw 0.1.0",
  "sensors": { "water": "ok", "humidity": "ok", "pressure": "simulated", "flow": "simulated" },
  "test": null, "network": { "mode": "wifi", "ssid": "Home" } }
```

The answer carries the config (same as `GET /device/config`): zone, thresholds, usual levels,
`valveTarget`, `testRequestedAt`, `lang`, `activeAlert`.

## Valve rules (safe state)

| Situation | Valve |
|---|---|
| `valveTarget` = `closed` (a person in the app, or the node itself) | close |
| `valveTarget` = `open` | open **only if the floor is dry** and no pressure test runs |
| Confirmed leak and `autoClose` | close at once, before the network |
| Scout unplugged / stuck and `failSafeClose` | close (cannot watch for leaks any more) |
| Wi-Fi lost | keep the current position; local detection keeps working and still closes on a leak |

Only owners can set `valveTarget` to `open` (the server checks the role). A fake command
cannot come from another node: every node has its own key, and phones use a different scheme.

## Night pressure test (`src/core/pressureTest.ts`)

Starts when `testRequestedAt` changes, or by itself after `flowAlarmSec` of flow that never stops.
Close the valve, wait 2 s, note p0. In the first 7 s a fall > 0.8 bar means a tap is in use:
cancel and re-open. After `testSec`, a fall > `testDropBar` = hidden leak:
keep closed and `POST /device/events {type:"hidden_leak", valveClosed:true, snapshot:{pressureDrop}}`.

## Events: `POST /device/events`

| type | When |
|---|---|
| `leak` | confirmed leak (with `valveClosed`, `source`, `reason`, `snapshot`) |
| `hidden_leak` | pressure test failed |
| `sensor_fault` | Scout unplugged (no reading) or stuck (same exact value 30 s) |
| `local_ack` | the button was pressed during an alert: stop the buzzer |
| `valve_closed` | the valve was closed by the node without a new alert |

## Bluetooth (linking and Wi-Fi only)

Service and characteristics in `src/device/protocol.ts`. Advertise as `AquaGuard AG-XXXXXX`.
`identity` (read) → `{"id","claim","fw"}`; `control` (write 1 = identify: blink and beep, wait for the button);
`event` (notify: 5 button pressed, 6 provisioned online, 7 provisioned offline, 8/9/10 Wi-Fi ok/fail/denied);
`provision` (write `{"key","api"}`, store in flash); `network` (write `{"mode":"wifi","ssid","pass"}`).
