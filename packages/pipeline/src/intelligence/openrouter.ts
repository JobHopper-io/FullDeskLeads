// OpenRouter: the same call as courier.ts (same prompt in, text out, same result shape) on a hosted model, for comparing
// generation models. Used only when GENERATION_BACKEND=openrouter (generate.ts); OPENROUTER_MODEL names the model.
// Never throws: a failure is a value, as with Courier.
import type { CourierResult } from "./courier.js";

const URL = "https://openrouter.ai/api/v1/chat/completions";
/** Hosted models are slower than Courier on a long input, and a reasoning model thinks before it answers. */
const TIMEOUT_MS = 90_000;
const ATTEMPTS = 2; // the call plus one retry, as with Courier
/** Above Courier's 1200: a reasoning model's thinking counts against the cap, and truncating it would be an unfair fail. */
const MAX_TOKENS = 4000;

/** Every call's usage, summed for the run; generationIds let a caller check the cost against /api/v1/generation. */
export const openRouterUsage = { calls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cost: 0, generationIds: [] as string[] };

async function once(prompt: { system: string; user: string }, model: string, apiKey: string, fetchFn: typeof fetch): Promise<CourierResult> {
  const res = await fetchFn(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      temperature: 0.2,
      max_tokens: MAX_TOKENS,
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, attempts: 1 };
  const body = (await res.json()) as {
    id?: string; model?: string;
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  openRouterUsage.calls++;
  openRouterUsage.promptTokens += body.usage?.prompt_tokens ?? 0;
  openRouterUsage.completionTokens += body.usage?.completion_tokens ?? 0;
  openRouterUsage.reasoningTokens += body.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  openRouterUsage.cost += body.usage?.cost ?? 0;
  if (body.id) openRouterUsage.generationIds.push(body.id);
  const text = body.choices?.[0]?.message?.content;
  if (!text) return { ok: false, error: `incomplete response (finish ${body.choices?.[0]?.finish_reason ?? "none"})`, attempts: 1 };
  return { ok: true, text, model: body.model ?? model, attempts: 1 };
}

/** One generation, retried once on any failure except 402 (out of credit, which a retry can't fix). Never throws. */
export async function callOpenRouter(prompt: { system: string; user: string }, fetchFn: typeof fetch = fetch): Promise<CourierResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;
  if (!apiKey || !model) return { ok: false, error: "OPENROUTER_API_KEY and OPENROUTER_MODEL must both be set", attempts: 0 };
  let last: CourierResult = { ok: false, error: "not attempted", attempts: 0 };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      last = await once(prompt, model, apiKey, fetchFn);
    } catch (error) {
      last = { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), attempts: 1 };
    }
    last.attempts = attempt;
    if (last.ok || last.error.startsWith("HTTP 402")) return last;
  }
  return last;
}
