import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { bluetoothAvailable, connectNode, findNode, type BleSession } from '../../device/ble';
import { useT } from '../../i18n';
import { useGuard } from '../../state/GuardProvider';
import { Button, Card, styles } from '../../ui/components';
import { Icon, type IconName } from '../../ui/Icon';
import { colors, space } from '../../ui/theme';

// Wi-Fi of a sensor node. The network name and password go to the node over
// Bluetooth; someone presses the node button first, so nobody nearby can change it.

type Step = { s: 'idle' } | { s: 'busy'; label: string; press?: boolean } | { s: 'done'; ok: boolean; title: string; text: string };

const keyOf = (deviceId: string) => `ag.network.${deviceId}`;

export default function NetworkScreen() {
  const t = useT();
  const { zoneId } = useLocalSearchParams<{ zoneId: string }>();
  const { home } = useGuard();
  const zone = home?.zones.find((z) => z.id === zoneId);
  const d = zone?.device;
  const [ssid, setSsid] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [lastSent, setLastSent] = useState('');
  const [step, setStep] = useState<Step>({ s: 'idle' });
  const session = useRef<BleSession | null>(null);

  useEffect(() => {
    if (!d) return;
    AsyncStorage.getItem(keyOf(d.id)).then((v) => v && setLastSent(v));
    return () => void session.current?.close();
  }, [d]);

  if (!zone || !d) {
    return (
      <View style={{ padding: space(6) }}>
        <Text style={styles.body}>{t('net.linkFirst')}</Text>
      </View>
    );
  }

  const isOwner = home!.me.role === 'owner';
  const current = d.live?.network?.ssid || lastSent;
  const passOk = pass.length === 0 || (pass.length >= 8 && pass.length <= 63);
  const canSend = isOwner && ssid.trim().length > 0 && ssid.trim().length <= 32 && passOk && step.s !== 'busy';

  const send = async () => {
    const name = ssid.trim();
    if (!bluetoothAvailable()) {
      setStep({ s: 'done', ok: false, title: t('net.bleNeeded'), text: t('ble.needApp') });
      return;
    }
    try {
      setStep({ s: 'busy', label: t('net.looking', { id: d.id }) });
      const found = await findNode(d.id);
      setStep({ s: 'busy', label: t('net.connecting') });
      const sess = await connectNode(found.id);
      session.current = sess;
      setStep({ s: 'busy', label: t('net.press'), press: true });
      await sess.waitForButton();
      setStep({ s: 'busy', label: t('net.joining', { ssid: name }) });
      const r = await sess.setWifi(name, pass);
      await sess.close();
      session.current = null;
      if (r === 'ok' || r === 'fail') {
        setLastSent(name);
        AsyncStorage.setItem(keyOf(d.id), name).catch(() => {});
        setPass('');
      }
      setStep(
        r === 'ok'
          ? { s: 'done', ok: true, title: t('net.ok'), text: t('net.okSub', { ssid: name }) }
          : r === 'fail'
            ? { s: 'done', ok: false, title: t('net.fail'), text: t('net.failSub') }
            : r === 'denied'
              ? { s: 'done', ok: false, title: t('net.denied'), text: t('ble.noPress') }
              : r === 'unsupported'
                ? { s: 'done', ok: false, title: t('net.update'), text: t('net.updateSub') }
                : { s: 'done', ok: false, title: t('net.noAnswer'), text: t('net.noAnswerSub') },
      );
    } catch (e) {
      await session.current?.close();
      session.current = null;
      setStep({ s: 'done', ok: false, title: t('net.unreachable'), text: (e as Error).message });
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(5), paddingBottom: space(14), gap: space(3) }} keyboardShouldPersistTaps="handled">
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: d.online ? colors.goodSoft : '#EEF2F6', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={d.online ? 'wifi' : 'wifiOff'} size={24} color={d.online ? colors.good : colors.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.body, { fontWeight: '800' }]}>{d.online ? t('common.online') : t('common.offline')}</Text>
          <Text style={styles.small}>
            {current ? `Wi-Fi “${current}”` : t('net.none')}
            {d.online && d.live?.rssi ? ` · ${d.live.rssi} dBm` : ''}
          </Text>
        </View>
      </Card>

      <Card style={{ gap: space(3) }}>
        <Text style={styles.h3}>{t('net.title')}</Text>
        <Input icon="wifi" value={ssid} onChange={setSsid} placeholder={t('net.ssid')} />
        <View>
          <Input icon="lock" value={pass} onChange={setPass} placeholder={t('net.pass')} secure={!show} />
          <Pressable onPress={() => setShow((v) => !v)} hitSlop={10} style={{ position: 'absolute', right: space(3.5), top: 0, bottom: 0, justifyContent: 'center' }}>
            <Icon name="eye" size={18} color={show ? colors.primary : colors.faint} />
          </Pressable>
        </View>
        {!passOk && <Text style={{ color: colors.urgent, fontSize: 13 }}>{t('net.passRule')}</Text>}
        <Text style={styles.small}>{t('net.note')}</Text>
        {step.s === 'busy' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), backgroundColor: step.press ? colors.primarySoft : colors.bg, padding: space(3.5), borderRadius: 16 }}>
            {step.press ? <Icon name="sensor" size={26} color={colors.primary} /> : <ActivityIndicator color={colors.primary} />}
            <Text style={[styles.body, { flex: 1, fontWeight: step.press ? '800' : '500' }]}>{step.label}</Text>
          </View>
        ) : (
          <Button icon="send" title={t('net.send')} disabled={!canSend} onPress={send} />
        )}
        {step.s === 'done' && (
          <View style={{ backgroundColor: step.ok ? colors.goodSoft : colors.attentionSoft, padding: space(3.5), borderRadius: 16, gap: 4 }}>
            <Text style={[styles.body, { fontWeight: '800', color: step.ok ? colors.good : colors.warning }]}>{step.title}</Text>
            <Text style={styles.small}>{step.text}</Text>
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

function Input({ icon, value, onChange, placeholder, secure }: { icon: IconName; value: string; onChange: (v: string) => void; placeholder: string; secure?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), backgroundColor: colors.bg, borderRadius: 14, paddingHorizontal: space(3.5) }}>
      <Icon name={icon} size={16} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        style={{ flex: 1, paddingVertical: space(3.2), paddingRight: space(8), fontSize: 15, color: colors.text }}
      />
    </View>
  );
}
