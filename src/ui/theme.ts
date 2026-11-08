import type { Stage } from '../core/types';

// Clear water palette. Status colors (good / attention / urgent) are reserved
// for state and always ship with an icon + label, never color alone.
export const colors = {
  bg: '#F1F6FA',
  card: '#FFFFFF',
  text: '#12263A',
  muted: '#6C7F93',
  faint: '#B1C0CF',
  border: '#E1EAF2',
  primary: '#1786DB',
  primarySoft: '#E4F1FC',
  violet: '#6C63F2',
  violetSoft: '#F1F0FE',
  good: '#12A07A',
  goodSoft: '#E3F5EE',
  attention: '#E8962E',
  attentionSoft: '#FDF3E3',
  urgent: '#E5484D',
  urgentSoft: '#FDECEC',
  water: '#1E9BE9',
  humidity: '#7B93F2',
  pressure: '#0E9F9F',
  flow: '#2CB67D',
  warning: '#B7791F',
};

export type Mood = 'calm' | 'learning' | 'attention' | 'urgent' | 'resolved' | 'offline' | 'closed';

export const moods: Record<Mood, { gradient: [string, string]; tint: string }> = {
  calm: { gradient: ['#2296EE', '#14B5C8'], tint: colors.primary },
  learning: { gradient: ['#4FA3EE', '#5FC6E6'], tint: colors.primary },
  attention: { gradient: ['#F6B54D', '#EE8448'], tint: colors.attention },
  urgent: { gradient: ['#F0606A', '#D2386C'], tint: colors.urgent },
  resolved: { gradient: ['#34C38F', '#1C9DA6'], tint: colors.good },
  offline: { gradient: ['#8E9BAE', '#66748A'], tint: colors.muted },
  closed: { gradient: ['#4E6A8F', '#2F4A6E'], tint: colors.text },
};

export function stageMood(stage: Stage): Mood {
  switch (stage) {
    case 'EVENT_DETECTED':
    case 'LOCAL_ASSISTANCE':
      return 'attention';
    case 'ESCALATE':
      return 'urgent';
    case 'RESOLVED':
      return 'resolved';
    default:
      return 'calm';
  }
}

export const radius = 22;
export const space = (n: number) => n * 4;

export const shadow = {
  shadowColor: '#12263A',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
};
