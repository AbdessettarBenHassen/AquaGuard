import 'dotenv/config';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { waitUntil } from '@vercel/functions';

import { generateAdvice, type AdviceAlertRow } from './advice.js';
import { runAssistant, type ChatTurn } from './assistant.js';
import { computeInsights } from './insights.js';
import { advance, DEFAULT_TIMERS, type ChainContact, type Entry, type Timers } from './escalation.js';
import { langOf, tr, type Lang } from './i18n.js';
import { sendPush, sendSms } from './notify.js';

// AquaGuard API. The only component holding database credentials.
//
//  Phones      -> Authorization: Bearer <session token>   (/auth, /me, /homes, /zones, /devices, /alerts)
//  Sensor node -> Authorization: Device <device key>      (/device/*)
//
// The node sends its readings here over Wi-Fi every ~2 s and reads back the
// valve position the home wants. Bluetooth is used only once, by the linking
// phone, to claim the node and hand it its device key.
//
// Security model:
//  - passwords: scrypt with a random salt; sessions and device keys: random
//    32-byte tokens, only their SHA-256 is stored
//  - every phone call checks the caller's role in the home; turning the water
//    back on is reserved to owners (spec: "only an allowed person")
//  - a node can only write to its own zone; a stolen phone session cannot
//    impersonate a node and vice versa (different auth schemes)

const sql = neon(process.env.DATABASE_URL!);
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Vars = { userId: string; userName: string; deviceId: string };
export const app = new Hono<{ Variables: Vars }>();

app.use('*', cors());
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Server error' }, 500);
});

const fail = (status: 400 | 401 | 403 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message });
};

// ---------- helpers ----------

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (n = 6) => Array.from(randomBytes(n), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

function hashPassword(pw: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(pw, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

const iso = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString());
const ms = (d: unknown) => (d == null ? null : new Date(d as string).getTime());

const COOLDOWN_SEC = 30;
const ONLINE_MS = 10000; // the node reports every second: 10 s of silence = offline
const OFFLINE_NOTIFY_MS = 30000; // 30 s of silence = push "sensor offline" (once)

/**
 * Runs a slow side task (push, SMS) without making the caller wait: the node or
 * the phone gets its answer at once. On Vercel, waitUntil keeps the function
 * alive until the task ends; elsewhere the promise simply runs.
 */
function later(task: Promise<unknown>) {
  const safe = task.catch((e) => console.error('background task failed', e));
  try {
    waitUntil(safe);
  } catch {
    // not on Vercel
  }
}
const ZONE_ICONS = ['kitchen', 'bathroom', 'laundry', 'boiler', 'garage', 'other'];

function timersOf(settings: Row | null | undefined): Timers {
  return { ...DEFAULT_TIMERS, ...(settings ?? {}) } as Timers;
}

async function body<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return fail(400, 'Invalid JSON body');
  }
}

// ---------- auth middleware ----------

async function userAuth(c: Context<{ Variables: Vars }>, next: () => Promise<void>) {
  const token = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) fail(401, 'Please log in');
  const [u] = await sql`
    UPDATE sessions s SET last_seen_at = now() FROM users u
    WHERE s.token_hash = ${sha(token!)} AND u.id = s.user_id
    RETURNING u.id, u.name`;
  if (!u) fail(401, 'Session expired. Please log in again.');
  c.set('userId', u.id);
  c.set('userName', u.name);
  await next();
}

async function deviceAuth(c: Context<{ Variables: Vars }>, next: () => Promise<void>) {
  const key = c.req.header('authorization')?.match(/^Device\s+(.+)$/i)?.[1];
  if (!key) fail(401, 'Missing device key');
  const [d] = await sql`SELECT id FROM devices WHERE key_hash = ${sha(key!)}`;
  if (!d) fail(401, 'Unknown or unlinked sensor');
  c.set('deviceId', d.id);
  await next();
}

async function roleIn(homeId: string, userId: string): Promise<string> {
  const [m] = await sql`SELECT role FROM home_members WHERE home_id = ${homeId} AND user_id = ${userId}`;
  if (!m) fail(403, 'You are not in this home');
  return m.role;
}
async function requireOwner(homeId: string, userId: string) {
  if ((await roleIn(homeId, userId)) !== 'owner') fail(403, 'Only an owner of the home can do this');
}
async function zoneAccess(zoneId: string, userId: string, needOwner: boolean) {
  const [z] = await sql`SELECT * FROM zones WHERE id = ${zoneId}`;
  if (!z) fail(404, 'Zone not found');
  const role = await roleIn(z.home_id, userId);
  if (needOwner && role !== 'owner') fail(403, 'Only an owner of the home can do this');
  return { zone: z, role };
}
async function homeLang(homeId: string): Promise<Lang> {
  const [h] = await sql`SELECT settings FROM homes WHERE id = ${homeId}`;
  return langOf(h?.settings?.lang);
}

// ---------- JSON shapes ----------

function alertJson(a: Row) {
  return {
    id: a.id,
    zoneId: a.zone_id,
    deviceId: a.device_id,
    startedAt: ms(a.started_at),
    trigger: { kind: a.kind, source: a.source, reason: a.reason, snapshot: a.snapshot },
    stage: a.stage,
    level: a.level,
    smsSentForLevel: a.sms_sent_for_level,
    deadline: ms(a.deadline),
    timeline: a.timeline,
    resolution: a.resolution,
    resolvedBy: a.resolved_by,
    resolvedAt: ms(a.resolved_at),
  };
}

// ---------- escalation runner ----------

async function homePushTokens(homeId: string) {
  const rows = await sql`
    SELECT p.token FROM push_tokens p JOIN home_members m ON m.user_id = p.user_id WHERE m.home_id = ${homeId}`;
  return rows.map((r) => r.token as string);
}

