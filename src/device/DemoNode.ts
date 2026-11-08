import { deviceApi, type LiveStatus } from '../api/client';
import { DEFAULT_SETTINGS } from '../core/defaults';
import { assess, emptyBaseline, sensorStuck, shouldAlert, updateBaseline } from '../core/detection';
import { startTest, stepTest } from '../core/pressureTest';
import type { Assessment, Baseline, PressureTest, Reading, Settings, ValveState } from '../core/types';
import { NodeSimulator, type Fault, type Overrides, type Toggle } from './simulator';

// A pretend AquaGuard node that behaves exactly like the real firmware:
//  - reads its (simulated) Scout and Guardian every second and runs detection itself
//  - closes the valve by itself on a confirmed leak, or on a sensor failure (fail-safe)
//  - runs the night pressure test (asked from the app, or after a long continuous flow)
//  - refuses to re-open the water while the floor is still wet
//  - talks to the server with its own device key (PUT /device/live, POST /device/events)
// It runs on the phone that linked it, while the app is open.

const LIVE_EVERY_MS = 2000;
const CONFIG_EVERY_MS = 3000;
const RECENT_MAX = 60;

const T = {
  en: {
    leak: (w: number, g: number, s: number | null) => `Water on the floor sensor (${Math.round(w)}%, growing ${Math.round(g)}%/min). AI leak score ${s != null ? Math.round(s * 100) : '–'}%.`,
    hidden: (d: number) => `Night pressure test: the pressure fell ${d.toFixed(2)} bar with every tap closed. Hidden leak in the pipes or walls.`,
    unplugged: 'The floor water sensor stopped giving readings (unplugged or broken).',
    stuck: 'The floor water sensor gives the exact same value for a long time: it may be blocked or dirty.',
  },
  fr: {
    leak: (w: number, g: number, s: number | null) => `De l’eau sur le capteur au sol (${Math.round(w)} %, en hausse de ${Math.round(g)} %/min). Score de fuite IA ${s != null ? Math.round(s * 100) : '–'} %.`,
    hidden: (d: number) => `Test de pression nocturne : la pression a baissé de ${d.toFixed(2)} bar avec tous les robinets fermés. Fuite cachée dans les tuyaux ou les murs.`,
    unplugged: 'Le capteur d’eau au sol ne donne plus de mesures (débranché ou cassé).',
    stuck: 'Le capteur d’eau au sol donne exactement la même valeur depuis longtemps : il est peut-être bloqué ou sale.',
  },
};

export class DemoNode {
  readonly sim: NodeSimulator;
  online = false;
  valve: ValveState = 'open';
  test: PressureTest | null = null;
  latest: Reading | null = null;
  assessment: Assessment | null = null;
  private api: ReturnType<typeof deviceApi>;
  private settings: Settings = DEFAULT_SETTINGS;
  private baseline: Baseline = emptyBaseline();
  private recent: Reading[] = [];
  private valveTarget: ValveState = 'open';
  private lang: 'en' | 'fr' = 'en';
  private activeAlert: string | null = null;
  private eventPending = false;
  private faultSent = false;
  private leakLatched = false;
  private lastTestRequest: number | null = null;
  private flowSeconds = 0;
  private lastLive = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private listeners = new Set<() => void>();

  constructor(
    readonly deviceId: string,
    key: string,
    private onRevoked: () => void,
  ) {
    this.api = deviceApi(key);
    this.sim = new NodeSimulator();
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  async start() {
    if (this.online) return;
    this.online = true;
    await this.refreshConfig(true);
    this.timers.push(setInterval(() => this.tick(), 1000));
    this.timers.push(setInterval(() => this.refreshConfig(false), CONFIG_EVERY_MS));
    this.emit();
  }

  /** Switches the node off: no more readings, the app shows it offline after ~10 s. */
  stop() {
    this.online = false;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.emit();
  }

  // ---- demo controls ----

  toggle(t: Toggle, on: boolean) {
    this.sim.set(t, on);
    this.emit();
  }
  spill() {
    this.sim.spill();
    this.emit();
  }
  fixLeaks() {
    this.sim.fixLeaks();
    this.emit();
  }
  setFault(f: Fault) {
    this.sim.setFault(f);
    this.faultSent = false;
    this.recent = [];
    this.emit();
  }
  setOverride(k: keyof Overrides, v: number | null) {
    this.sim.overrides = { ...this.sim.overrides, [k]: v };
    this.emit();
  }
  reset() {
    this.sim.reset();
    this.recent = [];
    this.faultSent = false;
    this.leakLatched = false;
    this.test = null;
    this.flowSeconds = 0;
    this.emit();
  }
  runTest() {
    if (!this.test || this.test.state !== 'running') this.beginTest(false);
  }

  /** The button on the node: "I have seen it" stops the alarm and closes the alert. */
  pressButton() {
    this.api.event('local_ack').catch(() => {});
    this.activeAlert = null;
  }

  // ---- node loop ----

  private async refreshConfig(first: boolean) {
    try {
      const cfg = await this.api.config();
      this.applyConfig(cfg, first);
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        this.stop();
        this.onRevoked();
      }
    }
  }

