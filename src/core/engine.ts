import { DEFAULT_CONTACTS, DEFAULT_SETTINGS } from './defaults';
import { assess, emptyBaseline, shouldAlert, updateBaseline } from './detection';
import type {
  Actor,
  AlertEvent,
  Assessment,
  Baseline,
  Contact,
  LinkStatus,
  PressureTest,
  Reading,
  Resolution,
  Settings,
  Stage,
  Trigger,
  ValveState,
} from './types';

// GuardEngine is the app's view model of one zone, plus the same alert state
// machine the server runs (used to test the whole chain without a network):
//
//   IDLE -> EVENT_DETECTED -> LOCAL_ASSISTANCE --(nobody at home presses the button)--> ESCALATE
//                                   |  local ack                                          | member ack
//                                   v                                                     v
//                                RESOLVED ------------------> back to IDLE <---------------+
//
// The valve closes the moment a leak is confirmed (autoClose), before anyone is
// alerted: the response target is "water stopped in less than 10 s".
// Phones only mirror the server (mirror()); the node and the server do the work.

export interface Notifier {
  send(contact: Contact, channel: 'push' | 'sms', event: AlertEvent, zoneName: string): void;
}

export interface EngineState {
  settings: Settings;
  contacts: Contact[];
  link: LinkStatus;
  latest: Reading | null;
  recent: Reading[];
  baseline: Baseline;
  assessment: Assessment | null;
  stage: Stage;
  active: AlertEvent | null;
  history: AlertEvent[];
  cooldownUntil: number;
  /** Valve position reported by the node. */
  valve: ValveState | null;
  /** Valve position the home wants (server). */
  valveTarget: ValveState;
  /** Last or running night pressure test. */
  test: PressureTest | null;
  /** Litres lost through leaks (estimate from the flow). */
  waterLost: number | null;
}