/** Advances every overdue open alert of a home. Safe to call concurrently. */
async function advanceHome(homeId: string) {
  const open = await sql`
    SELECT a.*, z.name AS zone_name, d.valve_target FROM alerts a
    JOIN zones z ON z.id = a.zone_id LEFT JOIN devices d ON d.zone_id = a.zone_id AND d.key_hash IS NOT NULL
    WHERE a.home_id = ${homeId} AND a.resolution IS NULL AND a.deadline IS NOT NULL AND a.deadline <= now()`;
  if (open.length === 0) return;
  const [[home], contacts] = await Promise.all([
    sql`SELECT name, settings FROM homes WHERE id = ${homeId}`,
    sql`SELECT name, role, phone, push, sms FROM contacts WHERE home_id = ${homeId} ORDER BY position`,
  ]);
  const timers = timersOf(home?.settings);
  const lang = langOf(home?.settings?.lang);
  for (const a of open) {
    const step = advance(
      { stage: a.stage, level: a.level, smsSentForLevel: a.sms_sent_for_level, deadline: ms(a.deadline) },
      contacts as ChainContact[],
      timers,
      Date.now(),
      lang,
    );
    if (!step) continue;
    const updated = await sql`
      UPDATE alerts SET stage = ${step.stage}, level = ${step.level}, sms_sent_for_level = ${step.smsSentForLevel},
        deadline = ${iso(step.deadline)}, timeline = timeline || ${JSON.stringify(step.entries)}::jsonb, updated_at = now()
      WHERE id = ${a.id} AND resolution IS NULL AND stage = ${a.stage} AND level = ${a.level}
        AND deadline IS NOT DISTINCT FROM ${a.deadline}
      RETURNING id`;
    if (updated.length === 0) continue; // another request already advanced it
    const zone = a.zone_name as string;
    if (step.notifications.some((n) => n.channel === 'push')) {
      const who = step.notifications.find((n) => n.contact)?.contact?.name;
      later(sendPush(
        await homePushTokens(homeId),
        tr(lang, 'push.esc.title', { zone }),
        tr(lang, 'push.esc.body', { who: who ? tr(lang, 'push.esc.who', { name: who }) : '' }),
        true,
      ));
    }
    for (const n of step.notifications) {
      if (n.channel === 'sms' && n.contact) {
        const text =
          a.kind !== 'sensor_fault'
            ? tr(lang, 'sms.leak', { zone, home: home.name, valve: tr(lang, a.valve_target === 'closed' ? 'sms.valveClosed' : 'sms.valveOpen') })
            : tr(lang, 'sms.fault', { zone, home: home.name });
        later(sendSms(n.contact.phone, text));
      }
    }
  }
}

/** Push once when a node goes silent (power cut, Wi-Fi lost, crashed). Runs on every phone poll and on the cron. */
async function notifyOffline(homeId: string) {
  const gone = await sql`
    UPDATE devices d SET offline_notified_at = now() FROM zones z
    WHERE d.home_id = ${homeId} AND z.id = d.zone_id AND d.key_hash IS NOT NULL AND d.live_at IS NOT NULL
      AND d.live_at < now() - make_interval(secs => ${OFFLINE_NOTIFY_MS / 1000}) AND d.offline_notified_at IS NULL
    RETURNING z.name AS zone_name`;
  if (!gone.length) return;
  const lang = await homeLang(homeId);
  const tokens = await homePushTokens(homeId);
  for (const g of gone) await sendPush(tokens, tr(lang, 'push.offline.title', { zone: g.zone_name }), tr(lang, 'push.offline.body'), true);
}

/** Appends a line to the zone's open alert, if there is one. */
async function noteOnOpenAlert(zoneId: string, entry: Entry) {
  await sql`UPDATE alerts SET timeline = timeline || ${JSON.stringify([entry])}::jsonb, updated_at = now()
            WHERE zone_id = ${zoneId} AND resolution IS NULL`;
}

async function logValve(homeId: string, zoneId: string, action: 'open' | 'closed', byName: string, byKind: 'device' | 'person', reason: string | null) {
  await sql`INSERT INTO valve_log (home_id, zone_id, action, by_name, by_kind, reason)
            VALUES (${homeId}, ${zoneId}, ${action}, ${byName}, ${byKind}, ${reason})`;
}

// ======================================================================
// Public
// ======================================================================

app.get('/health', async (c) => {
  await sql`SELECT 1`;
  return c.json({ ok: true, app: 'aquaguard', version: 1 });
});

app.post('/auth/register', async (c) => {
  const b = await body<{ name: string; email: string; password: string; avatar?: unknown }>(c);
  const email = (b.email ?? '').trim().toLowerCase();
  const name = (b.name ?? '').trim();
  if (!name) fail(400, 'Please enter your name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Please enter a valid email');
  if ((b.password ?? '').length < 6) fail(400, 'Password must be at least 6 characters');
  const [exists] = await sql`SELECT 1 FROM users WHERE email = ${email}`;
  if (exists) fail(409, 'An account with this email already exists. Log in instead.');
  const [u] = await sql`
    INSERT INTO users (email, name, password_hash, avatar) VALUES (${email}, ${name}, ${hashPassword(b.password)}, ${b.avatar ? JSON.stringify(b.avatar) : null})
    RETURNING id, email, name, avatar`;
  const token = newToken();
  await sql`INSERT INTO sessions (token_hash, user_id) VALUES (${sha(token)}, ${u.id})`;
  return c.json({ token, user: u });
});

app.post('/auth/login', async (c) => {
  const b = await body<{ email: string; password: string }>(c);
  const [u] = await sql`SELECT id, email, name, avatar, password_hash FROM users WHERE email = ${(b.email ?? '').trim().toLowerCase()}`;
  if (!u || !checkPassword(b.password ?? '', u.password_hash)) fail(401, 'Wrong email or password');
  const token = newToken();
  await sql`INSERT INTO sessions (token_hash, user_id) VALUES (${sha(token)}, ${u.id})`;
  return c.json({ token, user: { id: u.id, email: u.email, name: u.name, avatar: u.avatar } });
});

// ======================================================================
// Phones (logged-in users)
// ======================================================================

