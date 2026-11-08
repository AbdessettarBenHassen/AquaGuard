import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { DEFAULT_SETTINGS } from '../../core/defaults';
import type { Settings } from '../../core/types';
import { useLang, useT, type Lang } from '../../i18n';
import { testAlertSound } from '../../state/alertSound';
import { askBatteryExemption, backgroundAvailable } from '../../state/background';
import { useGuard, useGuardState } from '../../state/GuardProvider';
import { Avatar } from '../../ui/Avatar';
import { Button, Card, IconBadge, SectionTitle, styles } from '../../ui/components';
import { Icon, zoneIcon, type IconName } from '../../ui/Icon';
import { Logo } from '../../ui/Logo';
import { colors, space } from '../../ui/theme';

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

export default function SettingsScreen() {
  const t = useT();
  const [lang, setLang] = useLang();
  const { engine, clearHistory, relearn, user, home, zone, role, logout, api } = useGuard();
  const canEdit = role === 'owner';
  const { settings, link, baseline } = useGuardState();
  const [advanced, setAdvanced] = useState(false);
  const set = (patch: Partial<Settings>) => engine.updateSettings(patch);

  const chooseLang = (l: Lang) => {
    setLang(l);
    // The home's language is used by the server for SMS, push and alert timelines.
    if (canEdit && home && api) api.updateHome(home.home.id, { settings: { ...home.home.settings, lang: l } }).catch(() => {});
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(5), paddingBottom: space(12) }}>
      {/* Account */}
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
        {user?.avatar ? <Avatar config={user.avatar} size={52} /> : <Logo size={52} />}
        <View style={{ flex: 1 }}>
          <Text style={[styles.body, { fontWeight: '800' }]}>{user?.name}</Text>
          <Text style={styles.small}>{user?.email}</Text>
          <Text style={styles.small}>
            {home?.home.name} · {role === 'owner' ? t('role.owner') : t('role.member')}
          </Text>
        </View>
        <Button
          title={t('set.logout')}
          kind="ghost"
          onPress={() =>
            Alert.alert(t('set.logoutQ'), undefined, [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('set.logout'), style: 'destructive', onPress: () => logout().then(() => router.replace('/welcome')) },
            ])
          }
        />
      </Card>

      {/* Language */}
      <SectionTitle>{t('set.language')}</SectionTitle>
      <Card style={{ gap: space(3) }}>
        <View style={{ flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 14, padding: 4 }}>
          {(
            [
              { k: 'en', label: 'English' },
              { k: 'fr', label: 'Français' },
            ] as const
          ).map((o) => (
            <Pressable key={o.k} onPress={() => chooseLang(o.k)} style={{ flex: 1, paddingVertical: space(2.5), borderRadius: 11, alignItems: 'center', backgroundColor: lang === o.k ? colors.primary : 'transparent' }}>
              <Text style={{ fontWeight: '700', color: lang === o.k ? '#fff' : colors.muted }}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.small}>{canEdit ? t('set.langOwner') : t('set.langMember')}</Text>
      </Card>

      {zone && (
        <Pressable onPress={() => router.push({ pathname: '/zone/[id]', params: { id: zone.id } })}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), marginTop: space(3) }}>
            <IconBadge name={zoneIcon(zone.icon)} color={colors.primary} bg={colors.primarySoft} size={52} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.body, { fontWeight: '800' }]}>{zone.name}</Text>
              <Text style={styles.small}>{zone.device ? `${zone.device.id} · ${link.connected ? t('common.online') : t('common.offline')}` : t('zone.noSensor')}</Text>
            </View>
            <Icon name="chevron" size={20} color={colors.faint} />
          </Card>
        </Pressable>
      )}

      {/* Safety */}
      <SectionTitle>{t('set.safety')}</SectionTitle>
      <Card style={{ gap: space(4), opacity: canEdit ? 1 : 0.5, pointerEvents: canEdit ? 'auto' : 'none' }}>
        <ToggleRow icon="valve" label={t('set.autoClose')} sub={t('set.autoCloseSub')} value={settings.autoClose} onChange={(autoClose) => set({ autoClose })} />
        <ToggleRow icon="shield" label={t('set.failSafe')} sub={t('set.failSafeSub')} value={settings.failSafeClose} onChange={(failSafeClose) => set({ failSafeClose })} />
        <Text style={styles.small}>{t('set.reopenRule')}</Text>
      </Card>

      {backgroundAvailable() && (
        <>
          <SectionTitle>{t('set.background')}</SectionTitle>
          <Card style={{ gap: space(4) }}>
            <ToggleRow icon="shield" label={t('set.keepWatching')} sub={t('set.keepWatchingSub')} value={settings.backgroundWatch} onChange={(backgroundWatch) => set({ backgroundWatch })} />
            <Button
              icon="battery"
              title={t('set.battery')}
              kind="secondary"
              onPress={async () => {
                const opened = await askBatteryExemption();
                if (!opened) Alert.alert(t('set.batteryOk'));
              }}
            />
          </Card>
        </>
      )}

      <SectionTitle>{t('set.alerts')}</SectionTitle>
      <Card style={{ gap: space(4) }}>
        <ToggleRow icon="volume" label={t('set.sound')} sub={t('set.soundSub')} value={settings.soundEnabled} onChange={(soundEnabled) => set({ soundEnabled })} />
        <Button icon="volume" title={t('set.testSound')} kind="secondary" onPress={testAlertSound} />
      </Card>

      <SectionTitle>{t('set.timing')}</SectionTitle>
      <Card style={{ gap: space(4), opacity: canEdit ? 1 : 0.5, pointerEvents: canEdit ? 'auto' : 'none' }}>
        <Stepper settings={settings} set={set} k="gracePeriodSec" label={t('set.grace')} unit="s" step={5} min={5} max={600} />
        <Stepper settings={settings} set={set} k="smsFallbackSec" label={t('set.sms')} unit="s" step={5} min={5} max={600} />
        <Stepper settings={settings} set={set} k="nextContactSec" label={t('set.next')} unit="s" step={5} min={10} max={900} />
        <Text style={styles.small}>{t('set.timingNote')}</Text>
      </Card>

      <SectionTitle>{t('set.demo')}</SectionTitle>
      <Card>
        <ToggleRow icon="flask" label={t('set.demoControls')} sub={t('set.demoSub')} value={settings.demoMode} onChange={(demoMode) => set({ demoMode })} />
      </Card>

      <SectionTitle>{t('set.privacy')}</SectionTitle>
      <Card style={{ gap: space(3) }}>
        <View style={{ flexDirection: 'row', gap: space(3) }}>
          <IconBadge name="shield" color={colors.primary} bg={colors.primarySoft} />
          <Text style={[styles.body, { flex: 1 }]}>{t('set.privacyText')}</Text>
        </View>
        {canEdit && (
          <Button
            title={t('set.clear')}
            kind="ghost"
            onPress={() =>
              Alert.alert(t('set.clearQ'), t('set.clearSub'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('set.clearYes'), style: 'destructive', onPress: () => clearHistory() },
              ])
            }
          />
        )}
      </Card>

      <Pressable onPress={() => setAdvanced((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space(6), marginBottom: space(3) }}>
        <View>
          <Text style={styles.sectionTitle}>{t('set.advanced')}</Text>
          <Text style={styles.small}>{t('set.advancedSub')}</Text>
        </View>
        <Icon name={advanced ? 'up' : 'down'} size={20} color={colors.muted} />
      </Pressable>
      {advanced && (
        <Card style={{ gap: space(4) }}>
          <ToggleRow icon="sparkle" label={t('set.technical')} sub={t('set.technicalSub')} value={settings.showTechnical} onChange={(showTechnical) => set({ showTechnical })} />
          <View style={{ gap: space(4), opacity: canEdit ? 1 : 0.5, pointerEvents: canEdit ? 'auto' : 'none' }}>
            <Stepper settings={settings} set={set} k="wetThreshold" label={t('set.wet')} unit="%" step={5} min={10} max={80} />
            <Stepper settings={settings} set={set} k="leakScoreThreshold" label={t('set.score')} unit="%" step={0.05} min={0.5} max={0.99} format={(v) => String(Math.round(v * 100))} />
            <Stepper settings={settings} set={set} k="sustainSamples" label={t('set.sustain')} unit="" step={1} min={1} max={10} />
            <Stepper settings={settings} set={set} k="windowSamples" label={t('set.window')} unit="s" step={1} min={4} max={20} />
            <Stepper settings={settings} set={set} k="staleSec" label={t('set.stale')} unit="s" step={5} min={5} max={120} />
            <Stepper settings={settings} set={set} k="flowAlarmSec" label={t('set.flowAlarm')} unit="s" step={15} min={15} max={3600} />
            <Stepper settings={settings} set={set} k="testSec" label={t('set.testSec')} unit="s" step={5} min={10} max={900} />
            <Stepper settings={settings} set={set} k="testDropBar" label={t('set.testDrop')} unit=" bar" step={0.05} min={0.05} max={1} format={(v) => v.toFixed(2)} />
            <Stepper settings={settings} set={set} k="cooldownSec" label={t('set.cooldown')} unit="s" step={15} min={0} max={1800} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.body}>{t('set.usual')}</Text>
                <Text style={styles.small}>
                  {baseline.calibrated
                    ? `${Math.round(baseline.humidity ?? 0)}% · ${(baseline.pressure ?? 0).toFixed(2)} bar`
                    : t('set.learning', { n: baseline.samples, total: settings.calibrationSamples })}
                </Text>
              </View>
              <Button
                title={t('set.relearn')}
                kind="secondary"
                onPress={() =>
                  Alert.alert(t('set.relearnQ'), t('set.relearnSub'), [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('set.relearn'), onPress: () => relearn() },
                  ])
                }
              />
            </View>
            <Button
              title={t('set.restore')}
              kind="ghost"
              onPress={() =>
                set({
                  wetThreshold: DEFAULT_SETTINGS.wetThreshold,
                  leakScoreThreshold: DEFAULT_SETTINGS.leakScoreThreshold,
                  sustainSamples: DEFAULT_SETTINGS.sustainSamples,
                  windowSamples: DEFAULT_SETTINGS.windowSamples,
                  staleSec: DEFAULT_SETTINGS.staleSec,
                  flowAlarmSec: DEFAULT_SETTINGS.flowAlarmSec,
                  testSec: DEFAULT_SETTINGS.testSec,
                  testDropBar: DEFAULT_SETTINGS.testDropBar,
                  cooldownSec: DEFAULT_SETTINGS.cooldownSec,
                })
              }
            />
          </View>
          <Text style={styles.small}>
            {t('tech.firmware')} {link.firmware}
          </Text>
        </Card>
      )}

      <View style={{ alignItems: 'center', marginTop: space(10), gap: space(1.5) }}>
        <Logo size={48} />
        <Text style={[styles.small, { fontWeight: '700', color: colors.text }]}>AquaGuard 1.0</Text>
        <Text style={[styles.small, { textAlign: 'center' }]}>Team NAWARAT · IEEE ESPRIT SBJC · IoT Spark 4.0</Text>
      </View>
    </ScrollView>
  );
}

