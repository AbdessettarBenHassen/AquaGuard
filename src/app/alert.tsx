import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TriggerKind } from '../core/types';
import { useT, type Key } from '../i18n';
import { useGuard, useGuardState, useNow } from '../state/GuardProvider';
import { Ring } from '../ui/charts';
import { Button, Card, GlassChips, IconBadge, Timeline, styles } from '../ui/components';
import { alertChips, alertTitle, countdown, whoResolved } from '../ui/copy';
import { Icon, type IconName } from '../ui/Icon';
import { CallSheet, callEmergency } from '../ui/CallSheet';
import { Logo } from '../ui/Logo';
import { colors, moods, space, stageMood } from '../ui/theme';

// What to do, as big symbols with a few words. Safety first: water and
// electricity never mix.
const STEPS: Record<TriggerKind, { icon: IconName; text: Key; urgent?: boolean; action?: 'call' | 'emergency' | 'valve' }[]> = {
  leak: [
    { icon: 'valve', text: 'step.valve', action: 'valve' },
    { icon: 'bolt', text: 'step.power', urgent: true },
    { icon: 'drop', text: 'step.find' },
    { icon: 'wrench', text: 'step.plumber', action: 'call' },
  ],
  hidden_leak: [
    { icon: 'valve', text: 'step.keepOff', action: 'valve' },
    { icon: 'wall', text: 'step.stains' },
    { icon: 'gauge', text: 'step.meter' },
    { icon: 'wrench', text: 'step.plumber', action: 'call' },
  ],
  sensor_fault: [
    { icon: 'sensor', text: 'step.cable' },
    { icon: 'refresh', text: 'step.clean' },
    { icon: 'valve', text: 'step.failSafe', action: 'valve' },
  ],
};

