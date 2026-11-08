import { useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import type { AvatarConfig, Contact, ContactRole } from '../../core/types';
import { useT, type Key } from '../../i18n';
import { useGuard, useGuardState } from '../../state/GuardProvider';
import { AVATAR_OPTIONS, Avatar, OPTION_LABELS, avatarFor, randomAvatar } from '../../ui/Avatar';
import { dial } from '../../ui/CallSheet';
import { HomeOverview } from '../../ui/HomeOverview';
import { Button, Card, styles } from '../../ui/components';
import { Icon, type IconName } from '../../ui/Icon';
import { colors, shadow, space } from '../../ui/theme';

const ROLES: { key: ContactRole; label: Key; icon: IconName }[] = [
  { key: 'family', label: 'crole.family', icon: 'home' },
  { key: 'neighbour', label: 'crole.neighbour', icon: 'users' },
  { key: 'plumber', label: 'crole.plumber', icon: 'wrench' },
  { key: 'other', label: 'crole.other', icon: 'sparkle' },
];

export default function Contacts() {
  const t = useT();
  const { engine, role, home } = useGuard();
  const canEdit = role === 'owner';
  const { contacts } = useGuardState();
  const [editing, setEditing] = useState<Contact | null>(null);

  const save = (c: Contact) => {
    const exists = contacts.some((x) => x.id === c.id);
    engine.setContacts(exists ? contacts.map((x) => (x.id === c.id ? c : x)) : [...contacts, c]);
    setEditing(null);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= contacts.length) return;
    const next = [...contacts];
    [next[i], next[j]] = [next[j], next[i]];
    engine.setContacts(next);
  };
  const remove = (c: Contact) =>
    Alert.alert(t('contact.removeQ', { name: c.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.remove'), style: 'destructive', onPress: () => engine.setContacts(contacts.filter((x) => x.id !== c.id)) },
    ]);

  if (editing) {
    return <Editor key={editing.id} initial={editing} onSave={save} onCancel={() => setEditing(null)} />;
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(5), paddingTop: 0, paddingBottom: space(12) }}>
      <HomeOverview />
      {/* Team strip */}
      <Card style={{ alignItems: 'center', paddingVertical: space(5) }}>
        <Text style={[styles.small, { fontWeight: '700', letterSpacing: 0.5 }]}>{t('contact.team', { home: (home?.home.name ?? '').toUpperCase() })}</Text>
        <View style={{ flexDirection: 'row', marginTop: space(3) }}>
          {contacts.slice(0, 5).map((c, i) => (
            <View key={c.id} style={{ marginLeft: i === 0 ? 0 : -14, borderRadius: 32, borderWidth: 3, borderColor: '#fff' }}>
              <Avatar config={avatarFor(c.id, c.avatar)} size={58} />
            </View>
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5), marginTop: space(3) }}>
          <Icon name="bell" size={14} color={colors.muted} />
          <Text style={styles.small}>{t('contact.order')}</Text>
        </View>
      </Card>

      <View style={{ gap: space(3), marginTop: space(4) }}>
        {contacts.map((c, i) => (
          <Pressable key={c.id} disabled={!canEdit} onPress={() => setEditing(c)}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
              <View>
                <Avatar config={avatarFor(c.id, c.avatar)} size={56} />
                <View style={{ position: 'absolute', right: -3, bottom: -3, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>{i + 1}</Text>
                </View>
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.body, { fontWeight: '800', fontSize: 16 }]}>{c.name}</Text>
                <Text style={styles.small}>{t(ROLES.find((r) => r.key === c.role)?.label ?? 'crole.other')}</Text>
                <View style={{ flexDirection: 'row', gap: space(2) }}>
                  {c.push && <Icon name="bell" size={16} color={colors.primary} />}
                  {c.sms && <Icon name="phone" size={16} color={colors.primary} />}
                  {!c.push && !c.sms && <Icon name="close" size={16} color={colors.faint} />}
                </View>
              </View>
              {canEdit && (
              <>
              <View style={{ gap: 2 }}>
                <Pressable onPress={() => move(i, -1)} hitSlop={8} disabled={i === 0}>
                  <Icon name="up" size={20} color={i === 0 ? colors.border : colors.muted} />
                </Pressable>
                <Pressable onPress={() => move(i, 1)} hitSlop={8} disabled={i === contacts.length - 1}>
                  <Icon name="down" size={20} color={i === contacts.length - 1 ? colors.border : colors.muted} />
                </Pressable>
              </View>
              <Pressable onPress={() => remove(c)} hitSlop={8}>
                <Icon name="trash" size={19} color={colors.faint} />
              </Pressable>
              </>
              )}
              <Pressable onPress={() => dial(c.phone)} hitSlop={6} style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.good, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="phone" size={19} color="#fff" />
              </Pressable>
            </Card>
          </Pressable>
        ))}
      </View>

      {canEdit && (
      <Button
        icon="plus"
        title={t('contact.add')}
        kind="secondary"
        style={{ marginTop: space(4) }}
        onPress={() => setEditing({ id: `c${Date.now()}`, name: '', role: 'family', phone: '', push: true, sms: true, avatar: randomAvatar() })}
      />
      )}
    </ScrollView>
  );
}

type Part = 'skin' | 'hair' | 'hairColor' | 'eyes' | 'mouth' | 'accessory' | 'bg';
const PARTS: { key: Part; label: Key }[] = [
  { key: 'accessory', label: 'av.extras' },
  { key: 'hair', label: 'av.hair' },
  { key: 'hairColor', label: 'av.hairColor' },
  { key: 'eyes', label: 'av.eyes' },
  { key: 'mouth', label: 'av.mouth' },
  { key: 'skin', label: 'av.skin' },
  { key: 'bg', label: 'av.bg' },
];

