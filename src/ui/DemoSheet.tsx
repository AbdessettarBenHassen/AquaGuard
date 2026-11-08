import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Overrides, Toggle } from '../device/simulator';
import { useT } from '../i18n';
import type { Key } from '../i18n/en';
import { useDemo, useGuard, useGuardState } from '../state/GuardProvider';
import { Button, styles } from './components';
import { Icon, type IconName } from './Icon';
import { colors, space } from './theme';

// The demo node's control panel (same buttons as the team's Guardian/Scout
// simulation): scenario toggles, one-shot actions, sensor problems, and values
// set by hand, e.g. the pipe pressure the prototype has no sensor for.

const TOGGLES: { key: Toggle; icon: IconName; label: Key; hint: Key }[] = [
  { key: 'tap', icon: 'tap', label: 'demo.tap', hint: 'demo.tapHint' },
  { key: 'shower', icon: 'shower', label: 'demo.shower', hint: 'demo.showerHint' },
  { key: 'sink', icon: 'drop', label: 'demo.sink', hint: 'demo.sinkHint' },
  { key: 'burst', icon: 'alert', label: 'demo.burst', hint: 'demo.burstHint' },
  { key: 'wall', icon: 'wall', label: 'demo.wall', hint: 'demo.wallHint' },
];

const VALUES: { key: keyof Overrides; icon: IconName; label: Key; unit: string; step: number; min: number; max: number; digits: number }[] = [
  { key: 'pressure', icon: 'gauge', label: 'demo.pressure', unit: 'bar', step: 0.1, min: 0, max: 2.5, digits: 1 },
  { key: 'flow', icon: 'flow', label: 'demo.flow', unit: 'L/min', step: 0.5, min: 0, max: 8, digits: 1 },
  { key: 'water', icon: 'drop', label: 'demo.water', unit: '%', step: 10, min: 0, max: 100, digits: 0 },
  { key: 'humidity', icon: 'humidity', label: 'demo.humidity', unit: '%', step: 5, min: 0, max: 100, digits: 0 },
];

