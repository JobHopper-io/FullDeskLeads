// Courier: the shared, self-hosted Gemma instance (also used by Job-Hopper) behind an ngrok tunnel. No rate limits or
// uptime guarantee are known, so every call is bounded and a failure is a value, never an exception.
const COURIER_URL = "https://uce.ngrok.app/v1/responses";
export const MODEL = "Gemma 4 26B A4B";
/** Measured 5.9s and 7.3s for a ~400-token generation (2026-09-28); ~3x headroom for a busy shared box. */
const TIMEOUT_MS = 20_000;
const ATTEMPTS = 2; // the call plus one retry, then give up on this lead

export type CourierResult = { ok: true; text: string; model: string; attempts: number } | { ok: false; error: string; attempts: number };

async function once(prompt: { system: string; user: string }, apiKey: string, fetchFn: typeof fetch): Promise<CourierResult> {
  const res = await fetchFn(COURIER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { type: "message", role: "system", content: prompt.system },
        { type: "message", role: "user", content: prompt.user },
      ],
      stream: false,
      max_output_tokens: 1200,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, attempts: 1 };
  const body = (await res.json()) as { model?: string; status?: string; output?: { content?: { text?: string }[] }[] };
  const text = body.output?.[0]?.content?.[0]?.text;
  if (body.status !== "completed" || !text) return { ok: false, error: `incomplete response (status ${body.status})`, attempts: 1 };
  return { ok: true, text, model: body.model ?? "unknown", attempts: 1 };
}

/** One generation, retried once on any failure (network, timeout, non-200, incomplete). Never throws. */
export async function callCourier(prompt: { system: string; user: string }, fetchFn: typeof fetch = fetch): Promise<CourierResult> {
  const apiKey = process.env.GEMMA_API_KEY;
  if (!apiKey) return { ok: false, error: "GEMMA_API_KEY is not set", attempts: 0 };
  let last: CourierResult = { ok: false, error: "not attempted", attempts: 0 };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      last = await once(prompt, apiKey, fetchFn);
    } catch (error) {
      last = { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), attempts: 1 };
    }
    last.attempts = attempt;
    if (last.ok) return last;
  }
  return last;
}
