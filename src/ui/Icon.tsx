import Svg, { Path, Rect } from 'react-native-svg';

// Minimal stroke icon set (24x24 grid, 2px strokes, round caps).
export type IconName =
  | 'home'
  | 'clock'
  | 'users'
  | 'settings'
  | 'drop'
  | 'humidity'
  | 'thermo'
  | 'gauge'
  | 'flow'
  | 'valve'
  | 'tap'
  | 'shower'
  | 'wall'
  | 'wrench'
  | 'bolt'
  | 'power'
  | 'globe'
  | 'sensor'
  | 'kitchen'
  | 'bathroom'
  | 'laundry'
  | 'boiler'
  | 'garage'
  | 'battery'
  | 'link'
  | 'check'
  | 'bell'
  | 'shield'
  | 'chevron'
  | 'close'
  | 'flask'
  | 'phone'
  | 'sparkle'
  | 'alert'
  | 'wifiOff'
  | 'wifi'
  | 'up'
  | 'down'
  | 'trash'
  | 'plus'
  | 'minus'
  | 'volume'
  | 'arrowUp'
  | 'arrowDown'
  | 'dice'
  | 'siren'
  | 'chat'
  | 'send'
  | 'eye'
  | 'chart'
  | 'moon'
  | 'refresh'
  | 'lock';

