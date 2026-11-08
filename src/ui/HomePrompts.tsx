import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import type { ZoneIcon } from '../core/types';
import { useT } from '../i18n';
import { useGuard } from '../state/GuardProvider';
import { Button, Card, styles } from './components';
import { Field } from './Field';
import { ZonePicker } from './HomeOverview';
import { Icon } from './Icon';
import { colors, space } from './theme';

/** Setup nudges on Home: add a zone, link its sensor. */
export function HomePrompts() {
  const t = useT();
  const { home, zone, api, refresh } = useGuard();
  const [newName, setNewName] = useState('');
  const [icon, setIcon] = useState<ZoneIcon>('kitchen');
  if (!home) return null;
  const isOwner = home.me.role === 'owner';
  const nudges: React.ReactNode[] = [];

  if (home.zones.length === 0 && isOwner) {
    nudges.push(
      <Card key="add" style={{ gap: space(3) }}>
        <Text style={styles.h2}>{t('prompt.addZone')}</Text>
        <Text style={styles.small}>{t('prompt.addZoneSub')}</Text>
        <Field icon="home" value={newName} onChange={setNewName} placeholder={t('zone.namePh')} />
        <ZonePicker value={icon} onChange={setIcon} />
        <Button
          icon="plus"
          title={t('common.add')}
          disabled={!newName.trim()}
          onPress={async () => {
            try {
              const r = await api!.addZone(home.home.id, { name: newName.trim(), icon });
              await refresh();
              router.push({ pathname: '/link/[zoneId]', params: { zoneId: r.id } });
            } catch (e) {
              Alert.alert(t('common.couldNot'), (e as Error).message);
            }
          }}
        />
      </Card>,
    );
  }

  if (home.zones.length === 0 && !isOwner) {
    nudges.push(
      <Card key="wait0" style={{ alignItems: 'center', gap: space(2), paddingVertical: space(6) }}>
        <Icon name="home" size={36} color={colors.faint} />
        <Text style={[styles.body, { textAlign: 'center' }]}>{t('prompt.noZoneYet')}</Text>
      </Card>,
    );
  }

  if (zone && !zone.device && isOwner) {
    nudges.push(
      <Pressable key="link" onPress={() => router.push({ pathname: '/link/[zoneId]', params: { zoneId: zone.id } })}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(4), paddingVertical: space(5), backgroundColor: colors.primary }}>
          <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sensor" size={26} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>{t('prompt.link', { zone: zone.name })}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.85)' }}>{t('prompt.linkSub')}</Text>
          </View>
          <Icon name="chevron" size={22} color="#fff" />
        </Card>
      </Pressable>,
    );
  }

  if (zone && !zone.device && !isOwner) {
    nudges.push(
      <Card key="wait" style={{ alignItems: 'center', gap: space(2), paddingVertical: space(6) }}>
        <Icon name="sensor" size={36} color={colors.faint} />
        <Text style={styles.body}>{t('prompt.noSensor', { zone: zone.name })}</Text>
      </Card>,
    );
  }

  if (nudges.length === 0) return null;
  return <View style={{ gap: space(3), marginTop: space(5) }}>{nudges}</View>;
}
