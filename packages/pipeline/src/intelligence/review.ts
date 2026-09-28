/**
 * The review pass: a stronger model reads each generation against its inputs and only flags characterizations or claims
 * the posting doesn't make. It judges meaning, which the deterministic QA in verify.ts can't. Report-only: flags never
 * change QA pass/fail. Never throws. (Objections aren't generated, so there are no responses to check.)
 */
import type { Generation } from "./verify.js";

const URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 60_000;

export interface ReviewFlag { field: string; quote: string; kind: "not_in_posting"; reason: string }
export type ReviewResult = { ok: true; model: string; flags: ReviewFlag[] } | { ok: false; error: string };

export const REVIEW_SYSTEM = `You review call prep a small model wrote for a recruiter, against the INPUTS it was given. You only flag; you never rewrite.

Flag exactly one kind of problem, "not_in_posting": a characterization or claim INPUTS do not make, however small: judgments such as "critical" or "urgent", a fact restated about the wrong subject (the plant instead of the position), an inferred move, transition, timeline or cause, or a purpose or output the posting doesn't give the role.

Do not flag style, tone, length or anything else. Quote the exact words you flag. If nothing qualifies, return an empty list.

Return JSON only: {"flags":[{"field":"why_now"|"opening_script","quote":string,"kind":"not_in_posting","reason":string}]}`;

export const reviewUser = (inputs: string, g: Generation) => `INPUTS:\n${inputs}\n\nGENERATED CALL PREP:\n${JSON.stringify(g, null, 2)}`;

export async function reviewGeneration(inputs: string, g: Generation, fetchFn: typeof fetch = fetch): Promise<ReviewResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY is not set" };
  try {
    const res = await fetchFn(URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, system: REVIEW_SYSTEM, messages: [{ role: "user", content: reviewUser(inputs, g) }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const body = (await res.json()) as { model?: string; content?: { type: string; text?: string }[] };
    const text = body.content?.find((c) => c.type === "text")?.text ?? "";
    const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { flags?: ReviewFlag[] };
    return Array.isArray(parsed.flags) ? { ok: true, model: body.model ?? MODEL, flags: parsed.flags } : { ok: false, error: "no flags list in the review" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}
