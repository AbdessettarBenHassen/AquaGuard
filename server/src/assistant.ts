import type { Lang } from './i18n.js';
import { chatWith, fallbackProvider, llmModel, LlmError, primaryProvider, type LlmMessage, type ToolDef } from './llm.js';
import { slotOf, type Insights } from './insights.js';

// The home assistant: a free AI model (llm.ts) that answers questions about one
// zone's leak alerts, valve and sensor. It reads the real data through tools
// and never invents numbers. If the AI is not set up or not reachable, a plain
// summary of the same data is returned instead, so the page always answers.
//
// Privacy: only readings, times and alert types are sent to the AI provider,
// never names, emails, addresses or phone numbers.

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantData {
  insights: Insights;
  alerts: Row[]; // last `insights.days` days, newest first
  device: Row | null; // devices row with live + live_age_ms
  tzOffsetMin: number;
  lang?: Lang;
}

export interface AssistantReply {
  answer: string;
  model: string | null; // null = offline summary (no AI)
  notice?: string;
}

const MAX_TURNS = 12;
const MAX_CHARS = 1500;
const MAX_STEPS = 5;

const SYSTEM = `You are the AquaGuard assistant. You help a family understand the water-leak alerts of one room ("zone") of their home.

How AquaGuard works: a sensor node in the room reads a water sensor on the floor (0-100% wet), the air humidity and temperature, and the water pressure in the pipe when a pressure sensor is fitted. A small AI model reads a short window of readings (not one value) and gives a leak probability. A "leak" alert needs water on the sensor that stays and grows; humid air (a shower) or a small spill that dries must NOT raise one. A "hidden_leak" comes from the night pressure test: the valve closes with every tap shut and the pipe pressure is watched; if it falls, water is escaping inside the pipes or walls, where no floor sensor can see it (the test also starts by itself when water flows without stopping for a long time). On a confirmed leak the node turns the water off by itself with a valve and sounds an alarm; someone at home can press the node's button, otherwise the family and then the contacts are alerted. Only an owner of the home can turn the water back on. "sensor_fault" means the sensor stopped giving readings, is unplugged, or is stuck; the node then turns the water off for safety.

Use the tools to read the data before answering anything about this zone. Never invent numbers, dates or patterns: if the tools do not show it, say you do not see it in the data.

Rules:
- Safety first: if someone describes water near electrical sockets or appliances, tell them to switch off the electricity at the breaker before touching anything. For a flood or a burst pipe, keep the water off and call a plumber; for danger to people, call civil protection (198 in Tunisia).
- Never tell them to re-open the water while water is still detected.
- Answer in the language of the question. Plain, warm, short: a few sentences or a short list.`;

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_summary',
      description: 'What AquaGuard learned about the zone: usual humidity and pressure, thresholds, alert counts by type, time of day, outcome, how fast the water was turned off, leak growth, findings. Call this first for most questions.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_alerts',
      description: 'The individual alerts, newest first: type, local date and time, readings at that moment (water, humidity, pressure, AI leak score, growth), whether the water was turned off, how it ended and how long it took.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['leak', 'hidden_leak', 'sensor_fault', 'any'], description: 'Filter by alert type (default any).' },
          limit: { type: 'integer', minimum: 1, maximum: 40, description: 'How many (default 15).' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sensor_status',
      description: 'The sensor node right now: online or not, water level, humidity, temperature, pressure, AI leak score, valve open or closed, sensor health, network.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
];

const RESOLUTION_TEXT: Record<string, string> = {
  local_ack: 'someone at home pressed the sensor button',
  member_ack: 'a family member answered in the app',
  false_alarm: 'a family member marked it a false alarm',
};

function localTime(d: Date, tz: number) {
  const l = new Date(d.getTime() - tz * 60000);
  return l.toISOString().slice(0, 16).replace('T', ' ');
}

function alertBrief(a: Row, tz: number) {
  const started = new Date(a.started_at);
  const s = a.snapshot ?? {};
  return {
    kind: a.kind,
    localTime: localTime(started, tz),
    timeOfDay: slotOf(started, tz),
    detectedBy: a.source,
    readings: {
      water: s.water ?? null,
      humidity: s.humidity ?? null,
      usualHumidity: s.baselineHumidity ?? null,
      pressure: s.pressure ?? null,
      usualPressure: s.baselinePressure ?? null,
      flowLitresPerMin: s.flow ?? null,
      pressureDropInTest: s.pressureDrop ?? null,
      waterLostLitres: s.waterLost ?? null,
      leakScore: s.mlScore ?? null,
      growthPerMin: s.growthPerMin ?? null,
    },
    waterTurnedOff: s.valveClosed ?? null,
    outcome: a.resolution ? RESOLUTION_TEXT[a.resolution] ?? a.resolution : 'still open',
    contactsReached: Number(a.level) > 0,
    minutesToClose: a.resolved_at ? Math.round((new Date(a.resolved_at).getTime() - started.getTime()) / 6000) / 10 : null,
  };
}

