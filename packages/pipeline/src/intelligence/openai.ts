// OpenAI: the same call as courier.ts/openrouter.ts (same prompt in, text out, same result shape) on a hosted model.
// Used only when GENERATION_BACKEND=openai (generate.ts); OPENAI_MODEL names the model. Never throws: a failure is a
// value, as with Courier.
import type { CourierResult } from "./courier.js";

const URL = "https://api.openai.com/v1/chat/completions";
/** Same rationale as openrouter.ts: a hosted model is slower than Courier, and a reasoning model thinks first. */
const TIMEOUT_MS = 90_000;
const ATTEMPTS = 2; // the call plus one retry, as with Courier
/** gpt-5-mini's reasoning tokens count against this cap same as any other model here (confirmed: 20 tokens produced
 * an empty completion, all spent on reasoning) — well above Courier's 1200 for the same reason as openrouter.ts. */
const MAX_TOKENS = 4000;

/** Every call's usage, summed for the run. No dollar cost: unlike OpenRouter, the Chat Completions response carries
 * only token counts, not a priced cost — a caller converts using whatever's current for the model. */
export const openAiUsage = { calls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };

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
      // No temperature: gpt-5-mini (confirmed) rejects anything but the default (1) — "Only the default (1) value
      // is supported" — so, unlike Courier/OpenRouter, this is omitted rather than set to 0.2.
      max_completion_tokens: MAX_TOKENS,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, attempts: 1 };
  const body = (await res.json()) as {
    model?: string;
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  openAiUsage.calls++;
  openAiUsage.promptTokens += body.usage?.prompt_tokens ?? 0;
  openAiUsage.completionTokens += body.usage?.completion_tokens ?? 0;
  openAiUsage.reasoningTokens += body.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const text = body.choices?.[0]?.message?.content;
  if (!text) return { ok: false, error: `incomplete response (finish ${body.choices?.[0]?.finish_reason ?? "none"})`, attempts: 1 };
  return { ok: true, text, model: body.model ?? model, attempts: 1 };
}

/** One generation, retried once on any failure except 429 (rate/quota limit, which an immediate retry can't fix). Never throws. */
export async function callOpenAi(prompt: { system: string; user: string }, fetchFn: typeof fetch = fetch): Promise<CourierResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY must be set", attempts: 0 };
  let last: CourierResult = { ok: false, error: "not attempted", attempts: 0 };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      last = await once(prompt, model, apiKey, fetchFn);
    } catch (error) {
      last = { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), attempts: 1 };
    }
    last.attempts = attempt;
    if (last.ok || last.error.startsWith("HTTP 429")) return last;
  }
  return last;
}