for (const p of ['/me', '/me/*', '/homes', '/homes/*', '/zones/*', '/devices/*', '/alerts/*', '/auth/logout']) app.use(p, userAuth);

app.post('/auth/logout', async (c) => {
  const token = c.req.header('authorization')!.split(/\s+/)[1];
  await sql`DELETE FROM sessions WHERE token_hash = ${sha(token)}`;
  return c.json({ ok: true });
});

app.get('/me', async (c) => {
  const uid = c.get('userId');
  const [[u], homes] = await Promise.all([
    sql`SELECT id, email, name, avatar FROM users WHERE id = ${uid}`,
    sql`SELECT h.id, h.name, h.invite_code, m.role FROM home_members m JOIN homes h ON h.id = m.home_id WHERE m.user_id = ${uid} ORDER BY m.joined_at`,
  ]);
  return c.json({ user: u, homes: homes.map((h) => ({ id: h.id, name: h.name, inviteCode: h.invite_code, role: h.role })) });
});

app.put('/me', async (c) => {
  const b = await body<{ name?: string; avatar?: unknown }>(c);
  const [u] = await sql`
    UPDATE users SET name = COALESCE(${b.name?.trim() || null}, name), avatar = COALESCE(${b.avatar ? JSON.stringify(b.avatar) : null}::jsonb, avatar)
    WHERE id = ${c.get('userId')} RETURNING id, email, name, avatar`;
  return c.json({ user: u });
});

app.post('/me/push-token', async (c) => {
  const { token } = await body<{ token: string }>(c);
  if (!token) fail(400, 'token required');
  await sql`INSERT INTO push_tokens (token, user_id) VALUES (${token}, ${c.get('userId')})
            ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = now()`;
  return c.json({ ok: true });
});

/** Create a home. The creator becomes its owner. */
app.post('/homes', async (c) => {
  const b = await body<{ name: string; settings?: unknown; contacts?: ChainContact[] }>(c);
  let home: Row | undefined;
  for (let i = 0; i < 5 && !home; i++) {
    try {
      [home] = await sql`INSERT INTO homes (name, invite_code, settings) VALUES (${(b.name ?? '').trim() || 'My home'}, ${newCode()}, ${JSON.stringify(b.settings ?? {})}) RETURNING *`;
    } catch (e) {
      if (!String(e).includes('invite_code')) throw e;
    }
  }
  if (!home) fail(409, 'Could not create the home, try again');
  await sql`INSERT INTO home_members (home_id, user_id, role) VALUES (${home!.id}, ${c.get('userId')}, 'owner')`;
  return c.json({ id: home!.id, name: home!.name, inviteCode: home!.invite_code, role: 'owner' });
});

/** Join with the home code as a member. An owner can then promote them. */
app.post('/homes/join', async (c) => {
  const b = await body<{ code: string }>(c);
  const [home] = await sql`SELECT * FROM homes WHERE invite_code = ${(b.code ?? '').trim().toUpperCase()}`;
  if (!home) fail(404, 'No home with this code');
  const uid = c.get('userId');
  const [already] = await sql`SELECT role FROM home_members WHERE home_id = ${home.id} AND user_id = ${uid}`;
  if (already) return c.json({ id: home.id, name: home.name, inviteCode: home.invite_code, role: already.role });
  const [owner] = await sql`SELECT 1 FROM home_members WHERE home_id = ${home.id} AND role = 'owner'`;
  const role = owner ? 'member' : 'owner';
  await sql`INSERT INTO home_members (home_id, user_id, role) VALUES (${home.id}, ${uid}, ${role})`;
  return c.json({ id: home.id, name: home.name, inviteCode: home.invite_code, role });
});

/** Everything a phone shows, polled every couple of seconds. Also advances escalation. */
app.get('/homes/:id/state', async (c) => {
  const hid = c.req.param('id');
  const role = await roleIn(hid, c.get('userId'));
  await advanceHome(hid);
  later(notifyOffline(hid));
  const [[home], members, zones, devices, contacts, alerts, valveLog] = await Promise.all([
    sql`SELECT * FROM homes WHERE id = ${hid}`,
    sql`SELECT m.user_id, m.role, m.joined_at, u.name, u.avatar,
               EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.last_seen_at > now() - interval '1 minute') AS online
        FROM home_members m JOIN users u ON u.id = m.user_id WHERE m.home_id = ${hid} ORDER BY m.joined_at`,
    sql`SELECT * FROM zones WHERE home_id = ${hid} ORDER BY created_at`,
    sql`SELECT d.*, u.name AS main_user_name, (EXTRACT(EPOCH FROM now() - d.live_at) * 1000)::bigint AS live_age_ms
        FROM devices d LEFT JOIN users u ON u.id = d.main_user_id WHERE d.home_id = ${hid} AND d.key_hash IS NOT NULL`,
    sql`SELECT id, name, role, phone, push, sms, avatar FROM contacts WHERE home_id = ${hid} ORDER BY position`,
    sql`SELECT * FROM alerts WHERE home_id = ${hid} ORDER BY started_at DESC LIMIT 150`,
    sql`SELECT * FROM valve_log WHERE home_id = ${hid} ORDER BY at DESC LIMIT 60`,
  ]);
  const all = alerts.map(alertJson);
  return c.json({
    me: { userId: c.get('userId'), role },
    home: { id: home.id, name: home.name, inviteCode: home.invite_code, settings: home.settings },
    members: members.map((m) => ({ userId: m.user_id, name: m.name, avatar: m.avatar, role: m.role, online: m.online })),
    zones: zones.map((z) => {
      const d = devices.find((x) => x.zone_id === z.id);
      const age = d?.live_age_ms != null ? Number(d.live_age_ms) : null;
      return {
        id: z.id,
        name: z.name,
        icon: z.icon,
        settings: z.settings,
        baseline: z.baseline,
        device: d
          ? {
              id: d.id,
              kind: d.kind,
              firmware: d.firmware,
              mainUserId: d.main_user_id,
              mainUserName: d.main_user_name,
              linkedAt: ms(d.linked_at),
              online: age != null && age < ONLINE_MS,
              liveAgeMs: age,
              live: d.live,
              valveTarget: d.valve_target,
            }
          : null,
        active: all.find((a) => a.zoneId === z.id && a.resolution == null) ?? null,
      };
    }),
    contacts: contacts.map((x) => ({ ...x, avatar: x.avatar ?? undefined })),
    history: all.filter((a) => a.resolution != null),
    valveLog: valveLog.map((v) => ({ id: String(v.id), zoneId: v.zone_id, action: v.action, by: v.by_name, byKind: v.by_kind, reason: v.reason, at: ms(v.at) })),
    serverTime: Date.now(),
  });
});

