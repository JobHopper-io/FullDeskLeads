/**
 * The review pass: after a generation passes the deterministic QA (verify.ts), a second, separate call reads it against
 * the inputs it was written from and judges meaning, which the QA can't: a claim about the wrong subject, a perk
 * restated as a duty, a why_now with no duty. Only a generation that passes BOTH may be written live.
 *
 * Which reviewer runs is INTELLIGENCE_REVIEWER: "gemma" (Courier, a fresh call with a critique-only prompt; never the
 * generation's own context) or "claude" (the paid reviewer, once its key exists). Anything else, including unset, is
 * off: content is written on the deterministic QA alone and marked review:qa_only. Never throws; a reviewer that
 * can't answer, or answers in a shape we can't read, is a fail.
 */
import { callCourier } from "./courier.js";
import type { FieldName, Generation } from "./verify.js";

export type Reviewer = "gemma" | "claude";
export const intelligenceReviewer = (): Reviewer | null => {
  const v = process.env.INTELLIGENCE_REVIEWER;
  return v === "gemma" || v === "claude" ? v : null;
};

export const RULES = ["invented_fact", "wrong_subject", "unused_citation", "no_duty", "unreadable"] as const;
export interface ReviewProblem { field: FieldName; rule: (typeof RULES)[number]; quote: string; reason: string; quoteFound: boolean }
/** One statement of fact in a field, as the reviewer labels it. The code, not the reviewer, turns labels into a verdict. */
export interface Claim { claim: string; about: string; source: string; source_says: string; faithful: boolean }
export type ReviewResult =
  | { ok: true; reviewer: Reviewer; model: string; pass: boolean; fields: Record<FieldName, { pass: boolean; claims: Claim[] }>; problems: ReviewProblem[] }
  | { ok: false; reviewer: Reviewer; error: string; pass: false };

const FIELDS: FieldName[] = ["why_now", "opening_script"];

export const REVIEW_SYSTEM = `You check call prep that another writer produced for a recruiter who is about to phone a hiring contact about one job posting. You did not write it. You never rewrite it. Your job is to label every statement of fact in it, carefully and literally.

You get:
- INPUTS: everything the writer was allowed to use. Each sentence of the job posting has an ID such as [D4]; each sentence from the company's own website has an ID such as [T2]. The lines under THE JOB POSTING (Role, Location, Shift, Pay, Posted) are facts too.
- CALL PREP: two fields, why_now and opening_script.

For each field, split the text into claims: each separate thing it states as fact. A sentence that says two things ("The role has been open 21 days and supervises 8 technicians") is two claims. Skip greetings, names in brackets, and a question that only asks whether they are still looking; but a question that states something ("are you still looking for someone to run the Hi-Pot testing?") states a claim (the role runs the Hi-Pot testing).

Label each claim:
- "claim": the claim's exact words from the field.
- "about": "role_duty" if it says what the person in this role does, handles or is responsible for; "role_other" if it is about the role but is not a duty (location, where it is based, shift, pay, how long it has been open, the title, who it reports to, what experience it needs); "company" if it is about the company, the plant or a site.
- "source": the ID of the one sentence the claim comes from, such as "D4"; "posting_line" if it comes only from the Role, Location, Shift, Pay or Posted lines; "none" if nothing in INPUTS says it.
- "source_says": what that source sentence is: "duty" (what the role does or is responsible for), "requirement" (experience, skills or qualifications the person needs), "perk" (what the job offers the employee: an opportunity, a benefit, a technology they get to work with, the culture), "company" (about the company, plant or site), "location_or_timing" (where or when), "other".
- "faithful": true only if the source says the same thing about the same subject. false if the claim adds anything the source does not say (a purpose, output, tool, place, timeline, number or judgment such as critical or key), moves it to another subject (the plant instead of the position, a perk or requirement turned into a duty), or mixes in words from another sentence.

Be literal. When you are unsure a claim is faithful, it is false.

Return JSON only, in exactly this shape:
{"why_now":{"claims":[{"claim":string,"about":"role_duty"|"role_other"|"company","source":string,"source_says":"duty"|"requirement"|"perk"|"company"|"location_or_timing"|"other","faithful":boolean}]},"opening_script":{"claims":[...]}}`;

export const reviewUser = (inputs: string, g: Generation) =>
  `INPUTS:\n${inputs}\n\nCALL PREP:\n${FIELDS.map((f) => `${f}: ${JSON.stringify(g[f].text)}`).join("\n")}`;

