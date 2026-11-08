import { Redirect, Tabs, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View, type ColorValue } from 'react-native';

import { useT } from '../../i18n';
import { useGuard, useGuardState } from '../../state/GuardProvider';
import { Icon, type IconName } from '../../ui/Icon';
import { Logo } from '../../ui/Logo';
import { colors } from '../../ui/theme';

const tabIcon = (name: IconName) =>
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Icon name={name} size={24} color={String(color)} strokeWidth={focused ? 2.3 : 1.9} />;
  };

export default function TabLayout() {
  const t = useT();
  const { ready, user, homes } = useGuard();
  const { active, stage } = useGuardState();
  const openedFor = useRef<string | null>(null);

  // Bring the alert screen up as soon as a new event opens.
  useEffect(() => {
    if (active && stage !== 'RESOLVED' && openedFor.current !== active.id) {
      openedFor.current = active.id;
      router.push('/alert');
    }
  }, [active, stage]);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <Logo size={120} />
      </View>
    );
  }
  if (!user) return <Redirect href="/welcome" />;
  if (homes.length === 0) return <Redirect href="/setup" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { backgroundColor: '#fff', borderTopWidth: 0, elevation: 12, shadowColor: '#12263A', shadowOpacity: 0.06, shadowRadius: 12, height: 64, paddingTop: 6 },
        headerTitleStyle: { color: colors.text, fontWeight: '800', fontSize: 22 },
        headerTitleAlign: 'left',
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tab.live'), headerShown: false, tabBarIcon: tabIcon('drop') }} />
      <Tabs.Screen name="history" options={{ title: t('tab.history'), tabBarIcon: tabIcon('clock') }} />
      <Tabs.Screen name="contacts" options={{ title: t('tab.home'), tabBarIcon: tabIcon('home') }} />
      <Tabs.Screen name="settings" options={{ title: t('tab.settings'), tabBarIcon: tabIcon('settings') }} />
    </Tabs>
  );
}
