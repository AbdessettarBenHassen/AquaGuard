import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import type { Insights } from '../../api/client';
import { MODEL } from '../../core/model';
import { getLang, useLang, useT, type Key } from '../../i18n';
import { useGuard } from '../../state/GuardProvider';
import { Button, Card, IconBadge, Pill, SectionTitle, styles } from '../../ui/components';
import { Icon, type IconName } from '../../ui/Icon';
import { colors, space } from '../../ui/theme';

// "What AquaGuard learned": the room's usual levels, the AI model, and the
// patterns in this zone's alerts, computed by the server from the real data.

const CONFIDENCE: Record<Insights['confidence'], { label: Key; tone: 'attention' | 'muted' | 'primary' | 'good'; text: Key }> = {
  learning: { label: 'conf.learning', tone: 'attention', text: 'conf.learningSub' },
  low: { label: 'conf.low', tone: 'muted', text: 'conf.lowSub' },
  medium: { label: 'conf.medium', tone: 'primary', text: 'conf.mediumSub' },
  high: { label: 'conf.high', tone: 'good', text: 'conf.highSub' },
};

const SLOTS: { key: keyof Insights['alerts']['byTime']; label: Key; icon: IconName }[] = [
  { key: 'morning', label: 'slot.morning', icon: 'sparkle' },
  { key: 'afternoon', label: 'slot.afternoon', icon: 'tap' },
  { key: 'evening', label: 'slot.evening', icon: 'home' },
  { key: 'night', label: 'slot.night', icon: 'moon' },
];