app.put('/homes/:id', async (c) => {
  const hid = c.req.param('id');
  await requireOwner(hid, c.get('userId'));
  const b = await body<{ name?: string; settings?: unknown }>(c);
  await sql`UPDATE homes SET name = COALESCE(${b.name?.trim() || null}, name),
            settings = COALESCE(${b.settings ? JSON.stringify(b.settings) : null}::jsonb, settings) WHERE id = ${hid}`;
  return c.json({ ok: true });
});

app.put('/homes/:id/contacts', async (c) => {
  const hid = c.req.param('id');
  await requireOwner(hid, c.get('userId'));
  const list = await body<(ChainContact & { id: string; avatar?: unknown })[]>(c);
  if (!Array.isArray(list)) fail(400, 'Expected a list');
  await sql.transaction([
    sql`DELETE FROM contacts WHERE home_id = ${hid}`,
    ...list.map(
      (x, i) => sql`INSERT INTO contacts (home_id, id, position, name, role, phone, push, sms, avatar)
        VALUES (${hid}, ${x.id}, ${i}, ${x.name}, ${x.role}, ${x.phone}, ${!!x.push}, ${!!x.sms}, ${x.avatar ? JSON.stringify(x.avatar) : null})`,
    ),
  ]);
  return c.json({ ok: true });
});

app.post('/homes/:id/invite-code', async (c) => {
  const hid = c.req.param('id');
  await requireOwner(hid, c.get('userId'));
  const [h] = await sql`UPDATE homes SET invite_code = ${newCode()} WHERE id = ${hid} RETURNING invite_code`;
  return c.json({ inviteCode: h.invite_code });
});

app.put('/homes/:id/members/:userId', async (c) => {
  const hid = c.req.param('id');
  await requireOwner(hid, c.get('userId'));
  const { role } = await body<{ role: 'owner' | 'member' }>(c);
  if (!['owner', 'member'].includes(role)) fail(400, 'Bad role');
  if (role !== 'owner') {
    const [o] = await sql`SELECT count(*)::int AS n FROM home_members WHERE home_id = ${hid} AND role = 'owner' AND user_id <> ${c.req.param('userId')}`;
    if (o.n === 0) fail(409, 'The home needs at least one owner');
  }
  await sql`UPDATE home_members SET role = ${role} WHERE home_id = ${hid} AND user_id = ${c.req.param('userId')}`;
  return c.json({ ok: true });
});

app.delete('/homes/:id/members/:userId', async (c) => {
  const hid = c.req.param('id');
  const target = c.req.param('userId');
  const me = c.get('userId');
  if (target !== me) await requireOwner(hid, me);
  else await roleIn(hid, me);
  const [counts] = await sql`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE role = 'owner' AND user_id <> ${target})::int AS other_owners
    FROM home_members WHERE home_id = ${hid}`;
  if (counts.total > 1 && counts.other_owners === 0) {
    const [t] = await sql`SELECT role FROM home_members WHERE home_id = ${hid} AND user_id = ${target}`;
    if (t?.role === 'owner') fail(409, 'Make someone else an owner first');
  }
  await sql`DELETE FROM home_members WHERE home_id = ${hid} AND user_id = ${target}`;
  await sql`UPDATE devices SET main_user_id = NULL WHERE home_id = ${hid} AND main_user_id = ${target}`;
  // Last person out: delete the home and free its sensors.
  if (counts.total <= 1) {
    await sql`UPDATE devices SET home_id = NULL, zone_id = NULL, key_hash = NULL, main_user_id = NULL, live = NULL, valve_target = 'open' WHERE home_id = ${hid}`;
    await sql`DELETE FROM homes WHERE id = ${hid}`;
  }
  return c.json({ ok: true });
});

app.delete('/homes/:id/alerts', async (c) => {
  const hid = c.req.param('id');
  await requireOwner(hid, c.get('userId'));
  await sql`DELETE FROM alerts WHERE home_id = ${hid} AND resolution IS NOT NULL`;
  await sql`DELETE FROM valve_log WHERE home_id = ${hid}`;
  return c.json({ ok: true });
});

/** Add a zone (a room with one leak sensor node). */
app.post('/homes/:id/zones', async (c) => {
  const hid = c.req.param('id');
  await requireOwner(hid, c.get('userId'));
  const b = await body<{ name: string; icon?: string; settings?: unknown }>(c);
  if (!b.name?.trim()) fail(400, 'Please enter a name for the zone');
  const icon = ZONE_ICONS.includes(b.icon ?? '') ? b.icon : 'other';
  const [z] = await sql`
    INSERT INTO zones (home_id, name, icon, settings) VALUES (${hid}, ${b.name.trim()}, ${icon}, ${JSON.stringify(b.settings ?? {})})
    RETURNING id`;
  return c.json({ id: z.id });
});

app.put('/zones/:id', async (c) => {
  const { zone } = await zoneAccess(c.req.param('id'), c.get('userId'), true);
  const b = await body<{ name?: string; icon?: string; settings?: unknown; baseline?: unknown }>(c);
  const icon = b.icon && ZONE_ICONS.includes(b.icon) ? b.icon : null;
  await sql`UPDATE zones SET
      name = COALESCE(${b.name?.trim() || null}, name),
      icon = COALESCE(${icon}, icon),
      settings = COALESCE(${b.settings ? JSON.stringify(b.settings) : null}::jsonb, settings),
      baseline = CASE WHEN ${b.baseline === null} THEN NULL ELSE COALESCE(${b.baseline ? JSON.stringify(b.baseline) : null}::jsonb, baseline) END
    WHERE id = ${zone.id}`;
  return c.json({ ok: true });
});

