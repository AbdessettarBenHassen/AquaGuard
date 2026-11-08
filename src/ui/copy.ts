import type { EngineState } from '../core/engine';
import type { AlertEvent, Contact, TriggerKind } from '../core/types';
import { locale, t } from '../i18n';
import type { IconName } from './Icon';
import type { Mood } from './theme';

// Plain-language wording for the family. No jargon, no stage names.

export interface StatusChip {
  icon: IconName;
  text: string;
  /** true = this sign looks off (warning tint). */
  alert?: boolean;
}

export interface FriendlyStatus {
  mood: Mood;
  title: string;
  chips: StatusChip[];
}

const pct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x)}%`);

export function friendlyStatus(s: EngineState): FriendlyStatus {
  const zone = s.settings.zoneName;
  const { active, stage, link, baseline, latest, valve, test } = s;

  if (active && stage === 'RESOLVED') {
    return { mood: 'resolved', title: t('st.sorted'), chips: [{ icon: 'check', text: whoResolved(active) }] };
  }
  if (active && (stage === 'EVENT_DETECTED' || stage === 'LOCAL_ASSISTANCE')) {
    return { mood: 'attention', title: alertTitle(active.trigger.kind, zone), chips: [...alertChips(active), { icon: 'siren', text: t('chip.alarmHome') }] };
  }
  if (active && stage === 'ESCALATE') {
    const contact = currentContact(s);
    return {
      mood: 'urgent',
      title: t('st.noAnswer', { zone }),
      chips: [{ icon: 'close', text: t('chip.noAnswer'), alert: true }, ...(contact ? [{ icon: 'phone' as IconName, text: t('chip.alerted', { name: contact.name }) }] : [])],
    };
  }
  if (!link.connected) return { mood: 'offline', title: t('st.offline'), chips: [{ icon: 'wifiOff', text: t('chip.noSignal') }] };
  if (link.sensorIssue === 'missing') return { mood: 'offline', title: t('st.unplugged'), chips: [{ icon: 'sensor', text: t('chip.checkCable'), alert: true }, valveChip(valve)] };
  if (link.sensorIssue === 'stuck') return { mood: 'offline', title: t('st.stuck'), chips: [{ icon: 'sensor', text: t('chip.cleanSensor'), alert: true }, valveChip(valve)] };
  if (test?.state === 'running') {
    return {
      mood: 'learning',
      title: t('st.testing'),
      chips: [{ icon: 'gauge', text: t('chip.drop', { bar: (test.drop ?? 0).toFixed(2) }) }, { icon: 'clock', text: `${Math.max(0, s.settings.testSec - test.elapsed)} s` }],
    };
  }
  if (valve === 'closed') {
    return { mood: 'closed', title: t('st.waterOff'), chips: [{ icon: 'valve', text: t('chip.valveClosed') }, { icon: 'lock', text: t('chip.ownerOpens') }] };
  }
  if (latest && latest.water >= s.settings.wetThreshold) {
    return { mood: 'attention', title: t('st.wetFloor'), chips: [{ icon: 'drop', text: pct(latest.water), alert: true }, valveChip(valve)] };
  }
  if (!baseline.calibrated) {
    return { mood: 'learning', title: t('st.learning'), chips: [{ icon: 'clock', text: `${baseline.samples}/${s.settings.calibrationSamples}` }, valveChip(valve)] };
  }
  return {
    mood: 'calm',
    title: t('st.allDry'),
    chips: [
      { icon: 'drop', text: waterLabel(latest?.water ?? null, s.settings.wetThreshold) },
      { icon: 'humidity', text: pct(latest?.humidity) },
      valveChip(valve),
    ],
  };
}

function valveChip(v: EngineState['valve']): StatusChip {
  return v === 'closed' ? { icon: 'valve', text: t('chip.waterOff'), alert: true } : { icon: 'valve', text: t('chip.waterOn') };
}

/** Symbol chips describing why an alert fired. */
export function alertChips(e: AlertEvent): StatusChip[] {
  const s = e.trigger.snapshot;
  const valve: StatusChip = s.valveClosed ? { icon: 'valve', text: t('chip.waterOff') } : { icon: 'valve', text: t('chip.waterOn'), alert: true };
  if (e.trigger.kind === 'sensor_fault') return [{ icon: 'sensor', text: t('chip.noReadings'), alert: true }, valve];
  if (e.trigger.kind === 'hidden_leak') return [{ icon: 'gauge', text: `−${(s.pressureDrop ?? 0).toFixed(2)} bar`, alert: true }, { icon: 'wall', text: t('chip.inWall') }, valve];
  return [{ icon: 'drop', text: pct(s.water), alert: true }, ...(s.growthPerMin != null && s.growthPerMin > 0 ? [{ icon: 'arrowUp' as IconName, text: `${Math.round(s.growthPerMin)}%/min` }] : []), valve];
}

export function alertTitle(kind: TriggerKind, zone: string) {
  if (kind === 'leak') return t('st.leak', { zone });
  if (kind === 'hidden_leak') return t('st.hidden', { zone });
  return t('st.fault', { zone });
}

export function triggerShort(kind: TriggerKind) {
  return kind === 'leak' ? t('kind.leak') : kind === 'hidden_leak' ? t('kind.hidden') : t('kind.fault');
}

export const triggerIcon: Record<TriggerKind, IconName> = {
  leak: 'drop',
  hidden_leak: 'wall',
  sensor_fault: 'sensor',
};

/** Icon colors per alert type: a leak is shown as danger. */
export const triggerTone: Record<TriggerKind, { color: string; bg: string }> = {
  leak: { color: '#E5484D', bg: '#FDECEC' },
  hidden_leak: { color: '#B7791F', bg: '#FDF3E3' },
  sensor_fault: { color: '#6C7F93', bg: '#EEF2F6' },
};

export function whoResolved(e: AlertEvent) {
  if (e.resolution === 'local_ack') return t('who.home');
  return e.resolvedBy ?? t('who.member');
}

export function outcomeLabel(e: AlertEvent): { text: string; tone: 'good' | 'attention' | 'muted' } {
  if (e.resolution === 'local_ack') return { text: t('out.home'), tone: 'good' };
  if (e.resolution === 'false_alarm') return { text: t('out.false'), tone: 'muted' };
  if (e.resolution === 'member_ack') return { text: e.level > 0 ? t('out.family') : t('out.app'), tone: 'attention' };
  return { text: t('out.open'), tone: 'attention' };
}

/** Human explanation of why an alert fired, built from the saved snapshot. */
export function friendlyReason(e: AlertEvent) {
  const s = e.trigger.snapshot;
  const off = s.valveClosed ? ` ${t('why.valveOff')}` : '';
  if (e.trigger.kind === 'sensor_fault') return (e.trigger.reason || t('why.fault')) + off;
  if (e.trigger.kind === 'hidden_leak') return t('why.hidden', { bar: (s.pressureDrop ?? 0).toFixed(2) }) + off;
  return t('why.leak', { water: pct(s.water), growth: Math.round(s.growthPerMin ?? 0), score: s.mlScore != null ? Math.round(s.mlScore * 100) : '–' }) + off;
}

export function waterLabel(water: number | null, wetThreshold: number) {
  if (water == null) return '–';
  if (water < wetThreshold / 3) return t('water.dry');
  if (water < wetThreshold) return t('water.damp');
  return t('water.wet');
}

export function greeting(now: number) {
  const h = new Date(now).getHours();
  if (h < 12) return t('hello.morning');
  if (h < 18) return t('hello.afternoon');
  return t('hello.evening');
}

export function relativeDay(ms: number, now = Date.now()) {
  const d = new Date(ms);
  const today = new Date(now);
  const yest = new Date(now - 86400000);
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return t('day.today', { time });
  if (d.toDateString() === yest.toDateString()) return t('day.yesterday', { time });
  return `${d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function currentContact(s: EngineState): Contact | null {
  if (!s.active || s.active.level < 1) return null;
  return s.contacts.filter((c) => c.push || c.sms)[s.active.level - 1] ?? null;
}