function Stepper({
  settings,
  set,
  k,
  label,
  unit,
  step,
  min,
  max,
  format = String,
}: {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  k: NumKey;
  label: string;
  unit: string;
  step: number;
  min: number;
  max: number;
  format?: (v: number) => string;
}) {
  const v = settings[k];
  const change = (d: number) => set({ [k]: Math.round(Math.max(min, Math.min(max, v + d)) * 100) / 100 } as Partial<Settings>);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
      <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
      <Pressable onPress={() => change(-step)} style={stepBtn} hitSlop={6}>
        <Text style={stepTxt}>−</Text>
      </Pressable>
      <Text style={[styles.body, { minWidth: 62, textAlign: 'center', fontWeight: '700' }]}>
        {format(v)}
        {unit}
      </Text>
      <Pressable onPress={() => change(step)} style={stepBtn} hitSlop={6}>
        <Text style={stepTxt}>+</Text>
      </Pressable>
    </View>
  );
}

function ToggleRow({ icon, label, sub, value, onChange }: { icon: IconName; label: string; sub: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
      <IconBadge name={icon} color={colors.primary} bg={colors.primarySoft} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.body, { fontWeight: '700' }]}>{label}</Text>
        <Text style={styles.small}>{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}

const stepBtn = { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primarySoft, alignItems: 'center' as const, justifyContent: 'center' as const };
const stepTxt = { fontSize: 18, color: colors.primary, fontWeight: '800' as const };
