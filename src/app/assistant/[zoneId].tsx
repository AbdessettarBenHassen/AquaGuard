import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ChatTurn } from '../../api/client';
import { getLang, useT, type Key } from '../../i18n';
import { useGuard } from '../../state/GuardProvider';
import { styles } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { colors, space } from '../../ui/theme';

// Chat with the AquaGuard assistant about one zone. The server's free AI model
// reads the zone's real alerts, valve actions and sensor before answering.

interface Msg extends ChatTurn {
  notice?: string;
  offline?: boolean;
}

const SUGGESTIONS: Key[] = ['ask.q1', 'ask.q2', 'ask.q3', 'ask.q4', 'ask.q5'];

const keyOf = (zoneId: string) => `ag.chat.${zoneId}`;

export default function Assistant() {
  const t = useT();
  const { zoneId } = useLocalSearchParams<{ zoneId: string }>();
  const { api, home } = useGuard();
  const insets = useSafeAreaInsets();
  const zone = home?.zones.find((z) => z.id === zoneId);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    AsyncStorage.getItem(keyOf(zoneId)).then((raw) => {
      if (!raw) return;
      try {
        setMsgs(JSON.parse(raw));
      } catch {}
    });
  }, [zoneId]);

  const save = (list: Msg[]) => AsyncStorage.setItem(keyOf(zoneId), JSON.stringify(list.slice(-30))).catch(() => {});

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy || !api) return;
    const next: Msg[] = [...msgs, { role: 'user', content: question }];
    setMsgs(next);
    setText('');
    setBusy(true);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    try {
      const r = await api.ask(zoneId, next.map(({ role, content }) => ({ role, content })), getLang());
      const done: Msg[] = [...next, { role: 'assistant', content: r.answer, notice: r.notice, offline: r.model == null }];
      setMsgs(done);
      save(done);
    } catch (e) {
      setMsgs([...next, { role: 'assistant', content: (e as Error).message, offline: true }]);
    } finally {
      setBusy(false);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  const clear = () => {
    setMsgs([]);
    AsyncStorage.removeItem(keyOf(zoneId)).catch(() => {});
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen
        options={{
          title: t('nav.assistant'),
          headerRight: () =>
            msgs.length ? (
              <Pressable onPress={clear} hitSlop={10}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>{t('ask.new')}</Text>
              </Pressable>
            ) : null,
        }}
      />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: space(4), gap: space(3), paddingBottom: space(6) }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'center', backgroundColor: colors.violetSoft, borderRadius: 18, padding: space(3.5) }}>
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.violet, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkle" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.body, { fontWeight: '800' }]}>{t('ask.title', { zone: zone?.name ?? '' })}</Text>
            <Text style={styles.small}>{t('ask.sub')}</Text>
          </View>
        </View>

        {msgs.length === 0 && (
          <View style={{ gap: space(2) }}>
            {SUGGESTIONS.map((k) => (
              <Pressable key={k} onPress={() => ask(t(k))} style={({ pressed }) => ({ backgroundColor: colors.card, borderRadius: 16, padding: space(3.5), opacity: pressed ? 0.7 : 1, flexDirection: 'row', alignItems: 'center', gap: space(2) })}>
                <Icon name="chat" size={18} color={colors.violet} />
                <Text style={[styles.body, { flex: 1 }]}>{t(k)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <View key={i} style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colors.primary, borderRadius: 18, borderBottomRightRadius: 6, padding: space(3) }}>
              <Text style={[styles.body, { color: '#fff' }]}>{m.content}</Text>
            </View>
          ) : (
            <View key={i} style={{ alignSelf: 'flex-start', maxWidth: '92%', gap: space(1.5) }}>
              {m.notice ? <Text style={[styles.small, { color: colors.warning }]}>{m.notice}</Text> : null}
              <View style={{ backgroundColor: colors.card, borderRadius: 18, borderBottomLeftRadius: 6, padding: space(3.5) }}>
                <Text style={styles.body}>{m.content}</Text>
              </View>
            </View>
          ),
        )}
        {busy && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
            <ActivityIndicator color={colors.violet} />
            <Text style={styles.small}>{t('ask.reading')}</Text>
          </View>
        )}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space(2), padding: space(3), paddingBottom: insets.bottom + space(3), backgroundColor: colors.card }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('ask.placeholder')}
          placeholderTextColor={colors.faint}
          multiline
          maxLength={1500}
          style={{ flex: 1, maxHeight: 120, backgroundColor: colors.bg, borderRadius: 20, paddingHorizontal: space(4), paddingVertical: space(2.8), fontSize: 15, color: colors.text }}
        />
        <Pressable
          onPress={() => ask(text)}
          disabled={!text.trim() || busy}
          style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', opacity: !text.trim() || busy ? 0.4 : 1 }}
        >
          <Icon name="send" size={20} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
