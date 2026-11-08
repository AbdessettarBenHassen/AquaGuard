import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { colors } from './theme';

/** Catmull-Rom -> cubic Bézier for a smooth line through the points. */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/**
 * Single-series area chart: smooth 2px line, soft gradient fill, a marker on
 * the latest value, and an optional dashed "usual" reference line.
 */
export function AreaChart({
  values,
  color,
  height = 110,
  reference,
  referenceLabel = 'usual',
  minSpan = 10,
}: {
  values: number[];
  color: string;
  height?: number;
  reference?: number | null;
  referenceLabel?: string;
  minSpan?: number;
}) {
  const [w, setW] = useState(0);
  const pad = { top: 12, bottom: 8, right: 10 };
  const ref = reference ?? null;
  const all = ref != null ? [...values, ref] : values;
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (max - min < minSpan) {
    const mid = (max + min) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }
  const n = Math.max(values.length, 2);
  const innerW = w - pad.right;
  const x = (i: number) => (i / (n - 1)) * innerW;
  const y = (v: number) => pad.top + (1 - (v - min) / (max - min)) * (height - pad.top - pad.bottom);
  const pts = values.map((v, i) => [x(i), y(v)] as [number, number]);
  const line = smoothPath(pts);
  const last = pts[pts.length - 1];
  const id = `g${color.replace('#', '')}`;

  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && values.length > 1 && (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.28} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {ref != null && (
            <>
              <Line x1={0} x2={innerW} y1={y(ref)} y2={y(ref)} stroke={colors.faint} strokeWidth={1} strokeDasharray="4 4" />
              <SvgText x={2} y={y(ref) - 5} fontSize={10} fill={colors.muted}>
                {referenceLabel}
              </SvgText>
            </>
          )}
          <Path d={`${line} L${last[0]},${height} L0,${height} Z`} fill={`url(#${id})`} />
          <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
          <Circle cx={last[0]} cy={last[1]} r={6} fill={colors.card} />
          <Circle cx={last[0]} cy={last[1]} r={4} fill={color} />
        </Svg>
      )}
      {values.length <= 1 && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.muted, fontSize: 12 }}>Waiting for readings…</Text>
        </View>
      )}
    </View>
  );
}

/** Circular progress ring with children rendered in the center. */
export function Ring({
  progress,
  size = 120,
  stroke = 8,
  color = '#fff',
  track = 'rgba(255,255,255,0.25)',
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - p)}
        />
      </Svg>
      {children}
    </View>
  );
}

/** Seven-day bar chart; today's bar is emphasized, values labeled above bars. */
export function WeekBars({ data, color }: { data: { label: string; value: number; today: boolean }[]; color: string }) {
  const [w, setW] = useState(0);
  const height = 120;
  const labelH = 18;
  const top = 16;
  const max = Math.max(1, ...data.map((d) => d.value));
  const slot = w / data.length;
  const barW = Math.min(22, slot * 0.5);
  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Svg width={w} height={height}>
          <Line x1={0} x2={w} y1={height - labelH} y2={height - labelH} stroke={colors.border} strokeWidth={1} />
          {data.map((d, i) => {
            const h = d.value === 0 ? 3 : (d.value / max) * (height - labelH - top - 4);
            const x = i * slot + (slot - barW) / 2;
            const yTop = height - labelH - h;
            return (
              <G key={i}>
                <Rect
                  x={x}
                  y={yTop}
                  width={barW}
                  height={h}
                  rx={Math.min(4, barW / 2)}
                  fill={d.value === 0 ? colors.border : color}
                  opacity={d.today || d.value === 0 ? 1 : 0.45}
                />
                {d.value > 0 && (
                  <SvgText x={x + barW / 2} y={yTop - 4} fontSize={11} fontWeight="600" fill={colors.text} textAnchor="middle">
                    {d.value}
                  </SvgText>
                )}
                <SvgText
                  x={x + barW / 2}
                  y={height - 4}
                  fontSize={11}
                  fontWeight={d.today ? '700' : '400'}
                  fill={d.today ? colors.text : colors.muted}
                  textAnchor="middle"
                >
                  {d.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      )}
    </View>
  );
}
