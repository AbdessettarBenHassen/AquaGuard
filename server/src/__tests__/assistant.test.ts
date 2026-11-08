import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';

import { generateAdvice } from '../advice.js';
import { advance } from '../escalation.js';
import { offlineAnswer, runAssistant, type AssistantData } from '../assistant.js';
import { computeInsights, slotOf } from '../insights.js';

// A fake OpenAI-compatible provider: records requests, answers with a script.
let server: Server;
const requests: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
let script: ((body: any) => any)[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ auth: req.headers.authorization, url: req.url, body });
      const next = script.shift();
      res.setHeader('content-type', 'application/json');
      if (!next) {
        res.statusCode = 429;
        return res.end(JSON.stringify({ error: { message: 'rate limit' } }));
      }
      const out = next(body);
      if (out.__status) {
        res.statusCode = out.__status;
        return res.end(JSON.stringify({ error: { message: 'Invalid API Key' } }));
      }
      res.end(JSON.stringify({ choices: [{ message: out }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_MODEL = 'test-model';
  // The keyless fallback goes to the same fake server (path /fallback), never to the Internet.
  process.env.LLM_FALLBACK_URL = `http://127.0.0.1:${port}/fallback`;
  process.env.LLM_FALLBACK_MODEL = 'free-model';
});
after(() => server.close());

const NOW = Date.UTC(2026, 10, 8, 12, 0);
const zone = { name: 'Kitchen', icon: 'kitchen', settings: {}, baseline: { humidity: 52, pressure: 2, samples: 40, calibrated: true } };
const alert = (o: Record<string, unknown>) => ({
  kind: 'leak',
  source: 'ml',
  reason: 'r',
  level: 0,
  started_at: new Date(NOW - 2 * 3600000).toISOString(),
  resolved_at: new Date(NOW - 2 * 3600000 + 5 * 60000).toISOString(),
  resolution: 'local_ack',
  resolved_by: 'Kitchen',
  snapshot: { water: 72, humidity: 61, baselineHumidity: 52, pressure: 1.94, mlScore: 0.97, growthPerMin: 40, valveClosed: true },
  ...o,
});
// three night leaks (local 02:00 in Tunisia = 01:00 UTC), one false alarm, one escalated, one sensor fault
const at = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, d, h, m)).toISOString();
const alerts = [
  alert({ started_at: at(7, 1), resolved_at: at(7, 1, 4) }),
  alert({ started_at: at(6, 1), resolved_at: at(6, 1, 10), resolution: 'false_alarm', resolved_by: 'Sami' }),
  alert({ started_at: at(5, 1), resolved_at: at(5, 1, 20), resolution: 'member_ack', level: 2 }),
  alert({ kind: 'sensor_fault', source: 'watchdog', snapshot: {}, started_at: at(1, 15) }),
];
// the node shut the water 4 s after each leak
const valves = alerts.slice(0, 3).map((a) => ({ action: 'closed', by_kind: 'device', at: new Date(new Date(a.started_at).getTime() + 4000).toISOString() }));

test('time of day uses the phone time zone', () => {
  assert.equal(slotOf(new Date(Date.UTC(2026, 10, 7, 1)), -60), 'night'); // 02:00 local
  assert.equal(slotOf(new Date(Date.UTC(2026, 10, 7, 5, 30)), -60), 'morning'); // 06:30 local
});

test('insights: counts, night pattern, shut-off time, in English and French', () => {
  const i = computeInsights(zone, alerts, valves, { days: 30, tzOffsetMin: -60, now: NOW });
  assert.equal(i.alerts.total, 4);
  assert.equal(i.alerts.byKind.leak, 3);
  assert.equal(i.alerts.byTime.night, 3);
  assert.equal(i.alerts.outcomes.contactsReached, 1);
  assert.equal(i.alerts.falseAlarmRate, 1 / 3);
  assert.equal(i.alerts.avgSecondsToShutOff, 4);
  assert.equal(i.alerts.autoShutOffs, 3);
  assert.equal(i.confidence, 'medium');
  assert.ok(i.findings.some((f) => /at night/.test(f)), i.findings.join(' | '));
  assert.ok(i.suggestions.some((s) => /night/.test(s)));
  const fr = computeInsights(zone, alerts, valves, { days: 30, tzOffsetMin: -60, now: NOW, lang: 'fr' });
  assert.ok(fr.findings.some((f) => /la nuit/.test(f)), fr.findings.join(' | '));
  const empty = computeInsights({ settings: {}, baseline: { samples: 3 } }, [], [], { days: 30, tzOffsetMin: -60, now: NOW });
  assert.equal(empty.confidence, 'learning');
  assert.ok(empty.findings[0].includes('3 of 15'));
});

