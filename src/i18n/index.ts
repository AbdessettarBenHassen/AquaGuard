import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { en, type Key } from './en';
import { fr } from './fr';

// Two languages, switchable at any time from Settings (or the welcome screen).
// `t()` works anywhere (also outside React); screens call `useT()` so they
// re-render when the language changes. Every French text is type-checked
// against the English keys, so a missing translation fails the build.

export type Lang = 'en' | 'fr';
export type { Key };

const LANG_KEY = 'ag:lang';
const DICTS: Record<Lang, Record<Key, string>> = { en, fr };

function detect(): Lang {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = detect();
const listeners = new Set<() => void>();

export type Vars = Record<string, string | number>;

export function t(key: Key, vars: Vars = {}): string {
  const text = DICTS[current][key] ?? en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
}

export const getLang = () => current;

/** Locale for dates and numbers. */
export const locale = () => (current === 'fr' ? 'fr-FR' : 'en-GB');

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  AsyncStorage.setItem(LANG_KEY, l).catch(() => {});
  listeners.forEach((fn) => fn());
}

/** Restores the saved language at start-up. */
export async function loadLang() {
  try {
    const saved = await AsyncStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'fr') setLang(saved);
  } catch {
    // keep the phone language
  }
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Re-renders the component when the language changes; returns `t`. */
export function useT() {
  useSyncExternalStore(subscribe, getLang, getLang);
  return t;
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return [lang, setLang];
}
