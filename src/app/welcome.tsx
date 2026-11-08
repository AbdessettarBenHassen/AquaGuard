import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLang, useT } from '../i18n';
import { styles } from '../ui/components';
import { Icon, type IconName } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { colors, shadow, space } from '../ui/theme';

export default function Welcome() {
  const t = useT();
  const [lang, setLang] = useLang();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: insets.bottom + space(8) }}>
      <LinearGradient colors={['#E2F2FD', '#E0F7F8']} style={{ paddingTop: insets.top + space(4), paddingBottom: space(10), alignItems: 'center', borderBottomLeftRadius: 40, borderBottomRightRadius: 40 }}>
        <Pressable
          onPress={() => setLang(lang === 'en' ? 'fr' : 'en')}
          style={{ alignSelf: 'flex-end', marginRight: space(5), flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 }}
        >
          <Icon name="globe" size={16} color={colors.primary} />
          <Text style={{ fontWeight: '800', color: colors.primary }}>{lang === 'en' ? 'FR' : 'EN'}</Text>
        </Pressable>
        <View style={{ marginTop: space(6) }}>
          <Logo size={150} />
        </View>
        <Text style={[styles.h1, { fontSize: 34, marginTop: space(3) }]}>AquaGuard</Text>
        <Text style={[styles.body, { color: colors.muted, textAlign: 'center', marginTop: space(2), maxWidth: 300 }]}>{t('welcome.tagline')}</Text>
      </LinearGradient>

      <View style={{ paddingHorizontal: space(5), gap: space(3.5), marginTop: space(8) }}>
        <Choice icon="home" title={t('welcome.create')} sub={t('welcome.createSub')} onPress={() => router.push({ pathname: '/auth', params: { mode: 'new' } })} />
        <Choice icon="users" title={t('welcome.join')} sub={t('welcome.joinSub')} onPress={() => router.push({ pathname: '/auth', params: { mode: 'join' } })} />
        <Pressable onPress={() => router.push({ pathname: '/auth', params: { mode: 'login' } })} style={{ alignItems: 'center', padding: space(4) }}>
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 16 }}>{t('welcome.haveAccount')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Choice({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: space(4), backgroundColor: colors.card, borderRadius: 24, padding: space(4.5), transform: [{ scale: pressed ? 0.98 : 1 }] },
        shadow,
      ]}
    >
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={28} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{title}</Text>
        <Text style={styles.small}>{sub}</Text>
      </View>
      <Icon name="chevron" size={22} color={colors.faint} />
    </Pressable>
  );
}
