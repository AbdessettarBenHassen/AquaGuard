import type { AlertEvent, AvatarConfig, Baseline, Contact, PressureTest, Settings, ValveState, ZoneIcon } from '../core/types';

// Client for the AquaGuard API (server/src/app.ts).
//  - user calls use the session token from login/register
//  - device calls (demo node) use the node's own key

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://aquaguard-api-one.vercel.app').replace(/\/+$/, '');

export type Role = 'owner' | 'member';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: AvatarConfig | null;
}

export interface HomeSummary {
  id: string;
  name: string;
  inviteCode: string;
  role: Role;
}

export type SensorHealth = 'ok' | 'missing' | 'stuck' | 'simulated';

/** What a node reports every ~2 s (overwritten, never kept as history). */
export interface LiveStatus {
  water: number | null;
  wet: boolean;
  humidity: number | null;
  temp: number | null;
  pressure: number | null;
  flow: number | null;
  /** Water depth in the tray under the pipe (cm), from the ultrasonic sensor. */
  levelCm?: number | null;
  waterLost: number | null;
  mlScore: number | null;
  growthPerMin: number | null;
  valve: ValveState;
  battery: number | null;
  rssi?: number;
  calibrated: boolean;
  samples: number;
  firmware?: string;
  sensors?: { water: SensorHealth; humidity: SensorHealth; pressure: SensorHealth; flow: SensorHealth; level?: SensorHealth };
  test?: PressureTest | null;
  network?: { mode: 'wifi'; ssid?: string };
}