app.delete('/zones/:id', async (c) => {
  const { zone } = await zoneAccess(c.req.param('id'), c.get('userId'), true);
  await sql`UPDATE devices SET home_id = NULL, zone_id = NULL, key_hash = NULL, main_user_id = NULL, live = NULL, valve_target = 'open' WHERE zone_id = ${zone.id}`;
  await sql`DELETE FROM zones WHERE id = ${zone.id}`;
  return c.json({ ok: true });
});

/**
 * Link a sensor node to a zone. The phone read deviceId + claimCode from the
 * node over Bluetooth (or created a demo node). Returns the device key ONCE;
 * the phone writes it to the node over Bluetooth.
 * Linking a new node to a zone that already has one replaces the old one.
 */
app.post('/zones/:id/device', async (c) => {
  const uid = c.get('userId');
  const { zone } = await zoneAccess(c.req.param('id'), uid, true);
  const b = await body<{ deviceId: string; claimCode: string; kind?: 'real' | 'demo'; firmware?: string }>(c);
  const deviceId = (b.deviceId ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,40}$/.test(deviceId)) fail(400, 'Invalid sensor ID');
  if (!b.claimCode) fail(400, 'Missing claim code');
  const [d] = await sql`SELECT * FROM devices WHERE id = ${deviceId}`;
  if (d) {
    if (d.claim_hash && d.claim_hash !== sha(b.claimCode)) fail(403, 'This sensor did not confirm the pairing (wrong code)');
    if (d.key_hash && d.home_id && d.home_id !== zone.home_id) fail(409, 'This sensor belongs to another home. Remove it there first.');
    if (d.key_hash && d.zone_id && d.zone_id !== zone.id) fail(409, 'This sensor is linked to another zone. Use "Move to another zone" instead.');
  }
  // Replace: free whatever node this zone had before.
  await sql`UPDATE devices SET home_id = NULL, zone_id = NULL, key_hash = NULL, main_user_id = NULL, live = NULL, valve_target = 'open'
            WHERE zone_id = ${zone.id} AND id <> ${deviceId}`;
  const key = newToken();
  await sql`
    INSERT INTO devices (id, kind, claim_hash, home_id, zone_id, main_user_id, key_hash, firmware, linked_at)
    VALUES (${deviceId}, ${b.kind === 'demo' ? 'demo' : 'real'}, ${sha(b.claimCode)}, ${zone.home_id}, ${zone.id}, ${uid}, ${sha(key)}, ${b.firmware ?? null}, now())
    ON CONFLICT (id) DO UPDATE SET home_id = EXCLUDED.home_id, zone_id = EXCLUDED.zone_id, main_user_id = EXCLUDED.main_user_id,
      key_hash = EXCLUDED.key_hash, claim_hash = COALESCE(devices.claim_hash, EXCLUDED.claim_hash),
      firmware = COALESCE(EXCLUDED.firmware, devices.firmware), linked_at = now(), live = NULL, live_at = NULL, valve_target = 'open'`;
  return c.json({ deviceId, deviceKey: key });
});

/**
 * Valve command from a phone.
 *   close: any member of the home (stopping water is always safe)
 *   open:  owners only, and never while the node still reports water
 * The node applies the new target on its next check-in (~2 s).
 */
app.post('/zones/:id/valve', async (c) => {
  const { action } = await body<{ action: 'open' | 'close' }>(c);
  if (action !== 'open' && action !== 'close') fail(400, 'Bad action');
  const { zone } = await zoneAccess(c.req.param('id'), c.get('userId'), action === 'open');
  const [d] = await sql`SELECT *, (EXTRACT(EPOCH FROM now() - live_at) * 1000)::bigint AS live_age_ms FROM devices WHERE zone_id = ${zone.id} AND key_hash IS NOT NULL`;
  if (!d) fail(404, 'No sensor linked to this zone');
  const fresh = d.live_age_ms != null && Number(d.live_age_ms) < ONLINE_MS;
  if (action === 'open' && fresh && d.live?.wet) fail(409, 'Water is still detected. Dry the sensor and fix the leak first.');
  const target = action === 'open' ? 'open' : 'closed';
  if (d.valve_target === target) return c.json({ ok: true, valveTarget: target, changed: false });
  await sql`UPDATE devices SET valve_target = ${target} WHERE id = ${d.id}`;
  const by = c.get('userName');
  const lang = await homeLang(zone.home_id);
  await logValve(zone.home_id, zone.id, target, by, 'person', null);
  await noteOnOpenAlert(zone.id, { at: Date.now(), actor: 'member', text: tr(lang, target === 'open' ? 'valve.openedBy' : 'valve.closedBy', { by }) });
  return c.json({ ok: true, valveTarget: target, changed: true });
});

/**
 * Night pressure test, asked from a phone: the node closes the valve, watches the
 * pipe pressure for a while with every tap closed, and reports. A pressure drop
 * means a hidden leak in the pipes or walls (event hidden_leak). Any member.
 */
app.post('/zones/:id/pressure-test', async (c) => {
  const { zone } = await zoneAccess(c.req.param('id'), c.get('userId'), false);
  const [d] = await sql`UPDATE devices SET test_requested_at = now() WHERE zone_id = ${zone.id} AND key_hash IS NOT NULL RETURNING id`;
  if (!d) fail(404, 'No sensor linked to this zone');
  return c.json({ ok: true });
});

async function deviceForOwner(deviceId: string, userId: string) {
  const [d] = await sql`SELECT * FROM devices WHERE id = ${deviceId}`;
  if (!d || !d.home_id) fail(404, 'Sensor not linked');
  await requireOwner(d.home_id, userId);
  return d;
}

