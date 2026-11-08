import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { useT } from '../i18n';
import { useGuard } from '../state/GuardProvider';
import { Avatar, randomAvatar } from '../ui/Avatar';
import { Button, Card, styles } from '../ui/components';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Logo } from '../ui/Logo';
import { colors, space } from '../ui/theme';

type Mode = 'new' | 'join' | 'login';

export default function AuthScreen() {
  const t = useT();
  const params = useLocalSearchParams<{ mode?: Mode }>();
  const [mode, setMode] = useState<Mode>(params.mode ?? 'new');
  const { register, login } = useGuard();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState(() => randomAvatar());
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const isLogin = mode === 'login';

  const submit = async () => {
    setBusy(true);
    try {
      if (isLogin) {
        await login(email, password);
        router.replace('/');
      } else {
        await register({ name: name.trim(), email, password, avatar });
        router.replace({ pathname: '/setup', params: { tab: mode === 'join' ? 'join' : 'new' } });
      }
    } catch (e) {
      Alert.alert(isLogin ? t('auth.loginFail') : t('auth.registerFail'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const valid = (isLogin || name.trim().length > 0) && email.includes('@') && password.length >= 6 && (isLogin || agreed);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space(5), gap: space(4), paddingBottom: space(12) }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: space(2) }}>
          {isLogin ? (
            <Logo size={90} />
          ) : (
            <Pressable onPress={() => setAvatar(randomAvatar())} style={{ alignItems: 'center' }}>
              <Avatar config={avatar} size={110} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space(2) }}>
                <Icon name="dice" size={16} color={colors.violet} />
                <Text style={{ color: colors.violet, fontWeight: '700' }}>{t('auth.newLook')}</Text>
              </View>
            </Pressable>
          )}
          <Text style={styles.h1}>{isLogin ? t('auth.welcomeBack') : t('auth.create')}</Text>
          <Text style={[styles.small, { textAlign: 'center' }]}>{isLogin ? t('auth.loginSub') : mode === 'join' ? t('auth.joinSub') : t('auth.newSub')}</Text>
        </View>

        <Card style={{ gap: space(3) }}>
          {!isLogin && <Field icon="users" value={name} onChange={setName} placeholder={t('auth.name')} />}
          <Field icon="bell" value={email} onChange={setEmail} placeholder={t('auth.email')} keyboard="email-address" small />
          <Field icon="lock" value={password} onChange={setPassword} placeholder={t('auth.password')} secure small />
        </Card>

        {!isLogin && (
          <Pressable onPress={() => setAgreed((a) => !a)} style={{ flexDirection: 'row', gap: space(3), alignItems: 'flex-start', padding: space(1) }}>
            <View style={{ width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: agreed ? colors.primary : colors.faint, backgroundColor: agreed ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {agreed && <Icon name="check" size={16} color="#fff" strokeWidth={3} />}
            </View>
            <Text style={[styles.small, { flex: 1, lineHeight: 19, color: colors.text }]}>{t('auth.agree')}</Text>
          </Pressable>
        )}

        {busy ? (
          <ActivityIndicator color={colors.primary} style={{ padding: space(4) }} />
        ) : (
          <Button title={isLogin ? t('auth.login') : t('auth.createBtn')} icon="check" disabled={!valid} onPress={submit} style={{ paddingVertical: space(4.5) }} />
        )}

        <Pressable onPress={() => setMode(isLogin ? 'new' : 'login')} style={{ alignItems: 'center', padding: space(2) }}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>{isLogin ? t('auth.toRegister') : t('auth.toLogin')}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