export default function AlertScreen() {
  const t = useT();
  const { acknowledge, falseAlarm, setValve, role } = useGuard();
  const { active, stage, contacts, settings, valve } = useGuardState();
  const now = useNow();
  const insets = useSafeAreaInsets();
  const [showLog, setShowLog] = useState(true);
  const [callOpen, setCallOpen] = useState(false);
  const zone = settings.zoneName;

  if (!active) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(6), gap: space(3), backgroundColor: colors.bg }}>
        <Logo size={110} />
        <Text style={styles.h2}>{t('alert.calm')}</Text>
        <Button title={t('common.back')} kind="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  const mood = stageMood(stage);
  const resolved = stage === 'RESOLVED';
  const remaining = active.deadline ? active.deadline - now : null;
  const total = stage === 'LOCAL_ASSISTANCE' ? settings.gracePeriodSec * 1000 : settings.smsFallbackSec * 1000;
  const contact = active.level > 0 ? contacts.filter((c) => c.push || c.sms)[active.level - 1] : null;

  const title = resolved ? t('st.sorted') : stage === 'ESCALATE' ? t('st.noAnswer', { zone }) : alertTitle(active.trigger.kind, zone);
  const chips = resolved
    ? [{ icon: 'check' as IconName, text: whoResolved(active) }]
    : stage === 'ESCALATE'
      ? [{ icon: 'close' as IconName, text: t('chip.noAnswer'), alert: true }, ...(contact ? [{ icon: 'phone' as IconName, text: t('chip.alerted', { name: contact.name }) }] : [])]
      : [...alertChips({ ...active, trigger: { ...active.trigger, snapshot: { ...active.trigger.snapshot, valveClosed: valve === 'closed' || active.trigger.snapshot.valveClosed } } }), { icon: 'siren' as IconName, text: t('chip.alarmHome') }];

  const confirmFalseAlarm = () =>
    Alert.alert(t('alert.falseQ'), t('alert.falseSub'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('alert.falseYes'), style: 'destructive', onPress: () => falseAlarm() },
    ]);

  const valveAction = () => {
    if (valve !== 'closed') setValve('close').catch((e: Error) => Alert.alert(t('common.couldNot'), e.message));
    else Alert.alert(t('valve.off'), role === 'owner' ? t('valve.reopenLater') : t('valve.ownerOnly'));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: space(12) }}>
        <LinearGradient
          colors={moods[mood].gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingTop: insets.top + space(3), paddingHorizontal: space(5), paddingBottom: space(11), borderBottomLeftRadius: 36, borderBottomRightRadius: 36, alignItems: 'center' }}
        >
          <Pressable onPress={() => router.back()} hitSlop={12} style={{ alignSelf: 'flex-end', padding: space(1.5), borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)' }}>
            <Icon name="close" size={20} color="#fff" />
          </Pressable>

          <View style={{ marginTop: space(1) }}>
            {!resolved && remaining != null && remaining > 0 ? (
              <Ring progress={remaining / total} size={170} stroke={10}>
                <Icon name={stage === 'ESCALATE' ? 'bell' : 'siren'} size={28} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 40, fontWeight: '800', letterSpacing: -1 }}>{countdown(remaining)}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, textAlign: 'center', maxWidth: 120 }}>{stage === 'LOCAL_ASSISTANCE' ? t('hero.untilFamily') : t('hero.next')}</Text>
              </Ring>
            ) : (
              <View style={{ width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center' }}>
                <Logo size={120} mood={resolved ? 'happy' : 'alert'} />
              </View>
            )}
          </View>

          <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800', marginTop: space(4), textAlign: 'center', letterSpacing: -0.6 }}>{title}</Text>
          <View style={{ marginTop: space(4) }}>
            <GlassChips chips={chips} big />
          </View>
        </LinearGradient>

        <View style={{ paddingHorizontal: space(5), marginTop: -space(8) }}>
          <Card style={{ gap: space(2.5) }}>
            {!resolved ? (
              <>
                <View style={{ flexDirection: 'row', gap: space(2.5) }}>
                  <Button icon="check" title={t('alert.onIt')} onPress={() => acknowledge()} style={{ flex: 1, paddingVertical: space(5) }} />
                  <Button icon="phone" title={t('alert.call')} onPress={() => setCallOpen(true)} style={{ paddingVertical: space(5), backgroundColor: colors.good }} />
                </View>
                {valve !== 'closed' && active.trigger.kind !== 'sensor_fault' && <Button icon="valve" title={t('valve.close')} kind="danger" onPress={valveAction} />}
                <Button icon="close" title={t('alert.false')} kind="ghost" onPress={confirmFalseAlarm} />
              </>
            ) : (
              <Button icon="check" title={t('common.done')} onPress={() => router.back()} style={{ paddingVertical: space(5) }} />
            )}
          </Card>

          {!resolved && (
            <>
              <Text style={[styles.sectionTitle, { marginTop: space(6), marginBottom: space(3) }]}>{t('alert.todo')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
                {STEPS[active.trigger.kind].map((st, i) => {
                  const done = st.action === 'valve' && valve === 'closed';
                  const onPress = st.action === 'call' ? () => setCallOpen(true) : st.action === 'emergency' ? callEmergency : st.action === 'valve' && !done ? valveAction : undefined;
                  return (
                    <Pressable key={i} onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ width: '47%', flexGrow: 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                      <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(5), backgroundColor: st.urgent ? colors.urgentSoft : done ? colors.goodSoft : colors.card }}>
                        <View style={{ position: 'absolute', top: 10, left: 12 }}>
                          <Text style={{ fontSize: 12, fontWeight: '800', color: st.urgent ? colors.urgent : colors.faint }}>{i + 1}</Text>
                        </View>
                        {done && (
                          <View style={{ position: 'absolute', top: 10, right: 12 }}>
                            <Icon name="check" size={16} color={colors.good} strokeWidth={3} />
                          </View>
                        )}
                        <IconBadge name={st.icon} color={st.urgent ? '#fff' : done ? colors.good : colors.primary} bg={st.urgent ? colors.urgent : done ? '#fff' : colors.primarySoft} size={60} />
                        <Text style={{ fontSize: 15, fontWeight: '700', color: st.urgent ? colors.urgent : colors.text, textAlign: 'center' }}>{done ? t('step.valveDone') : t(st.text)}</Text>
                      </Card>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable onPress={callEmergency} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(1.5), marginTop: space(4) }}>
                <Icon name="siren" size={14} color={colors.urgent} />
                <Text style={[styles.small, { color: colors.urgent, fontWeight: '700' }]}>{t('alert.emergency')}</Text>
              </Pressable>
            </>
          )}

          <Pressable onPress={() => setShowLog((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space(6), marginBottom: space(3) }}>
            <Text style={styles.sectionTitle}>{t('alert.happened')}</Text>
            <Icon name={showLog ? 'up' : 'down'} size={20} color={colors.muted} />
          </Pressable>
          {showLog && (
            <Card>
              <Timeline entries={active.timeline} />
            </Card>
          )}
        </View>
      </ScrollView>
      <CallSheet visible={callOpen} onClose={() => setCallOpen(false)} />
    </View>
  );
}