  private applyConfig(cfg: Awaited<ReturnType<ReturnType<typeof deviceApi>['config']>>, first: boolean) {
    this.settings = { ...DEFAULT_SETTINGS, ...cfg.settings };
    this.lang = cfg.lang === 'fr' ? 'fr' : 'en';
    this.activeAlert = cfg.activeAlert?.id ?? null;
    if (cfg.baseline && !this.baseline.calibrated) this.baseline = cfg.baseline;
    if (!cfg.baseline && this.baseline.calibrated) this.baseline = emptyBaseline(); // relearn asked
    this.valveTarget = cfg.valveTarget;
    if (first) this.valve = cfg.valveTarget;
    if (cfg.testRequestedAt && cfg.testRequestedAt !== this.lastTestRequest) {
      const isNew = this.lastTestRequest !== null || Date.now() - cfg.testRequestedAt < 30000;
      this.lastTestRequest = cfg.testRequestedAt;
      if (isNew && !first) this.runTest();
    }
    this.followTarget();
  }

  /** Applies the valve position the home wants, with the node's own safety rules. */
  private followTarget() {
    if (this.test?.state === 'running') return;
    if (this.valveTarget === 'closed') this.valve = 'closed';
    else if (this.valve === 'closed' && !this.isWet()) this.valve = 'open'; // never re-open on a wet floor
    this.emit();
  }

  private isWet() {
    return (this.latest?.water ?? 0) >= this.settings.wetThreshold;
  }

  private beginTest(auto: boolean) {
    this.test = startTest(Date.now(), auto);
    this.valve = 'closed';
    this.emit();
  }

  private tick() {
    if (!this.online) return;
    const r = this.sim.step(this.valve === 'open');
    if (!r) {
      this.sensorFault('unplugged');
      if (Date.now() - this.lastLive >= LIVE_EVERY_MS) this.pushLive();
      return;
    }
    this.latest = r;
    this.recent = [...this.recent, r].slice(-RECENT_MAX);
    const wasCalibrated = this.baseline.calibrated;
    this.baseline = updateBaseline(this.baseline, r, this.settings);
    if (this.baseline.calibrated && !wasCalibrated) this.api.baseline(this.baseline).catch(() => {});
    this.assessment = assess(this.recent, this.baseline, this.assessment?.streak ?? 0, this.settings);

    if (sensorStuck(this.recent)) this.sensorFault('stuck');
    else if (this.sim.state.fault == null) this.faultSent = false;

    // One leak = one alert: report again only after the floor has dried.
    if (r.water < this.settings.wetThreshold / 2) this.leakLatched = false;

    // Leak confirmed: shut the water first, then tell the server.
    const source = shouldAlert(this.assessment, this.settings);
    if (source && !this.leakLatched && !this.activeAlert && !this.eventPending) {
      this.leakLatched = true;
      if (this.settings.autoClose) this.valve = 'closed';
      if (this.test?.state === 'running') this.test = { ...this.test, state: 'cancelled' };
      const f = this.assessment.features!;
      this.sendEvent('leak', {
        source,
        reason: T[this.lang].leak(f.waterNow, f.growthPerMin, this.assessment.mlScore),
        valveClosed: this.valve === 'closed',
        snapshot: this.snapshot({ valveClosed: this.valve === 'closed' }),
      });
    }

    this.stepPressureTest(r);
    this.watchFlow(r);
    if (Date.now() - this.lastLive >= LIVE_EVERY_MS) this.pushLive();
    this.emit();
  }

