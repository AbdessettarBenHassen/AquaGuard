import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { API_URL } from '../../api/client';
import { bluetoothAvailable, connectNode, scanNodes, type BleSession, type FoundNode } from '../../device/ble';
import { useT } from '../../i18n';
import { useGuard } from '../../state/GuardProvider';
import { Button, Card, styles } from '../../ui/components';
import { Icon, zoneIcon, type IconName } from '../../ui/Icon';
import { colors, space } from '../../ui/theme';

// Link a sensor node to a zone.
//  Real: Bluetooth scan -> connect -> someone presses the node button ->
//        server registers it and issues its key -> key written to the node.
//        From then on the node sends its data itself over Wi-Fi.
//  Demo: a pretend node that talks to the server exactly the same way.

type Step =
  | { s: 'choose' }
  | { s: 'scan'; found: FoundNode[] }
  | { s: 'connecting'; name: string }
  | { s: 'press'; session: BleSession }
  | { s: 'linking'; label: string }
  | { s: 'done'; deviceId: string; note?: string; real?: boolean }
  | { s: 'error'; message: string };

export default function LinkNode() {
  const t = useT();
  const { zoneId, first } = useLocalSearchParams<{ zoneId: string; first?: string }>();
  const { home, api, linkDemo, refresh } = useGuard();
  const zone = home?.zones.find((z) => z.id === zoneId);
  const [step, setStep] = useState<Step>({ s: 'choose' });
  const stopScan = useRef<(() => void) | null>(null);
  const session = useRef<BleSession | null>(null);
  const hasBle = bluetoothAvailable();

  useEffect(
    () => () => {
      stopScan.current?.();
      session.current?.close();
    },
    [],
  );

  const finish = () => {
    refresh();
    if (first) router.replace('/');
    else router.back();
  };

  const startScan = async () => {
    setStep({ s: 'scan', found: [] });
    try {
      stopScan.current = await scanNodes(
        (b) => setStep((cur) => (cur.s === 'scan' && !cur.found.some((x) => x.id === b.id) ? { s: 'scan', found: [...cur.found, b].sort((x, y) => (y.rssi ?? -99) - (x.rssi ?? -99)) } : cur)),
        (e) => setStep({ s: 'error', message: e.message }),
      );
    } catch (e) {
      setStep({ s: 'error', message: (e as Error).message });
    }
  };

  const pick = async (b: FoundNode) => {
    stopScan.current?.();
    setStep({ s: 'connecting', name: b.name });
    try {
      const sess = await connectNode(b.id);
      session.current = sess;
      setStep({ s: 'press', session: sess });
      await sess.waitForButton();
      setStep({ s: 'linking', label: t('link.registering') });
      const r = await api!.linkDevice(zoneId, { deviceId: sess.identity.id, claimCode: sess.identity.claim, kind: 'real', firmware: sess.identity.fw });
      setStep({ s: 'linking', label: t('link.sendingKey') });
      const result = await sess.provision(r.deviceKey, API_URL);
      await sess.close();
      session.current = null;
      setStep({ s: 'done', deviceId: r.deviceId, real: true, note: result === 'no-network' ? t('link.noWifi') : undefined });
    } catch (e) {
      await session.current?.close();
      session.current = null;
      setStep({ s: 'error', message: (e as Error).message });
    }
  };

  const demo = async () => {
    setStep({ s: 'linking', label: t('link.demoSetup') });
    try {
      await linkDemo(zoneId);
      setStep({ s: 'done', deviceId: t('link.demoName'), note: t('link.demoNote') });
    } catch (e) {
      setStep({ s: 'error', message: (e as Error).message });
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(5), gap: space(4), paddingBottom: space(12) }}>
      <View style={{ alignItems: 'center', gap: space(2) }}>
        <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={zoneIcon(zone?.icon)} size={44} color={colors.primary} />
        </View>
        <Text style={styles.h2}>{zone ? t('link.title', { zone: zone.name }) : t('nav.link')}</Text>
        {zone?.device && step.s === 'choose' && <Text style={[styles.small, { textAlign: 'center' }]}>{t('link.replaces', { id: zone.device.id })}</Text>}
      </View>

      {step.s === 'choose' && (
        <>
          <Option icon="sensor" title={t('link.real')} sub={hasBle ? t('link.realSub') : t('link.realNoBle')} disabled={!hasBle} onPress={startScan} />
          <Option icon="flask" title={t('link.demo')} sub={t('link.demoSub')} onPress={demo} />
          {first && (
            <Pressable onPress={finish} style={{ alignItems: 'center', padding: space(3) }}>
              <Text style={{ color: colors.muted, fontWeight: '600' }}>{t('link.skip')}</Text>
            </Pressable>
          )}
        </>
      )}

      {step.s === 'scan' && (
        <Card style={{ gap: space(3) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.body, { fontWeight: '700' }]}>{t('link.looking')}</Text>
          </View>
          <Text style={styles.small}>{t('link.lookingSub')}</Text>
          {step.found.map((b) => (
            <Pressable key={b.id} onPress={() => pick(b)} style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3), borderRadius: 14, backgroundColor: colors.bg }}>
              <Icon name="sensor" size={22} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.body, { fontWeight: '700' }]}>{b.name}</Text>
                <Text style={styles.small}>{b.rssi == null ? t('link.sigUnknown') : b.rssi > -60 ? t('link.sigClose') : b.rssi > -75 ? t('link.sigNear') : t('link.sigFar')}</Text>
              </View>
              <Icon name="chevron" size={20} color={colors.faint} />
            </Pressable>
          ))}
          <Button title={t('common.cancel')} kind="ghost" onPress={() => { stopScan.current?.(); setStep({ s: 'choose' }); }} />
        </Card>
      )}

      {step.s === 'connecting' && <Busy label={t('link.connecting', { name: step.name })} />}

      {step.s === 'press' && (
        <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(7) }}>
          <Icon name="sensor" size={56} color={colors.primary} />
          <Text style={[styles.h2, { textAlign: 'center' }]}>{t('link.press')}</Text>
          <Text style={[styles.small, { textAlign: 'center' }]}>{t('link.pressSub', { id: step.session.identity.id })}</Text>
          <ActivityIndicator color={colors.primary} />
        </Card>
      )}

      {step.s === 'linking' && <Busy label={step.label} />}

      {step.s === 'done' && (
        <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(7) }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={38} color={colors.good} strokeWidth={3} />
          </View>
          <Text style={styles.h2}>{t('link.done')}</Text>
          <Text style={[styles.body, { fontWeight: '700' }]}>{step.deviceId}</Text>
          {step.note && <Text style={[styles.small, { textAlign: 'center' }]}>{step.note}</Text>}
          {step.real && (
            <Button icon="wifi" title={t('link.setWifi')} onPress={() => router.replace({ pathname: '/network/[zoneId]', params: { zoneId } })} style={{ alignSelf: 'stretch', marginTop: space(2) }} />
          )}
          <Button icon="home" title={t('common.done')} kind={step.real ? 'secondary' : 'primary'} onPress={finish} style={{ alignSelf: 'stretch' }} />
        </Card>
      )}

      {step.s === 'error' && (
        <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(6) }}>
          <Icon name="alert" size={40} color={colors.urgent} />
          <Text style={[styles.body, { textAlign: 'center' }]}>{step.message}</Text>
          <Button title={t('common.retry')} onPress={() => setStep({ s: 'choose' })} style={{ alignSelf: 'stretch' }} />
        </Card>
      )}
    </ScrollView>
  );
}

function Option({ icon, title, sub, onPress, disabled }: { icon: IconName; title: string; sub: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => ({ opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(4), paddingVertical: space(5) }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={28} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{title}</Text>
          <Text style={styles.small}>{sub}</Text>
        </View>
        <Icon name="chevron" size={22} color={colors.faint} />
      </Card>
    </Pressable>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(8) }}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.body}>{label}</Text>
    </Card>
  );
}
