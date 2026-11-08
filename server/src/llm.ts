// Free AI through any OpenAI-compatible chat API, with an automatic fallback.
//
//  Primary (needs a free key): Groq with OpenAI's open model GPT-OSS 120B.
//    LLM_API_KEY   the provider key
//    LLM_BASE_URL  default https://api.groq.com/openai/v1
//                  (Gemini: https://generativelanguage.googleapis.com/v1beta/openai,
//                   Hugging Face: https://router.huggingface.co/v1)
//    LLM_MODEL     default openai/gpt-oss-120b
//
//  Fallback (no key at all): Pollinations, OpenAI's open models for free, limited to about
//  one answer every 45 s. Used when there is no key or the primary refuses (bad key, quota).
//    LLM_FALLBACK_URL    default https://text.pollinations.ai/openai   ("off" disables it)
//    LLM_FALLBACK_MODEL  default openai

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export class LlmError extends Error {}

export interface Provider {
  name: 'primary' | 'fallback';
  url: string; // full chat-completions endpoint
  key: string | null;
  model: string;
}

export function primaryProvider(): Provider | null {
  const key = process.env.LLM_API_KEY;
  if (!key) return null;
  const base = (process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  return { name: 'primary', url: `${base}/chat/completions`, key, model: process.env.LLM_MODEL || 'openai/gpt-oss-120b' };
}

export function fallbackProvider(): Provider | null {
  const url = process.env.LLM_FALLBACK_URL ?? 'https://text.pollinations.ai/openai';
  if (!url || url === 'off') return null;
  return { name: 'fallback', url, key: null, model: process.env.LLM_FALLBACK_MODEL || 'openai' };
}

export const llmConfigured = () => !!(primaryProvider() || fallbackProvider());
export const llmModel = (p?: Provider | null) => (p ?? primaryProvider() ?? fallbackProvider())?.model ?? 'none';

interface ChatOpts {
  messages: LlmMessage[];
  tools?: ToolDef[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

/** One call to one provider. */
export async function chatWith(p: Provider, opts: ChatOpts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let res: Response;
  try {
    res = await fetch(p.url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(p.key ? { authorization: `Bearer ${p.key}` } : {}) },
      body: JSON.stringify({
        model: p.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 700,
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  } catch (e) {
    throw new LlmError(`The AI service did not answer (${(e as Error).name === 'AbortError' ? 'timeout' : 'network'}).`);
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as {
    choices?: { message: { content: string | null; tool_calls?: ToolCall[] } }[];
    error?: { message?: string } | string;
  };
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message;
    // 429 / 402 = the free plan's limit for now
    throw new LlmError(res.status === 429 || res.status === 402 ? 'The free AI is busy right now (rate limit). Try again in a minute.' : `AI error ${res.status}: ${msg ?? 'unknown'}`);
  }
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new LlmError('The AI sent an empty answer.');
  return { ...msg, tool_calls: msg.tool_calls?.length ? msg.tool_calls : undefined, provider: p };
}

/** Primary first; on any refusal (bad key, quota, outage) the keyless fallback, in one call. */
export async function chat(opts: ChatOpts) {
  const primary = primaryProvider();
  const fallback = fallbackProvider();
  if (!primary && !fallback) throw new LlmError('The AI is not set up on the server (LLM_API_KEY).');
  if (primary) {
    try {
      return await chatWith(primary, opts);
    } catch (e) {
      if (!fallback) throw e;
      console.error('primary AI failed, using the free fallback:', (e as Error).message);
    }
  }
  return chatWith(fallback!, opts);
}
