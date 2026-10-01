import type { HiringSignalRow } from "@fdl/db";
import { NOT_A_SENTENCE_END } from "@fdl/sources";
import { callCourier } from "./courier.js";
import { callOpenRouter } from "./openrouter.js";
import { fixedObjections, type FixedObjection } from "./objections.js";
import { fixedQuestions } from "./questions.js";
import { ARCHETYPES, COMPANY_SOURCES, archetypeForEmployer } from "./sources.js";
import { verifyGeneration, type Generation, type Verification } from "./verify.js";

export type SourceKey = keyof typeof COMPANY_SOURCES;

export interface GenerationResult {
  hiringSignalId: string;
  roleTitle: string;
  source: SourceKey;
  /** The exact text the model saw, and the only text the QA pass accepts as grounding. */
  inputs: string;
  /** Sentence ID -> exact sentence, as numbered in `inputs`. The model cites IDs; the code fills in the text. */
  sentences: Record<string, string>;
  ok: boolean;
  error: string | null;
  attempts: number;
  latencyMs: number;
  generation: Generation | null;
  verification: Verification | null;
  /** Static, never generated: the spec's fixed objection set for this lead's archetype (objections.ts). */
  objections: { static: true; pairs: FixedObjection[] };
  /** Static, never generated: the spec's four discovery questions (questions.ts). */
  discoveryQuestions: { static: true; questions: string[] };
  /** Not generated: left as the app's existing placeholder ("isn't generated yet"). */
  roleIntelligence: null;
  /** The posting's operating employer (sources.ts operatingEmployer) and whether it calls for this source's archetype. */
  attribution: { employer: string | null; archetype: string; ok: boolean };
  /** Output that wasn't valid JSON, kept for diagnosis: one entry per invalid attempt (a retried lead has one). */
  invalidOutputs?: string[];
}

const PER = { hour: "per hour", year: "per year" } as const;

function daysOpen(postedDate: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(`${postedDate}T00:00:00Z`)) / 864e5));
}

