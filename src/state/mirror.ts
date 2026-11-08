import type { HomeState, ZoneInfo } from '../api/client';
import { DEFAULT_SETTINGS } from '../core/defaults';
import type { EngineState } from '../core/engine';
import type { AlertEvent, Reading, Settings } from '../core/types';

// Turns the server's home state into the view model the screens use
// (EngineState), for the selected zone. Phones never run detection: the node
// does, and the server runs the escalation countdown.

export const ZONE_KEYS = [
  'wetThreshold',
  'windowSamples',
  'leakScoreThreshold',
  'sustainSamples',
  'autoClose',
  'failSafeClose',
  'staleSec',
  'cooldownSec',
  'calibrationSamples',
  'flowAlarmSec',
  'testSec',
  'testDropBar',
] as const;
export const HOME_KEYS = ['gracePeriodSec', 'smsFallbackSec', 'nextContactSec', 'snoozeSec'] as const;
export const DEVICE_KEYS = ['demoMode', 'soundEnabled', 'showTechnical', 'backgroundWatch'] as const;

export type DevicePrefs = Pick<Settings, (typeof DEVICE_KEYS)[number]>;

export function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]) {
  const r = {} as Pick<T, K>;
  for (const k of keys) r[k] = o[k];
  return r;
}

const RESOLVED_HOLD_MS = 5000;

export interface MirrorMemo {
  zoneId: string | null;
  lastLiveKey: string | null;
  recent: Reading[];
  hold: { id: string; until: number } | null;
  prevActiveId: string | null;
}

export const newMemo = (): MirrorMemo => ({ zoneId: null, lastLiveKey: null, recent: [], hold: null, prevActiveId: null });

export function mirrorZone(r: HomeState, zone: ZoneInfo, prefs: DevicePrefs, memo: MirrorMemo): Partial<EngineState> {
  const now = Date.now();
  if (memo.zoneId !== zone.id) Object.assign(memo, newMemo(), { zoneId: zone.id });

  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...pick({ ...DEFAULT_SETTINGS, ...r.home.settings }, HOME_KEYS),
    ...pick({ ...DEFAULT_SETTINGS, ...zone.settings }, ZONE_KEYS),
    zoneName: zone.name,
    ...prefs,
  };

  const d = zone.device;
  const live = d?.live ?? null;
  let latest: Reading | null = null;
  if (d?.online && live) {
    latest = { at: now, water: live.water ?? 0, humidity: live.humidity, temp: live.temp, pressure: live.pressure, flow: live.flow };
    const key = `${d.liveAgeMs != null ? Math.round((r.serverTime - d.liveAgeMs) / 1000) : ''}|${live.water}|${live.pressure}`;
    if (key !== memo.lastLiveKey) {
      memo.lastLiveKey = key;
      memo.recent = [...memo.recent, latest].slice(-90);
    }
  }

  // Active alert, plus a short "All sorted" moment after it closes.
  const history = r.history.filter((h) => h.zoneId === zone.id) as AlertEvent[];
  let active: AlertEvent | null = zone.active;
  if (!active && memo.prevActiveId) {
    const closed = history.find((h) => h.id === memo.prevActiveId);
    if (closed) memo.hold = { id: closed.id, until: now + RESOLVED_HOLD_MS };
  }
  memo.prevActiveId = zone.active?.id ?? null;
  let stage: EngineState['stage'] = active?.stage ?? 'IDLE';
  if (!active && memo.hold && now < memo.hold.until) {
    active = history.find((h) => h.id === memo.hold!.id) ?? null;
    stage = active ? 'RESOLVED' : 'IDLE';
  }
  if (active?.deadline) active = { ...active, deadline: active.deadline - r.serverTime + now };

  const sensors = live?.sensors;
  return {
    settings,
    contacts: r.contacts,
    link: {
      connected: !!d?.online,
      battery: live?.battery ?? null,
      rssi: live?.rssi ?? 0,
      lastSampleAt: d?.online ? now : null,
      connectedAt: d?.linkedAt ?? null,
      firmware: d?.firmware ?? (d ? '–' : 'No sensor'),
      sensorIssue: !d?.online ? null : sensors?.water === 'missing' ? 'missing' : sensors?.water === 'stuck' ? 'stuck' : null,
    },
    latest,
    recent: memo.recent,
    baseline: zone.baseline ?? { humidity: null, pressure: null, samples: live?.samples ?? 0, calibrated: !!live?.calibrated },
    assessment: live
      ? { features: null, mlScore: live.mlScore, ruleHit: false, mlHit: false, streak: 0, suppressed: null }
      : null,
    active,
    stage,
    history,
    valve: d?.online ? (live?.valve ?? null) : null,
    valveTarget: d?.valveTarget ?? 'open',
    test: live?.test ?? null,
    waterLost: live?.waterLost ?? null,
  };
}
