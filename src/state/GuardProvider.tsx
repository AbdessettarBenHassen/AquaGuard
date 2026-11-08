import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { authApi, userApi, type HomeState, type HomeSummary, type Role, type User, type UserApi, type ZoneInfo } from '../api/client';
import { DEFAULT_CONTACTS, DEFAULT_SETTINGS } from '../core/defaults';
import { GuardEngine, type EngineState } from '../core/engine';
import type { AvatarConfig } from '../core/types';
import { DemoNode } from '../device/DemoNode';
import { getLang, t } from '../i18n';
import { setupAlertAudio, useAlertSound } from './alertSound';
import { AUTH_KEY, setWatching, stopWatching } from './background';
import { DEVICE_KEYS, HOME_KEYS, ZONE_KEYS, mirrorZone, newMemo, pick, type DevicePrefs } from './mirror';

// App state: who is logged in, which home/zone is shown, live home data polled
// from the server, the demo node (if this phone runs one), and the background
// watching service.

const PREFS_KEY = 'ag:prefs';
const DEMO_KEYS = 'ag:demo-keys';
const POLL_MS = 1000;

interface Prefs extends DevicePrefs {
  homeId: string | null;
  zoneId: string | null;
}

const defaultPrefs: Prefs = { homeId: null, zoneId: null, ...pick(DEFAULT_SETTINGS, DEVICE_KEYS) };

export type SyncStatus = 'idle' | 'ok' | 'offline' | 'error';

interface GuardApi {
  engine: GuardEngine;
  ready: boolean;
  user: User | null;
  api: UserApi | null;
  homes: HomeSummary[];
  home: HomeState | null;
  zone: ZoneInfo | null;
  role: Role | null;
  syncStatus: SyncStatus;
  register: (b: { name: string; email: string; password: string; avatar?: AvatarConfig }) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  createHome: (name: string) => Promise<string>;
  joinHome: (code: string) => Promise<HomeSummary>;
  selectHome: (id: string) => void;
  selectZone: (id: string) => void;
  refresh: () => Promise<void>;
  acknowledge: () => Promise<void>;
  falseAlarm: () => Promise<void>;
  /** Close (any member) or re-open (owners) the water of the shown zone. */
  setValve: (action: 'open' | 'close') => Promise<void>;
  pressureTest: () => Promise<void>;
  clearHistory: () => Promise<void>;
  relearn: () => Promise<void>;
  /** Links a demo node to a zone and starts it on this phone. */
  linkDemo: (zoneId: string) => Promise<void>;
  demo: DemoNode | null;
}

const Ctx = createContext<GuardApi | null>(null);

function AlertSoundController({ engine }: { engine: GuardEngine }) {
  const s = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  useAlertSound(s.stage, s.active, s.settings.zoneName, s.settings.soundEnabled);
  return null;
}

async function readDemoKeys() {
  return JSON.parse((await AsyncStorage.getItem(DEMO_KEYS)) ?? '{}') as Record<string, string>;
}