const P: Record<IconName, string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V20h5v-6h4v6h5V9.5'],
  clock: ['M12 7v5l3 2', 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z'],
  users: [
    'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20',
    'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    'M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35',
    'M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  ],
  settings: [
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  ],
  drop: ['M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0L12 2.7Z'],
  humidity: ['M8 3.5 4.6 7a4.8 4.8 0 1 0 6.8 0L8 3.5Z', 'M16.5 9.5l-2.3 2.4a3.2 3.2 0 1 0 4.6 0l-2.3-2.4Z', 'M15 19h6', 'M3 21h12'],
  thermo: ['M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0Z', 'M12 9v6'],
  gauge: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 13l4-4', 'M12 13h.01', 'M7 16h10'],
  flow: ['M3 8c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.5 4-1.5', 'M3 13c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.5 4-1.5', 'M3 18c2.5-2 4.5-2 7 0s4.5 2 7 0 3-1.5 4-1.5'],
  valve: ['M2 14h6', 'M16 14h6', 'M8 11h8v6H8Z', 'M12 11V6', 'M8 6h8', 'M2 11v6', 'M22 11v6'],
  tap: ['M4 9h9a3 3 0 0 1 3 3v2', 'M4 7v4', 'M9 9V5', 'M6.5 5h5', 'M16 17.5v.5', 'M16 21v.01'],
  shower: ['M4 21V8a4 4 0 0 1 4-4h1a4 4 0 0 1 4 4', 'M10 8h6', 'M11 12v.01', 'M14 12v.01', 'M17 12v.01', 'M12 15v.01', 'M15 15v.01', 'M13 18v.01', 'M16 18v.01'],
  wall: ['M3 4h18v16H3Z', 'M3 9.5h18', 'M3 15h18', 'M9 4v5.5', 'M15 4v5.5', 'M6 9.5V15', 'M12 9.5V15', 'M18 9.5V15', 'M9 15v5', 'M15 15v5'],
  wrench: ['M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-2.5-2.5 6.3-6.3a4 4 0 0 1-5-5L13.3 5.7Z', 'M3 21l6-6', 'M6.5 14.5l3 3'],
  bolt: ['M13 2 4 14h7l-1 8 9-12h-7l1-8Z'],
  power: ['M12 3v9', 'M6.3 6.3a8 8 0 1 0 11.4 0'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  sensor: ['M5 15h14v4H5Z', 'M8 15v-3a4 4 0 0 1 8 0v3', 'M12 4v2', 'M5.6 6.6l1.4 1.4', 'M18.4 6.6 17 8'],
  kitchen: ['M5 10h14v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-8Z', 'M3 10h18', 'M9 3c0 1.5 1 1.5 1 3', 'M13 3c0 1.5 1 1.5 1 3'],
  bathroom: ['M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-2Z', 'M6 12V5a2 2 0 0 1 3.5-1.3', 'M7 19l-1 2', 'M17 19l1 2'],
  laundry: ['M5 3h14v18H5Z', 'M5 7h14', 'M12 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M8 5h.01'],
  boiler: ['M7 3h10v14H7Z', 'M12 13c-1.5 0-2-1-2-2 0-1.5 2-3 2-3s2 1.5 2 3c0 1-.5 2-2 2Z', 'M9 17v4', 'M15 17v4'],
  garage: ['M3 10 12 4l9 6v10H3Z', 'M7 20v-6h10v6', 'M7 17h10'],
  battery: ['M22 11v2'],
  link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
  check: ['M20 6 9 17l-5-5'],
  bell: ['M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', 'M9 12l2 2 4-4'],
  chevron: ['M9 18l6-6-6-6'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  flask: ['M9 3h6', 'M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21.5h11.6a2 2 0 0 0 1.7-3L14 9V3', 'M7 15h10'],
  phone: ['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z', 'M19 17l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'],
  wifiOff: ['M2 2l20 20', 'M8.5 16.4a5 5 0 0 1 7 0', 'M5 12.9a10 10 0 0 1 5.2-2.7', 'M19 12.9a10 10 0 0 0-2.4-1.6', 'M12 20h.01'],
  wifi: ['M2 9a15 15 0 0 1 20 0', 'M5 12.5a10 10 0 0 1 14 0', 'M8.5 16a5 5 0 0 1 7 0', 'M12 19.5h.01'],
  up: ['M18 15l-6-6-6 6'],
  down: ['M6 9l6 6 6-6'],
  trash: ['M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  volume: ['M11 5 6 9H2v6h4l5 4V5Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14'],
  arrowUp: ['M12 19V5', 'M5 12l7-7 7 7'],
  arrowDown: ['M12 5v14', 'M19 12l-7 7-7-7'],
  dice: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M8.5 8.5h.01', 'M15.5 8.5h.01', 'M12 12h.01', 'M8.5 15.5h.01', 'M15.5 15.5h.01'],
  siren: ['M7 18v-6a5 5 0 0 1 10 0v6', 'M5 18h14v3H5Z', 'M12 3v1', 'M4.2 6.2l.8.8', 'M19.8 6.2l-.8.8'],
  chat: ['M21 12a8 8 0 0 1-11.8 7L4 20l1-4.6A8 8 0 1 1 21 12Z', 'M8.5 12h.01', 'M12 12h.01', 'M15.5 12h.01'],
  send: ['M22 2 11 13', 'M22 2 15 22l-4-9-9-4 20-7Z'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  chart: ['M4 20V11', 'M10 20V5', 'M16 20v-6', 'M21 20H3'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z'],
  refresh: ['M21 12a9 9 0 0 1-15.5 6.2', 'M3 12a9 9 0 0 1 15.5-6.2', 'M18.5 2v4h-4', 'M5.5 22v-4h4'],
  lock: ['M5 11h14v10H5Z', 'M8 11V7a4 4 0 0 1 8 0v4'],
};

export function Icon({
  name,
  size = 22,
  color = '#12263A',
  strokeWidth = 2,
  fill = 'none',
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'battery' && <Rect x={2} y={7} width={18} height={10} rx={2.5} stroke={color} strokeWidth={strokeWidth} />}
      {P[name].map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill={i === 0 ? fill : 'none'} />
      ))}
    </Svg>
  );
}

export const ZONE_ICONS = ['kitchen', 'bathroom', 'laundry', 'boiler', 'garage', 'other'] as const;
export const zoneIcon = (z: string | null | undefined): IconName =>
  z === 'kitchen' || z === 'bathroom' || z === 'laundry' || z === 'boiler' || z === 'garage' ? z : 'home';
