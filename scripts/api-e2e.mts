// End-to-end test of the AquaGuard API against the real database.
// Run (API must be running): npm run test:api   (API_URL=... to target another server)
const URL = process.env.API_URL ?? 'http://localhost:3000';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

async function call<T = any>(method: string, path: string, body?: unknown, auth?: string): Promise<T & { _status: number }> {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { ...json, _status: res.status };
}

const tag = Date.now().toString(36);
const mail = (n: string) => `e2e-${n}-${tag}@test.aquaguard`;

// 1. The owner registers, creates the home (French texts) and a zone.
const sami = await call('POST', '/auth/register', { name: 'Sami', email: mail('sami'), password: 'secret123' });
ok(sami.token, 'owner registers');
const S = `Bearer ${sami.token}`;
const home = await call('POST', '/homes', { name: 'E2E home', settings: { gracePeriodSec: 2, smsFallbackSec: 2, nextContactSec: 2, lang: 'fr' } }, S);
ok(home.role === 'owner' && home.inviteCode?.length === 6, `home created, Sami is owner (code ${home.inviteCode})`);
await call('PUT', `/homes/${home.id}/contacts`, [{ id: 'c1', name: 'Sami', role: 'family', phone: '+21620000001', push: true, sms: true }], S);
const zone = await call('POST', `/homes/${home.id}/zones`, { name: 'Cuisine', icon: 'kitchen' }, S);
ok(zone.id, 'zone added');

// 2. Link a (demo) node; the node authenticates with its own key.
const deviceId = `AG-DEMO-${tag.toUpperCase()}`;
const link = await call('POST', `/zones/${zone.id}/device`, { deviceId, claimCode: 'pair-123', kind: 'demo' }, S);
ok(link.deviceKey, 'node linked, key issued');
const D = `Device ${link.deviceKey}`;
const cfg = await call('GET', '/device/config', undefined, D);
ok(cfg.zone?.name === 'Cuisine' && cfg.valveTarget === 'open' && cfg.lang === 'fr', 'node config: its zone, valve open, home language');
ok((await call('GET', '/device/config', undefined, 'Device wrong'))._status === 401, 'wrong device key rejected (fake node)');

// 3. Live readings, then a leak: the node already closed the valve.
await call('PUT', '/device/live', { water: 2, wet: false, humidity: 55, pressure: 2, flow: 0, valve: 'open', calibrated: true }, D);
let st = await call('GET', `/homes/${home.id}/state`, undefined, S);
ok(st.zones[0].device?.online && st.zones[0].device.live.pressure === 2, 'phone sees the node online with live data');
const ev = await call('POST', '/device/events', { type: 'leak', source: 'ml', reason: 'Eau sur le capteur', valveClosed: true, snapshot: { water: 72, mlScore: 0.97 } }, D);
ok(ev.alertId, 'node opens a leak alert');
ok((await call('POST', '/device/events', { type: 'leak' }, D)).duplicate, 'second event does not open a duplicate alert');
await call('PUT', '/device/live', { water: 72, wet: true, valve: 'closed', calibrated: true }, D);
st = await call('GET', `/homes/${home.id}/state`, undefined, S);
ok(['LOCAL_ASSISTANCE', 'ESCALATE'].includes(st.zones[0].active?.stage), `phone sees the open alert (stage ${st.zones[0].active?.stage}; 2 s grace in this test)`);
ok(st.zones[0].device.valveTarget === 'closed' && st.valveLog[0]?.byKind === 'device', 'valve target follows the node; valve log records the auto shut-off');
ok(st.zones[0].active.timeline.some((t: any) => /coupée automatiquement/.test(t.text)), 'timeline written in French');

// 4. Server-owned escalation after the grace period.
await wait(2600);
st = await call('GET', `/homes/${home.id}/state`, undefined, S);
const a = st.zones[0].active;
ok(a?.stage === 'ESCALATE' && a.level === 1, `server escalated to level 1 (stage ${a?.stage})`);

// 5. Leila joins as a member: she can close but not re-open the water.
const leila = await call('POST', '/auth/register', { name: 'Leila', email: mail('leila'), password: 'secret123' });
const L = `Bearer ${leila.token}`;
const j = await call('POST', '/homes/join', { code: home.inviteCode.toLowerCase() }, L);
ok(j.role === 'member', 'second person joins as member');
ok((await call('POST', `/zones/${zone.id}/valve`, { action: 'open' }, L))._status === 403, 'member cannot turn the water back on');
ok((await call('POST', `/zones/${zone.id}/valve`, { action: 'open' }, S))._status === 409, 'owner cannot re-open while the node still sees water');
const r = await call('POST', `/alerts/${a.id}/resolve`, { resolution: 'member_ack' }, L);
ok(r.changed, 'member answers the alert');
ok((await call('GET', '/device/config', undefined, D)).activeAlert === null, 'node sees the alert is over (stops the alarm)');
await call('PUT', '/device/live', { water: 1, wet: false, valve: 'closed', calibrated: true }, D);
const opened = await call('POST', `/zones/${zone.id}/valve`, { action: 'open' }, S);
ok(opened.changed && opened.valveTarget === 'open', 'owner re-opens once the floor is dry');
ok((await call('GET', '/device/config', undefined, D)).valveTarget === 'open', 'node reads the new target');
ok((await call('POST', `/zones/${zone.id}/valve`, { action: 'close' }, L)).valveTarget === 'closed', 'member can turn the water off');
await call('POST', `/zones/${zone.id}/valve`, { action: 'open' }, S);
ok((await call('PUT', `/homes/${home.id}/contacts`, [], L))._status === 403, 'member cannot edit contacts');

