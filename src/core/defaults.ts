import type { Contact, Settings } from './types';

// Timers are in seconds and deliberately short so the whole chain can be shown
// live (the night pressure test lasts 15 s instead of 15 min). A real home would
// use minutes.
export const DEFAULT_SETTINGS: Settings = {
  zoneName: 'Kitchen',
  gracePeriodSec: 20,
  smsFallbackSec: 20,
  nextContactSec: 40,
  snoozeSec: 60,
  wetThreshold: 30,
  windowSamples: 8,
  leakScoreThreshold: 0.8,
  sustainSamples: 3,
  autoClose: true,
  failSafeClose: true,
  staleSec: 10,
  cooldownSec: 30,
  calibrationSamples: 15,
  flowAlarmSec: 45,
  testSec: 15,
  testDropBar: 0.2,
  soundEnabled: true,
  showTechnical: false,
  backgroundWatch: true,
  demoMode: true,
};

export const DEFAULT_CONTACTS: Contact[] = [
  {
    id: 'c1', name: 'Sami', role: 'family', phone: '+216 20 000 001', push: true, sms: true,
    avatar: { bg: '#CDE7FF', skin: '#E3A77F', hair: 'short', hairColor: '#2B2340', eyes: 'happy', mouth: 'smile', accessory: 'none' },
  },
  {
    id: 'c2', name: 'Leila', role: 'family', phone: '+216 20 000 002', push: true, sms: true,
    avatar: { bg: '#FFD1DC', skin: '#E3A77F', hair: 'long', hairColor: '#2B2340', eyes: 'wink', mouth: 'grin', accessory: 'glasses' },
  },
  {
    id: 'c3', name: 'Neighbour', role: 'neighbour', phone: '+216 20 000 003', push: false, sms: true,
    avatar: { bg: '#D9F2D0', skin: '#F6C9A4', hair: 'bun', hairColor: '#A0612F', eyes: 'happy', mouth: 'smile', accessory: 'none' },
  },
];
