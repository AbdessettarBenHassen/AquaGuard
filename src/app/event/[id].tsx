import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import type { AlertAdvice } from '../../api/client';
import { getLang, useT } from '../../i18n';
import { useGuard, useGuardState } from '../../state/GuardProvider';
import { Card, IconBadge, Pill, SectionTitle, Timeline, formatDuration, styles } from '../../ui/components';
import { friendlyReason, outcomeLabel, relativeDay, triggerIcon, triggerShort, triggerTone } from '../../ui/copy';
import type { IconName } from '../../ui/Icon';
import { colors, space } from '../../ui/theme';

export default function EventDetail() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { history, settings } = useGuardState();
  const e = history.find((x) => x.id === id);

  if (!e) {
    return (
      <View style={{ padding: space(6) }}>
        <Text style={styles.body}>{t('event.gone')}</Text>
      </View>
    );
  }

  const snap = e.trigger.snapshot;
  const out = outcomeLabel(e);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(5), paddingBottom: space(12) }}>
      <Card style={{ alignItems: 'center', gap: space(2), paddingVertical: space(6) }}>
        <IconBadge name={triggerIcon[e.trigger.kind]} color={triggerTone[e.trigger.kind].color} bg={triggerTone[e.trigger.kind].bg} size={60} />
        <Text style={styles.h2}>{triggerShort(e.trigger.kind)}</Text>
        <Text style={styles.small}>{relativeDay(e.startedAt)}</Text>
        <Pill text={out.text} tone={out.tone} icon={out.tone === 'good' ? 'check' : undefined} />
        {e.resolvedAt && <Text style={styles.small}>{t('event.sorted', { d: formatDuration(e.resolvedAt - e.startedAt) })}</Text>}
      </Card>

      <SectionTitle>{t('event.why')}</SectionTitle>
      <Card>
        <Text style={styles.body}>{friendlyReason(e)}</Text>
      </Card>

      <View style={{ flexDirection: 'row', gap: space(3), marginTop: space(3) }}>
        {e.trigger.kind === 'hidden_leak' ? (
          <Fact icon="gauge" color={colors.pressure} label={t('event.drop')} value={`${(snap.pressureDrop ?? 0).toFixed(2)} bar`} />
        ) : (
          <Fact icon="drop" color={colors.water} label={t('tile.floor')} value={snap.water != null ? `${Math.round(snap.water)}%` : '–'} />
        )}
        <Fact icon="valve" color={snap.valveClosed ? colors.good : colors.urgent} label={t('event.valve')} value={snap.valveClosed ? t('chip.waterOff') : t('chip.waterOn')} />
        <Fact icon="alert" color={colors.warning} label={t('tile.lost')} value={snap.waterLost != null ? `${snap.waterLost} L` : '–'} />
      </View>

      {settings.showTechnical && (
        <>
          <SectionTitle>{t('tech.title')}</SectionTitle>
          <Card style={{ gap: space(1.5) }}>
            <Text style={styles.small}>{e.trigger.reason}</Text>
            <Text style={styles.small}>
              {t('event.detectedBy')}: {e.trigger.source}
              {snap.mlScore != null ? ` · ${t('tech.score')} ${Math.round(snap.mlScore * 100)}%` : ''}
            </Text>
            {snap.humidity != null && (
              <Text style={styles.small}>
                {t('tile.humidity')} {Math.round(snap.humidity)}% · {t('tile.pressure')} {snap.pressure?.toFixed(2) ?? '–'} bar · {t('tile.flow')} {snap.flow?.toFixed(1) ?? '–'} L/min
              </Text>
            )}
          </Card>
        </>
      )}

      {e.resolvedAt != null && <AdviceCard alertId={e.id} />}

      <SectionTitle>{t('alert.happened')}</SectionTitle>
      <Card>
        <Timeline entries={e.timeline} />
      </Card>
    </ScrollView>
  );
}

/** AI advice (free AI model), written by the server once the alert is closed. */
function AdviceCard({ alertId }: { alertId: string }) {
  const t = useT();
  const { api } = useGuard();
  const [advice, setAdvice] = useState<AlertAdvice | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    api
      .advice(alertId, getLang())
      .then((r) => {
        if (!alive) return;
        setAdvice(r.advice);
        setNote(r.advice ? null : (r.pending ?? null));
      })
      .catch((err: Error) => alive && setNote(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [api, alertId]);

  if (!api || (!loading && !advice && !note)) return null;
  return (
    <>
      <SectionTitle>{t('event.advice')}</SectionTitle>
      <Card style={{ gap: space(2.5) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <IconBadge name="sparkle" color={colors.violet} bg={colors.violetSoft} size={34} />
          <Text style={[styles.body, { fontWeight: '700', flex: 1 }]}>{loading ? t('event.writing') : t('event.whatToDo')}</Text>
          {loading && <ActivityIndicator color={colors.violet} />}
        </View>
        {advice && (
          <>
            <Text style={styles.body}>{advice.summary}</Text>
            {advice.tips.map((tip, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: space(2) }}>
                <Text style={[styles.body, { color: colors.violet, fontWeight: '800' }]}>{i + 1}.</Text>
                <Text style={[styles.body, { flex: 1 }]}>{tip}</Text>
              </View>
            ))}
            <Text style={styles.small}>{t('event.aiNote')}</Text>
          </>
        )}
        {!advice && !loading && note && <Text style={styles.small}>{note}</Text>}
      </Card>
    </>
  );
}

function Fact({ icon, color, label, value }: { icon: IconName; color: string; label: string; value: string }) {
  return (
    <Card style={{ flex: 1, gap: space(1.5) }}>
      <IconBadge name={icon} color={color} bg={colors.bg} size={34} />
      <Text style={styles.small} numberOfLines={1}>
        {label}
      </Text>
      <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </Card>
  );
}