test('escalation: nobody at home -> push, then SMS, then next contact', () => {
  const chain = [
    { name: 'Sami', role: 'owner', phone: '+216 1', push: true, sms: true },
    { name: 'Neighbour', role: 'other', phone: '+216 2', push: false, sms: true },
  ];
  const t = { gracePeriodSec: 20, smsFallbackSec: 20, nextContactSec: 40 };
  const s = advance({ stage: 'LOCAL_ASSISTANCE', level: 0, smsSentForLevel: false, deadline: 0 }, chain, t, 61000, 'fr')!;
  assert.equal(s.stage, 'ESCALATE');
  assert.equal(s.level, 2);
  assert.deepEqual(
    s.notifications.map((n) => `${n.contact?.name ?? 'all'}:${n.channel}`),
    ['all:push', 'Sami:push', 'Sami:sms', 'Neighbour:sms'],
  );
  assert.ok(s.entries.some((e) => /Personne à la maison/.test(e.text)));
});

const data = (): AssistantData => ({
  insights: computeInsights(zone, alerts, valves, { days: 30, tzOffsetMin: -60, now: NOW }),
  alerts,
  device: { live: { water: 3, wet: false, humidity: 50, pressure: 2, valve: 'open', calibrated: true, network: { mode: 'wifi', ssid: 'home' } }, valve_target: 'open', live_age_ms: 2000 },
  tzOffsetMin: -60,
});

test('without a key and no fallback: the assistant answers with a data summary', async () => {
  delete process.env.LLM_API_KEY;
  const fb = process.env.LLM_FALLBACK_URL;
  process.env.LLM_FALLBACK_URL = 'off';
  after(() => (process.env.LLM_FALLBACK_URL = fb));
  const r = await runAssistant([{ role: 'user', content: 'Why the alerts?' }], data());
  assert.equal(r.model, null);
  assert.match(r.notice!, /not connected/);
  assert.match(r.answer, /at night/);
  assert.match(r.answer, /water on/);
});

test('with a key: tool call, then the answer; no names sent to the provider', async () => {
  process.env.LLM_API_KEY = 'gsk_test';
  requests.length = 0;
  script = [
    () => ({ content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'list_alerts', arguments: '{"kind":"leak","limit":2}' } }] }),
    (body) => {
      const tool = body.messages.find((m: { role: string }) => m.role === 'tool');
      const list = JSON.parse(tool.content);
      assert.equal(list.length, 2);
      assert.equal(list[0].localTime, '2026-11-07 02:00');
      assert.equal(list[0].timeOfDay, 'night');
      assert.equal(list[0].waterTurnedOff, true);
      return { content: 'Two recent leaks happened around 2 a.m.' };
    },
  ];
  const r = await runAssistant([{ role: 'user', content: 'When do leaks happen?' }], data());
  assert.equal(r.model, 'test-model');
  assert.equal(r.answer, 'Two recent leaks happened around 2 a.m.');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].auth, 'Bearer gsk_test');
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].body.tools.length, 3);
  const sent = JSON.stringify(requests);
  assert.ok(!sent.includes('Sami'), 'names must not reach the AI provider');
});

test('provider rate limit: falls back to the data summary with a notice', async () => {
  script = [];
  const r = await runAssistant([{ role: 'user', content: 'Hello' }], data());
  assert.equal(r.model, null);
  assert.match(r.notice!, /busy/);
  assert.equal(r.answer, offlineAnswer(data()));
});

test('bad key: the free fallback answers in ONE call, with the data in the prompt', async () => {
  const fb = process.env.LLM_FALLBACK_URL;
  process.env.LLM_FALLBACK_URL = fb === 'off' ? process.env.LLM_BASE_URL!.replace('/v1', '/fallback') : fb;
  process.env.LLM_API_KEY = 'gsk_revoked';
  requests.length = 0;
  const fallbackAnswer = (body: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(body.model, 'free-model');
    assert.equal(body.tools, undefined, 'no tools: one call only');
    assert.match(body.messages[0].content, /recentAlerts/);
    return { content: 'Trois fuites la nuit.' };
  };
  script = [() => ({ __status: 401 }), fallbackAnswer]; // primary: invalid key, then the fallback answers
  const r = await runAssistant([{ role: 'user', content: 'Combien de fuites ?' }], data());
  assert.equal(r.answer, 'Trois fuites la nuit.');
  assert.equal(r.model, 'free-model');
  assert.equal(requests.at(-1).url, '/fallback');
  assert.equal(requests.at(-1).auth, undefined, 'no key sent to the free fallback');
});

test('advice: JSON answer parsed, at most 4 tips, asked in French', async () => {
  script = [() => ({ content: JSON.stringify({ summary: 'Fuite sous l’évier.', tips: ['a', ' ', 'b', 'c', 'd', 'e'] }) })];
  requests.length = 0;
  const a = await generateAdvice(alerts[0] as never, alerts.slice(1) as never, { room: 'kitchen' }, -60, 'fr');
  assert.equal(a!.summary, 'Fuite sous l’évier.');
  assert.deepEqual(a!.tips, ['a', 'b', 'c', 'd']);
  assert.equal(requests[0].body.response_format.type, 'json_object');
  assert.match(requests[0].body.messages[1].content, /French/);
  script = [() => ({ content: 'not json' })];
  assert.equal(await generateAdvice(alerts[0] as never, [], { room: 'other' }), null);
});
