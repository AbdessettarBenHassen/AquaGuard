import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef } from 'react';
import { AppState, Vibration } from 'react-native';

import type { AlertEvent, Stage } from '../core/types';
import { t } from '../i18n';
import { clearAlertNotification, requestNotificationPermission, showAlertNotification } from './background';

// Alert sounds follow the escalation stage:
//   LOCAL_ASSISTANCE -> looping chime + short vibration (the node's alarm is sounding at home)
//   ESCALATE         -> urgent looping alarm + continuous vibration (nobody at home answered)
//   RESOLVED / IDLE  -> silence
// Plus an Android notification that pops up over other apps (see background.ts).

let players: { chime: AudioPlayer; alarm: AudioPlayer } | null = null;

function getPlayers() {
  if (!players) {
    const chime = createAudioPlayer(require('../../assets/sounds/chime.wav'));
    const alarm = createAudioPlayer(require('../../assets/sounds/alarm.wav'));
    chime.loop = true;
    alarm.loop = true;
    players = { chime, alarm };
  }
  return players;
}

function stopAll() {
  if (players) {
    for (const p of [players.chime, players.alarm]) {
      p.pause();
      p.seekTo(0);
    }
  }
  Vibration.cancel();
}

function play(which: 'chime' | 'alarm') {
  const p = getPlayers();
  const other = which === 'chime' ? p.alarm : p.chime;
  other.pause();
  other.seekTo(0);
  p[which].seekTo(0);
  p[which].play();
}

export async function setupAlertAudio() {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
      // Keep the alarm going while another app is open (the background service keeps the app alive).
      shouldPlayInBackground: true,
    });
  } catch {
    // best effort
  }
  await requestNotificationPermission();
}

/** Plays a short preview of both sounds (Settings → Test sound). */
export function testAlertSound() {
  play('chime');
  setTimeout(() => play('alarm'), 2200);
  setTimeout(stopAll, 4600);
}

function titleOf(e: AlertEvent, zone: string) {
  if (e.trigger.kind === 'leak') return t('notif.leak', { zone });
  if (e.trigger.kind === 'hidden_leak') return t('notif.hidden', { zone });
  return t('notif.fault', { zone });
}

/** Drives sound, vibration and the pop-up notification from the alert stage. */
export function useAlertSound(stage: Stage, active: AlertEvent | null, zoneName: string, enabled: boolean) {
  const last = useRef<{ stage: Stage; id: string | null }>({ stage: 'IDLE', id: null });
  const alertId = active?.id ?? null;

  useEffect(() => {
    const prev = last.current;
    last.current = { stage, id: alertId };

    if (stage === 'IDLE' || stage === 'RESOLVED') {
      stopAll();
      if (prev.stage !== 'IDLE' && prev.stage !== 'RESOLVED') clearAlertNotification();
      return;
    }
    if (!alertId || !active) return;

    const newAlert = alertId !== prev.id;
    const zoneId = (active as AlertEvent & { zoneId?: string }).zoneId;
    const closed = !!active.trigger.snapshot.valveClosed;
    if ((stage === 'EVENT_DETECTED' || stage === 'LOCAL_ASSISTANCE') && newAlert) {
      if (enabled) play('chime');
      Vibration.vibrate([0, 400, 200, 400]);
      showAlertNotification({ title: titleOf(active, zoneName), body: closed ? t('notif.bodyClosed') : t('notif.bodyOpen'), urgent: active.trigger.kind !== 'sensor_fault', alertId, zoneId: closed ? undefined : zoneId });
    }
    if (stage === 'ESCALATE' && (prev.stage !== 'ESCALATE' || newAlert)) {
      if (enabled) play('alarm');
      Vibration.vibrate([0, 700, 300, 700, 300], true);
      showAlertNotification({ title: t('notif.escTitle', { zone: zoneName }), body: t('notif.escBody'), urgent: true, alertId, zoneId: closed ? undefined : zoneId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to stage/alert changes only
  }, [stage, alertId, zoneName, enabled]);

  useEffect(() => {
    if (!enabled && players) {
      players.chime.pause();
      players.alarm.pause();
    }
  }, [enabled]);

  // Coming back to the app: the in-app alert screen takes over from the notification.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && (last.current.stage === 'IDLE' || last.current.stage === 'RESOLVED')) clearAlertNotification();
    });
    return () => sub.remove();
  }, []);
}
