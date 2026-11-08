import { Link } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import type { ValveLogEntry } from '../../api/client';
import type { AlertEvent } from '../../core/types';
import { locale, useT } from '../../i18n';
import { useGuard, useGuardState, useNow } from '../../state/GuardProvider';
import { WeekBars } from '../../ui/charts';
import { Card, IconBadge, Pill, SectionTitle, styles } from '../../ui/components';
import { outcomeLabel, relativeDay, triggerIcon, triggerShort, triggerTone } from '../../ui/copy';
import { Icon, type IconName } from '../../ui/Icon';
import { Logo } from '../../ui/Logo';
import { colors, space } from '../../ui/theme';

const DAY = 86400000;

type Item = { type: 'alert'; at: number; e: AlertEvent } | { type: 'valve'; at: number; v: ValveLogEntry };

export default function History() {
  const t = useT();
  const { history } = useGuardState();
  const { home, zone } = useGuard();
  const now = useNow(60000);
  const [show, setShow] = useState<'all' | 'alerts'>('all');

  const start = new Date(now).setHours(0, 0, 0, 0) - 6 * DAY;
  const week = Array.from({ length: 7 }, (_, i) => {
    const from = start + i * DAY;
    return {
      label: new Date(from).toLocaleDateString(locale(), { weekday: 'narrow' }),
      value: history.filter((e) => e.startedAt >= from && e.startedAt < from + DAY).length,
      today: i === 6,
    };
  });
  const thisWeek = history.filter((e) => e.startedAt >= start);
  const atHome = thisWeek.filter((e) => e.resolution === 'local_ack').length;
  const neededFamily = thisWeek.filter((e) => e.level > 0).length;
  const falseAlarms = thisWeek.filter((e) => e.resolution === 'false_alarm').length;

  const valves = show === 'all' ? (home?.valveLog ?? []).filter((v) => v.zoneId === zone?.id) : [];
  const items: Item[] = [
    ...history.map((e) => ({ type: 'alert' as const, at: e.startedAt, e })),
    ...valves.map((v) => ({ type: 'valve' as const, at: v.at, v })),
  ].sort((a, b) => b.at - a.at);

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      data={items}
      keyExtractor={(x) => (x.type === 'alert' ? x.e.id : `v${x.v.id}`)}
      contentContainerStyle={{ padding: space(5), gap: space(3), paddingBottom: space(12) }}
      ListHeaderComponent={
        <View style={{ gap: space(3) }}>
          <Card>
            <View style={{ marginBottom: space(3) }}>
              <Text style={[styles.body, { fontWeight: '700' }]}>{t('hist.week', { zone: zone?.name ?? '' })}</Text>
              <Text style={styles.small}>{thisWeek.length === 0 ? t('hist.calmWeek') : t('hist.count', { n: thisWeek.length })}</Text>
            </View>
            <WeekBars data={week} color={colors.primary} />
          </Card>
          <View style={{ flexDirection: 'row', gap: space(3) }}>
            <Mini value={atHome} label={t('hist.atHome')} tone={colors.good} bg={colors.goodSoft} icon="home" />
            <Mini value={neededFamily} label={t('hist.family')} tone={colors.warning} bg={colors.attentionSoft} icon="users" />
            <Mini value={falseAlarms} label={t('hist.false')} tone={colors.muted} bg="#EEF2F6" icon="close" />
          </View>
          {items.length > 0 && (
            <SectionTitle
              right={
                <View style={{ flexDirection: 'row', backgroundColor: colors.card, borderRadius: 999, padding: 3 }}>
                  {(['all', 'alerts'] as const).map((k) => (
                    <Pressable key={k} onPress={() => setShow(k)} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: show === k ? colors.primary : 'transparent' }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: show === k ? '#fff' : colors.muted }}>{k === 'all' ? t('hist.all') : t('hist.alertsOnly')}</Text>
                    </Pressable>
                  ))}
                </View>
              }
            >
              {t('hist.events')}
            </SectionTitle>
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={{ alignItems: 'center', marginTop: space(10), gap: space(2) }}>
          <Logo size={110} />
          <Text style={styles.h2}>{t('hist.empty')}</Text>
          <Text style={[styles.body, { color: colors.muted, textAlign: 'center', maxWidth: 260 }]}>{t('hist.emptySub')}</Text>
        </View>
      }
      renderItem={({ item }) => (item.type === 'alert' ? <AlertRow e={item.e} now={now} /> : <ValveRow v={item.v} now={now} />)}
    />
  );
}

function AlertRow({ e, now }: { e: AlertEvent; now: number }) {
  const out = outcomeLabel(e);
  return (
    <Link href={{ pathname: '/event/[id]', params: { id: e.id } }} asChild>
      <Pressable>
        <Card style={{ flexDirection: 'row', gap: space(3), alignItems: 'center' }}>
          <IconBadge name={triggerIcon[e.trigger.kind]} color={triggerTone[e.trigger.kind].color} bg={triggerTone[e.trigger.kind].bg} size={44} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={[styles.body, { fontWeight: '700' }]}>{triggerShort(e.trigger.kind)}</Text>
            <Text style={styles.small}>{relativeDay(e.startedAt, now)}</Text>
          </View>
          <Pill text={out.text} tone={out.tone} icon={out.tone === 'good' ? 'check' : undefined} />
          <Icon name="chevron" size={18} color={colors.faint} />
        </Card>
      </Pressable>
    </Link>
  );
}

function ValveRow({ v, now }: { v: ValveLogEntry; now: number }) {
  const t = useT();
  const closed = v.action === 'closed';
  const by = v.byKind === 'device' ? t('valve.bySensor') : v.by;
  return (
    <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'center', paddingHorizontal: space(4), paddingVertical: space(2.5), borderRadius: 18, backgroundColor: closed ? colors.urgentSoft : colors.goodSoft }}>
      <Icon name="valve" size={20} color={closed ? colors.urgent : colors.good} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.body, { fontWeight: '700', color: closed ? colors.urgent : colors.good }]}>{closed ? t('hist.valveOff', { by }) : t('hist.valveOn', { by })}</Text>
        <Text style={styles.small}>{relativeDay(v.at, now)}</Text>
      </View>
    </View>
  );
}

function Mini({ value, label, tone, bg, icon }: { value: number; label: string; tone: string; bg: string; icon: IconName }) {
  return (
    <Card style={{ flex: 1, gap: space(2) }}>
      <IconBadge name={icon} color={tone} bg={bg} size={32} />
      <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{value}</Text>
      <Text style={styles.small} numberOfLines={1}>
        {label}
      </Text>
    </Card>
  );
}
