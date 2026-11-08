import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';

/**
 * AquaGuard mark: a friendly water drop sheltered by a house roof, with a small
 * shield badge for protection. Same artwork as assets/brand/mark.svg.
 * mood "alert" shows a worried face (used while a leak is open).
 */
export function Logo({ size = 96, mood = 'happy' }: { size?: number; mood?: 'happy' | 'calm' | 'alert' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Defs>
        <LinearGradient id="agBody" x1="0.2" y1="0" x2="0.8" y2="1">
          <Stop offset="0" stopColor="#5CC8FF" />
          <Stop offset="1" stopColor="#1786DB" />
        </LinearGradient>
        <LinearGradient id="agRoof" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#14B5C8" />
          <Stop offset="1" stopColor="#0E8FB0" />
        </LinearGradient>
      </Defs>
      {/* roof */}
      <Path d="M150 470 L512 170 L874 470" stroke="url(#agRoof)" strokeWidth={70} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* drop */}
      <Path d="M512 300 C600 410 742 540 742 680 A230 230 0 0 1 282 680 C282 540 424 410 512 300Z" fill="url(#agBody)" />
      <Ellipse cx={428} cy={600} rx={30} ry={64} rotation={28} origin="428, 600" fill="#FFFFFF" opacity={0.4} />
      {mood === 'happy' && (
        <>
          <Ellipse cx={450} cy={700} rx={24} ry={30} fill="#0F2D4D" />
          <Ellipse cx={574} cy={700} rx={24} ry={30} fill="#0F2D4D" />
          <Circle cx={458} cy={690} r={7} fill="#FFFFFF" />
          <Circle cx={582} cy={690} r={7} fill="#FFFFFF" />
          <Path d="M478 760 Q512 794 546 760" stroke="#0F2D4D" strokeWidth={16} strokeLinecap="round" fill="none" />
        </>
      )}
      {mood === 'calm' && (
        <>
          <Path d="M424 704 Q450 682 476 704" stroke="#0F2D4D" strokeWidth={15} strokeLinecap="round" fill="none" />
          <Path d="M548 704 Q574 682 600 704" stroke="#0F2D4D" strokeWidth={15} strokeLinecap="round" fill="none" />
          <Path d="M484 762 Q512 786 540 762" stroke="#0F2D4D" strokeWidth={15} strokeLinecap="round" fill="none" />
        </>
      )}
      {mood === 'alert' && (
        <>
          <Circle cx={450} cy={700} r={26} fill="#0F2D4D" />
          <Circle cx={574} cy={700} r={26} fill="#0F2D4D" />
          <Ellipse cx={512} cy={778} rx={22} ry={18} fill="#0F2D4D" />
        </>
      )}
      <Circle cx={414} cy={752} r={24} fill="#FFFFFF" opacity={0.35} />
      <Circle cx={610} cy={752} r={24} fill="#FFFFFF" opacity={0.35} />
      {/* shield badge */}
      <Circle cx={760} cy={830} r={86} fill="#FFFFFF" />
      <Path d="M760 760 L820 782 V828 C820 868 760 900 760 900 C760 900 700 868 700 828 V782 Z" fill="#12A07A" />
      <Path d="M732 830 L752 850 L790 810" stroke="#FFFFFF" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
