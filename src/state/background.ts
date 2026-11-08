import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Linking, Platform } from 'react-native';

import { userApi } from '../api/client';
import { t } from '../i18n';

// Background watching on Android (Notifee foreground service):
//  - a permanent notification ("🛡️ Watching Kitchen, Bathroom · 💧 All dry") keeps
//    the app running while other apps are used
//  - alerts pop up over any app (heads-up), on the lock screen when urgent,
//    with "I'm on it" and "Turn water off" buttons that work without opening the app.
// Not available in Expo Go (needs the installed APK): every call is a no-op there.

type Notifee = typeof import('@notifee/react-native');
type NotifeeDefault = Notifee['default'];

export const AUTH_KEY = 'ag:auth';
const STATUS_ID = 'ag-status';
const ALERT_ID = 'ag-alert';
const STATUS_CHANNEL = 'ag-status';
const ALARM_CHANNEL = 'ag-alarm';

let N: Notifee | null = null;
if (Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- native module must not load in Expo Go
    N = require('@notifee/react-native') as Notifee;
  } catch {
    N = null;
  }
}
const notifee = (): NotifeeDefault | null => N?.default ?? null;

export const backgroundAvailable = () => notifee() != null;

async function token() {
  const raw = await AsyncStorage.getItem(AUTH_KEY);
  return raw ? (JSON.parse(raw) as { token: string }).token : null;
}

/** Handles notification buttons ("I'm on it", "Turn water off") even when the app is in the background. */
async function handleAction(actionId: string | undefined, data: Record<string, unknown> | undefined) {
  if (!data) return;
  const tk = await token();
  if (actionId === 'ack' && typeof data.alertId === 'string') {
    if (tk) await userApi(tk).resolve(data.alertId, 'member_ack').catch(() => {});
    await notifee()?.cancelNotification(ALERT_ID);
  }
  if (actionId === 'close' && typeof data.zoneId === 'string' && data.zoneId) {
    if (tk) await userApi(tk).valve(data.zoneId, 'close').catch(() => {});
  }
  if (actionId === 'call' && typeof data.phone === 'string' && data.phone) {
    await Linking.openURL(`tel:${data.phone.replace(/[^\d+]/g, '')}`).catch(() => {});
  }
}

/** Must run at app start-up (module scope of the root layout). */
export function registerBackgroundHandlers() {
  const n = notifee();
  if (!n || !N) return;
  // The service stays alive until stopForegroundService() is called.
  n.registerForegroundService(() => new Promise(() => {}));
  n.onBackgroundEvent(async ({ type, detail }) => {
    if (type === N!.EventType.ACTION_PRESS) await handleAction(detail.pressAction?.id, detail.notification?.data);
  });
  n.onForegroundEvent(({ type, detail }) => {
    if (type === N!.EventType.ACTION_PRESS) void handleAction(detail.pressAction?.id, detail.notification?.data);
  });
}

async function ensureChannels() {
  const n = notifee();
  if (!n || !N) return;
  await n.createChannel({ id: STATUS_CHANNEL, name: t('notif.channelWatch'), importance: N.AndroidImportance.LOW, vibration: false });
  await n.createChannel({
    id: ALARM_CHANNEL,
    name: t('notif.channelAlerts'),
    importance: N.AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    vibrationPattern: [300, 600, 300, 600],
    bypassDnd: true,
    visibility: N.AndroidVisibility.PUBLIC,
  });
}

export async function requestNotificationPermission() {
  const n = notifee();
  if (!n) return;
  await n.requestPermission().catch(() => {});
  await ensureChannels();
}

/** Asks Android not to put AquaGuard to sleep (battery optimization). */
export async function askBatteryExemption() {
  const n = notifee();
  if (!n) return false;
  if (await n.isBatteryOptimizationEnabled()) {
    await n.openBatteryOptimizationSettings();
    return true;
  }
  return false;
}

let watching = false;

/** Starts or updates the permanent "watching" notification. */
export async function setWatching(title: string, body: string) {
  const n = notifee();
  if (!n || !N) return;
  await ensureChannels();
  await n.displayNotification({
    id: STATUS_ID,
    title,
    body,
    android: {
      channelId: STATUS_CHANNEL,
      asForegroundService: true,
      ongoing: true,
      onlyAlertOnce: true,
      smallIcon: 'ic_launcher',
      color: '#1786DB',
      pressAction: { id: 'default', launchActivity: 'default' },
      foregroundServiceTypes: [N.AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_SPECIAL_USE],
    },
  });
  watching = true;
}

export async function stopWatching() {
  const n = notifee();
  if (!n || !watching) return;
  watching = false;
  await n.stopForegroundService().catch(() => {});
  await n.cancelNotification(STATUS_ID).catch(() => {});
}

/** Pops an alert over other apps. Urgent alerts also take over the lock screen. */
export async function showAlertNotification(o: { title: string; body: string; urgent: boolean; alertId: string; zoneId?: string; phone?: string }) {
  const n = notifee();
  if (!n || !N) return;
  await ensureChannels();
  await n.displayNotification({
    id: ALERT_ID,
    title: o.title,
    body: o.body,
    data: { alertId: o.alertId, zoneId: o.zoneId ?? '', phone: o.phone ?? '' },
    android: {
      channelId: ALARM_CHANNEL,
      importance: N.AndroidImportance.HIGH,
      category: o.urgent ? N.AndroidCategory.ALARM : N.AndroidCategory.REMINDER,
      smallIcon: 'ic_launcher',
      color: o.urgent ? '#E5484D' : '#E59A2F',
      pressAction: { id: 'default', launchActivity: 'default' },
      fullScreenAction: o.urgent ? { id: 'default', launchActivity: 'default' } : undefined,
      actions: [
        { title: t('notif.ack'), pressAction: { id: 'ack' } },
        ...(o.zoneId ? [{ title: t('notif.closeWater'), pressAction: { id: 'close' } }] : []),
        ...(o.phone ? [{ title: t('notif.call'), pressAction: { id: 'call', launchActivity: 'default' } }] : []),
      ],
      autoCancel: false,
      loopSound: o.urgent,
    },
  });
}

export async function clearAlertNotification() {
  await notifee()?.cancelNotification(ALERT_ID).catch(() => {});
}
