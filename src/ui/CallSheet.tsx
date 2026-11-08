import { Alert, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t, useT } from '../i18n';
import { useGuardState } from '../state/GuardProvider';
import { Avatar, avatarFor } from './Avatar';
import { styles } from './components';
import { Icon, type IconName } from './Icon';
import { colors, space } from './theme';

/** Opens the phone dialer with the number filled in; the user taps call. */
export async function dial(number: string) {
  const clean = number.replace(/[^\d+]/g, '');
  if (!clean) return;
  try {
    await Linking.openURL(`tel:${clean}`);
  } catch {
    Alert.alert(t('call.cannot'), number);
  }
}

/** Civil protection (fire and rescue) in Tunisia: floods, water near electricity. */
export function callEmergency() {
  Alert.alert(t('call.emergencyQ'), t('call.emergencySub'), [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('call.emergencyBtn'), style: 'destructive', onPress: () => dial('198') },
  ]);
}

/** "Who do you want to call?": the home's contacts (plumber first), phone contacts, emergency. */
export function CallSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const tt = useT();
  const { contacts } = useGuardState();
  const insets = useSafeAreaInsets();

  const call = (number: string) => {
    onClose();
    dial(number);
  };

  const pickFromPhone = async () => {
    try {
      // Loaded on demand so a missing native module can never crash app start-up.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Contact: PhoneContact } = require('expo-contacts') as typeof import('expo-contacts');
      const picked = await PhoneContact.presentPicker();
      if (!picked) return;
      const phones = (await picked.getPhones()).map((p) => p.number).filter((n): n is string => !!n);
      const who = (await picked.getFullName()) || '…';
      if (phones.length === 0) Alert.alert(tt('call.noNumber'), who);
      else if (phones.length === 1) call(phones[0]);
      else
        Alert.alert(who, undefined, [...phones.slice(0, 3).map((n) => ({ text: n, onPress: () => call(n) })), { text: tt('common.cancel'), style: 'cancel' as const }]);
    } catch {
      Alert.alert(tt('call.noContacts'));
    }
  };

  const sorted = [...contacts.filter((c) => c.phone && c.role === 'plumber'), ...contacts.filter((c) => c.phone && c.role !== 'plumber')];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(18,38,58,0.4)' }} onPress={onClose} />
      <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: space(3), paddingBottom: insets.bottom + space(5), maxHeight: '85%' }}>
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.faint, marginBottom: space(4) }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(5), marginBottom: space(3) }}>
          <Icon name="phone" size={20} color={colors.good} />
          <Text style={styles.h2}>{tt('call.who')}</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space(5), gap: space(2.5) }}>
          {sorted.map((c) => (
            <Row
              key={c.id}
              avatar={c.role === 'plumber' ? <IconCircle name="wrench" color={colors.primary} bg={colors.primarySoft} /> : <Avatar config={avatarFor(c.id, c.avatar)} size={52} />}
              title={c.name}
              sub={c.phone}
              onPress={() => call(c.phone)}
            />
          ))}
          <Row avatar={<IconCircle name="users" color={colors.primary} bg={colors.primarySoft} />} title={tt('call.fromContacts')} sub={tt('call.fromContactsSub')} onPress={pickFromPhone} chevron />
          <Row
            avatar={<IconCircle name="siren" color="#fff" bg={colors.urgent} />}
            title={tt('call.emergency')}
            sub={tt('call.emergencyWhen')}
            onPress={() => {
              onClose();
              callEmergency();
            }}
            danger
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

function Row({ avatar, title, sub, onPress, chevron, danger }: { avatar: React.ReactNode; title: string; sub: string; onPress: () => void; chevron?: boolean; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3), borderRadius: 18, backgroundColor: danger ? colors.urgentSoft : colors.card, transform: [{ scale: pressed ? 0.98 : 1 }] })}
    >
      {avatar}
      <View style={{ flex: 1 }}>
        <Text style={[styles.body, { fontWeight: '800', color: danger ? colors.urgent : colors.text }]}>{title}</Text>
        <Text style={styles.small}>{sub}</Text>
      </View>
      {chevron ? (
        <Icon name="chevron" size={20} color={colors.faint} />
      ) : (
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: danger ? colors.urgent : colors.good, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="phone" size={20} color="#fff" />
        </View>
      )}
    </Pressable>
  );
}

function IconCircle({ name, color, bg }: { name: IconName; color: string; bg: string }) {
  return (
    <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={24} color={color} />
    </View>
  );
}