/** Remove completely: the key stops working and the node is free for any home. */
app.post('/devices/:id/release', async (c) => {
  const d = await deviceForOwner(c.req.param('id'), c.get('userId'));
  await sql`UPDATE devices SET home_id = NULL, zone_id = NULL, key_hash = NULL, main_user_id = NULL, live = NULL, live_at = NULL, valve_target = 'open' WHERE id = ${d.id}`;
  return c.json({ ok: true });
});

/** Move to another zone of the same home (the node relearns the room's usual humidity). */
app.post('/devices/:id/move', async (c) => {
  const d = await deviceForOwner(c.req.param('id'), c.get('userId'));
  const { zoneId } = await body<{ zoneId: string }>(c);
  const [target] = await sql`SELECT id FROM zones WHERE id = ${zoneId} AND home_id = ${d.home_id}`;
  if (!target) fail(404, 'Zone not found in this home');
  await sql`UPDATE devices SET home_id = NULL, zone_id = NULL, key_hash = NULL, main_user_id = NULL, live = NULL, valve_target = 'open'
            WHERE zone_id = ${zoneId} AND id <> ${d.id}`;
  await sql`UPDATE devices SET zone_id = ${zoneId}, live = NULL, live_at = NULL WHERE id = ${d.id}`;
  return c.json({ ok: true });
});

/** Change which account/phone is the node's main phone. */
app.post('/devices/:id/main', async (c) => {
  const d = await deviceForOwner(c.req.param('id'), c.get('userId'));
  const { userId } = await body<{ userId: string }>(c);
  await roleIn(d.home_id, userId);
  await sql`UPDATE devices SET main_user_id = ${userId} WHERE id = ${d.id}`;
  return c.json({ ok: true });
});

/** "I'm on it" / false alarm from any phone of the home. The valve stays as it is. */
app.post('/alerts/:id/resolve', async (c) => {
  const b = await body<{ resolution: 'member_ack' | 'false_alarm' }>(c);
  if (b.resolution !== 'member_ack' && b.resolution !== 'false_alarm') fail(400, 'Bad resolution');
  const [a] = await sql`SELECT home_id FROM alerts WHERE id = ${c.req.param('id')}`;
  if (!a) fail(404, 'Alert not found');
  await roleIn(a.home_id, c.get('userId'));
  const by = c.get('userName');
  const lang = await homeLang(a.home_id);
  const text = tr(lang, b.resolution === 'false_alarm' ? 'res.false' : 'res.ack', { by });
  const rows = await sql`
    UPDATE alerts SET resolution = ${b.resolution}, resolved_by = ${by}, resolved_at = now(), stage = 'RESOLVED', deadline = NULL,
      timeline = timeline || ${JSON.stringify([{ at: Date.now(), actor: 'member', text }])}::jsonb, updated_at = now()
    WHERE id = ${c.req.param('id')} AND resolution IS NULL RETURNING id`;
  return c.json({ ok: true, changed: rows.length > 0 });
});

/** Phone time zone offset (JS getTimezoneOffset, minutes), Tunisia by default. */
function tzOf(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= 840 ? n : -60;
}

/**
 * AI advice for an alert (see advice.ts), written by a free AI model once the
 * alert is closed, then stored with it: at most one AI call per alert.
 */
app.get('/alerts/:id/advice', async (c) => {
  const [a] = await sql`SELECT * FROM alerts WHERE id = ${c.req.param('id')}`;
  if (!a) fail(404, 'Alert not found');
  await roleIn(a.home_id, c.get('userId'));
  if (a.advice) return c.json({ advice: a.advice });
  const lang = langOf(c.req.query('lang'));
  if (!a.resolution) return c.json({ advice: null, pending: lang === 'fr' ? 'Les conseils sont écrits une fois l’alerte fermée.' : 'Advice is written once the alert is closed.' });

  const [zone] = await sql`SELECT name, icon FROM zones WHERE id = ${a.zone_id}`;
  const history = await sql`
    SELECT * FROM alerts WHERE zone_id = ${a.zone_id} AND id <> ${a.id} AND started_at > now() - interval '30 days'
    ORDER BY started_at DESC LIMIT 40`;
  let advice;
  try {
    advice = await generateAdvice(a as AdviceAlertRow, history as AdviceAlertRow[], { room: zone?.icon ?? 'other' }, tzOf(c.req.query('tz')), lang);
  } catch (e) {
    console.error('advice failed', e);
    return c.json({ advice: null, pending: (e as Error).message || 'The AI is not reachable right now. Try again later.' });
  }
  if (!advice) return c.json({ advice: null, pending: lang === 'fr' ? 'L’IA n’est pas encore connectée.' : 'The AI is not connected yet.' });
  await sql`UPDATE alerts SET advice = ${JSON.stringify(advice)}::jsonb WHERE id = ${a.id}`;
  return c.json({ advice });
});

/** Alerts and valve actions of the last `days` days + the node row, for insights and the assistant. */
async function zoneData(zoneId: string, days: number) {
  const [alerts, valves, [device]] = await Promise.all([
    sql`SELECT * FROM alerts WHERE zone_id = ${zoneId} AND started_at > now() - make_interval(days => ${days}) ORDER BY started_at DESC LIMIT 300`,
    sql`SELECT * FROM valve_log WHERE zone_id = ${zoneId} AND at > now() - make_interval(days => ${days}) ORDER BY at DESC LIMIT 300`,
    sql`SELECT d.*, (EXTRACT(EPOCH FROM now() - d.live_at) * 1000)::bigint AS live_age_ms FROM devices d
        WHERE d.zone_id = ${zoneId} AND d.key_hash IS NOT NULL`,
  ]);
  return { alerts, valves, device: device ?? null };
}

