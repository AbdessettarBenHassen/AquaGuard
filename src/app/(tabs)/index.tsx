import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '../../i18n';
import { useGuard, useGuardState, useNow } from '../../state/GuardProvider';
import { AreaChart, Ring } from '../../ui/charts';
import { Button, Card, GlassChips, GradientCard, IconBadge, Pill, Pulse, SectionTitle, formatDuration, styles } from '../../ui/components';
import { countdown, friendlyStatus, greeting, relativeDay, waterLabel } from '../../ui/copy';
import { DemoSheet } from '../../ui/DemoSheet';
import { HomePrompts } from '../../ui/HomePrompts';
import { Icon, zoneIcon, type IconName } from '../../ui/Icon';
import { Logo } from '../../ui/Logo';
import { colors, shadow, space } from '../../ui/theme';

export default function Home() {
  const t = useT();
  const s = useGuardState();
  const now = useNow();
  const insets = useSafeAreaInsets();
  const [demoOpen, setDemoOpen] = useState(false);
  const [chart, setChart] = useState<'water' | 'pressure'>('water');
  const { syncStatus, home, zone, demo, selectZone, role, setValve, pressureTest } = useGuard();

  const { latest, link, baseline, assessment, settings, active, stage, history, valve, test, waterLost } = s;
  const status = friendlyStatus(s);
  const alertOpen = !!active && stage !== 'RESOLVED';
  const remaining = active?.deadline ? active.deadline - now : null;
  const totalWindow = stage === 'LOCAL_ASSISTANCE' ? settings.gracePeriodSec * 1000 : stage === 'ESCALATE' ? settings.smsFallbackSec * 1000 : null;
  const isOwner = role === 'owner';
  const wet = (latest?.water ?? 0) >= settings.wetThreshold;
  const testing = test?.state === 'running';

  const series = chart === 'water' ? s.recent.slice(-60).map((r) => r.water) : s.recent.slice(-60).map((r) => r.pressure ?? 0);
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const today = history.filter((e) => e.startedAt >= startOfDay);
  const valveLog = (home?.valveLog ?? []).filter((v) => v.zoneId === zone?.id);
  const autoToday = valveLog.filter((v) => v.at >= startOfDay && v.action === 'closed' && v.byKind === 'device').length;
  const lastValve = valveLog[0];

  const closeWater = () =>
    Alert.alert(t('valve.closeQ'), t('valve.closeSub'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('valve.close'), style: 'destructive', onPress: () => setValve('close').catch((e: Error) => Alert.alert(t('common.couldNot'), e.message)) },
    ]);
  const openWater = () =>
    Alert.alert(t('valve.openQ'), t('valve.openSub'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('valve.open'), onPress: () => setValve('open').catch((e: Error) => Alert.alert(t('common.couldNot'), e.message)) },
    ]);
  const runTest = () =>
    Alert.alert(t('test.q'), t('test.sub', { s: settings.testSec }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('test.start'), onPress: () => pressureTest().catch((e: Error) => Alert.alert(t('common.couldNot'), e.message)) },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space(3), paddingHorizontal: space(5), paddingBottom: space(28) }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
          <Pressable disabled={!zone} onPress={() => zone && router.push({ pathname: '/zone/[id]', params: { id: zone.id } })}>
            {zone ? <IconBadge name={zoneIcon(zone.icon)} color={colors.primary} bg={colors.primarySoft} size={46} /> : <Logo size={44} />}
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.small}>{greeting(now)}</Text>
            <Text style={[styles.h2, { fontSize: 21 }]} numberOfLines={1}>
              {zone ? zone.name : (home?.home.name ?? 'AquaGuard')}
            </Text>
          </View>
          {syncStatus !== 'ok' && syncStatus !== 'idle' && <Pill icon="wifiOff" text={t('common.noInternet')} tone="urgent" />}
          {zone?.device && <Pill icon={link.connected ? 'wifi' : 'wifiOff'} text={link.connected ? t('common.online') : t('common.offline')} tone={link.connected ? 'good' : 'urgent'} />}
        </View>

        {/* Zone switcher */}
        {home && home.zones.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2), paddingTop: space(4) }}>
            {home.zones.map((z) => {
              const on = z.id === zone?.id;
              const off = z.device?.online && z.device.live?.valve === 'closed';
              return (
                <Pressable key={z.id} onPress={() => selectZone(z.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: on ? colors.primary : colors.card }}>
                  <Icon name={zoneIcon(z.icon)} size={16} color={on ? '#fff' : colors.muted} />
                  <Text style={{ fontWeight: '700', color: on ? '#fff' : colors.text }}>{z.name}</Text>
                  {(z.active || off || (z.device && !z.device.online)) && (
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: z.active ? colors.urgent : off ? colors.attention : colors.faint }} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <HomePrompts />

        {zone?.device && (
          <>
            {/* Hero */}
            <Pressable disabled={!alertOpen} onPress={() => router.push('/alert')} style={{ marginTop: space(5) }}>
              <GradientCard mood={status.mood} style={{ alignItems: 'center', paddingVertical: space(7) }}>
                {alertOpen && remaining != null && remaining > 0 && totalWindow ? (
                  <Ring progress={remaining / totalWindow} size={132} stroke={9}>
                    <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800' }}>{countdown(remaining)}</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 11, textAlign: 'center' }}>{stage === 'LOCAL_ASSISTANCE' ? t('hero.untilFamily') : t('hero.next')}</Text>
                  </Ring>
                ) : testing ? (
                  <Ring progress={test!.elapsed / settings.testSec} size={132} stroke={9}>
                    <Icon name="gauge" size={42} color="#fff" />
                  </Ring>
                ) : !baseline.calibrated && link.connected && !alertOpen ? (
                  <Ring progress={baseline.samples / settings.calibrationSamples} size={132} stroke={9}>
                    <Logo size={84} mood="calm" />
                  </Ring>
                ) : (
                  <Pulse size={110} speed={status.mood === 'calm' ? 3200 : 1400}>
                    <View style={{ width: 110, height: 110, borderRadius: 55, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center' }}>
                      <Logo size={86} mood={alertOpen || wet ? 'alert' : 'happy'} />
                    </View>
                  </Pulse>
                )}
                <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800', marginTop: space(4), textAlign: 'center', letterSpacing: -0.6 }}>{status.title}</Text>
                <View style={{ marginTop: space(3.5) }}>
                  <GlassChips chips={status.chips} />
                </View>
                {alertOpen && <Button title={t('common.open')} kind="white" icon="chevron" style={{ marginTop: space(5), alignSelf: 'stretch' }} onPress={() => router.push('/alert')} />}
              </GradientCard>
            </Pressable>

            {/* Water valve */}
            <SectionTitle>{t('valve.title')}</SectionTitle>
            <Card style={{ gap: space(3) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
                <View style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: valve === 'closed' ? colors.urgentSoft : valve === 'open' ? colors.goodSoft : colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="valve" size={30} color={valve === 'closed' ? colors.urgent : valve === 'open' ? colors.good : colors.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: valve === 'closed' ? colors.urgent : valve === 'open' ? colors.good : colors.muted }}>
                    {valve === 'closed' ? t('valve.off') : valve === 'open' ? t('valve.on') : t('valve.unknown')}
                  </Text>
                  <Text style={styles.small} numberOfLines={2}>
                    {testing
                      ? t('valve.testing')
                      : s.valveTarget !== valve && valve != null
                        ? t('valve.applying')
                        : lastValve
                          ? t('valve.last', { by: lastValve.byKind === 'device' ? t('valve.bySensor') : lastValve.by, when: relativeDay(lastValve.at, now) })
                          : t('valve.never')}
                  </Text>
                </View>
              </View>
              {valve === 'closed' ? (
                <>
                  <Button icon="valve" title={t('valve.open')} disabled={!isOwner || wet || testing} onPress={openWater} />
                  {!isOwner ? (
                    <Note icon="lock" text={t('valve.ownerOnly')} />
                  ) : wet ? (
                    <Note icon="drop" text={t('valve.dryFirst')} tone={colors.urgent} />
                  ) : null}
                </>
              ) : (
                <Button icon="valve" title={t('valve.close')} kind="danger" disabled={!link.connected || testing} onPress={closeWater} />
              )}
              <Button icon="gauge" title={testing ? t('test.running', { s: Math.max(0, settings.testSec - test!.elapsed) }) : t('test.button')} kind="secondary" disabled={!link.connected || testing || valve === 'closed'} onPress={runTest} />
              {test && test.state !== 'running' && (
                <Note
                  icon={test.state === 'failed' ? 'alert' : test.state === 'passed' ? 'check' : 'tap'}
                  tone={test.state === 'failed' ? colors.urgent : test.state === 'passed' ? colors.good : colors.muted}
                  text={test.state === 'failed' ? t('test.failed', { bar: (test.drop ?? 0).toFixed(2) }) : test.state === 'passed' ? t('test.passed', { bar: (test.drop ?? 0).toFixed(2) }) : t('test.cancelled')}
                />
              )}
            </Card>

            {/* Right now */}
            <SectionTitle>{t('home.now')}</SectionTitle>
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Tile icon="drop" color={wet ? colors.urgent : colors.water} value={waterLabel(latest?.water ?? null, settings.wetThreshold)} sub={latest ? `${Math.round(latest.water)}%` : ''} label={t('tile.floor')} />
              <Tile icon="sensor" color={(zone.device.live?.levelCm ?? 0) >= 1 ? colors.urgent : colors.water} value={zone.device.live?.levelCm != null ? zone.device.live.levelCm.toFixed(1) : '–'} sub="cm" label={t('tile.tray')} />
              <Tile icon="humidity" color={colors.humidity} value={latest?.humidity != null ? `${Math.round(latest.humidity)}%` : '–'} sub={latest?.temp != null ? `${latest.temp.toFixed(1)}°` : ''} label={t('tile.humidity')} />
            </View>
            <View style={{ flexDirection: 'row', gap: space(3), marginTop: space(3) }}>
              <Tile icon="gauge" color={colors.pressure} value={latest?.pressure != null ? latest.pressure.toFixed(2) : '–'} sub="bar" label={t('tile.pressure')} />
              <Tile icon="flow" color={colors.flow} value={latest?.flow != null ? latest.flow.toFixed(1) : '–'} sub="L/min" label={t('tile.flow')} />
              <Tile icon="alert" color={colors.warning} value={waterLost != null ? `${Math.round(waterLost)}` : '–'} sub="L" label={t('tile.lost')} />
            </View>

            {/* Chart */}
            <Card style={{ marginTop: space(3), paddingBottom: space(3) }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space(2) }}>
                <View>
                  <Text style={[styles.body, { fontWeight: '700' }]}>{chart === 'water' ? t('chart.water') : t('chart.pressure')}</Text>
                  <Text style={styles.small}>{t('chart.lastMinute')}</Text>
                </View>
                <View style={{ flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 999, padding: 3 }}>
                  {(['water', 'pressure'] as const).map((k) => (
                    <Pressable key={k} onPress={() => setChart(k)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: chart === k ? colors.card : 'transparent' }}>
                      <Icon name={k === 'water' ? 'drop' : 'gauge'} size={16} color={chart === k ? colors.primary : colors.muted} />
                    </Pressable>
                  ))}
                </View>
              </View>
              {chart === 'water' ? (
                <AreaChart values={series} color={colors.water} reference={settings.wetThreshold} referenceLabel={t('chart.wet')} minSpan={40} />
              ) : (
                <AreaChart values={series} color={colors.pressure} reference={baseline.pressure} referenceLabel={t('chart.usual')} minSpan={0.6} />
              )}
            </Card>

            {/* Smart help (AI) */}
            <SectionTitle>{t('home.smart')}</SectionTitle>
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Pressable style={{ flex: 1 }} onPress={() => router.push({ pathname: '/assistant/[zoneId]', params: { zoneId: zone.id } })}>
                <Card style={{ gap: space(2) }}>
                  <IconBadge name="chat" color={colors.violet} bg={colors.violetSoft} size={36} />
                  <Text style={[styles.body, { fontWeight: '800' }]}>{t('home.ask')}</Text>
                  <Text style={styles.small}>{t('home.askSub')}</Text>
                </Card>
              </Pressable>
              <Pressable style={{ flex: 1 }} onPress={() => router.push({ pathname: '/insights/[zoneId]', params: { zoneId: zone.id } })}>
                <Card style={{ gap: space(2) }}>
                  <IconBadge name="chart" color={colors.primary} bg={colors.primarySoft} size={36} />
                  <Text style={[styles.body, { fontWeight: '800' }]}>{t('home.learned')}</Text>
                  <Text style={styles.small}>{t('home.learnedSub')}</Text>
                </Card>
              </Pressable>
            </View>

            {/* Today */}
            <SectionTitle>{t('home.today')}</SectionTitle>
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Stat icon={<IconBadge name="shield" color={colors.primary} bg={colors.primarySoft} size={36} />} value={link.connectedAt ? formatDuration(now - link.connectedAt) : '–'} label={t('home.protected')} />
              <Stat icon={<IconBadge name="bell" color={colors.warning} bg={colors.attentionSoft} size={36} />} value={String(today.length)} label={t('home.alerts')} />
              <Stat icon={<IconBadge name="valve" color={colors.good} bg={colors.goodSoft} size={36} />} value={String(autoToday)} label={t('home.autoStops')} />
            </View>
          </>
        )}

        {settings.showTechnical && zone?.device && (
          <>
            <SectionTitle>{t('tech.title')}</SectionTitle>
            <Card style={{ gap: space(2) }}>
              <Row k={t('tech.score')} v={assessment?.mlScore != null ? `${Math.round(assessment.mlScore * 100)}% (≥ ${Math.round(settings.leakScoreThreshold * 100)}%)` : 'n/a'} />
              <Row k={t('tech.window')} v={`${settings.windowSamples} × 1 s · ${t('tech.confirm', { n: settings.sustainSamples })}`} />
              <Row k={t('tech.baseline')} v={baseline.calibrated ? `${Math.round(baseline.humidity ?? 0)}% · ${(baseline.pressure ?? 0).toFixed(2)} bar` : `${baseline.samples}/${settings.calibrationSamples}`} />
              <Row k={t('tech.wet')} v={`${settings.wetThreshold}%`} />
              <Row k={t('tech.stage')} v={stage} />
              <Row k={t('tech.signal')} v={link.connected ? `${link.rssi} dBm` : '–'} />
              <Row k={t('tech.firmware')} v={link.firmware} />
            </Card>
          </>
        )}
      </ScrollView>

      {settings.demoMode && demo && (
        <Pressable
          onPress={() => setDemoOpen(true)}
          style={({ pressed }) => [
            { position: 'absolute', right: space(5), bottom: space(5), flexDirection: 'row', alignItems: 'center', gap: space(2), backgroundColor: colors.text, paddingVertical: space(3), paddingHorizontal: space(4.5), borderRadius: 999, transform: [{ scale: pressed ? 0.96 : 1 }] },
            shadow,
          ]}
        >
          <Icon name="flask" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700' }}>{t('demo.button')}</Text>
        </Pressable>
      )}
      <DemoSheet visible={demoOpen} onClose={() => setDemoOpen(false)} />
    </View>
  );
}

function Tile({ icon, color, value, sub, label }: { icon: IconName; color: string; value: string; sub?: string; label: string }) {
  return (
    <Card style={{ flex: 1, gap: space(1.5), paddingVertical: space(3.5) }}>
      <Icon name={icon} size={20} color={color} />
      <Text style={{ fontSize: 19, fontWeight: '800', color: colors.text, letterSpacing: -0.4 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {!!sub && <Text style={{ fontSize: 12, fontWeight: '600', color: colors.muted }}> {sub}</Text>}
      </Text>
      <Text style={styles.small} numberOfLines={1}>
        {label}
      </Text>
    </Card>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <Card style={{ flex: 1, alignItems: 'flex-start', gap: space(2) }}>
      {icon}
      <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.small} numberOfLines={1}>
        {label}
      </Text>
    </Card>
  );
}

function Note({ icon, text, tone = colors.muted }: { icon: IconName; text: string; tone?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
      <Icon name={icon} size={15} color={tone} />
      <Text style={[styles.small, { flex: 1, color: tone }]}>{text}</Text>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(3) }}>
      <Text style={styles.small}>{k}</Text>
      <Text style={[styles.small, { color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' }]}>{v}</Text>
    </View>
  );
}
