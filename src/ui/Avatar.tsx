import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';

import type { AvatarConfig } from '../core/types';

// Build-your-own cartoon faces for the Family tab.

export const AVATAR_OPTIONS = {
  bg: ['#FFD6A5', '#CDE7FF', '#D9F2D0', '#FFD1DC', '#E5DBFF', '#FFF1B8', '#C7F0EC'],
  skin: ['#FFE0C7', '#F6C9A4', '#E3A77F', '#C68863', '#9A6646', '#6E4630'],
  hair: ['short', 'curly', 'long', 'bun', 'spiky', 'none'] as const,
  hairColor: ['#2B2340', '#5A3A22', '#A0612F', '#E8B64C', '#D9562F', '#8E9AAF', '#7C6CF2', '#FF7AB6'],
  eyes: ['happy', 'wink', 'sleepy', 'wide'] as const,
  mouth: ['smile', 'grin', 'oh', 'tongue'] as const,
  accessory: ['none', 'glasses', 'shades', 'cap', 'crown', 'bow', 'headphones', 'mustache'] as const,
};

export const OPTION_LABELS: Record<string, string> = {
  short: 'Short', curly: 'Curly', long: 'Long', bun: 'Bun', spiky: 'Spiky', none: 'None',
  happy: 'Happy', wink: 'Wink', sleepy: 'Sleepy', wide: 'Wow',
  smile: 'Smile', grin: 'Grin', oh: 'Oh!', tongue: 'Silly',
  glasses: 'Glasses', shades: 'Cool', cap: 'Cap', crown: 'Crown', bow: 'Bow', headphones: 'Music', mustache: 'Mustache',
};

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

export function randomAvatar(): AvatarConfig {
  return {
    bg: pick(AVATAR_OPTIONS.bg),
    skin: pick(AVATAR_OPTIONS.skin),
    hair: pick(AVATAR_OPTIONS.hair),
    hairColor: pick(AVATAR_OPTIONS.hairColor),
    eyes: pick(AVATAR_OPTIONS.eyes),
    mouth: pick(AVATAR_OPTIONS.mouth),
    accessory: pick(AVATAR_OPTIONS.accessory),
  };
}

export const DEFAULT_AVATAR: AvatarConfig = {
  bg: '#CDE7FF',
  skin: '#F6C9A4',
  hair: 'short',
  hairColor: '#2B2340',
  eyes: 'happy',
  mouth: 'smile',
  accessory: 'none',
};

/** Stable avatar for contacts saved before avatars existed. */
export function avatarFor(seed: string, config?: AvatarConfig): AvatarConfig {
  if (config) return config;
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const at = <T,>(xs: readonly T[], k: number) => xs[(h >>> k) % xs.length];
  return {
    bg: at(AVATAR_OPTIONS.bg, 0),
    skin: at(AVATAR_OPTIONS.skin, 3),
    hair: at(AVATAR_OPTIONS.hair, 6),
    hairColor: at(AVATAR_OPTIONS.hairColor, 9),
    eyes: at(AVATAR_OPTIONS.eyes, 12),
    mouth: at(AVATAR_OPTIONS.mouth, 15),
    accessory: at(AVATAR_OPTIONS.accessory, 18),
  };
}

const INK = '#2A2540';

export function Avatar({ config, size = 56 }: { config?: AvatarConfig; size?: number }) {
  const c = config ?? DEFAULT_AVATAR;
  const id = `clip${size}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <ClipPath id={id}>
          <Circle cx={50} cy={50} r={50} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id})`}>
        <Rect width={100} height={100} fill={c.bg} />
        {/* shoulders */}
        <Path d="M18 100 C20 84 34 78 50 78 C66 78 80 84 82 100Z" fill={c.hairColor} opacity={0.55} />
        {c.hair === 'long' && <Path d="M22 56 C22 26 36 20 50 20 C64 20 78 26 78 56 L80 88 L64 88 L64 60 L36 60 L36 88 L20 88Z" fill={c.hairColor} />}
        {c.accessory === 'headphones' && <Path d="M20 56 C20 22 80 22 80 56" stroke="#3A3F58" strokeWidth={6} fill="none" strokeLinecap="round" />}
        {/* ears + face */}
        <Circle cx={24} cy={58} r={6} fill={c.skin} />
        <Circle cx={76} cy={58} r={6} fill={c.skin} />
        <Circle cx={50} cy={56} r={27} fill={c.skin} />
        <Hair kind={c.hair} color={c.hairColor} />
        <Eyes kind={c.eyes} />
        <Circle cx={35} cy={66} r={4.5} fill="#FF8FA8" opacity={0.55} />
        <Circle cx={65} cy={66} r={4.5} fill="#FF8FA8" opacity={0.55} />
        <Mouth kind={c.mouth} />
        <Accessory kind={c.accessory} />
      </G>
    </Svg>
  );
}

