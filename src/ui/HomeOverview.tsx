import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';

import type { Member, Role } from '../api/client';
import type { ZoneIcon } from '../core/types';
import { useT, type Key } from '../i18n';
import { useGuard } from '../state/GuardProvider';
import { Avatar, avatarFor } from './Avatar';
import { Button, Card, Pill, SectionTitle, styles } from './components';
import { Field } from './Field';
import { Icon, ZONE_ICONS, zoneIcon } from './Icon';
import { colors, space } from './theme';

/** Home tab header: zones, members (roles) and the invite code. */
export function HomeOverview() {
  const t = useT();
  const { home, api, refresh, user } = useGuard();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState<ZoneIcon>('kitchen');
  if (!home) return null;
  const isOwner = home.me.role === 'owner';
  const hid = home.home.id;
  const roleLabel = (r: Role) => (r === 'owner' ? t('role.owner') : t('role.member'));

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      Alert.alert(t('common.couldNot'), (e as Error).message);
    }
  };

  const memberMenu = (m: Member) => {
    const self = m.userId === user?.id;
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (isOwner && !self) {
      if (m.role !== 'owner') buttons.push({ text: t('home.makeOwner'), onPress: () => act(() => api!.setRole(hid, m.userId, 'owner')) });
      if (m.role !== 'member') buttons.push({ text: t('home.makeMember'), onPress: () => act(() => api!.setRole(hid, m.userId, 'member')) });
      buttons.push({ text: t('home.remove', { name: m.name }), style: 'destructive', onPress: () => act(() => api!.removeMember(hid, m.userId)) });
    }
    if (self) buttons.push({ text: t('home.leave'), style: 'destructive', onPress: () => act(() => api!.removeMember(hid, m.userId)) });
    if (buttons.length === 0) return;
    buttons.push({ text: t('common.cancel'), style: 'cancel' });
    Alert.alert(m.name, roleLabel(m.role), buttons);
  };

  return (
    <View>
      {/* Zones */}
      <SectionTitle right={isOwner ? <Pressable onPress={() => setAdding((a) => !a)} hitSlop={8}><Icon name={adding ? 'close' : 'plus'} size={22} color={colors.primary} /></Pressable> : undefined}>
        {t('home.zones')}
      </SectionTitle>
      {adding && (
        <Card style={{ gap: space(3), marginBottom: space(3) }}>
          <Field icon="home" value={newName} onChange={setNewName} placeholder={t('zone.namePh')} />
          <ZonePicker value={newIcon} onChange={setNewIcon} />
          <Button
            icon="plus"
            title={t('home.addZone')}
            disabled={!newName.trim()}
            onPress={() =>
              act(async () => {
                const r = await api!.addZone(hid, { name: newName.trim(), icon: newIcon });
                setNewName('');
                setAdding(false);
                router.push({ pathname: '/zone/[id]', params: { id: r.id } });
              })
            }
          />
        </Card>
      )}
      <View style={{ gap: space(3) }}>
        {home.zones.map((z) => {
          const d = z.device;
          const closed = d?.online && d.live?.valve === 'closed';
          return (
            <Pressable key={z.id} onPress={() => router.push({ pathname: '/zone/[id]', params: { id: z.id } })}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={zoneIcon(z.icon)} size={26} color={colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={[styles.body, { fontWeight: '800', fontSize: 16 }]}>{z.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name={d?.kind === 'demo' ? 'flask' : 'sensor'} size={14} color={d?.online ? colors.good : colors.muted} />
                    <Text style={styles.small}>{d ? `${d.id} · ${d.online ? t('common.online') : t('common.offline')}` : t('zone.noSensor')}</Text>
                  </View>
                </View>
                {z.active ? <Pill icon="alert" text={t('common.alert')} tone="urgent" /> : closed ? <Pill icon="valve" text={t('chip.waterOff')} tone="attention" /> : null}
                <Icon name="chevron" size={20} color={colors.faint} />
              </Card>
            </Pressable>
          );
        })}
        {home.zones.length === 0 && <Text style={styles.small}>{t('home.noZone')}</Text>}
      </View>

      {/* Members */}
      <SectionTitle>{t('home.members')}</SectionTitle>
      <Card style={{ gap: space(3) }}>
        {home.members.map((m) => (
          <Pressable key={m.userId} onPress={() => memberMenu(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            <View>
              <Avatar config={avatarFor(m.userId, m.avatar ?? undefined)} size={42} />
              <View style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff', backgroundColor: m.online ? colors.good : colors.faint }} />
            </View>
            <Text style={[styles.body, { flex: 1, fontWeight: '700' }]}>
              {m.name}
              {m.userId === user?.id ? ` (${t('common.you')})` : ''}
            </Text>
            <Pill icon={m.role === 'owner' ? 'lock' : undefined} text={roleLabel(m.role)} tone={m.role === 'owner' ? 'primary' : 'muted'} />
          </Pressable>
        ))}
        <Text style={styles.small}>{t('home.rolesHint')}</Text>
      </Card>

      {/* Invite */}
      <Card style={{ alignItems: 'center', gap: space(2), marginTop: space(3), backgroundColor: colors.primarySoft }}>
        <Text style={[styles.small, { fontWeight: '700' }]}>{t('home.code')}</Text>
        <Text style={{ fontSize: 34, fontWeight: '800', letterSpacing: 6, color: colors.primary }}>{home.home.inviteCode}</Text>
        <Text style={[styles.small, { textAlign: 'center' }]}>{t('home.codeHint')}</Text>
        <View style={{ flexDirection: 'row', gap: space(2), alignSelf: 'stretch' }}>
          <Button icon="users" title={t('common.share')} style={{ flex: 1 }} onPress={() => Share.share({ message: t('home.shareMsg', { home: home.home.name, code: home.home.inviteCode }) })} />
          {isOwner && (
            <Button
              title={t('home.newCode')}
              kind="ghost"
              style={{ flex: 1, backgroundColor: '#fff' }}
              onPress={() =>
                Alert.alert(t('home.newCodeQ'), t('home.newCodeSub'), [
                  { text: t('common.cancel'), style: 'cancel' },
                  { text: t('home.newCode'), onPress: () => act(() => api!.newInviteCode(hid)) },
                ])
              }
            />
          )}
        </View>
      </Card>

      <SectionTitle>{t('home.whoAlerted')}</SectionTitle>
    </View>
  );
}

/** Room type chooser (icon row). */
export function ZonePicker({ value, onChange }: { value: ZoneIcon; onChange: (z: ZoneIcon) => void }) {
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
      {ZONE_ICONS.map((k) => {
        const on = value === k;
        return (
          <Pressable key={k} onPress={() => onChange(k)} style={{ width: '30%', flexGrow: 1, alignItems: 'center', gap: 4, paddingVertical: space(2.5), borderRadius: 14, backgroundColor: on ? colors.primary : colors.bg }}>
            <Icon name={zoneIcon(k)} size={20} color={on ? '#fff' : colors.muted} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: on ? '#fff' : colors.muted }}>{t(`room.${k}` as Key)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