/**
 * The verdict, decided here from the reviewer's labels. A field fails on any claim that isn't faithful or has no source,
 * a duty taken from a sentence that isn't a duty (a perk, a requirement, company text), a cited sentence no claim comes
 * from, and, for why_now, no faithful duty at all. Unreadable output, or a field with no claims, is a fail.
 */
export function readVerdict(text: string, g: Generation): { fields: Record<FieldName, { pass: boolean; claims: Claim[] }>; problems: ReviewProblem[] } | null {
  let o: unknown;
  try {
    o = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const problems: ReviewProblem[] = [];
  const fields = {} as Record<FieldName, { pass: boolean; claims: Claim[] }>;
  for (const f of FIELDS) {
    const raw = (o as Record<string, { claims?: unknown }>)[f]?.claims;
    const claims = (Array.isArray(raw) ? raw : []).filter((c): c is Claim => typeof c?.claim === "string").map((c) => ({ ...c, source: String(c.source ?? "none").replace(/[[\]\s]/g, "") }));
    const text = (g[f].text ?? "").toLowerCase();
    const add = (rule: ReviewProblem["rule"], quote: string, reason: string) => problems.push({ field: f, rule, quote, reason, quoteFound: !!quote && text.includes(quote.toLowerCase()) });
    const before = problems.length;
    if (!claims.length) add("unreadable", "", "the reviewer listed no claims");
    for (const c of claims) {
      if (c.source === "none") add("invented_fact", c.claim, "no source in the inputs");
      else if (c.faithful !== true) add(c.about === "role_duty" && c.source_says !== "duty" ? "wrong_subject" : "invented_fact", c.claim, `not faithful to ${c.source} (${c.source_says})`);
      else if (c.about === "role_duty" && ["perk", "requirement", "company"].includes(c.source_says)) add("wrong_subject", c.claim, `a duty taken from a ${c.source_says} sentence (${c.source})`);
    }
    for (const id of g[f].sourceIds) if (!claims.some((c) => c.source === id)) add("unused_citation", id, `no claim comes from cited ${id}`);
    if (f === "why_now" && !claims.some((c) => c.about === "role_duty" && c.source_says === "duty" && c.faithful === true)) add("no_duty", "", "why_now states no duty of the role");
    fields[f] = { pass: problems.length === before, claims };
  }
  return { fields, problems };
}

async function reviewWithCourier(inputs: string, g: Generation, fetchFn: typeof fetch): Promise<ReviewResult> {
  // Output that isn't valid JSON is asked for once more, as generation does; a second one fails the review.
  for (let i = 0; i < 2; i++) {
    const res = await callCourier({ system: REVIEW_SYSTEM, user: reviewUser(inputs, g) }, fetchFn);
    if (!res.ok) return { ok: false, reviewer: "gemma", error: `courier: ${res.error}`, pass: false };
    const v = readVerdict(res.text, g);
    if (v) return { ok: true, reviewer: "gemma", model: res.model, pass: FIELDS.every((f) => v.fields[f].pass), ...v };
  }
  return { ok: false, reviewer: "gemma", error: "invalid JSON twice", pass: false };
}

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-opus-5-5";

async function reviewWithClaude(inputs: string, g: Generation, fetchFn: typeof fetch): Promise<ReviewResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reviewer: "claude", error: "ANTHROPIC_API_KEY is not set", pass: false };
  try {
    const res = await fetchFn(CLAUDE_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2000, system: REVIEW_SYSTEM, messages: [{ role: "user", content: reviewUser(inputs, g) }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { ok: false, reviewer: "claude", error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, pass: false };
    const body = (await res.json()) as { model?: string; content?: { type: string; text?: string }[] };
    const v = readVerdict(body.content?.find((c) => c.type === "text")?.text ?? "", g);
    return v ? { ok: true, reviewer: "claude", model: body.model ?? CLAUDE_MODEL, pass: FIELDS.every((f) => v.fields[f].pass), ...v } : { ok: false, reviewer: "claude", error: "unreadable review", pass: false };
  } catch (error) {
    return { ok: false, reviewer: "claude", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error), pass: false };
  }
}

/** One review of a generation that already passed the deterministic QA. A separate call; never throws. */
export const reviewGeneration = (reviewer: Reviewer, inputs: string, g: Generation, fetchFn: typeof fetch = fetch): Promise<ReviewResult> =>
  (reviewer === "gemma" ? reviewWithCourier : reviewWithClaude)(inputs, g, fetchFn);
