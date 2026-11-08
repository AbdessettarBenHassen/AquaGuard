import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ZoneIcon } from '../core/types';
import { useT } from '../i18n';
import { useGuard } from '../state/GuardProvider';
import { Button, Card, styles } from '../ui/components';
import { Field } from '../ui/Field';
import { ZonePicker } from '../ui/HomeOverview';
import { Logo } from '../ui/Logo';
import { colors, space } from '../ui/theme';

// First-time setup after creating an account:
//  new:  create the home (you become its owner) + its first zone, then link the sensor
//  join: enter the home code given by an owner (you join as a member)

export default function Setup() {
  const t = useT();
  const params = useLocalSearchParams<{ tab?: 'new' | 'join' }>();
  const { user, createHome, joinHome, api, logout } = useGuard();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'new' | 'join'>(params.tab ?? 'new');
  const [homeName, setHomeName] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [icon, setIcon] = useState<ZoneIcon>('kitchen');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert(t('common.wrong'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const hid = await createHome(homeName.trim() || t('setup.defaultHome', { name: user?.name ?? '' }));
      const z = await api!.addZone(hid, { name: zoneName.trim(), icon });
      router.replace({ pathname: '/link/[zoneId]', params: { zoneId: z.id, first: '1' } });
    });

  const join = () =>
    run(async () => {
      await joinHome(code.trim());
      router.replace('/');
    });

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space(8), padding: space(5), gap: space(4), paddingBottom: space(12) }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: space(2) }}>
          <Logo size={100} />
          <Text style={styles.h1}>{t('setup.hello', { name: user?.name ?? '' })}</Text>
          <Text style={[styles.small, { textAlign: 'center' }]}>{t('setup.sub')}</Text>
        </View>

        <View style={{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: 16, padding: 4 }}>
          {(
            [
              { k: 'new', label: t('setup.new') },
              { k: 'join', label: t('setup.haveCode') },
            ] as const
          ).map((x) => (
            <Pressable key={x.k} onPress={() => setTab(x.k)} style={{ flex: 1, paddingVertical: space(3), borderRadius: 12, alignItems: 'center', backgroundColor: tab === x.k ? colors.primary : 'transparent' }}>
              <Text style={{ fontWeight: '700', color: tab === x.k ? '#fff' : colors.muted }}>{x.label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'new' ? (
          <Card style={{ gap: space(3) }}>
            <Text style={[styles.body, { fontWeight: '700' }]}>{t('setup.home')}</Text>
            <Field icon="home" value={homeName} onChange={setHomeName} placeholder={t('setup.homePh')} />
            <Text style={[styles.body, { fontWeight: '700', marginTop: space(2) }]}>{t('setup.firstZone')}</Text>
            <Field icon="drop" value={zoneName} onChange={setZoneName} placeholder={t('zone.namePh')} />
            <ZonePicker value={icon} onChange={setIcon} />
            <Text style={styles.small}>{t('setup.ownerNote')}</Text>
          </Card>
        ) : (
          <Card style={{ gap: space(3) }}>
            <Text style={[styles.body, { fontWeight: '700' }]}>{t('setup.code')}</Text>
            <Text style={styles.small}>{t('setup.codeSub')}</Text>
            <Field icon="sparkle" value={code} onChange={(x) => setCode(x.toUpperCase())} placeholder="CODE" caps />
          </Card>
        )}

        {busy ? (
          <ActivityIndicator color={colors.primary} style={{ padding: space(4) }} />
        ) : tab === 'join' ? (
          <Button icon="check" title={t('setup.join')} disabled={code.trim().length < 6} onPress={join} style={{ paddingVertical: space(4.5) }} />
        ) : (
          <Button icon="check" title={t('setup.create')} disabled={!zoneName.trim()} onPress={create} style={{ paddingVertical: space(4.5) }} />
        )}

        <Pressable onPress={() => logout().then(() => router.replace('/welcome'))} style={{ alignItems: 'center', padding: space(2) }}>
          <Text style={{ color: colors.muted }}>{t('set.logout')}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