/** What AquaGuard learned about a zone (insights.ts). Data only, no AI. */
app.get('/zones/:id/insights', async (c) => {
  const { zone } = await zoneAccess(c.req.param('id'), c.get('userId'), false);
  const days = Math.min(90, Math.max(7, Number(c.req.query('days')) || 30));
  const { alerts, valves } = await zoneData(zone.id, days);
  return c.json({ insights: computeInsights(zone, alerts, valves, { days, tzOffsetMin: tzOf(c.req.query('tz')), lang: langOf(c.req.query('lang')) }) });
});

/** The home assistant (assistant.ts): a free AI model reading this zone's data. */
app.post('/zones/:id/assistant', async (c) => {
  const { zone } = await zoneAccess(c.req.param('id'), c.get('userId'), false);
  const b = await body<{ messages: ChatTurn[]; tz?: number; lang?: string }>(c);
  if (!Array.isArray(b.messages)) fail(400, 'Missing messages');
  const tzOffsetMin = tzOf(b.tz);
  const lang = langOf(b.lang);
  const days = 30;
  const { alerts, valves, device } = await zoneData(zone.id, days);
  const insights = computeInsights(zone, alerts, valves, { days, tzOffsetMin, lang });
  try {
    return c.json(await runAssistant(b.messages, { insights, alerts, device, tzOffsetMin, lang }));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// ======================================================================
// Sensor node (Wi-Fi, own key)
// ======================================================================

app.use('/device/*', deviceAuth);

async function deviceContext(deviceId: string) {
  const [d] = await sql`
    SELECT d.*, z.name AS zone_name, z.settings AS zone_settings, z.baseline, h.name AS home_name, h.settings AS home_settings
    FROM devices d LEFT JOIN zones z ON z.id = d.zone_id LEFT JOIN homes h ON h.id = d.home_id
    WHERE d.id = ${deviceId}`;
  return d;
}

/**
 * What the node needs: zone, thresholds, usual humidity, valve target, pressure-test
 * request, and whether an alert is open. ONE database round trip (with the live
 * update when `live` is given): the node checks in every second.
 */
async function deviceConfig(deviceId: string, live?: Row) {
  const [d] = live
    ? await sql`
        WITH u AS (
          UPDATE devices SET live = ${JSON.stringify(live)}, live_at = now(), offline_notified_at = NULL,
                 firmware = COALESCE(${(live.firmware as string) ?? null}, firmware)
          WHERE id = ${deviceId}
          RETURNING id, zone_id, home_id, valve_target, test_requested_at,
                    (SELECT offline_notified_at FROM devices WHERE id = ${deviceId}) AS was_offline)
        SELECT u.*, z.name AS zone_name, z.settings AS zone_settings, z.baseline, h.settings AS home_settings,
               a.id AS alert_id, a.stage AS alert_stage, a.kind AS alert_kind, a.deadline AS alert_deadline
        FROM u LEFT JOIN zones z ON z.id = u.zone_id LEFT JOIN homes h ON h.id = u.home_id
        LEFT JOIN LATERAL (SELECT id, stage, kind, deadline FROM alerts WHERE zone_id = u.zone_id AND resolution IS NULL
                           ORDER BY started_at DESC LIMIT 1) a ON true`
    : await sql`
        SELECT d.id, d.zone_id, d.home_id, d.valve_target, d.test_requested_at, NULL AS was_offline,
               z.name AS zone_name, z.settings AS zone_settings, z.baseline, h.settings AS home_settings,
               a.id AS alert_id, a.stage AS alert_stage, a.kind AS alert_kind, a.deadline AS alert_deadline
        FROM devices d LEFT JOIN zones z ON z.id = d.zone_id LEFT JOIN homes h ON h.id = d.home_id
        LEFT JOIN LATERAL (SELECT id, stage, kind, deadline FROM alerts WHERE zone_id = d.zone_id AND resolution IS NULL
                           ORDER BY started_at DESC LIMIT 1) a ON true
        WHERE d.id = ${deviceId}`;
  // Only touch the escalation when a countdown is actually due.
  if (d.home_id && d.alert_deadline && (ms(d.alert_deadline) ?? 0) <= Date.now()) await advanceHome(d.home_id);
  const lang = langOf(d.home_settings?.lang);
  if (d.was_offline && d.home_id) {
    const zone = d.zone_name as string;
    later(homePushTokens(d.home_id).then((tk) => sendPush(tk, tr(lang, 'push.online.title', { zone }), tr(lang, 'push.online.body'), false)));
  }
  return {
    deviceId: d.id,
    zone: d.zone_id ? { id: d.zone_id, name: d.zone_name } : null,
    settings: d.zone_settings ?? {},
    baseline: d.baseline ?? null,
    valveTarget: d.valve_target ?? 'open',
    testRequestedAt: ms(d.test_requested_at),
    lang,
    activeAlert: d.alert_id ? { id: d.alert_id, stage: d.alert_stage, kind: d.alert_kind } : null,
    serverTime: Date.now(),
  };
}

app.get('/device/config', async (c) => c.json(await deviceConfig(c.get('deviceId'))));

/**
 * Latest status, overwritten every second (never stored as history).
 * Answers with the config too, so one request per tick carries both directions.
 */
app.put('/device/live', async (c) => {
  const live = await body<Row>(c);
  return c.json({ ok: true, ...(await deviceConfig(c.get('deviceId'), live)) });
});

app.put('/device/baseline', async (c) => {
  const { baseline } = await body<{ baseline: unknown }>(c);
  const d = await deviceContext(c.get('deviceId'));
  if (d.zone_id) await sql`UPDATE zones SET baseline = ${JSON.stringify(baseline)} WHERE id = ${d.zone_id}`;
  return c.json({ ok: true });
});

/**
 * Events detected ON the node:
 *   leak | hidden_leak | sensor_fault (`sensor`: water | humidity | level)
 *                        -> opens an alert (server runs the countdown). `valveClosed` says
 *                           the node already shut the water by itself. hidden_leak comes
 *                           from a failed night pressure test (no water seen on the floor).
 *   local_ack            -> someone at home pressed the node's button: closes the open alert
 *   valve_closed         -> the node shut the water by itself without a new alert
 */
app.post('/device/events', async (c) => {
  const e = await body<{ type: string; reason?: string; source?: string; snapshot?: unknown; valveClosed?: boolean; sensor?: string }>(c);
  const d = await deviceContext(c.get('deviceId'));
  if (!d.zone_id) fail(409, 'Sensor is not linked to a zone');
  const lang = langOf(d.home_settings?.lang);
  const now = Date.now();
  const [open] = await sql`SELECT * FROM alerts WHERE zone_id = ${d.zone_id} AND resolution IS NULL ORDER BY started_at DESC LIMIT 1`;

  // The node closed the valve itself: the home's target follows, so nobody re-opens it by accident.
  const valveClosedByNode = async (reason: string) => {
    if (d.valve_target === 'closed') return;
    await sql`UPDATE devices SET valve_target = 'closed' WHERE id = ${d.id}`;
    await logValve(d.home_id, d.zone_id, 'closed', d.id, 'device', reason);
  };

  if (e.type === 'local_ack') {
    if (!open) return c.json({ ok: true, changed: false });
    await sql`UPDATE alerts SET resolution = 'local_ack', resolved_by = ${d.zone_name}, resolved_at = now(), stage = 'RESOLVED', deadline = NULL,
              timeline = timeline || ${JSON.stringify([{ at: now, actor: 'local', text: tr(lang, 'ev.localAck') }])}::jsonb, updated_at = now()
              WHERE id = ${open.id} AND resolution IS NULL`;
    return c.json({ ok: true, changed: true, alertId: open.id });
  }

  if (e.type === 'valve_closed') {
    await valveClosedByNode(e.reason ?? 'node');
    return c.json({ ok: true });
  }

  if (!['leak', 'hidden_leak', 'sensor_fault'].includes(e.type)) fail(400, 'Unknown event type');
  const isLeak = e.type !== 'sensor_fault';
  if (e.valveClosed) await valveClosedByNode(e.type);
  const zone = d.zone_name as string;
  const tokens = () => homePushTokens(d.home_id);
  // A secondary sensor (air humidity, tray ultrasonic) failing is worth a notification,
  // but not a shut-off or an SMS chain: the floor sensor still watches for leaks.
  const minor = e.type === 'sensor_fault' && !!e.sensor && e.sensor !== 'water';
  if (open) {
    if (e.type === 'sensor_fault' && e.reason) {
      await noteOnOpenAlert(d.zone_id, { at: now, actor: 'device', text: tr(lang, 'ev.detected', { reason: e.reason }) });
      later(tokens().then((tk) => sendPush(tk, tr(lang, 'push.fault.title', { zone }), e.reason!, false)));
    }
    return c.json({ ok: true, alertId: open.id, duplicate: true });
  }
  if (isLeak) {
    const [recent] = await sql`SELECT 1 FROM alerts WHERE zone_id = ${d.zone_id} AND kind = ${e.type} AND resolved_at > now() - make_interval(secs => ${COOLDOWN_SEC})`;
    if (recent) return c.json({ ok: true, ignored: 'cooldown' });
  }
  const timers = timersOf(d.home_settings);
  const reason = e.reason ?? tr(lang, e.type === 'leak' ? 'ev.defaultLeak' : e.type === 'hidden_leak' ? 'ev.defaultHidden' : 'ev.defaultFault');
  const timeline: Entry[] = [
    { at: now, actor: 'device', text: tr(lang, 'ev.detected', { reason }) },
    ...(e.valveClosed ? [{ at: now, actor: 'device' as const, text: tr(lang, isLeak ? 'ev.valveAuto' : 'ev.valveFailSafe') }] : []),
    ...(minor
      ? [{ at: now, actor: 'system' as const, text: tr(lang, 'ev.minorFault') }]
      : [
          { at: now, actor: 'device' as const, text: tr(lang, 'ev.alarm') },
          { at: now, actor: 'system' as const, text: tr(lang, 'ev.countdown', { sec: timers.gracePeriodSec }) },
        ]),
  ];
  const [a] = await sql`
    INSERT INTO alerts (home_id, zone_id, device_id, kind, source, reason, snapshot, started_at, stage, deadline, timeline)
    VALUES (${d.home_id}, ${d.zone_id}, ${d.id}, ${e.type}, ${e.source ?? (e.type === 'leak' ? 'rule' : 'watchdog')}, ${reason},
            ${JSON.stringify({ ...((e.snapshot as object) ?? {}), ...(e.sensor ? { sensor: e.sensor } : {}) })}, ${iso(now)}, 'LOCAL_ASSISTANCE',
            ${minor ? null : iso(now + timers.gracePeriodSec * 1000)}, ${JSON.stringify(timeline)})
    RETURNING id`;
  const title = tr(lang, e.type === 'leak' ? 'push.leak.title' : e.type === 'hidden_leak' ? 'push.hidden.title' : 'push.fault.title', { zone });
  const text = isLeak ? tr(lang, e.valveClosed ? 'push.leak.body' : 'push.leakOpen.body') : (e.reason ?? tr(lang, 'push.fault.body'));
  later(tokens().then((tk) => sendPush(tk, title, text, isLeak || !minor)));
  return c.json({ ok: true, alertId: a.id });
});

/** Optional: an external scheduler can call this every minute so escalation runs even when no phone is open. */
app.post('/cron/escalate', async (c) => {
  if (process.env.CRON_SECRET && c.req.header('authorization') !== `Bearer ${process.env.CRON_SECRET}`) fail(401, 'Unauthorized');
  const homes = await sql`SELECT DISTINCT home_id FROM alerts WHERE resolution IS NULL AND deadline <= now()`;
  for (const h of homes) await advanceHome(h.home_id);
  const watched = await sql`SELECT DISTINCT home_id FROM devices WHERE home_id IS NOT NULL AND key_hash IS NOT NULL AND offline_notified_at IS NULL`;
  for (const h of watched) await notifyOffline(h.home_id);
  return c.json({ ok: true, homes: homes.length });
});

export default app;