/** What AquaGuard learned about a zone (server: insights.ts). */
export interface Insights {
  days: number;
  profile: {
    calibrated: boolean;
    samples: number;
    calibrationSamples: number;
    baselineHumidity: number | null;
    baselinePressure: number | null;
    thresholds: { wetThreshold: number; leakScoreThreshold: number; sustainSamples: number; windowSamples: number };
  };
  alerts: {
    total: number;
    byKind: Record<string, number>;
    byTime: Record<'night' | 'morning' | 'afternoon' | 'evening', number>;
    bySource: Record<string, number>;
    outcomes: { localAnswered: number; memberAnswered: number; falseAlarm: number; contactsReached: number; open: number };
    falseAlarmRate: number | null;
    avgMinutesToClose: number | null;
    avgSecondsToShutOff: number | null;
    avgGrowthPerMin: number | null;
    autoShutOffs: number;
    manualShutOffs: number;
    thisWeek: number;
    lastWeek: number;
  };
  confidence: 'learning' | 'low' | 'medium' | 'high';
  findings: string[];
  suggestions: string[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Assistant answer (server: assistant.ts). model null = data summary, the AI was not available. */
export interface AssistantReply {
  answer: string;
  model: string | null;
  notice?: string;
}

/** AI-written advice about one alert (server: advice.ts). */
export interface AlertAdvice {
  summary: string;
  tips: string[];
  model: string;
  createdAt: number;
}

export interface DeviceInfo {
  id: string;
  kind: 'real' | 'demo';
  firmware: string | null;
  mainUserId: string | null;
  mainUserName: string | null;
  linkedAt: number | null;
  online: boolean;
  liveAgeMs: number | null;
  live: LiveStatus | null;
  valveTarget: ValveState;
}

export interface ZoneInfo {
  id: string;
  name: string;
  icon: ZoneIcon;
  settings: Partial<Settings>;
  baseline: Baseline | null;
  device: DeviceInfo | null;
  active: (AlertEvent & { zoneId: string }) | null;
}

export interface Member {
  userId: string;
  name: string;
  avatar: AvatarConfig | null;
  role: Role;
  online: boolean;
}

export interface ValveLogEntry {
  id: string;
  zoneId: string;
  action: ValveState;
  by: string;
  byKind: 'device' | 'person';
  reason: string | null;
  at: number;
}

export interface HomeState {
  me: { userId: string; role: Role };
  home: { id: string; name: string; inviteCode: string; settings: Partial<Settings> & { lang?: string } };
  members: Member[];
  zones: ZoneInfo[];
  contacts: Contact[];
  history: (AlertEvent & { zoneId: string })[];
  valveLog: ValveLogEntry[];
  serverTime: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, auth: string | null, body?: unknown, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError((json as { error?: string }).error ?? `Error ${res.status}`, res.status);
    return json as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('No connection to AquaGuard. Check your internet.', 0);
  } finally {
    clearTimeout(timer);
  }
}

const tz = () => new Date().getTimezoneOffset();

/** Calls made as a logged-in person. */
export function userApi(token: string) {
  const A = `Bearer ${token}`;
  return {
    me: () => request<{ user: User; homes: HomeSummary[] }>('GET', '/me', A),
    updateMe: (b: { name?: string; avatar?: AvatarConfig }) => request<{ user: User }>('PUT', '/me', A, b),
    logout: () => request('POST', '/auth/logout', A),
    pushToken: (t: string) => request('POST', '/me/push-token', A, { token: t }),

    createHome: (b: { name: string; settings?: Partial<Settings> & { lang?: string }; contacts?: Contact[] }) => request<HomeSummary>('POST', '/homes', A, b),
    joinHome: (code: string) => request<HomeSummary>('POST', '/homes/join', A, { code }),
    state: (homeId: string) => request<HomeState>('GET', `/homes/${homeId}/state`, A),
    updateHome: (homeId: string, b: { name?: string; settings?: Partial<Settings> & { lang?: string } }) => request('PUT', `/homes/${homeId}`, A, b),
    setContacts: (homeId: string, contacts: Contact[]) => request('PUT', `/homes/${homeId}/contacts`, A, contacts),
    newInviteCode: (homeId: string) => request<{ inviteCode: string }>('POST', `/homes/${homeId}/invite-code`, A),
    setRole: (homeId: string, userId: string, role: Role) => request('PUT', `/homes/${homeId}/members/${userId}`, A, { role }),
    removeMember: (homeId: string, userId: string) => request('DELETE', `/homes/${homeId}/members/${userId}`, A),
    clearHistory: (homeId: string) => request('DELETE', `/homes/${homeId}/alerts`, A),

    addZone: (homeId: string, b: { name: string; icon?: ZoneIcon; settings?: Partial<Settings> }) => request<{ id: string }>('POST', `/homes/${homeId}/zones`, A, b),
    updateZone: (zoneId: string, b: { name?: string; icon?: ZoneIcon; settings?: Partial<Settings>; baseline?: null }) => request('PUT', `/zones/${zoneId}`, A, b),
    deleteZone: (zoneId: string) => request('DELETE', `/zones/${zoneId}`, A),
    valve: (zoneId: string, action: 'open' | 'close') => request<{ valveTarget: ValveState; changed: boolean }>('POST', `/zones/${zoneId}/valve`, A, { action }),
    pressureTest: (zoneId: string) => request('POST', `/zones/${zoneId}/pressure-test`, A),

    linkDevice: (zoneId: string, b: { deviceId: string; claimCode: string; kind: 'real' | 'demo'; firmware?: string }) =>
      request<{ deviceId: string; deviceKey: string }>('POST', `/zones/${zoneId}/device`, A, b),
    releaseDevice: (deviceId: string) => request('POST', `/devices/${deviceId}/release`, A),
    moveDevice: (deviceId: string, zoneId: string) => request('POST', `/devices/${deviceId}/move`, A, { zoneId }),
    setMainUser: (deviceId: string, userId: string) => request('POST', `/devices/${deviceId}/main`, A, { userId }),

    resolve: (alertId: string, resolution: 'member_ack' | 'false_alarm') => request<{ changed: boolean }>('POST', `/alerts/${alertId}/resolve`, A, { resolution }),
    // The first call writes the advice with the AI model: allow it time.
    advice: (alertId: string, lang: string) =>
      request<{ advice: AlertAdvice | null; pending?: string }>('GET', `/alerts/${alertId}/advice?tz=${tz()}&lang=${lang}`, A, undefined, 60000),
    insights: (zoneId: string, days: number, lang: string) => request<{ insights: Insights }>('GET', `/zones/${zoneId}/insights?days=${days}&tz=${tz()}&lang=${lang}`, A),
    ask: (zoneId: string, messages: ChatTurn[], lang: string) => request<AssistantReply>('POST', `/zones/${zoneId}/assistant`, A, { messages, tz: tz(), lang }, 60000),
  };
}
export type UserApi = ReturnType<typeof userApi>;

export const authApi = {
  register: (b: { name: string; email: string; password: string; avatar?: AvatarConfig }) =>
    request<{ token: string; user: User }>('POST', '/auth/register', null, b),
  login: (email: string, password: string) => request<{ token: string; user: User }>('POST', '/auth/login', null, { email, password }),
};

export interface DeviceConfig {
  deviceId: string;
  zone: { id: string; name: string } | null;
  settings: Partial<Settings>;
  baseline: Baseline | null;
  valveTarget: ValveState;
  testRequestedAt: number | null;
  lang: string;
  activeAlert: { id: string; stage: string; kind: string } | null;
}

export type DeviceEventType = 'leak' | 'hidden_leak' | 'sensor_fault' | 'local_ack' | 'valve_closed';

/** Calls made as a sensor node (used by the demo node; the real firmware does the same over Wi-Fi). */
export function deviceApi(key: string) {
  const D = `Device ${key}`;
  return {
    config: () => request<DeviceConfig>('GET', '/device/config', D),
    live: (live: LiveStatus) => request<DeviceConfig & { ok: boolean }>('PUT', '/device/live', D, live),
    baseline: (baseline: Baseline) => request('PUT', '/device/baseline', D, { baseline }),
    event: (type: DeviceEventType, extra?: { reason?: string; source?: string; snapshot?: unknown; valveClosed?: boolean }) =>
      request<{ alertId?: string; duplicate?: boolean; ignored?: string; changed?: boolean }>('POST', '/device/events', D, { type, ...extra }),
  };
}