function Editor({ initial, onSave, onCancel }: { initial: Contact; onSave: (c: Contact) => void; onCancel: () => void }) {
  const t = useT();
  const [c, setC] = useState<Contact>({ ...initial, avatar: avatarFor(initial.id, initial.avatar) });
  const [part, setPart] = useState<Part>('accessory');
  const avatar = c.avatar as AvatarConfig;
  const valid = c.name.trim().length > 0 && c.phone.trim().length >= 6;
  const setAvatar = (patch: Partial<AvatarConfig>) => setC({ ...c, avatar: { ...avatar, ...patch } });
  const options = AVATAR_OPTIONS[part] as readonly string[];
  const isColor = part === 'skin' || part === 'hairColor' || part === 'bg';

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space(5), paddingBottom: space(12) }} keyboardShouldPersistTaps="handled">
      {/* Preview */}
      <View style={{ alignItems: 'center', marginTop: space(2) }}>
        <View style={[{ borderRadius: 80, borderWidth: 5, borderColor: '#fff' }, shadow]}>
          <Avatar config={avatar} size={150} />
        </View>
        <Pressable
          onPress={() => setC({ ...c, avatar: randomAvatar() })}
          style={({ pressed }) => [
            { position: 'absolute', right: '22%', bottom: 0, width: 50, height: 50, borderRadius: 25, backgroundColor: colors.violet, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', transform: [{ rotate: pressed ? '20deg' : '0deg' }] },
          ]}
        >
          <Icon name="dice" size={24} color="#fff" strokeWidth={2.4} />
        </Pressable>
      </View>

      {/* Part tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2), paddingVertical: space(4) }}>
        {PARTS.map((p) => (
          <Pressable
            key={p.key}
            onPress={() => setPart(p.key)}
            style={{ paddingVertical: space(2), paddingHorizontal: space(4), borderRadius: 999, backgroundColor: part === p.key ? colors.text : '#fff' }}
          >
            <Text style={{ fontWeight: '700', color: part === p.key ? '#fff' : colors.text }}>{t(p.label)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Options */}
      <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3), justifyContent: 'flex-start' }}>
        {options.map((o) => {
          const on = avatar[part] === o;
          return (
            <Pressable key={o} onPress={() => setAvatar({ [part]: o } as Partial<AvatarConfig>)} style={{ alignItems: 'center', gap: 4, width: isColor ? 44 : 64 }}>
              {isColor ? (
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: o, borderWidth: on ? 3 : 0, borderColor: colors.text }} />
              ) : (
                <View style={{ borderRadius: 32, borderWidth: 3, borderColor: on ? colors.primary : 'transparent' }}>
                  <Avatar config={{ ...avatar, [part]: o }} size={56} />
                </View>
              )}
              {!isColor && (
                <Text style={{ fontSize: 11, fontWeight: on ? '800' : '500', color: on ? colors.primary : colors.muted }}>{OPTION_LABELS[o] ?? o}</Text>
              )}
            </Pressable>
          );
        })}
      </Card>

      {/* Details */}
      <Card style={{ gap: space(3.5), marginTop: space(4) }}>
        <Field icon="users" placeholder={t('contact.name')} value={c.name} onChange={(name) => setC({ ...c, name })} />
        <Field icon="phone" placeholder={t('contact.phone')} value={c.phone} onChange={(phone) => setC({ ...c, phone })} keyboard="phone-pad" />
        <View style={{ flexDirection: 'row', gap: space(2) }}>
          {ROLES.map((r) => {
            const on = c.role === r.key;
            return (
              <Pressable key={r.key} onPress={() => setC({ ...c, role: r.key })} style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: space(2.5), borderRadius: 14, backgroundColor: on ? colors.primary : colors.bg }}>
                <Icon name={r.icon} size={18} color={on ? '#fff' : colors.muted} />
                <Text style={{ fontSize: 11, fontWeight: '700', color: on ? '#fff' : colors.muted }}>{t(r.label)}</Text>
              </Pressable>
            );
          })}
        </View>
        <Toggle icon="bell" label={t('contact.push')} value={c.push} onChange={(push) => setC({ ...c, push })} />
        <Toggle icon="phone" label={t('contact.sms')} value={c.sms} onChange={(sms) => setC({ ...c, sms })} />
      </Card>

      <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(4) }}>
        <Button title={t('common.cancel')} kind="ghost" style={{ flex: 1 }} onPress={onCancel} />
        <Button icon="check" title={t('common.save')} style={{ flex: 1 }} disabled={!valid} onPress={() => onSave({ ...c, name: c.name.trim(), phone: c.phone.trim() })} />
      </View>
    </ScrollView>
  );
}

function Field({ icon, placeholder, value, onChange, keyboard }: { icon: IconName; placeholder: string; value: string; onChange: (v: string) => void; keyboard?: 'default' | 'phone-pad' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), backgroundColor: colors.bg, borderRadius: 14, paddingHorizontal: space(3.5) }}>
      <Icon name={icon} size={18} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        keyboardType={keyboard ?? 'default'}
        style={{ flex: 1, paddingVertical: space(3.5), fontSize: 16, color: colors.text }}
      />
    </View>
  );
}

function Toggle({ icon, label, value, onChange }: { icon: IconName; label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
      <Icon name={icon} size={18} color={colors.primary} />
      <Text style={[styles.body, { flex: 1 }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary }} />
    </View>
  );
}
