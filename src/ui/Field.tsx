import { TextInput, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { colors, space } from './theme';

/** Rounded input with a leading icon. */
export function Field({
  icon,
  value,
  onChange,
  placeholder,
  caps,
  small,
  secure,
  keyboard,
}: {
  icon: IconName;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  caps?: boolean;
  small?: boolean;
  secure?: boolean;
  keyboard?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), backgroundColor: colors.bg, borderRadius: 14, paddingHorizontal: space(3.5) }}>
      <Icon name={icon} size={16} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        autoCapitalize={caps ? 'characters' : small ? 'none' : 'words'}
        autoCorrect={false}
        secureTextEntry={secure}
        keyboardType={keyboard ?? 'default'}
        style={{
          flex: 1,
          paddingVertical: space(3.2),
          fontSize: caps ? 22 : 16,
          letterSpacing: caps ? 5 : 0,
          fontWeight: caps ? '800' : '400',
          color: colors.text,
        }}
      />
    </View>
  );
}
