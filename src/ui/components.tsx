import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { TimelineEntry } from '../core/types';
import { locale } from '../i18n';
import { Icon, type IconName } from './Icon';
import { colors, moods, radius, shadow, space, type Mood } from './theme';

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function GradientCard({ mood, children, style }: { mood: Mood; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient colors={moods[mood].gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.gradientCard, style]}>
      {children}
    </LinearGradient>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost' | 'white' | 'glass';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const bg: Record<ButtonKind, string> = {
    primary: colors.primary,
    danger: colors.urgent,
    secondary: colors.primarySoft,
    ghost: 'transparent',
    white: '#FFFFFF',
    glass: 'rgba(255,255,255,0.22)',
  };
  const fg: Record<ButtonKind, string> = {
    primary: '#fff',
    danger: '#fff',
    secondary: colors.primary,
    ghost: colors.text,
    white: colors.text,
    glass: '#fff',
  };
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg[kind], opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        kind === 'ghost' && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={18} color={fg[kind]} />}
      <Text style={[styles.buttonText, { color: fg[kind] }]}>{title}</Text>
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
      <Text style={[styles.chipText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

/** Small rounded label with an icon; tone colors always paired with text. */
export function Pill({ icon, text, tone = 'muted' }: { icon?: IconName; text: string; tone?: 'good' | 'attention' | 'urgent' | 'muted' | 'primary' }) {
  const map = {
    good: [colors.goodSoft, colors.good],
    attention: [colors.attentionSoft, colors.warning],
    urgent: [colors.urgentSoft, colors.urgent],
    muted: ['#EEF2F6', colors.muted],
    primary: [colors.primarySoft, colors.primary],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon && <Icon name={icon} size={13} color={fg} strokeWidth={2.4} />}
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

/** White translucent symbol chips for gradient backgrounds. */
export function GlassChips({ chips, big }: { chips: { icon: IconName; text: string; alert?: boolean }[]; big?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space(2) }}>
      {chips.map((c, i) => (
        <View
          key={i}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingVertical: big ? 9 : 7,
            paddingHorizontal: big ? 14 : 12,
            borderRadius: 999,
            backgroundColor: c.alert ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.22)',
          }}
        >
          <Icon name={c.icon} size={big ? 18 : 16} color={c.alert ? colors.urgent : '#fff'} strokeWidth={2.3} fill={c.icon === 'drop' ? (c.alert ? colors.urgent : '#fff') : 'none'} />
          <Text style={{ color: c.alert ? colors.urgent : '#fff', fontWeight: '800', fontSize: big ? 15 : 14 }}>{c.text}</Text>
        </View>
      ))}
    </View>
  );
}

/** Round tinted icon badge. */
export function IconBadge({ name, color, bg, size = 40 }: { name: IconName; color: string; bg: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={size * 0.5} color={color} />
    </View>
  );
}

/** Soft expanding rings behind content, used on the home hero. */
export function Pulse({ size, color = '#fff', speed = 2600, children }: { size: number; color?: string; speed?: number; children: React.ReactNode }) {
  const [a] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(a, { toValue: 1, duration: speed, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [a, speed]);
  const ring = (delay: number) => {
    const t = a.interpolate({ inputRange: [0, 1], outputRange: [delay, 1 + delay] });
    const v = Animated.modulo(t, 1);
    return (
      <Animated.View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.35] }) }],
        }}
      />
    );
  };
  return (
    <View style={{ width: size * 1.35, height: size * 1.35, alignItems: 'center', justifyContent: 'center' }}>
      {ring(0)}
      {ring(0.5)}
      {children}
    </View>
  );
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const icon: Record<TimelineEntry['actor'], IconName> = {
    system: 'sparkle',
    device: 'sensor',
    local: 'home',
    member: 'users',
    cloud: 'bell',
  };
  return (
    <View>
      {entries.map((e, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space(3) }}>
          <View style={{ alignItems: 'center' }}>
            <IconBadge name={icon[e.actor]} color={colors.primary} bg={colors.primarySoft} size={30} />
            {i < entries.length - 1 && <View style={{ width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 }} />}
          </View>
          <View style={{ flex: 1, paddingBottom: space(4) }}>
            <Text style={styles.small}>{formatTime(e.at)}</Text>
            <Text style={styles.body}>{e.text}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function formatTime(ms: number) {
  return new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: space(4),
    ...shadow,
  },
  gradientCard: {
    borderRadius: radius + 6,
    padding: space(5),
    overflow: 'hidden',
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space(6),
    marginBottom: space(3),
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: colors.text, letterSpacing: -0.2 },
  button: {
    paddingVertical: space(3.5),
    paddingHorizontal: space(5),
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space(2),
  },
  buttonText: { fontSize: 16, fontWeight: '700' },
  chip: {
    paddingVertical: space(2),
    paddingHorizontal: space(3.5),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600', textTransform: 'capitalize' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '700' },
  small: { fontSize: 12.5, color: colors.muted },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  h1: { fontSize: 28, fontWeight: '800', color: colors.text, letterSpacing: -0.6 },
  h2: { fontSize: 19, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  h3: { fontSize: 16, fontWeight: '800', color: colors.text },
  big: { fontSize: 30, fontWeight: '800', color: colors.text, letterSpacing: -0.8 },
});