const RECENT_MAX = 90;
const RESOLVED_HOLD_MS = 5000;
const HISTORY_MAX = 200;

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export class GuardEngine {
  private s: EngineState;
  private listeners = new Set<() => void>();
  private notifier: Notifier;
  private resolvedAtStage: number | null = null;
  private faultRaisedFor: number | null = null;
  private leakLatched = false;

  constructor(notifier: Notifier, initial?: Partial<EngineState>) {
    this.notifier = notifier;
    this.s = {
      settings: DEFAULT_SETTINGS,
      contacts: DEFAULT_CONTACTS,
      link: { connected: false, battery: null, rssi: 0, lastSampleAt: null, connectedAt: null, firmware: '-' },
      latest: null,
      recent: [],
      baseline: emptyBaseline(),
      assessment: null,
      stage: 'IDLE',
      active: null,
      history: [],
      cooldownUntil: 0,
      valve: 'open',
      valveTarget: 'open',
      test: null,
      waterLost: null,
      ...initial,
    };
  }

  // ---- subscription (used by React via useSyncExternalStore) ----

  getState = (): EngineState => this.s;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<EngineState>) {
    this.s = { ...this.s, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ---- configuration ----

  /** Phones: show the state received from the server as-is (no local detection). */
  mirror(patch: Partial<EngineState>) {
    this.set(patch);
  }

  updateSettings(patch: Partial<Settings>) {
    this.set({ settings: { ...this.s.settings, ...patch } });
  }

  setContacts(contacts: Contact[]) {
    this.set({ contacts });
  }

  // ---- inputs from the node ----

  setLink(patch: Partial<LinkStatus>) {
    const wasConnected = this.s.link.connected;
    const connectedAt =
      patch.connected === true && !wasConnected ? Date.now() : patch.connected === false ? null : this.s.link.connectedAt;
    this.set({ link: { ...this.s.link, ...patch, connectedAt } });
  }

  ingest(r: Reading) {
    const { settings } = this.s;
    const baseline = updateBaseline(this.s.baseline, r, settings);
    const recent = [...this.s.recent, r].slice(-RECENT_MAX);
    const assessment = assess(recent, baseline, this.s.assessment?.streak ?? 0, settings);
    this.faultRaisedFor = null;
    this.set({ latest: r, recent, baseline, assessment, link: { ...this.s.link, lastSampleAt: r.at } });
    // One leak = one alert: a new leak alert only after the floor has dried.
    if (r.water < settings.wetThreshold / 2) this.leakLatched = false;

    const source = shouldAlert(assessment, settings);
    if (source && !this.leakLatched && this.s.stage === 'IDLE' && r.at >= this.s.cooldownUntil) {
      this.leakLatched = true;
      const f = assessment.features!;
      const closed = settings.autoClose;
      if (closed) this.set({ valve: 'closed', valveTarget: 'closed' });
      const reason =
        `Water on the floor sensor ${Math.round(f.waterNow)}%, growing ${Math.round(f.growthPerMin)}%/min ` +
        `over ${settings.windowSamples} readings` +
        (assessment.mlScore != null ? `. AI leak score ${Math.round(assessment.mlScore * 100)}%.` : '.');
      this.open(
        {
          kind: 'leak',
          reason,
          source,
          snapshot: { water: r.water, humidity: r.humidity, pressure: r.pressure, flow: r.flow, mlScore: assessment.mlScore, growthPerMin: f.growthPerMin, valveClosed: closed },
        },
        r.at,
      );
      if (closed) this.log('device', 'Water turned off automatically.', r.at);
    }
  }

  /** The night pressure test failed: hidden leak in the pipes or walls. */
  hiddenLeak(drop: number, now = Date.now()) {
    if (this.s.stage !== 'IDLE') return;
    this.set({ valve: 'closed', valveTarget: 'closed' });
    this.open(
      {
        kind: 'hidden_leak',
        reason: `Night pressure test: the pressure fell ${drop.toFixed(2)} bar with every tap closed.`,
        source: 'pressure_test',
        snapshot: { pressureDrop: drop, valveClosed: true },
      },
      now,
    );
  }

  // ---- timer: call once per second ----

  tick(now = Date.now()) {
    const { settings, link, stage, active } = this.s;

    // Fault: connected, but readings stopped. Never stay silent; fail-safe closes the water.
    if (link.connected && link.lastSampleAt != null && now - link.lastSampleAt > settings.staleSec * 1000 && stage === 'IDLE' && this.faultRaisedFor !== link.lastSampleAt) {
      this.faultRaisedFor = link.lastSampleAt;
      const closed = settings.failSafeClose;
      if (closed) this.set({ valve: 'closed', valveTarget: 'closed' });
      this.open(
        { kind: 'sensor_fault', reason: `No readings for more than ${settings.staleSec} s. The sensor may be unplugged.`, source: 'watchdog', snapshot: { valveClosed: closed } },
        now,
      );
      return;
    }

    if (!active) return;

    if (stage === 'EVENT_DETECTED') {
      this.patchActive(
        { stage: 'LOCAL_ASSISTANCE', deadline: now + settings.gracePeriodSec * 1000 },
        { actor: 'device', text: 'The sensor sounds its alarm at home (buzzer and light).' },
        now,
      );
      return;
    }

    if (stage === 'RESOLVED') {
      if (this.resolvedAtStage != null && now - this.resolvedAtStage >= RESOLVED_HOLD_MS) {
        this.resolvedAtStage = null;
        this.set({ stage: 'IDLE', active: null });
      }
      return;
    }

    if (active.deadline == null || now < active.deadline) return;

    if (stage === 'LOCAL_ASSISTANCE') {
      this.log('system', 'Nobody at home answered the alarm. Alerting the family.', now);
      this.escalateTo(1, now);
      return;
    }

    if (stage === 'ESCALATE') {
      const contacts = this.chain();
      const current = contacts[active.level - 1];
      if (current && !active.smsSentForLevel && current.sms) {
        this.notify(current, 'sms', now);
        this.patchActive({ smsSentForLevel: true, deadline: now + settings.nextContactSec * 1000 }, null, now);
        return;
      }
      if (active.level < contacts.length) {
        this.escalateTo(active.level + 1, now);
      } else {
        this.log('cloud', 'Nobody has answered yet. Alerting everyone again.', now);
        contacts.forEach((c) => {
          if (c.push) this.notify(c, 'push', now);
          if (c.sms) this.notify(c, 'sms', now);
        });
        this.patchActive({ deadline: now + settings.nextContactSec * 1000 }, null, now);
      }
    }
  }

  // ---- people ----

  /** Someone at home pressed the node button: "I have seen it". */
  localAcknowledge(now = Date.now()) {
    this.resolve('local_ack', 'Someone at home (sensor button)', now);
  }

  memberAcknowledge(name = 'Member (app)', now = Date.now()) {
    this.resolve('member_ack', name, now);
  }

  markFalseAlarm(name = 'Member (app)', now = Date.now()) {
    this.resolve('false_alarm', name, now);
  }

  /**
   * Turning the water back on: owners only, and never on a wet floor
   * (the same two rules the server and the node enforce).
   */
  reopenValve(role: 'owner' | 'member', now = Date.now()): 'ok' | 'not_allowed' | 'still_wet' {
    if (role !== 'owner') return 'not_allowed';
    if ((this.s.latest?.water ?? 0) >= this.s.settings.wetThreshold) return 'still_wet';
    this.set({ valve: 'open', valveTarget: 'open' });
    this.log('member', 'The owner turned the water back on.', now);
    return 'ok';
  }

  // ---- internals ----

  private chain(): Contact[] {
    return this.s.contacts.filter((c) => c.push || c.sms);
  }

  private open(trigger: Trigger, now: number) {
    const event: AlertEvent = {
      id: newId(),
      startedAt: now,
      trigger,
      stage: 'EVENT_DETECTED',
      deadline: null,
      level: 0,
      smsSentForLevel: false,
      timeline: [{ at: now, actor: 'device', text: `Detected: ${trigger.reason}` }],
      resolvedAt: null,
      resolution: null,
      resolvedBy: null,
    };
    this.set({ stage: 'EVENT_DETECTED', active: event });
  }

  private escalateTo(level: number, now: number) {
    const contact = this.chain()[level - 1];
    if (!contact) {
      this.log('system', 'No contacts to alert.', now);
      this.patchActive({ stage: 'ESCALATE', level, deadline: null }, null, now);
      return;
    }
    this.patchActive({ stage: 'ESCALATE', level, smsSentForLevel: false, deadline: now + this.s.settings.smsFallbackSec * 1000 }, null, now);
    if (contact.push) {
      this.notify(contact, 'push', now);
    } else if (contact.sms) {
      this.notify(contact, 'sms', now);
      this.patchActive({ smsSentForLevel: true, deadline: now + this.s.settings.nextContactSec * 1000 }, null, now);
    }
  }

  private notify(contact: Contact, channel: 'push' | 'sms', now: number) {
    const event = this.s.active;
    if (!event) return;
    this.notifier.send(contact, channel, event, this.s.settings.zoneName);
    this.log('cloud', `${channel === 'push' ? 'App alert' : 'SMS'} sent to ${contact.name}.`, now);
  }

  private resolve(resolution: Resolution, by: string, now: number) {
    const { active, stage } = this.s;
    if (!active || stage === 'RESOLVED') return;
    const label = resolution === 'false_alarm' ? `${by} closed the alert (false alarm).` : `${by} answered. Alert closed.`;
    const done: AlertEvent = {
      ...active,
      stage: 'RESOLVED',
      deadline: null,
      resolvedAt: now,
      resolution,
      resolvedBy: by,
      timeline: [...active.timeline, { at: now, actor: resolution === 'local_ack' ? 'local' : 'member', text: label }],
    };
    this.resolvedAtStage = now;
    this.set({
      stage: 'RESOLVED',
      active: done,
      history: [done, ...this.s.history].slice(0, HISTORY_MAX),
      cooldownUntil: now + this.s.settings.cooldownSec * 1000,
      assessment: this.s.assessment ? { ...this.s.assessment, streak: 0 } : null,
    });
  }

  private log(actor: Actor, text: string, now = Date.now()) {
    if (!this.s.active) return;
    this.patchActive({}, { actor, text }, now);
  }

  private patchActive(patch: Partial<AlertEvent>, entry: { actor: Actor; text: string } | null, now: number) {
    const a = this.s.active;
    if (!a) return;
    const next: AlertEvent = { ...a, ...patch, timeline: entry ? [...a.timeline, { at: now, ...entry }] : a.timeline };
    this.set({ active: next, stage: next.stage });
  }
}
