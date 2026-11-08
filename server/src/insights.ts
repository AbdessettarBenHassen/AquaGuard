import { tr, type Lang } from './i18n.js';

// What AquaGuard has learned about one zone, computed from the data only (no
// AI model): the room's usual humidity, when and how alerts happen, how fast
// the water was turned off, and plain findings. Used by the "What AquaGuard
// learned" page and as the facts the AI assistant reads.

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Same values as the app (src/core/defaults.ts).
const DEFAULTS = { wetThreshold: 30, leakScoreThreshold: 0.8, sustainSamples: 3, windowSamples: 8, calibrationSamples: 15 };

export type TimeSlot = 'night' | 'morning' | 'afternoon' | 'evening';

export interface Insights {
  days: number;
  profile: {
    calibrated: boolean;
    samples: number;
    calibrationSamples: number;
    baselineHumidity: number | null;
    baselinePressure: number | null;
    thresholds: { wetThreshold: number; leakScoreThreshold: number; sustainSamples: number; windowSamples: number };
  };
  alerts: {
    total: number;
    byKind: Record<string, number>;
    byTime: Record<TimeSlot, number>;
    bySource: Record<string, number>;
    outcomes: { localAnswered: number; memberAnswered: number; falseAlarm: number; contactsReached: number; open: number };
    falseAlarmRate: number | null; // among closed leak alerts
    avgMinutesToClose: number | null;
    avgSecondsToShutOff: number | null; // leak detected -> valve closed
    avgGrowthPerMin: number | null; // how fast leaks grew on the sensor (% per minute)
    autoShutOffs: number;
    manualShutOffs: number;
    thisWeek: number;
    lastWeek: number;
  };
  confidence: 'learning' | 'low' | 'medium' | 'high';
  findings: string[];
  suggestions: string[];
}