// 6. Someone at home presses the node button on a new alert; pressure test; hidden leak.
const ev2 = await call('POST', '/device/events', { type: 'sensor_fault', valveClosed: true }, D);
const ack = await call('POST', '/device/events', { type: 'local_ack' }, D);
ok(ev2.alertId && ack.changed, 'node button closes the alert');
st = await call('GET', `/homes/${home.id}/state`, undefined, S);
ok(st.history[0]?.resolution === 'local_ack', 'history: handled at home');
await call('POST', `/zones/${zone.id}/valve`, { action: 'open' }, S);
await call('POST', `/zones/${zone.id}/pressure-test`, undefined, L);
ok((await call('GET', '/device/config', undefined, D)).testRequestedAt > 0, 'pressure test request reaches the node');
const hid = await call('POST', '/device/events', { type: 'hidden_leak', source: 'pressure_test', valveClosed: true, snapshot: { pressureDrop: 0.45 } }, D);
ok(hid.alertId, 'failed pressure test opens a hidden-leak alert');
await call('POST', `/alerts/${hid.alertId}/resolve`, { resolution: 'false_alarm' }, S);

// AI: insights from the data, assistant (summary when no AI key), advice for a closed alert
const ins = await call('GET', `/zones/${zone.id}/insights?days=30&tz=-60&lang=fr`, undefined, S);
ok(ins.insights?.alerts.total === 3 && ins.insights.alerts.outcomes.localAnswered === 1 && ins.insights.alerts.autoShutOffs >= 1, 'insights count alerts, outcomes and shut-offs');
const asked = await call('POST', `/zones/${zone.id}/assistant`, { messages: [{ role: 'user', content: 'Y a-t-il une fuite ?' }], tz: -60, lang: 'fr' }, L);
ok(typeof asked.answer === 'string' && asked.answer.trim().length > 10, `assistant answers (${asked.model ?? 'data summary, no AI'}): ${String(asked.answer).slice(0, 80).replace(/\s+/g, ' ')}…`);
ok((await call('POST', `/zones/${zone.id}/assistant`, { messages: [] }, S))._status === 400, 'assistant needs a question');
const adv = await call('GET', `/alerts/${st.history[0].id}/advice?tz=-60&lang=fr`, undefined, S);
ok(adv.advice != null || typeof adv.pending === 'string', `advice for a closed alert (${adv.advice ? 'written by AI' : adv.pending})`);

// 7. Sensor management.
const bath = await call('POST', `/homes/${home.id}/zones`, { name: 'Salle de bain', icon: 'bathroom' }, S);
ok((await call('POST', `/homes/${home.id}/zones`, { name: 'X' }, L))._status === 403, 'member cannot add zones');
await call('POST', `/devices/${deviceId}/move`, { zoneId: bath.id }, S);
ok((await call('GET', '/device/config', undefined, D)).zone?.name === 'Salle de bain', 'move to another zone: same key, new zone');
await call('POST', `/devices/${deviceId}/release`, undefined, S);
ok((await call('GET', '/device/config', undefined, D))._status === 401, 'remove completely: old key stops working');
const other = await call('POST', '/auth/register', { name: 'Stranger', email: mail('x'), password: 'secret123' });
const oh = await call('POST', '/homes', { name: 'Other' }, `Bearer ${other.token}`);
const oz = await call('POST', `/homes/${oh.id}/zones`, { name: 'Kitchen' }, `Bearer ${other.token}`);
ok((await call('POST', `/zones/${oz.id}/device`, { deviceId, claimCode: 'WRONG' }, `Bearer ${other.token}`))._status === 403, 'wrong claim code is refused');
ok((await call('POST', `/zones/${oz.id}/device`, { deviceId, claimCode: 'pair-123' }, `Bearer ${other.token}`)).deviceKey, 'released sensor can join another home');
ok((await call('GET', `/homes/${home.id}/state`, undefined, `Bearer ${other.token}`))._status === 403, 'a stranger cannot read another home');

// 8. Auth.
ok((await call('POST', '/auth/login', { email: mail('sami'), password: 'nope' }))._status === 401, 'wrong password rejected');
ok((await call('POST', '/auth/login', { email: mail('sami'), password: 'secret123' })).token, 'login works');

// Cleanup: everyone leaves -> homes are deleted.
for (const [h, t, u] of [
  [home.id, L, leila.user.id],
  [home.id, S, sami.user.id],
  [oh.id, `Bearer ${other.token}`, other.user.id],
] as const) {
  await call('DELETE', `/homes/${h}/members/${u}`, undefined, t);
}
console.log(failures === 0 ? 'ALL PASSED' : `${failures} FAILED`);
process.exitCode = failures ? 1 : 0;
