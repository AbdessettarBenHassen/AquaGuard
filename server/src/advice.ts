import { z } from 'zod';

import type { Lang } from './i18n.js';
import { chat, llmConfigured, llmModel } from './llm.js';

// AI advice after an alert: a free AI model (llm.ts) reads the alert's readings
// and the zone's recent alert history and writes a short explanation plus a few
// practical tips. Only readings, times, alert types and the room type are sent
// (no names, no address).

const AdviceSchema = z.object({
  summary: z.string().min(1),
  tips: z.array(z.string()),
});
export type Advice = z.infer<typeof AdviceSchema> & { model: string; createdAt: number };

const SYSTEM = `You help a family understand an alert from AquaGuard, a water-leak detector in one room of their home.

A sensor node reads a water sensor on the floor (0-100% wet), the air humidity and temperature, and the water pressure in the pipe when fitted. A small AI model reads a short window of readings and gives a leak probability (mlScore 0-1). "leak" = water that stays and grows on the sensor; "hidden_leak" = the night pressure test found the pipe pressure falling with every tap closed (a leak inside pipes or walls, invisible on the floor); "sensor_fault" = the sensor stopped, is unplugged or stuck. On a confirmed leak the node turns the water off itself (valveClosed) and sounds an alarm.

You receive the alert, the room type and the zone's alerts of the last 30 days as JSON. Write for a family: plain, warm, short words, no jargon.

Reply with JSON only, exactly: {"summary": "...", "tips": ["...", "..."]}
- summary: one or two sentences: what most likely happened, using the readings (how fast the water grew, pressure drop = pipe leak, humidity) and any pattern in the history (same time of day, repeated leaks, false alarms).
- tips: two to four practical things to do or check, one sentence each, adapted to the room (e.g. kitchen: under the sink, dishwasher hose; bathroom: toilet tank, shower seal; laundry: washing-machine hose; boiler: pressure relief valve).

Rules: safety first (electricity near water: switch off at the breaker). Never suggest re-opening the water while water is still there. Suggest a plumber for a burst pipe or a leak that comes back.`;

export type AdviceAlertRow = AlertRow;

interface AlertRow {
  kind: string;
  source: string;
  reason: string;
  snapshot: unknown;
  started_at: string | Date;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | Date | null;
  level: number;
}

function brief(a: AlertRow, tzOffsetMin: number) {
  const started = new Date(a.started_at);
  return {
    kind: a.kind,
    localTime: new Date(started.getTime() - tzOffsetMin * 60000).toISOString().slice(0, 16).replace('T', ' '),
    detectedBy: a.source,
    readings: a.snapshot,
    escalationLevel: a.level,
    resolution: a.resolution ?? 'still open',
    minutesToResolve: a.resolved_at ? Math.round((new Date(a.resolved_at).getTime() - started.getTime()) / 60000) : null,
  };
}

/** null when the AI is not configured (no LLM_API_KEY) or sent something unusable. */
export async function generateAdvice(alert: AlertRow, history: AlertRow[], zone: { room: string }, tzOffsetMin = -60, lang: Lang = 'en'): Promise<Advice | null> {
  if (!llmConfigured()) return null;
  const input = {
    answerLanguage: lang === 'fr' ? 'French' : 'English',
    room: zone.room,
    alert: brief(alert, tzOffsetMin),
    last30Days: history.map((h) => brief(h, tzOffsetMin)),
  };
  const msg = await chat({ messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(input) }], json: true, maxTokens: 500 });
  let parsed: z.infer<typeof AdviceSchema>;
  try {
    parsed = AdviceSchema.parse(JSON.parse(msg.content ?? ''));
  } catch {
    return null;
  }
  const tips = parsed.tips.map((t) => t.trim()).filter(Boolean).slice(0, 4);
  return { summary: parsed.summary.trim(), tips, model: llmModel(msg.provider), createdAt: Date.now() };
}
