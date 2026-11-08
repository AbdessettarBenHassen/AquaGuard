// Shared domain types for the AquaGuard app.
//
// One zone (kitchen, bathroom…) = one sensor node:
//   Scout    : water sensor on the floor (0-100 % wet) + air humidity/temperature
//   Guardian : the valve on the water pipe, with pipe pressure and flow
// The node runs detection itself; the server runs the escalation countdown.

/** One sample from the node, about once per second. */
export interface Reading {
  at: number; // epoch ms
  /** Scout floor sensor, 0 = dry, 100 = fully wet. */
  water: number;
  /** Air humidity %, DHT22 (null = sensor missing). */
  humidity: number | null;
  /** Air temperature °C, DHT22. */
  temp: number | null;
  /** Pipe pressure in bar (Guardian). Simulated or set from the app when no sensor is fitted. */
  pressure: number | null;
  /** Water flow in L/min (Guardian). Simulated or set from the app when no sensor is fitted. */
  flow: number | null;
}

/** Stages of the alert escalation state machine. */
export type Stage = 'IDLE' | 'EVENT_DETECTED' | 'LOCAL_ASSISTANCE' | 'ESCALATE' | 'RESOLVED';

/**
 * leak        : water on the floor that stays and grows (Scout)
 * hidden_leak : the night pressure test found the pipe pressure falling with every tap closed
 * sensor_fault: no readings, sensor unplugged or stuck
 */
export type TriggerKind = 'leak' | 'hidden_leak' | 'sensor_fault';

export type ValveState = 'open' | 'closed';

export interface TriggerSnapshot {
  water?: number | null;
  humidity?: number | null;
  baselineHumidity?: number | null;
  pressure?: number | null;
  baselinePressure?: number | null;
  flow?: number | null;
  /** Leak probability from the AI model over the window (0..1). */
  mlScore?: number | null;
  /** How fast the water grew on the Scout, % per minute. */
  growthPerMin?: number | null;
  /** Pressure fall during a night test, bar. */
  pressureDrop?: number | null;
  /** Litres lost before the valve closed (estimate). */
  waterLost?: number | null;
  valveClosed?: boolean;
}

export interface Trigger {
  kind: TriggerKind;
  /** Human-readable explanation; shown in the alert history (explainability). */
  reason: string;
  /** Which detector raised it. */
  source: 'rule' | 'ml' | 'rule+ml' | 'watchdog' | 'pressure_test';
  snapshot: TriggerSnapshot;
}

/** device = the node, local = someone at home pressed its button, member = someone in the app. */
export type Actor = 'system' | 'device' | 'local' | 'member' | 'cloud';

export interface TimelineEntry {
  at: number;
  actor: Actor;
  text: string;
}

export type Resolution = 'local_ack' | 'member_ack' | 'false_alarm';

export interface AlertEvent {
  id: string;
  startedAt: number;
  trigger: Trigger;
  stage: Stage;
  /** When the current grace/escalation timer fires next (epoch ms). */
  deadline: number | null;
  /** Escalation level reached (0 = not escalated, 1 = first contact, ...). */
  level: number;
  smsSentForLevel: boolean;
  timeline: TimelineEntry[];
  resolvedAt: number | null;
  resolution: Resolution | null;
  resolvedBy: string | null;
}

export type ContactRole = 'family' | 'neighbour' | 'plumber' | 'other';

export interface AvatarConfig {
  bg: string;
  skin: string;
  hair: 'short' | 'curly' | 'long' | 'bun' | 'spiky' | 'none';
  hairColor: string;
  eyes: 'happy' | 'wink' | 'sleepy' | 'wide';
  mouth: 'smile' | 'grin' | 'oh' | 'tongue';
  accessory: 'none' | 'glasses' | 'shades' | 'cap' | 'crown' | 'bow' | 'headphones' | 'mustache';
}