export function slotOf(date: Date, tzOffsetMin: number): TimeSlot {
  // tzOffsetMin follows JS getTimezoneOffset(): UTC - local, in minutes (Tunisia: -60)
  const local = new Date(date.getTime() - tzOffsetMin * 60000);
  const h = local.getUTCHours();
  if (h >= 22 || h < 6) return 'night';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

const pct = (a: number, b: number) => Math.round((a / b) * 100);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

export function computeInsights(
  zone: Row,
  alerts: Row[],
  valves: Row[],
  opts: { days: number; tzOffsetMin: number; lang?: Lang; now?: number },
): Insights {
  const now = opts.now ?? Date.now();
  const lang = opts.lang ?? 'en';
  const settings = { ...DEFAULTS, ...(zone.settings ?? {}) };
  const b = zone.baseline ?? {};
  const profile: Insights['profile'] = {
    calibrated: !!b.calibrated,
    samples: Number(b.samples ?? 0),
    calibrationSamples: settings.calibrationSamples,
    baselineHumidity: b.humidity != null ? Math.round(b.humidity) : null,
    baselinePressure: b.pressure != null ? Math.round(b.pressure * 100) / 100 : null,
    thresholds: {
      wetThreshold: settings.wetThreshold,
      leakScoreThreshold: settings.leakScoreThreshold,
      sustainSamples: settings.sustainSamples,
      windowSamples: settings.windowSamples,
    },
  };

  const byKind: Record<string, number> = {};
  const byTime: Record<TimeSlot, number> = { night: 0, morning: 0, afternoon: 0, evening: 0 };
  const bySource: Record<string, number> = {};
  const outcomes = { localAnswered: 0, memberAnswered: 0, falseAlarm: 0, contactsReached: 0, open: 0 };
  const closeMin: number[] = [];
  const shutOffSec: number[] = [];
  const growth: number[] = [];
  let leakClosed = 0;
  let leakFalse = 0;
  let thisWeek = 0;
  let lastWeek = 0;

  for (const a of alerts) {
    const started = new Date(a.started_at);
    byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    byTime[slotOf(started, opts.tzOffsetMin)]++;
    const snap = a.snapshot ?? {};
    if (a.source) bySource[a.source] = (bySource[a.source] ?? 0) + 1;
    if (a.resolution === 'local_ack') outcomes.localAnswered++;
    else if (a.resolution === 'member_ack') outcomes.memberAnswered++;
    else if (a.resolution === 'false_alarm') outcomes.falseAlarm++;
    else if (!a.resolution) outcomes.open++;
    if (Number(a.level) > 0) outcomes.contactsReached++;
    if (a.resolved_at) closeMin.push((new Date(a.resolved_at).getTime() - started.getTime()) / 60000);
    if (a.kind !== 'sensor_fault') {
      if (a.resolution) {
        leakClosed++;
        if (a.resolution === 'false_alarm') leakFalse++;
      }
      if (snap.growthPerMin != null) growth.push(Number(snap.growthPerMin));
      // First valve close in the 5 minutes after the leak was confirmed.
      const closed = valves
        .filter((v) => v.action === 'closed')
        .map((v) => new Date(v.at).getTime() - started.getTime())
        .filter((d) => d >= -3000 && d < 300000)
        .sort((x, y) => x - y)[0];
      if (closed != null) shutOffSec.push(Math.max(0, closed / 1000));
    }
    const age = now - started.getTime();
    if (age < 7 * 86400000) thisWeek++;
    else if (age < 14 * 86400000) lastWeek++;
  }

  const total = alerts.length;
  const leaks = (byKind.leak ?? 0) + (byKind.hidden_leak ?? 0);
  const faults = byKind.sensor_fault ?? 0;
  const falseAlarmRate = leakClosed ? leakFalse / leakClosed : null;
  const confidence: Insights['confidence'] = !profile.calibrated ? 'learning' : leaks < 3 ? 'low' : leaks < 10 ? 'medium' : 'high';
  const autoShutOffs = valves.filter((v) => v.action === 'closed' && v.by_kind === 'device').length;
  const manualShutOffs = valves.filter((v) => v.action === 'closed' && v.by_kind === 'person').length;

  const findings: string[] = [];
  const suggestions: string[] = [];
  if (!profile.calibrated) {
    findings.push(tr(lang, 'in.learning', { samples: profile.samples, total: profile.calibrationSamples }));
  } else if (profile.baselineHumidity != null) {
    findings.push(tr(lang, 'in.usual', { hum: profile.baselineHumidity, wet: profile.thresholds.wetThreshold }));
  }
  if (total === 0) {
    findings.push(tr(lang, 'in.none', { days: opts.days }));
  } else {
    findings.push(tr(lang, 'in.total', { total, days: opts.days, leaks, faults }));
    const top = (Object.entries(byTime) as [TimeSlot, number][]).sort((x, y) => y[1] - x[1])[0];
    if (top[1] >= 2 && top[1] / total >= 0.5) findings.push(tr(lang, 'in.slot', { slot: tr(lang, `slot.${top[0]}`), n: top[1], total }));
    if (thisWeek > lastWeek + 1) findings.push(tr(lang, 'in.more', { a: thisWeek, b: lastWeek }));
    else if (lastWeek > thisWeek + 1) findings.push(tr(lang, 'in.fewer', { a: thisWeek, b: lastWeek }));
    if (avg(shutOffSec) != null) findings.push(tr(lang, 'in.response', { sec: avg(shutOffSec)! }));
    const closed = outcomes.localAnswered + outcomes.memberAnswered + outcomes.falseAlarm;
    if (closed >= 2) findings.push(tr(lang, 'in.local', { pct: pct(outcomes.localAnswered, closed), esc: outcomes.contactsReached }));
    if (avg(growth) != null) findings.push(tr(lang, 'in.growth', { rate: avg(growth)! }));
  }
  if (falseAlarmRate != null && leakClosed >= 4 && falseAlarmRate >= 0.5) suggestions.push(tr(lang, 'in.sug.false', { pct: pct(leakFalse, leakClosed) }));
  if (faults >= 2) suggestions.push(tr(lang, 'in.sug.fault'));
  if (outcomes.contactsReached >= 2) suggestions.push(tr(lang, 'in.sug.esc'));
  if (byTime.night >= 2 && leaks >= 2) suggestions.push(tr(lang, 'in.sug.night'));

  return {
    days: opts.days,
    profile,
    alerts: {
      total,
      byKind,
      byTime,
      bySource,
      outcomes,
      falseAlarmRate,
      avgMinutesToClose: avg(closeMin),
      avgSecondsToShutOff: avg(shutOffSec),
      avgGrowthPerMin: avg(growth),
      autoShutOffs,
      manualShutOffs,
      thisWeek,
      lastWeek,
    },
    confidence,
    findings,
    suggestions,
  };
}
