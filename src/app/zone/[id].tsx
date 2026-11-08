import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ZoneIcon } from '../../core/types';
import { useT } from '../../i18n';
import { useGuard, useNow } from '../../state/GuardProvider';
import { Button, Card, Pill, SectionTitle, formatDuration, styles } from '../../ui/components';
import { relativeDay } from '../../ui/copy';
import { Field } from '../../ui/Field';
import { ZonePicker } from '../../ui/HomeOverview';
import { Icon, zoneIcon, type IconName } from '../../ui/Icon';
import { colors, space } from '../../ui/theme';

type Sheet = null | 'options' | 'main' | 'move';

export default function ZoneScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { home, api, refresh, selectZone } = useGuard();
  const insets = useSafeAreaInsets();
  const now = useNow(5000);
  const zone = home?.zones.find((z) => z.id === id);
  const [name, setName] = useState(zone?.name ?? '');
  const [icon, setIcon] = useState<ZoneIcon>(zone?.icon ?? 'other');
  const [sheet, setSheet] = useState<Sheet>(null);

  if (!home || !zone) {
    return (
      <View style={{ padding: space(6) }}>
        <Text style={styles.body}>{t('zone.gone')}</Text>
      </View>
    );
  }

  const isOwner = home.me.role === 'owner';
  const d = zone.device;
  const dirty = name !== zone.name || icon !== zone.icon;
  const valves = home.valveLog.filter((v) => v.zoneId === zone.id).slice(0, 6);
  const sensors = d?.live?.sensors;

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      await refresh();
      if (done) Alert.alert(done);
    } catch (e) {
      Alert.alert(t('common.couldNot'), (e as Error).message);
    }
  };

  const removeCompletely = () =>
    Alert.alert(t('zone.removeQ'), t('zone.removeSub', { id: d?.id ?? '' }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.remove'), style: 'destructive', onPress: () => act(() => api!.releaseDevice(d!.id), t('zone.removed')) },
    ]);

  const deleteZone = () =>
    Alert.alert(t('zone.deleteQ', { zone: zone.name }), t('zone.deleteSub'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          act(async () => {
            await api!.deleteZone(zone.id);
            router.back();
          }),
      },
    ]);

  const owners = home.members.filter((m) => m.role === 'owner');
  const others = home.zones.filter((z) => z.id !== zone.id);
  const health = (s?: string) => (s === 'missing' ? t('zone.missing') : s === 'stuck' ? t('zone.stuck') : s === 'simulated' ? t('zone.simulated') : s === 'ok' ? t('zone.ok') : '–');

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(5), paddingBottom: space(14) }}>
      <View style={{ alignItems: 'center', gap: space(2) }}>
        <View style={{ width: 110, height: 110, borderRadius: 55, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={zoneIcon(icon)} size={54} color={colors.primary} />
        </View>
        <Text style={styles.h1}>{zone.name}</Text>
        {zone.active && <Pill icon="alert" text={t('common.alert')} tone="urgent" />}
      </View>

      {/* Sensor node */}
      <SectionTitle>{t('zone.sensor')}</SectionTitle>
      {d ? (
        <Card style={{ gap: space(3) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: d.online ? colors.goodSoft : '#EEF2F6', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={d.kind === 'demo' ? 'flask' : 'sensor'} size={26} color={d.online ? colors.good : colors.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.body, { fontWeight: '800' }]}>{d.id}</Text>
              <Text style={styles.small}>{d.kind === 'demo' ? t('zone.demoNode') : `${t('tech.firmware')} ${d.firmware ?? '–'}`}</Text>
            </View>
            <Pill icon={d.online ? 'check' : 'wifiOff'} text={d.online ? t('common.online') : t('common.offline')} tone={d.online ? 'good' : 'muted'} />
          </View>
          <Row icon="valve" k={t('zone.valve')} v={d.online ? (d.live?.valve === 'closed' ? t('chip.waterOff') : t('chip.waterOn')) : '–'} />
          <Row icon="drop" k={t('zone.scout')} v={health(sensors?.water)} />
          <Row icon="sensor" k={t('zone.tray')} v={health(sensors?.level)} />
          <Row icon="humidity" k={t('tile.humidity')} v={health(sensors?.humidity)} />
          <Row icon="gauge" k={t('tile.pressure')} v={health(sensors?.pressure)} />
          <Row icon="phone" k={t('zone.mainPhone')} v={d.mainUserName ?? '–'} />
          <Row icon="clock" k={t('zone.lastData')} v={d.liveAgeMs != null ? t('zone.ago', { d: formatDuration(d.liveAgeMs) }) : t('zone.never')} />
          <Row icon="link" k={t('zone.linked')} v={d.linkedAt ? t('zone.ago', { d: formatDuration(now - d.linkedAt) }) : '–'} />
          <Row icon="wifi" k={t('zone.network')} v={d.live?.network?.ssid ? `Wi-Fi “${d.live.network.ssid}”` : d.kind === 'demo' ? t('zone.demoNet') : '–'} />
          {isOwner && d.kind === 'real' && <Button icon="wifi" title={t('zone.wifi')} kind="secondary" onPress={() => router.push({ pathname: '/network/[zoneId]', params: { zoneId: zone.id } })} />}
          {isOwner && <Button icon="settings" title={t('zone.options')} kind="secondary" onPress={() => setSheet('options')} />}
        </Card>
      ) : (
        <Card style={{ alignItems: 'center', gap: space(3), paddingVertical: space(6) }}>
          <Icon name="sensor" size={40} color={colors.faint} />
          <Text style={styles.body}>{t('zone.noSensor')}</Text>
          {isOwner && <Button icon="link" title={t('zone.link')} onPress={() => router.push({ pathname: '/link/[zoneId]', params: { zoneId: zone.id } })} style={{ alignSelf: 'stretch' }} />}
        </Card>
      )}

      {/* Valve log */}
      {valves.length > 0 && (
        <>
          <SectionTitle>{t('zone.valveLog')}</SectionTitle>
          <Card style={{ gap: space(2.5) }}>
            {valves.map((v) => (
              <View key={v.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space(2.5) }}>
                <Icon name="valve" size={16} color={v.action === 'closed' ? colors.urgent : colors.good} />
                <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
                  {v.action === 'closed' ? t('hist.valveOff', { by: v.byKind === 'device' ? t('valve.bySensor') : v.by }) : t('hist.valveOn', { by: v.by })}
                </Text>
                <Text style={styles.small}>{relativeDay(v.at, now)}</Text>
              </View>
            ))}
          </Card>
        </>
      )}

      {/* AI */}
      <SectionTitle>{t('home.smart')}</SectionTitle>
      <View style={{ gap: space(2.5) }}>
        <Option icon="chat" title={t('home.ask')} sub={t('zone.askSub', { zone: zone.name })} onPress={() => router.push({ pathname: '/assistant/[zoneId]', params: { zoneId: zone.id } })} />
        <Option icon="chart" title={t('home.learned')} sub={t('zone.learnedSub')} onPress={() => router.push({ pathname: '/insights/[zoneId]', params: { zoneId: zone.id } })} />
      </View>

      {/* Profile */}
      {isOwner && (
        <>
          <SectionTitle>{t('zone.profile')}</SectionTitle>
          <Card style={{ gap: space(3) }}>
            <Field icon="home" value={name} onChange={setName} placeholder={t('zone.namePh')} />
            <ZonePicker value={icon} onChange={setIcon} />
            <Button icon="check" title={t('common.save')} disabled={!dirty || !name.trim()} onPress={() => act(() => api!.updateZone(zone.id, { name: name.trim(), icon }), t('common.saved'))} />
          </Card>
        </>
      )}

      <Button icon="drop" title={t('zone.showHome', { zone: zone.name })} kind="ghost" style={{ marginTop: space(4) }} onPress={() => { selectZone(zone.id); router.back(); }} />
      {isOwner && <Button icon="trash" title={t('zone.delete', { zone: zone.name })} kind="ghost" style={{ marginTop: space(2) }} onPress={deleteZone} />}

      {/* Sensor options sheet */}
      <Modal visible={sheet != null} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(18,38,58,0.4)' }} onPress={() => setSheet(null)} />
        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: space(5), paddingBottom: insets.bottom + space(5), gap: space(2.5) }}>
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.faint, marginBottom: space(2) }} />
          {sheet === 'options' && d && (
            <>
              <Text style={styles.h2}>{t('zone.optionsQ')}</Text>
              <Option icon="link" title={t('zone.replace')} sub={t('zone.replaceSub')} onPress={() => { setSheet(null); router.push({ pathname: '/link/[zoneId]', params: { zoneId: zone.id } }); }} />
              <Option icon="phone" title={t('zone.changeMain')} sub={t('zone.changeMainSub')} onPress={() => setSheet('main')} />
              <Option icon="home" title={t('zone.move')} sub={others.length ? t('zone.moveSub') : t('zone.moveNone')} disabled={!others.length} onPress={() => setSheet('move')} />
              <Option icon="trash" title={t('zone.remove')} sub={t('zone.removeOpt')} danger onPress={() => { setSheet(null); removeCompletely(); }} />
            </>
          )}
          {sheet === 'main' && d && (
            <>
              <Text style={styles.h2}>{t('zone.whoMain')}</Text>
              {owners.map((m) => (
                <Option
                  key={m.userId}
                  icon={m.userId === d.mainUserId ? 'check' : 'phone'}
                  title={m.name}
                  sub={m.userId === d.mainUserId ? t('zone.currentMain') : t('role.owner')}
                  onPress={() => {
                    setSheet(null);
                    act(() => api!.setMainUser(d.id, m.userId), t('zone.mainSet', { name: m.name }));
                  }}
                />
              ))}
            </>
          )}
          {sheet === 'move' && d && (
            <>
              <Text style={styles.h2}>{t('zone.moveTo', { id: d.id })}</Text>
              {others.map((z) => (
                <Option
                  key={z.id}
                  icon={zoneIcon(z.icon)}
                  title={z.name}
                  sub={z.device ? t('zone.willFree', { id: z.device.id }) : t('zone.noSensor')}
                  onPress={() => {
                    setSheet(null);
                    act(() => api!.moveDevice(d.id, z.id), t('zone.moved', { zone: z.name }));
                  }}
                />
              ))}
            </>
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

function Row({ icon, k, v }: { icon: IconName; k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2.5) }}>
      <Icon name={icon} size={16} color={colors.muted} />
      <Text style={[styles.body, { flex: 1, color: colors.muted }]}>{k}</Text>
      <Text style={[styles.body, { fontWeight: '700' }]}>{v}</Text>
    </View>
  );
}

function Option({ icon, title, sub, onPress, danger, disabled }: { icon: IconName; title: string; sub: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3.5), borderRadius: 18, backgroundColor: danger ? colors.urgentSoft : colors.card, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}
    >
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: danger ? colors.urgent : colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={danger ? '#fff' : colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.body, { fontWeight: '800', color: danger ? colors.urgent : colors.text }]}>{title}</Text>
        <Text style={styles.small}>{sub}</Text>
      </View>
    </Pressable>
  );
}