  /** Water running without a stop for a long time (a hidden leak never stops): test the pipe. */
  private watchFlow(r: Reading) {
    if (this.valve === 'open' && (r.flow ?? 0) > 0.1 && this.test?.state !== 'running') {
      this.flowSeconds++;
      if (this.flowSeconds === this.settings.flowAlarmSec) this.beginTest(true);
    } else if (this.test?.state !== 'running') {
      this.flowSeconds = 0;
    }
  }

  private stepPressureTest(r: Reading) {
    if (!this.test || this.test.state !== 'running') return;
    this.test = stepTest(this.test, r.pressure, this.settings);
    if (this.test.state === 'running') return;
    this.flowSeconds = 0;
    if (this.test.state === 'failed') {
      this.valve = 'closed';
      this.sendEvent('hidden_leak', {
        source: 'pressure_test',
        reason: T[this.lang].hidden(this.test.drop ?? 0),
        valveClosed: true,
        snapshot: this.snapshot({ pressureDrop: this.test.drop, valveClosed: true }),
      });
    } else {
      // passed or cancelled (water in use): back to what the home wants
      this.valve = this.valveTarget;
    }
  }

  private sensorFault(kind: 'unplugged' | 'stuck') {
    if (this.faultSent || this.activeAlert || this.eventPending) return;
    this.faultSent = true;
    if (this.settings.failSafeClose) this.valve = 'closed';
    this.sendEvent('sensor_fault', {
      source: 'watchdog',
      reason: T[this.lang][kind],
      valveClosed: this.valve === 'closed',
      snapshot: this.snapshot({ valveClosed: this.valve === 'closed' }),
    });
  }

  private sendEvent(type: 'leak' | 'hidden_leak' | 'sensor_fault', extra: { source: string; reason: string; valveClosed: boolean; snapshot: unknown }) {
    this.eventPending = true;
    this.pushLive();
    this.api
      .event(type, extra)
      .then((res) => {
        if (res.alertId) this.activeAlert = res.alertId;
      })
      .catch(() => {})
      .finally(() => (this.eventPending = false));
  }

  private snapshot(extra: Record<string, unknown>) {
    const r = this.latest;
    const f = this.assessment?.features;
    return {
      water: r?.water ?? null,
      humidity: r?.humidity ?? null,
      baselineHumidity: this.baseline.humidity,
      pressure: r?.pressure ?? null,
      baselinePressure: this.baseline.pressure,
      flow: r?.flow ?? null,
      mlScore: this.assessment?.mlScore ?? null,
      growthPerMin: f ? Math.round(f.growthPerMin) : null,
      waterLost: Math.round(this.sim.state.lost * 10) / 10,
      ...extra,
    };
  }

  private pushLive() {
    this.lastLive = Date.now();
    const unplugged = this.sim.state.fault === 'unplugged';
    const r = unplugged ? null : this.latest;
    const o = this.sim.overrides;
    const live: LiveStatus = {
      water: r?.water ?? null,
      wet: !unplugged && this.isWet(),
      humidity: r?.humidity ?? null,
      temp: r?.temp ?? null,
      pressure: r?.pressure ?? null,
      flow: r?.flow ?? null,
      levelCm: unplugged ? null : Math.round(this.sim.state.puddle * 30) / 10,
      waterLost: Math.round(this.sim.state.lost * 10) / 10,
      mlScore: unplugged ? null : (this.assessment?.mlScore ?? null),
      growthPerMin: unplugged ? null : (this.assessment?.features?.growthPerMin ?? null),
      valve: this.valve,
      battery: null,
      rssi: -58,
      calibrated: this.baseline.calibrated,
      samples: this.baseline.samples,
      firmware: 'ag-demo 1.0',
      sensors: {
        water: unplugged ? 'missing' : this.sim.state.fault === 'stuck' ? 'stuck' : o.water != null ? 'simulated' : 'ok',
        humidity: o.humidity != null ? 'simulated' : 'ok',
        pressure: 'simulated',
        flow: 'simulated',
      },
      test: this.test,
    };
    this.api
      .live(live)
      .then((cfg) => this.applyConfig(cfg, false))
      .catch(() => {});
  }
}