// Sentences the call never needs: how to apply (and referral/scam/privacy/AI-screening notices), equal-opportunity
// boilerplate, benefits, any pay wording (pay reaches the model only through the structured Pay line), and recruiting
// marketing, which says nothing about the role.
// ponytail: sentence-level keyword cut tuned on Lever (Crest) and Greenhouse (IEM) templates; a new board's boilerplate
// may need its own words here.
const NOT_FOR_THE_CALL = [
  /\bappl(?:y|ying to|icant|icants|ication|ications)\b|\breferral|recruit(?:ing|er) (?:scam|email)|\bcareers\b|privacy|hiring process|artificial intelligence|fraudulent/i,
  /equal (?:opportunity|employment)|affirmative action|discriminat|without regard to|reasonable accommodation|protected veterans|\bCFR\b/i,
  /\bbenefits?\b|\bpto\b|401\s?\(?k|insurance|paid time off/i,
  /\$|\bpay\b|salary|salaries|\bwages?\b|compensation|\bbonus|incentive|\bcommissions?\b/i,
  /come join|biggest assets|company values|likes to have fun|get stuff done|why join|shaping the future|world-class|push the boundaries|just starting out|ambitious projects|problem-solvers who thrive|love to hear from you|creativity and passion|future is bright|next phase of growth|learn more about/i,
];
/**
 * The posting description's sentences, with those removed. Flattened HTML has no paragraphs, so the unit is the
 * sentence, plus a split before the boards' boilerplate headings, which often follow real content with no full stop.
 */
const SENTENCES = new RegExp(
  String.raw`${NOT_A_SENTENCE_END}(?<=[.!?\]])\s+|\s*[•¶]\s*|\s+(?=(?:Compensation|Learn more|Why Join|Recruiting Scams|Non-Discrimination Statement|Privacy|Use of AI|Referral Level|Equal Opportunity Employer)\b)`,
);
export function callSentences(description: string): string[] {
  return description
    .split(SENTENCES)
    .map((s) => s.trim())
    .filter((s) => s && !NOT_FOR_THE_CALL.some((rx) => rx.test(s)));
}
export const stripForCall = (description: string) => callSentences(description).join(" ");

/**
 * The posted title with any en or em dash made a space ("Field Service –Lead" -> "Field Service Lead"): the dash rule on
 * generated text is absolute, so the title the model copies and the checks compare against must not carry one.
 */
export const titleForCall = (roleTitle: string) => roleTitle.replace(/[–—]/g, " ").replace(/\s+/g, " ").trim();

/** The archetype's equipment and building lines describe what a maintenance tech contends with; only those roles get them. */
const isMaintenance = (roleTitle: string) => /maintenance/i.test(roleTitle);

/**
 * Everything the model may use, rendered once as plain text. Nothing else is sent. Every sentence of the plant text
 * ([T1]...) and the posting description ([D1]...) carries an ID the model cites instead of quoting. A role that isn't
 * maintenance gets the role-neutral company facts and the posting only.
 */
export function buildInputs(signal: HiringSignalRow, key: SourceKey, description: string | null, now = new Date()): { text: string; sentences: Record<string, string> } {
  const src = COMPANY_SOURCES[key];
  const arch = ARCHETYPES[src.archetype];
  const pay =
    signal.pay_min !== null && signal.pay_max !== null
      ? `${Number(signal.pay_min)} to ${Number(signal.pay_max)}${signal.pay_currency ? ` ${signal.pay_currency}` : ""}${signal.pay_interval ? ` ${PER[signal.pay_interval]}` : ""}`
      : null;
  const sentences: Record<string, string> = {};
  const id = (prefix: "T" | "D", sentence: string) => {
    const n = `${prefix}${Object.keys(sentences).filter((k) => k.startsWith(prefix)).length + 1}`;
    sentences[n] = sentence;
    return `[${n}] ${sentence}`;
  };
  const desc = description ? callSentences(description) : [];
  const text = [
    `COMPANY: ${src.company}${src.parent ? ` (a ${src.parent} company)` : ""}`,
    ...(isMaintenance(signal.role_title)
      ? [
          `PLANT ARCHETYPE: ${arch.name}`,
          `WHAT PEOPLE ON THIS KIND OF PLANT FLOOR DEAL WITH: ${id("T", arch.contendsWith)}`,
          `TYPICAL EQUIPMENT: ${id("T", arch.equipment.join("; "))}`,
        ]
      : []),
    "COMPANY FACTS (from the company's own website):",
    ...src.facts.map((f) => `- ${id("T", f)}`),
    "THE JOB POSTING:",
    `- Role: ${titleForCall(signal.role_title)}`,
    `- Location: ${signal.location ?? "not stated"}`,
    `- Shift: ${signal.shift ?? "not stated"}`,
    `- Pay: ${pay ?? "not stated in the posting"}`,
    signal.posted_date ? `- Posted: ${signal.posted_date} (open ${daysOpen(signal.posted_date, now)} days)` : "- Posted: not stated",
    // The posting's own free text, as captured at ingest (postingText), minus what the call never needs.
    "POSTING DESCRIPTION (the job posting's own text):",
    ...(desc.length ? desc.map((d) => id("D", d)) : ["not available"]),
  ].join("\n");
  return { text, sentences };
}

const SYSTEM = `You write call prep for a recruiter phoning a hiring contact about one job posting.

Use ONLY the facts in INPUTS. Do not use anything you know about this company, its industry, its location or the job market from outside INPUTS. Never state a number, date, name, piece of equipment or company detail that is not in INPUTS. If the posting's pay is "not stated", never mention pay, salary, wages or compensation. If a field cannot be written specifically from INPUTS, return null for it: generic filler is worse than nothing.

Restate posting facts as the posting states them, keeping who or what each fact is about: never turn a fact about the position into a fact about the plant, and never infer moves, transitions or timelines the posting does not state. A sentence about a location or a timeline must keep the subject the posting gives it: if the posting says the position is temporarily based somewhere while the new plant comes online, say the position is temporarily based there, never that the role supports the plant. Describe what the role does in the posting's own terms and never add a purpose, product or output it does not state (if the posting says the role operates CNC machinery and measures finished steel structures, do not say it produces steel structures). Never characterize the role, the search or the company with judgments the posting does not make (for example critical, key, urgent, important, tough, hard to fill).

Voice: a confident peer. Never lecture, never oversell. Ask it, don't state it: they have run this plant for years, and you are checking your understanding, not telling them their business. So anything about the plant, its equipment or the role is phrased as a question for them to confirm. A plant or company fact (WHAT PEOPLE ON THIS KIND OF PLANT FLOOR DEAL WITH, TYPICAL EQUIPMENT and COMPANY FACTS, whichever are present) may only be asked about, never stated, never presented as coming from the posting, and never blended into a posting fact: if the posting says "hoists or cranes", do not make them "overhead cranes"; if the posting names no plant buildings, do not put the role "across the different plant buildings". Never use em dashes or en dashes; write number ranges as "2 to 6". Use [first name] for the contact and [your name] for the caller, and no other placeholder.

Fields:
- why_now: 2 to 3 sentences on why this call is timely, using only the posting's own details (its description, role, location, shift, how long it has been open, pay only if stated).
- opening_script: what the caller says first, 2 to 3 sentences, ending with a question.

why_now and opening_script must each use at least one specific fact from the POSTING DESCRIPTION or the plant text (WHAT PEOPLE ON THIS KIND OF PLANT FLOOR DEAL WITH, TYPICAL EQUIPMENT and COMPANY FACTS, whichever are present). Neither may give the job title as the reason for calling: "I saw your opening for a CNC Machinist, are you still looking?" is not a reason; what that machinist would actually do there is.

Every sentence of the plant text and the POSTING DESCRIPTION starts with an ID in brackets, such as [T1] or [D4]. For why_now and opening_script, "sources" lists the IDs (1 to 4, for example ["D4", "T1"]) of the sentences the field actually uses, and no others. Never cite a sentence only for where the job is: a citation must support a duty or a stated fact the field uses, not the location. Return IDs only, never quoted text.

Return JSON only, in exactly this shape:
{"why_now":{"text":string|null,"sources":[id]},"opening_script":{"text":string|null,"sources":[id]}}`;

function parse(text: string): Generation | null {
  const json = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let g: unknown;
  try {
    g = JSON.parse(json);
  } catch {
    return null;
  }
  const o = g as Record<string, { text?: unknown; sources?: unknown }>;
  const strOrNull = (v: unknown) => (typeof v === "string" ? v : null);
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const ids = (v: unknown) => strs(v).map((id) => id.replace(/[[\]\s]/g, "")); // "[D4]" and "D4" are the same ID
  if (!o || typeof o !== "object" || !o.why_now || !o.opening_script) return null;
  return {
    why_now: { text: strOrNull(o.why_now.text), sourceIds: ids(o.why_now.sources), sources: [] },
    opening_script: { text: strOrNull(o.opening_script.text), sourceIds: ids(o.opening_script.sources), sources: [] },
  };
}

/** The code, never the model, writes each source's text: the exact sentence its ID names in the inputs. */
function fillSources(g: Generation, sentences: Record<string, string>): Generation {
  const fill = <F extends { sourceIds: string[] }>(f: F) => ({ ...f, sources: f.sourceIds.flatMap((id) => sentences[id] ?? []) });
  return { why_now: fill(g.why_now), opening_script: fill(g.opening_script) };
}

/** Output that isn't valid JSON is asked for once more with the same inputs; only a second invalid output fails the lead. */
const FORMAT_ATTEMPTS = 2;

/**
 * Generate and verify one lead's intelligence. Never throws: an unreachable Courier, a timeout or unparseable output
 * comes back as ok: false for this lead only. Writes nothing; the caller decides what to do with a passing result.
 */
export async function generateIntelligence(
  signal: HiringSignalRow,
  key: SourceKey,
  description: string | null,
  employer: string | null,
  fetchFn: typeof fetch = fetch,
): Promise<GenerationResult> {
  const { text: inputs, sentences } = buildInputs(signal, key, description);
  const archetype = COMPANY_SOURCES[key].archetype;
  const attribution = { employer, archetype, ok: archetypeForEmployer(employer) === archetype };
  const base = {
    hiringSignalId: signal.id, roleTitle: signal.role_title.trim(), source: key, inputs, sentences, generation: null, verification: null,
    objections: { static: true as const, pairs: fixedObjections(COMPANY_SOURCES[key].archetype, signal.role_title) },
    discoveryQuestions: { static: true as const, questions: fixedQuestions(signal.opening_count) },
    roleIntelligence: null,
    attribution,
  };
  const started = Date.now();
  // A posting for another employer must never get this company's facts and archetype: fail it before any model call.
  if (!attribution.ok) return { ...base, ok: false, error: `attribution: employer "${employer}" calls for ${archetypeForEmployer(employer) ?? "no documented archetype"}, not ${archetype}`, attempts: 0, latencyMs: 0 };
  const invalidOutputs: string[] = [];
  let attempts = 0;
  try {
    for (let i = 0; i < FORMAT_ATTEMPTS; i++) {
      // GENERATION_BACKEND=openrouter swaps Courier for a hosted model (openrouter.ts); the prompt and QA are the same.
      const call = process.env.GENERATION_BACKEND === "openrouter" ? callOpenRouter : callCourier;
      const res = await call({ system: SYSTEM, user: `INPUTS:\n${inputs}` }, fetchFn);
      attempts += res.attempts;
      if (!res.ok) return { ...base, ok: false, error: `courier: ${res.error}`, attempts, latencyMs: Date.now() - started, ...(invalidOutputs.length && { invalidOutputs }) };
      const parsed = parse(res.text);
      if (!parsed) { invalidOutputs.push(res.text); continue; }
      const generation = fillSources(parsed, sentences);
      const hasPay = signal.pay_min !== null && signal.pay_max !== null;
      return { ...base, ok: true, error: null, attempts, latencyMs: Date.now() - started, generation, verification: verifyGeneration(generation, inputs, hasPay, sentences), ...(invalidOutputs.length && { invalidOutputs }) };
    }
    return { ...base, ok: false, error: `invalid JSON twice (format failure)`, attempts, latencyMs: Date.now() - started, invalidOutputs };
  } catch (error) {
    return { ...base, ok: false, error: `unexpected: ${error instanceof Error ? error.message : String(error)}`, attempts, latencyMs: Date.now() - started };
  }
}