export default function InsightsScreen() {
  const t = useT();
  const [lang] = useLang();
  const { zoneId } = useLocalSearchParams<{ zoneId: string }>();
  const { api, home } = useGuard();
  const zone = home?.zones.find((z) => z.id === zoneId);
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      setData((await api.insights(zoneId, days, getLang())).insights);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, zoneId, days]);

  // Reload when the period or the language changes (findings are written by the server in that language).
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load, lang]);

  const a = data?.alerts;
  const maxSlot = a ? Math.max(1, ...SLOTS.map((s) => a.byTime[s.key])) : 1;
  const closed = a ? a.outcomes.localAnswered + a.outcomes.memberAnswered + a.outcomes.falseAlarm : 0;
  const pct = (n: number) => (closed ? `${Math.round((n / closed) * 100)}%` : '–');

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(5), paddingBottom: space(14), gap: space(3) }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
      <View style={{ flexDirection: 'row', gap: space(2) }}>
        {[7, 30, 90].map((d) => (
          <Pressable key={d} onPress={() => setDays(d)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: d === days ? colors.primary : colors.card }}>
            <Text style={{ fontWeight: '700', color: d === days ? '#fff' : colors.muted }}>{t('ins.days', { n: d })}</Text>
          </Pressable>
        ))}
      </View>

      {loading && !data ? <ActivityIndicator color={colors.primary} style={{ marginTop: space(8) }} /> : null}
      {error ? <Text style={{ color: colors.urgent }}>{error}</Text> : null}

      {data && a && (
        <>
          <Card style={{ gap: space(3) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
              <IconBadge name="sparkle" color={colors.violet} bg={colors.violetSoft} size={42} />
              <View style={{ flex: 1 }}>
                <Text style={styles.h3}>{t('ins.model', { zone: zone?.name ?? '' })}</Text>
                <Text style={styles.small}>{t(CONFIDENCE[data.confidence].text)}</Text>
              </View>
              <Pill text={t(CONFIDENCE[data.confidence].label)} tone={CONFIDENCE[data.confidence].tone} />
            </View>
            {!data.profile.calibrated && (
              <View style={{ gap: 6 }}>
                <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.min(100, (data.profile.samples / data.profile.calibrationSamples) * 100)}%`, height: 10, backgroundColor: colors.primary }} />
                </View>
                <Text style={styles.small}>{t('set.learning', { n: data.profile.samples, total: data.profile.calibrationSamples })}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Fact icon="humidity" color={colors.humidity} label={t('ins.usualHum')} value={data.profile.baselineHumidity != null ? `${data.profile.baselineHumidity}%` : '–'} />
              <Fact icon="gauge" color={colors.pressure} label={t('ins.usualPress')} value={data.profile.baselinePressure != null ? `${data.profile.baselinePressure} bar` : '–'} />
            </View>
            <Text style={styles.small}>
              {t('ins.how', {
                window: data.profile.thresholds.windowSamples,
                score: Math.round(data.profile.thresholds.leakScoreThreshold * 100),
                n: data.profile.thresholds.sustainSamples,
              })}
            </Text>
            <Text style={[styles.small, { color: colors.violet }]}>
              {t('ins.modelInfo', { version: MODEL.version, n: MODEL.features.length })}
            </Text>
          </Card>

          <SectionTitle>{t('ins.noticed')}</SectionTitle>
          <Card style={{ gap: space(2.5) }}>
            {data.findings.map((f, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: space(2) }}>
                <Icon name="check" size={16} color={colors.primary} />
                <Text style={[styles.body, { flex: 1 }]}>{f}</Text>
              </View>
            ))}
          </Card>

          {data.suggestions.length > 0 && (
            <>
              <SectionTitle>{t('ins.ideas')}</SectionTitle>
              <Card style={{ gap: space(2.5), backgroundColor: colors.attentionSoft }}>
                {data.suggestions.map((s, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: space(2) }}>
                    <Icon name="bell" size={16} color={colors.warning} />
                    <Text style={[styles.body, { flex: 1 }]}>{s}</Text>
                  </View>
                ))}
              </Card>
            </>
          )}

          {a.total > 0 && (
            <>
              <SectionTitle>{t('ins.when')}</SectionTitle>
              <Card style={{ gap: space(2.5) }}>
                {SLOTS.map((s) => (
                  <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space(2.5) }}>
                    <Icon name={s.icon} size={16} color={colors.muted} />
                    <Text style={[styles.body, { width: 92 }]}>{t(s.label)}</Text>
                    <View style={{ flex: 1, height: 12, borderRadius: 6, backgroundColor: colors.bg, overflow: 'hidden' }}>
                      <View style={{ width: `${(a.byTime[s.key] / maxSlot) * 100}%`, height: 12, borderRadius: 6, backgroundColor: s.key === 'night' ? colors.violet : colors.primary }} />
                    </View>
                    <Text style={[styles.body, { width: 24, textAlign: 'right', fontWeight: '700' }]}>{a.byTime[s.key]}</Text>
                  </View>
                ))}
              </Card>

              <SectionTitle>{t('ins.response')}</SectionTitle>
              <View style={{ flexDirection: 'row', gap: space(3) }}>
                <Fact icon="valve" color={colors.good} label={t('ins.shutOff')} value={a.avgSecondsToShutOff != null ? `${a.avgSecondsToShutOff} s` : '–'} />
                <Fact icon="arrowUp" color={colors.water} label={t('ins.growth')} value={a.avgGrowthPerMin != null ? `${a.avgGrowthPerMin}%/min` : '–'} />
              </View>
              <View style={{ flexDirection: 'row', gap: space(3) }}>
                <Fact icon="home" color={colors.good} label={t('hist.atHome')} value={pct(a.outcomes.localAnswered)} />
                <Fact icon="users" color={colors.primary} label={t('ins.inApp')} value={pct(a.outcomes.memberAnswered)} />
              </View>
              <View style={{ flexDirection: 'row', gap: space(3) }}>
                <Fact icon="close" color={colors.muted} label={t('hist.false')} value={a.falseAlarmRate != null ? `${Math.round(a.falseAlarmRate * 100)}%` : '–'} />
                <Fact icon="phone" color={colors.urgent} label={t('ins.reached')} value={String(a.outcomes.contactsReached)} />
              </View>
            </>
          )}

          <Button icon="chat" title={t('ins.ask', { zone: zone?.name ?? '' })} onPress={() => router.push({ pathname: '/assistant/[zoneId]', params: { zoneId } })} style={{ marginTop: space(2) }} />
          <Text style={styles.small}>{t('ins.footer')}</Text>
        </>
      )}
    </ScrollView>
  );
}

function Fact({ icon, color, label, value }: { icon: IconName; color: string; label: string; value: string }) {
  return (
    <Card style={{ flex: 1, gap: space(1.5) }}>
      <Icon name={icon} size={20} color={color} />
      <Text style={styles.small}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{value}</Text>
    </Card>
  );
}
