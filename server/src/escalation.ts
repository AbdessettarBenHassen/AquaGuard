import { tr, type Lang } from './i18n.js';

// Server-owned escalation: the timers live here, so the family is alerted even
// when every phone is off. Same state machine as the app's engine:
//
//   LOCAL_ASSISTANCE --(grace period, nobody at home pressed the button)--> ESCALATE level 1 (push)
//   ESCALATE: SMS fallback -> next contact -> ... -> re-alert whole chain
//
// Pure function: given an open alert and the time, returns the steps that
// should have happened. Catches up several steps if nobody looked for a while.

export interface Timers {
  gracePeriodSec: number;
  smsFallbackSec: number;
  nextContactSec: number;
}

export const DEFAULT_TIMERS: Timers = { gracePeriodSec: 20, smsFallbackSec: 20, nextContactSec: 40 };

export interface ChainContact {
  name: string;
  role: string;
  phone: string;
  push: boolean;
  sms: boolean;
}

export interface Entry {
  at: number;
  actor: 'system' | 'device' | 'local' | 'member' | 'cloud';
  text: string;
}

export interface OpenAlert {
  stage: string;
  level: number;
  smsSentForLevel: boolean;
  deadline: number | null;
}

export interface Notification {
  contact: ChainContact | null; // null = every member's phone
  channel: 'push' | 'sms';
}

export interface Step extends OpenAlert {
  entries: Entry[];
  notifications: Notification[];
}

export function advance(a: OpenAlert, chain: ChainContact[], t: Timers, now: number, lang: Lang = 'en'): Step | null {
  const contacts = chain.filter((c) => c.push || c.sms);
  let s: OpenAlert = { ...a };
  const entries: Entry[] = [];
  const notifications: Notification[] = [];
  let changed = false;

  const notify = (c: ChainContact, channel: 'push' | 'sms', at: number) => {
    notifications.push({ contact: c, channel });
    entries.push({ at, actor: 'cloud', text: tr(lang, channel === 'push' ? 'esc.sent.push' : 'esc.sent.sms', { name: c.name }) });
  };

  const escalateTo = (level: number, at: number) => {
    const c = contacts[level - 1];
    if (!c) {
      entries.push({ at, actor: 'system', text: tr(lang, 'esc.noContacts') });
      s = { stage: 'ESCALATE', level, smsSentForLevel: false, deadline: null };
      return;
    }
    if (c.push) {
      notify(c, 'push', at);
      s = { stage: 'ESCALATE', level, smsSentForLevel: false, deadline: at + t.smsFallbackSec * 1000 };
    } else {
      notify(c, 'sms', at);
      s = { stage: 'ESCALATE', level, smsSentForLevel: true, deadline: at + t.nextContactSec * 1000 };
    }
  };

  for (let i = 0; i < 25 && s.deadline != null && s.deadline <= now; i++) {
    const at = s.deadline;
    changed = true;
    if (s.stage === 'LOCAL_ASSISTANCE') {
      entries.push({ at, actor: 'system', text: tr(lang, 'esc.graceOver') });
      notifications.push({ contact: null, channel: 'push' });
      escalateTo(1, at);
      continue;
    }
    if (s.stage === 'ESCALATE') {
      const current = contacts[s.level - 1];
      if (current && !s.smsSentForLevel && current.sms) {
        notify(current, 'sms', at);
        s = { ...s, smsSentForLevel: true, deadline: at + t.nextContactSec * 1000 };
      } else if (s.level < contacts.length) {
        escalateTo(s.level + 1, at);
      } else {
        entries.push({ at, actor: 'cloud', text: tr(lang, 'esc.again') });
        for (const c of contacts) {
          if (c.push) notify(c, 'push', at);
          if (c.sms) notify(c, 'sms', at);
        }
        s = { ...s, deadline: at + t.nextContactSec * 1000 };
      }
      continue;
    }
    break;
  }
  return changed ? { ...s, entries, notifications } : null;
}