export function DemoSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT();
  const { demo: d } = useGuard();
  const demo = useDemo(d);
  const { stage, active, settings } = useGuardState();
  const insets = useSafeAreaInsets();
  if (!demo) return null;
  const sim = demo.sim.state;
  const o = demo.sim.overrides;
  const r = demo.latest;
  const alertOpen = !!active && stage !== 'RESOLVED';
  const testing = demo.test?.state === 'running';

  const live: Record<keyof Overrides, number | null> = { pressure: r?.pressure ?? null, flow: r?.flow ?? null, water: r?.water ?? null, humidity: r?.humidity ?? null };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(18,38,58,0.35)' }} onPress={onClose} />
      <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: space(5), paddingTop: space(3), paddingBottom: insets.bottom + space(5), maxHeight: '88%' }}>
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.faint, marginBottom: space(4) }} />
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
            <Icon name="flask" size={20} color={colors.violet} />
            <Text style={[styles.h2, { flex: 1 }]}>{t('demo.title')}</Text>
            <Pressable onPress={() => (demo.online ? demo.stop() : demo.start())} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: demo.online ? colors.goodSoft : colors.urgentSoft }}>
              <Icon name="power" size={15} color={demo.online ? colors.good : colors.urgent} />
              <Text style={{ fontWeight: '800', fontSize: 12, color: demo.online ? colors.good : colors.urgent }}>{demo.online ? t('demo.on') : t('demo.off')}</Text>
            </Pressable>
          </View>
          <Text style={[styles.small, { marginTop: 4 }]}>{t('demo.sub', { zone: settings.zoneName })}</Text>

          {/* Live readout, like the simulation's metrics row */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(4) }}>
            <Metric label={t('demo.valve')} value={demo.valve === 'open' ? t('valve.open') : t('valve.closed')} color={demo.valve === 'open' ? colors.good : colors.urgent} />
            <Metric label={t('demo.pressure')} value={r?.pressure != null ? `${r.pressure.toFixed(2)} bar` : '–'} />
            <Metric label={t('demo.flow')} value={r?.flow != null ? `${r.flow.toFixed(1)} L/min` : '–'} />
            <Metric label="Scout" value={sim.fault === 'unplugged' ? '—' : (r?.water ?? 0) >= settings.wetThreshold ? t('water.wet') : t('water.dry')} color={(r?.water ?? 0) >= settings.wetThreshold ? colors.urgent : undefined} />
            <Metric label={t('demo.lost')} value={`${Math.round(sim.lost)} L`} />
            {demo.assessment?.mlScore != null && <Metric label={t('demo.ai')} value={`${Math.round(demo.assessment.mlScore * 100)}%`} color={demo.assessment.mlHit ? colors.urgent : undefined} />}
          </View>
          {testing && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), marginTop: space(3), padding: space(3), borderRadius: 14, backgroundColor: colors.primarySoft }}>
              <Icon name="gauge" size={18} color={colors.primary} />
              <Text style={[styles.small, { flex: 1, color: colors.primary, fontWeight: '700' }]}>
                {t('demo.testing', { s: Math.max(0, settings.testSec - demo.test!.elapsed), drop: (demo.test!.drop ?? 0).toFixed(2) })}
              </Text>
            </View>
          )}

          {/* Scenarios */}
          <Text style={[styles.sectionTitle, { marginTop: space(6), marginBottom: space(3) }]}>{t('demo.scenarios')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2.5) }}>
            {TOGGLES.map((x) => {
              const on = sim[x.key];
              return (
                <Pressable key={x.key} onPress={() => demo.toggle(x.key, !on)} style={{ width: '47%', flexGrow: 1, padding: space(3.5), borderRadius: 18, backgroundColor: on ? colors.primary : colors.card, gap: space(1.5) }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Icon name={x.icon} size={22} color={on ? '#fff' : colors.primary} />
                    <Text style={{ fontSize: 11, fontWeight: '800', color: on ? '#fff' : colors.faint }}>{on ? 'ON' : 'OFF'}</Text>
                  </View>
                  <Text style={{ fontWeight: '700', fontSize: 15, color: on ? '#fff' : colors.text }}>{t(x.label)}</Text>
                  <Text style={{ fontSize: 12, color: on ? 'rgba(255,255,255,0.85)' : colors.muted }}>{t(x.hint)}</Text>
                </Pressable>
              );
            })}
            <Pressable onPress={() => demo.spill()} style={{ width: '47%', flexGrow: 1, padding: space(3.5), borderRadius: 18, backgroundColor: colors.card, gap: space(1.5) }}>
              <Icon name="drop" size={22} color={colors.humidity} />
              <Text style={{ fontWeight: '700', fontSize: 15, color: colors.text }}>{t('demo.spill')}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{t('demo.spillHint')}</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(3) }}>
            <Button icon="gauge" title={t('demo.runTest')} kind="secondary" disabled={testing} style={{ flex: 1 }} onPress={() => demo.runTest()} />
            <Button icon="wrench" title={t('demo.fix')} kind="secondary" style={{ flex: 1 }} onPress={() => demo.fixLeaks()} />
          </View>

          {/* Sensor problems */}
          <Text style={[styles.sectionTitle, { marginTop: space(6), marginBottom: space(3) }]}>{t('demo.faults')}</Text>
          <View style={{ flexDirection: 'row', gap: space(2) }}>
            <Chip icon="sensor" label={t('demo.unplug')} on={sim.fault === 'unplugged'} onPress={() => demo.setFault(sim.fault === 'unplugged' ? null : 'unplugged')} />
            <Chip icon="lock" label={t('demo.stuck')} on={sim.fault === 'stuck'} onPress={() => demo.setFault(sim.fault === 'stuck' ? null : 'stuck')} />
          </View>

          {/* Values set by hand */}
          <Text style={[styles.sectionTitle, { marginTop: space(6), marginBottom: 2 }]}>{t('demo.values')}</Text>
          <Text style={[styles.small, { marginBottom: space(3) }]}>{t('demo.valuesSub')}</Text>
          <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: space(3.5), gap: space(3.5) }}>
            {VALUES.map((v) => {
              const set = o[v.key];
              const shown = set ?? live[v.key];
              const change = (dir: number) => {
                const base = set ?? live[v.key] ?? v.min;
                const next = Math.round(Math.max(v.min, Math.min(v.max, base + dir * v.step)) * 100) / 100;
                demo.setOverride(v.key, next);
              };
              return (
                <View key={v.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space(2.5) }}>
                  <Icon name={v.icon} size={20} color={set != null ? colors.violet : colors.muted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.body, { fontWeight: '700' }]}>{t(v.label)}</Text>
                    <Pressable onPress={() => demo.setOverride(v.key, set != null ? null : (live[v.key] ?? v.min))} hitSlop={6}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: set != null ? colors.violet : colors.muted }}>{set != null ? t('demo.manual') : t('demo.auto')}</Text>
                    </Pressable>
                  </View>
                  <StepBtn icon="minus" onPress={() => change(-1)} />
                  <Text style={[styles.body, { minWidth: 76, textAlign: 'center', fontWeight: '800', color: set != null ? colors.violet : colors.text }]}>
                    {shown != null ? shown.toFixed(v.digits) : '–'} {v.unit}
                  </Text>
                  <StepBtn icon="plus" onPress={() => change(1)} />
                </View>
              );
            })}
          </View>

          {/* People at home */}
          <Text style={[styles.sectionTitle, { marginTop: space(6), marginBottom: space(3) }]}>{t('demo.atHome')}</Text>
          <View style={{ gap: space(2) }}>
            <Button
              icon="check"
              title={t('demo.press')}
              kind="secondary"
              disabled={!alertOpen}
              onPress={() => {
                demo.pressButton();
                onClose();
              }}
            />
            <Button icon="refresh" title={t('demo.reset')} kind="ghost" onPress={() => demo.reset()} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flexGrow: 1, minWidth: '30%', backgroundColor: colors.card, borderRadius: 14, paddingVertical: space(2.5), paddingHorizontal: space(3) }}>
      <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '600' }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: '800', color: color ?? colors.text }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function Chip({ icon, label, on, onPress }: { icon: IconName; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(3), borderRadius: 16, backgroundColor: on ? colors.urgent : colors.card }}>
      <Icon name={icon} size={18} color={on ? '#fff' : colors.muted} />
      <Text style={{ flex: 1, fontWeight: '700', fontSize: 13, color: on ? '#fff' : colors.text }}>{label}</Text>
    </Pressable>
  );
}

function StepBtn({ icon, onPress }: { icon: IconName; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={16} color={colors.primary} strokeWidth={2.6} />
    </Pressable>
  );
}