export interface Contact {
  id: string;
  name: string;
  role: ContactRole;
  phone: string;
  push: boolean;
  sms: boolean;
  avatar?: AvatarConfig;
}

export type ZoneIcon = 'kitchen' | 'bathroom' | 'laundry' | 'boiler' | 'garage' | 'other';

export interface Settings {
  zoneName: string;
  // ---- home: escalation (seconds, short for demos) ----
  /** Seconds for someone at home to press the node button before the family is alerted. */
  gracePeriodSec: number;
  /** Seconds after a push notification before the SMS fallback is sent. */
  smsFallbackSec: number;
  /** Seconds before escalating to the next contact in the chain. */
  nextContactSec: number;
  /** Seconds a snooze postpones escalation. */
  snoozeSec: number;
  // ---- zone: detection ----
  /** Scout reading (%) above which the floor counts as wet. */
  wetThreshold: number;
  /** Readings in the window the AI model reads. */
  windowSamples: number;
  /** AI leak probability above which a window counts as a leak. */
  leakScoreThreshold: number;
  /** Leak windows in a row before an alert (confirmation). */
  sustainSamples: number;
  /** Turn the water off by itself on a confirmed leak. */
  autoClose: boolean;
  /** Turn the water off when the sensor fails (it can no longer watch). */
  failSafeClose: boolean;
  /** Seconds without fresh readings before a fault alert. */
  staleSec: number;
  /** Seconds after a resolved alert during which no new leak alert fires. */
  cooldownSec: number;
  /** Dry readings needed to learn the room's usual humidity and pressure. */
  calibrationSamples: number;
  /** Water flowing without a stop for this long starts a night pressure test. */
  flowAlarmSec: number;
  /** Duration of the pressure test, seconds. */
  testSec: number;
  /** Pressure fall (bar) during the test that means a hidden leak. */
  testDropBar: number;
  // ---- this phone ----
  soundEnabled: boolean;
  showTechnical: boolean;
  backgroundWatch: boolean;
  demoMode: boolean;
}

export interface Baseline {
  humidity: number | null;
  pressure: number | null;
  samples: number;
  calibrated: boolean;
}

export interface LinkStatus {
  connected: boolean;
  /** Node on battery backup (null = mains powered). */
  battery: number | null;
  rssi: number; // dBm
  lastSampleAt: number | null;
  connectedAt: number | null;
  firmware: string;
  /** The node is online but a sensor is unplugged or stuck. */
  sensorIssue?: 'missing' | 'stuck' | null;
}

/** What the AI model reads from a window of readings. */
export interface Features {
  /** Share of the window where the floor is wet (0..1). */
  wetFrac: number;
  /** Mean Scout reading over the last 3 samples (%). */
  waterNow: number;
  /** Recent growth of the Scout reading (last 4 s), % per minute (negative = drying). */
  growthPerMin: number;
  /** Biggest rise between two readings in the window (%): a spill jumps, a leak climbs steadily. */
  jump: number;
  /** Humidity above the room's usual level (points). */
  humidityRise: number;
  /** Pipe pressure below its usual level (bar). */
  pressureDrop: number;
}

export interface Assessment {
  features: Features | null;
  /** AI leak probability for the current window (0..1). */
  mlScore: number | null;
  /** True when the explainable rule says "leak" for this window. */
  ruleHit: boolean;
  mlHit: boolean;
  /** Leak windows in a row so far. */
  streak: number;
  /** Why detection is paused, if it is. */
  suppressed: string | null;
}

export type PressureTestState = 'running' | 'passed' | 'failed' | 'cancelled';

export interface PressureTest {
  state: PressureTestState;
  startedAt: number;
  /** Seconds since start. */
  elapsed: number;
  /** Pressure at the start of the measure (bar). */
  p0: number | null;
  /** Pressure fall so far (bar). */
  drop: number | null;
  /** Started by itself after a long continuous flow. */
  auto: boolean;
}