function Hair({ kind, color }: { kind: AvatarConfig['hair']; color: string }) {
  const fringe = 'M23 52 C23 30 36 24 50 24 C64 24 77 30 77 52 C71 41 61 37 50 37 C39 37 29 41 23 52Z';
  switch (kind) {
    case 'short':
    case 'long':
      return <Path d={fringe} fill={color} />;
    case 'bun':
      return (
        <>
          <Circle cx={50} cy={22} r={10} fill={color} />
          <Path d={fringe} fill={color} />
        </>
      );
    case 'curly':
      return (
        <G fill={color}>
          {[
            [27, 44], [31, 34], [39, 28], [50, 25], [61, 28], [69, 34], [73, 44],
          ].map(([x, y], i) => (
            <Circle key={i} cx={x} cy={y} r={9} />
          ))}
        </G>
      );
    case 'spiky':
      return <Path d="M23 50 L26 30 L34 37 L39 21 L47 33 L53 19 L60 33 L67 23 L71 37 L77 32 L77 50 C70 41 61 38 50 38 C39 38 30 41 23 50Z" fill={color} />;
    default:
      return null;
  }
}

function Eyes({ kind }: { kind: AvatarConfig['eyes'] }) {
  switch (kind) {
    case 'wink':
      return (
        <>
          <Circle cx={41} cy={56} r={3.6} fill={INK} />
          <Path d="M55 57 Q59 53 63 57" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
        </>
      );
    case 'sleepy':
      return (
        <>
          <Path d="M37 56 Q41 60 45 56" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
          <Path d="M55 56 Q59 60 63 56" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
        </>
      );
    case 'wide':
      return (
        <>
          <Circle cx={41} cy={56} r={5.5} fill="#fff" />
          <Circle cx={59} cy={56} r={5.5} fill="#fff" />
          <Circle cx={41} cy={56} r={3} fill={INK} />
          <Circle cx={59} cy={56} r={3} fill={INK} />
        </>
      );
    default:
      return (
        <>
          <Circle cx={41} cy={56} r={3.6} fill={INK} />
          <Circle cx={59} cy={56} r={3.6} fill={INK} />
          <Circle cx={42.2} cy={54.8} r={1.1} fill="#fff" />
          <Circle cx={60.2} cy={54.8} r={1.1} fill="#fff" />
        </>
      );
  }
}

function Mouth({ kind }: { kind: AvatarConfig['mouth'] }) {
  switch (kind) {
    case 'grin':
      return <Path d="M41 66 Q50 77 59 66 Z" fill={INK} stroke={INK} strokeWidth={2} strokeLinejoin="round" />;
    case 'oh':
      return <Circle cx={50} cy={69} r={3.6} fill={INK} />;
    case 'tongue':
      return (
        <>
          <Path d="M42 66 Q50 74 58 66" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />
          <Path d="M47 70 Q47 76 50.5 76 Q54 76 54 70Z" fill="#FF6F8E" />
        </>
      );
    default:
      return <Path d="M43 66 Q50 72 57 66" stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round" />;
  }
}

function Accessory({ kind }: { kind: AvatarConfig['accessory'] }) {
  switch (kind) {
    case 'glasses':
      return (
        <G stroke={INK} strokeWidth={2.2} fill="rgba(255,255,255,0.25)">
          <Circle cx={41} cy={56} r={7.5} />
          <Circle cx={59} cy={56} r={7.5} />
          <Line x1={48.5} y1={56} x2={51.5} y2={56} />
        </G>
      );
    case 'shades':
      return (
        <G>
          <Rect x={31} y={51} width={16} height={10} rx={4} fill={INK} />
          <Rect x={53} y={51} width={16} height={10} rx={4} fill={INK} />
          <Line x1={47} y1={54} x2={53} y2={54} stroke={INK} strokeWidth={2.4} />
          <Rect x={34} y={53} width={5} height={2.4} rx={1.2} fill="#fff" opacity={0.6} />
        </G>
      );
    case 'cap':
      return (
        <G>
          <Path d="M24 44 C24 22 76 22 76 44Z" fill="#E5484D" />
          <Path d="M50 44 L88 44 Q88 49 82 49 L50 49Z" fill="#C83A3F" />
          <Circle cx={50} cy={26} r={2.5} fill="#fff" />
        </G>
      );
    case 'crown':
      return <Path d="M33 32 L36 15 L44 25 L50 11 L56 25 L64 15 L67 32Z" fill="#FFC93C" stroke="#E8A317" strokeWidth={1.5} strokeLinejoin="round" />;
    case 'bow':
      return (
        <G>
          <Path d="M64 24 L54 18 L54 30Z" fill="#FF6FA5" />
          <Path d="M64 24 L74 18 L74 30Z" fill="#FF6FA5" />
          <Circle cx={64} cy={24} r={3.2} fill="#E8508A" />
        </G>
      );
    case 'headphones':
      return (
        <G fill="#3A3F58">
          <Rect x={15} y={50} width={10} height={16} rx={4} />
          <Rect x={75} y={50} width={10} height={16} rx={4} />
        </G>
      );
    case 'mustache':
      return <Path d="M50 64 C46 60 38 61 36 66 C40 65 44 67 50 65.5 C56 67 60 65 64 66 C62 61 54 60 50 64Z" fill="#3B2A20" />;
    default:
      return null;
  }
}