function sensorStatus(d: Row | null) {
  if (!d) return { linked: false };
  const live = d.live ?? {};
  const age = d.live_age_ms != null ? Number(d.live_age_ms) : null;
  return {
    linked: true,
    online: age != null && age < 10000,
    lastDataSecondsAgo: age != null ? Math.round(age / 1000) : null,
    water: live.water ?? null,
    wet: live.wet ?? null,
    humidity: live.humidity ?? null,
    temperature: live.temp ?? null,
    pressure: live.pressure ?? null,
    flowLitresPerMin: live.flow ?? null,
    waterLostLitres: live.waterLost ?? null,
    lastPressureTest: live.test ?? null,
    leakScore: live.mlScore ?? null,
    valve: live.valve ?? null,
    valveWanted: d.valve_target ?? null,
    sensors: live.sensors ?? null,
    finishedLearning: live.calibrated ?? null,
    network: live.network?.mode ?? null,
  };
}

function runTool(name: string, args: Row, data: AssistantData): unknown {
  if (name === 'get_summary') {
    const { profile, alerts, confidence, findings, suggestions, days } = data.insights;
    return { days, profile, alerts, confidence, findings, suggestions };
  }
  if (name === 'list_alerts') {
    const kind = args.kind && args.kind !== 'any' ? String(args.kind) : null;
    const limit = Math.min(40, Math.max(1, Number(args.limit) || 15));
    return data.alerts.filter((a) => !kind || a.kind === kind).slice(0, limit).map((a) => alertBrief(a, data.tzOffsetMin));
  }
  if (name === 'get_sensor_status') return sensorStatus(data.device);
  return { error: `Unknown tool ${name}` };
}

/** Plain answer from the data, used when the AI is not available. */
export function offlineAnswer(data: AssistantData): string {
  const fr = data.lang === 'fr';
  const i = data.insights;
  const s = sensorStatus(data.device) as Row;
  const lines = [...i.findings];
  if (s.linked) {
    if (!s.online) lines.push(fr ? 'Le capteur est hors ligne en ce moment.' : 'The sensor is offline right now.');
    else {
      const valve = s.valve === 'closed' ? (fr ? 'eau coupée' : 'water off') : fr ? 'eau ouverte' : 'water on';
      lines.push(fr ? `Le capteur est en ligne, ${valve}.` : `The sensor is online, ${valve}.`);
    }
  }
  if (i.suggestions.length) lines.push('', fr ? 'À envisager :' : 'Things to consider:', ...i.suggestions.map((x) => `• ${x}`));
  return lines.join('\n');
}

/** Everything the tools would return, in one block: for the keyless fallback, which allows one call. */
function dataBlock(data: AssistantData) {
  const { profile, alerts, confidence, findings, suggestions, days } = data.insights;
  return JSON.stringify({
    summary: { days, profile, alerts, confidence, findings, suggestions },
    recentAlerts: data.alerts.slice(0, 15).map((a) => alertBrief(a, data.tzOffsetMin)),
    sensorNow: sensorStatus(data.device),
  });
}

export async function runAssistant(history: ChatTurn[], data: AssistantData): Promise<AssistantReply> {
  const fr = data.lang === 'fr';
  const turns = history
    .filter((t) => (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim())
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_CHARS) }));
  if (!turns.length || turns[turns.length - 1].role !== 'user') throw new LlmError(fr ? 'Posez d’abord une question.' : 'Ask a question first.');

  const primary = primaryProvider();
  const fallback = fallbackProvider();
  if (!primary && !fallback) {
    return { answer: offlineAnswer(data), model: null, notice: fr ? 'L’IA n’est pas encore connectée : voici un résumé des données.' : 'The AI is not connected yet: here is a summary of the data.' };
  }

  let lastError: LlmError | null = null;

  // 1. Primary model with tools: it reads the data it needs, step by step.
  if (primary) {
    const messages: LlmMessage[] = [{ role: 'system', content: SYSTEM }, ...turns];
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const msg = await chatWith(primary, { messages, tools: TOOLS, maxTokens: 700 });
        if (!msg.tool_calls?.length) {
          const answer = (msg.content ?? '').trim();
          if (!answer) break;
          return { answer, model: llmModel(primary) };
        }
        messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
        for (const call of msg.tool_calls) {
          let args: Row = {};
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {}
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(runTool(call.function.name, args, data)) });
        }
      }
      // the model kept calling tools: ask for the answer without tools
      const last = await chatWith(primary, { messages: [...messages, { role: 'user', content: 'Answer the question now with the data above.' }], maxTokens: 600 });
      if (last.content?.trim()) return { answer: last.content.trim(), model: llmModel(primary) };
      throw new LlmError('The AI did not answer.');
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      lastError = e;
    }
  }

  // 2. Keyless fallback: one call, with the data already in the prompt.
  if (fallback) {
    try {
      const msg = await chatWith(fallback, {
        messages: [{ role: 'system', content: `${SYSTEM}\n\nThe data of this zone (JSON), already read for you:\n${dataBlock(data)}` }, ...turns],
        maxTokens: 700,
      });
      const answer = (msg.content ?? '').trim();
      if (answer) return { answer, model: llmModel(fallback) };
      throw new LlmError('The AI did not answer.');
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      lastError = e;
    }
  }

  return { answer: offlineAnswer(data), model: null, notice: `${lastError?.message ?? ''} ${fr ? 'Voici un résumé des données.' : 'Here is a summary of the data instead.'}`.trim() };
}