export function GuardProvider({ children }: { children: React.ReactNode }) {
  const [engine] = useState(() => new GuardEngine({ send() {} }, { contacts: DEFAULT_CONTACTS }));
  const [ready, setReady] = useState(false);
  const [auth, setAuth] = useState<{ token: string; user: User } | null>(null);
  const [homes, setHomes] = useState<HomeSummary[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [home, setHome] = useState<HomeState | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [demo, setDemo] = useState<DemoNode | null>(null);

  const api = useMemo(() => (auth ? userApi(auth.token) : null), [auth]);
  const memo = useRef(newMemo());
  const applying = useRef(false);
  const latest = useRef<{ home: HomeState | null; zone: ZoneInfo | null; prefs: Prefs }>({ home: null, zone: null, prefs: defaultPrefs });

  const zone = useMemo(() => home?.zones.find((z) => z.id === prefs.zoneId) ?? home?.zones[0] ?? null, [home, prefs.zoneId]);
  const role = home?.me.role ?? homes.find((h) => h.id === prefs.homeId)?.role ?? null;

  useEffect(() => {
    latest.current = { home, zone, prefs };
  }, [home, zone, prefs]);

  const savePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      latest.current = { ...latest.current, prefs: next };
      AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  // ---- start-up: restore login + preferences ----
  useEffect(() => {
    (async () => {
      try {
        const [a, p] = await Promise.all([AsyncStorage.getItem(AUTH_KEY), AsyncStorage.getItem(PREFS_KEY)]);
        if (p) {
          const restored = { ...defaultPrefs, ...(JSON.parse(p) as Partial<Prefs>) };
          latest.current = { ...latest.current, prefs: restored };
          setPrefs(restored);
        }
        if (a) {
          const saved = JSON.parse(a) as { token: string; user: User };
          setAuth(saved);
          const me = await userApi(saved.token)
            .me()
            .catch((e: { status?: number }) => (e.status === 401 ? null : undefined));
          if (me === null) {
            await AsyncStorage.removeItem(AUTH_KEY);
            setAuth(null);
          } else if (me) {
            setHomes(me.homes);
            setAuth({ token: saved.token, user: me.user });
          }
        }
      } catch {
        // start logged out
      }
      setReady(true);
    })();
  }, []);

  // Pick a home once the list is known.
  useEffect(() => {
    if (homes.length && !homes.some((h) => h.id === prefs.homeId)) savePrefs({ homeId: homes[0].id, zoneId: null });
  }, [homes, prefs.homeId, savePrefs]);

  // ---- poll the home state and mirror the selected zone ----
  const poll = useCallback(async () => {
    const { prefs: p } = latest.current;
    if (!api || !p.homeId) return;
    let r: HomeState;
    try {
      r = await api.state(p.homeId);
    } catch (e) {
      const status = (e as { status?: number }).status;
      setSyncStatus(status === 0 ? 'offline' : 'error');
      if (status === 403) {
        const me = await api.me().catch(() => null);
        if (me) setHomes(me.homes);
      }
      return;
    }
    setSyncStatus('ok');
    setHome(r);
    latest.current = { ...latest.current, home: r };
    // A zone with an open alert takes the screen.
    const alerting = r.zones.find((z) => z.active);
    let sel = r.zones.find((z) => z.id === p.zoneId) ?? r.zones[0] ?? null;
    if (alerting && !sel?.active) {
      sel = alerting;
      savePrefs({ zoneId: alerting.id });
    }
    if (!sel) return;
    applying.current = true;
    try {
      engine.mirror(mirrorZone(r, sel, pick(latest.current.prefs, DEVICE_KEYS), memo.current));
    } finally {
      applying.current = false;
    }
  }, [api, engine, savePrefs]);

  useEffect(() => {
    if (!api || !prefs.homeId) return;
    memo.current = newMemo();
    const first = setTimeout(poll, 0);
    const id = setInterval(poll, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [api, prefs.homeId, poll]);

  // Switching zone: refresh right away instead of waiting for the next poll.
  useEffect(() => {
    if (!prefs.zoneId) return;
    const t0 = setTimeout(poll, 0);
    return () => clearTimeout(t0);
  }, [prefs.zoneId, poll]);

  // ---- edits made on screens (settings, contacts) go to the server ----
  useEffect(() => {
    let prev = engine.getState();
    return engine.subscribe(() => {
      const s = engine.getState();
      const p = prev;
      prev = s;
      if (applying.current) return;
      const devicePrefs = pick(s.settings, DEVICE_KEYS);
      if (JSON.stringify(devicePrefs) !== JSON.stringify(pick(p.settings, DEVICE_KEYS))) savePrefs(devicePrefs);
      const { home: h, zone: z } = latest.current;
      if (!api || !h || h.me.role !== 'owner') return;
      if (z && (s.settings.zoneName !== p.settings.zoneName || JSON.stringify(pick(s.settings, ZONE_KEYS)) !== JSON.stringify(pick(p.settings, ZONE_KEYS)))) {
        api.updateZone(z.id, { name: s.settings.zoneName, settings: pick(s.settings, ZONE_KEYS) }).catch(() => {});
      }
      if (JSON.stringify(pick(s.settings, HOME_KEYS)) !== JSON.stringify(pick(p.settings, HOME_KEYS))) {
        api.updateHome(h.home.id, { settings: { ...h.home.settings, ...pick(s.settings, HOME_KEYS) } }).catch(() => {});
      }
      if (s.contacts !== p.contacts) api.setContacts(h.home.id, s.contacts).catch(() => {});
    });
  }, [engine, api, savePrefs]);

  // ---- demo node: runs on the phone that holds its key ----
  const startDemo = useCallback((deviceId: string, key: string) => {
    setDemo((cur) => {
      if (cur?.deviceId === deviceId) return cur;
      cur?.stop();
      const d = new DemoNode(deviceId, key, async () => {
        const keys = await readDemoKeys();
        delete keys[deviceId];
        await AsyncStorage.setItem(DEMO_KEYS, JSON.stringify(keys));
        setDemo((x) => (x?.deviceId === deviceId ? null : x));
      });
      d.start();
      return d;
    });
  }, []);

  useEffect(() => {
    if (!home) return;
    let cancelled = false;
    (async () => {
      const keys = await readDemoKeys();
      if (cancelled) return;
      // The zone shown on Home drives the demo controls; otherwise any demo node of this home.
      const mine = [zone, ...home.zones].map((z) => z?.device).find((d) => d?.kind === 'demo' && keys[d.id]);
      if (mine) startDemo(mine.id, keys[mine.id]);
      else
        setDemo((cur) => {
          if (cur && !home.zones.some((z) => z.device?.id === cur.deviceId)) {
            cur.stop();
            return null;
          }
          return cur;
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [home, zone, startDemo]);

  // ---- background watching (Android permanent notification) ----
  const lang = getLang();
  const statusLine = useMemo(() => {
    if (!home) return null;
    const zs = home.zones;
    if (zs.length === 0) return { title: '🛡️ AquaGuard', body: t('bg.addZone') };
    const alerting = zs.find((z) => z.active);
    if (alerting) return { title: t('bg.alert', { zone: alerting.name }), body: t('bg.tap') };
    const offline = zs.filter((z) => z.device && !z.device.online).map((z) => z.name);
    const closed = zs.filter((z) => z.device?.online && z.device.live?.valve === 'closed').map((z) => z.name);
    return {
      title: t('bg.watching', { zones: zs.map((z) => z.name).join(', ') }),
      body: offline.length ? t('bg.offline', { zones: offline.join(', ') }) : closed.length ? t('bg.closed', { zones: closed.join(', ') }) : t('bg.allDry'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-word when the language changes
  }, [home, lang]);

  useEffect(() => {
    if (!auth || !statusLine || !prefs.backgroundWatch) {
      stopWatching();
      return;
    }
    setWatching(statusLine.title, statusLine.body);
  }, [auth, statusLine, prefs.backgroundWatch]);

  useEffect(() => {
    if (auth) setupAlertAudio();
  }, [auth]);

  // ---- actions ----
  const afterAuth = useCallback(
    async (token: string, user: User) => {
      await AsyncStorage.setItem(AUTH_KEY, JSON.stringify({ token, user }));
      setAuth({ token, user });
      const me = await userApi(token).me();
      setHomes(me.homes);
      savePrefs({ homeId: me.homes[0]?.id ?? null, zoneId: null });
    },
    [savePrefs],
  );

  const value = useMemo<GuardApi>(
    () => ({
      engine,
      ready,
      user: auth?.user ?? null,
      api,
      homes,
      home,
      zone,
      role,
      syncStatus,
      register: async (b) => {
        const r = await authApi.register(b);
        await afterAuth(r.token, r.user);
      },
      login: async (email, password) => {
        const r = await authApi.login(email, password);
        await afterAuth(r.token, r.user);
      },
      logout: async () => {
        await api?.logout().catch(() => {});
        demo?.stop();
        setDemo(null);
        await stopWatching();
        await AsyncStorage.removeItem(AUTH_KEY);
        setAuth(null);
        setHomes([]);
        setHome(null);
        savePrefs({ homeId: null, zoneId: null });
        engine.mirror({ active: null, stage: 'IDLE', history: [], recent: [], latest: null });
      },
      createHome: async (name) => {
        const h = await api!.createHome({ name, settings: { ...pick(DEFAULT_SETTINGS, HOME_KEYS), lang: getLang() }, contacts: [] });
        setHomes((x) => [...x, h]);
        savePrefs({ homeId: h.id, zoneId: null });
        return h.id;
      },
      joinHome: async (code) => {
        const h = await api!.joinHome(code);
        setHomes((x) => [...x.filter((y) => y.id !== h.id), h]);
        savePrefs({ homeId: h.id, zoneId: null });
        return h;
      },
      selectHome: (id) => savePrefs({ homeId: id, zoneId: null }),
      selectZone: (id) => savePrefs({ zoneId: id }),
      refresh: poll,
      acknowledge: async () => {
        const a = engine.getState().active;
        if (a && api) await api.resolve(a.id, 'member_ack');
        await poll();
      },
      falseAlarm: async () => {
        const a = engine.getState().active;
        if (a && api) await api.resolve(a.id, 'false_alarm');
        await poll();
      },
      setValve: async (action) => {
        if (api && zone) await api.valve(zone.id, action);
        await poll();
      },
      pressureTest: async () => {
        if (api && zone) await api.pressureTest(zone.id);
        await poll();
      },
      clearHistory: async () => {
        if (api && home) await api.clearHistory(home.home.id);
        await poll();
      },
      relearn: async () => {
        if (api && zone) await api.updateZone(zone.id, { baseline: null });
        await poll();
      },
      linkDemo: async (zoneId) => {
        const deviceId = `AG-DEMO-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        const claimCode = Math.random().toString(36).slice(2, 10);
        const r = await api!.linkDevice(zoneId, { deviceId, claimCode, kind: 'demo', firmware: 'ag-demo 1.0' });
        const keys = await readDemoKeys();
        keys[r.deviceId] = r.deviceKey;
        await AsyncStorage.setItem(DEMO_KEYS, JSON.stringify(keys));
        startDemo(r.deviceId, r.deviceKey);
        await poll();
      },
      demo,
    }),
    [engine, ready, auth, api, homes, home, zone, role, syncStatus, afterAuth, demo, poll, savePrefs, startDemo],
  );

  return (
    <Ctx.Provider value={value}>
      {auth && <AlertSoundController engine={engine} />}
      {children}
    </Ctx.Provider>
  );
}

export function useGuard() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useGuard must be used inside GuardProvider');
  return v;
}

/** Subscribes a component to the selected zone's view model. */
export function useGuardState(): EngineState {
  const { engine } = useGuard();
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}

/** Re-renders when the demo node changes (scenario toggles, overrides, valve). */
export function useDemo(demo: DemoNode | null) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!demo) return;
    const off = demo.onChange(() => setN((n) => n + 1));
    return () => {
      off();
    };
  }, [demo]);
  return demo;
}

/** Re-renders periodically, for countdowns. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
