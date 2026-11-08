import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadLang, useT } from '../i18n';
import { registerBackgroundHandlers } from '../state/background';
import { GuardProvider } from '../state/GuardProvider';
import { colors } from '../ui/theme';

// Must run at start-up so notification buttons work while the app is in the background.
registerBackgroundHandlers();

export default function RootLayout() {
  const t = useT();
  useEffect(() => {
    loadLang();
  }, []);
  return (
    <SafeAreaProvider>
      <GuardProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerTintColor: colors.primary,
            headerTitleStyle: { color: colors.text, fontWeight: '700' },
            headerStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ title: '' }} />
          <Stack.Screen name="setup" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="alert" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="event/[id]" options={{ title: t('nav.event') }} />
          <Stack.Screen name="zone/[id]" options={{ title: t('nav.zone') }} />
          <Stack.Screen name="link/[zoneId]" options={{ title: t('nav.link'), presentation: 'modal' }} />
          <Stack.Screen name="network/[zoneId]" options={{ title: t('nav.network') }} />
          <Stack.Screen name="assistant/[zoneId]" options={{ title: t('nav.assistant') }} />
          <Stack.Screen name="insights/[zoneId]" options={{ title: t('nav.insights') }} />
        </Stack>
      </GuardProvider>
    </SafeAreaProvider>
  );
}
