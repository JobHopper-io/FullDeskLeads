/**
 * The mandatory QA pass on a generation, deterministic by design: a second call to the same small model would share
 * its blind spots. A field fails if anything in it can't be traced to the inputs actually sent. A lead whose
 * generation has any failing field is never written anywhere live.
 */

/** `sourceIds` are what the model cited; `sources` is the code's copy of those sentences from the inputs, never the model's. */
export interface Generation {
  why_now: { text: string | null; sourceIds: string[]; sources: string[] };
  opening_script: { text: string | null; sourceIds: string[]; sources: string[] };
}
export type FieldName = keyof Generation;
export interface FieldCheck { status: "pass" | "fail" | "null"; problems: string[] }
export interface Verification { pass: boolean; fields: Record<FieldName, FieldCheck> }

// Equipment and process vocabulary. Any of these in the output must also be in this lead's inputs, which catches
// equipment borrowed from the other archetype or from the model's own knowledge.
// ponytail: fixed lexicon, so a term outside it isn't checked this way (the citation and proper-noun checks still apply);
// grow it from real false negatives.
const DOMAIN_TERMS = [
  "laser", "shear", "turret", "punch", "press brake", "brake press", "bus bar", "busbar", "copper", "powder coat", "paint line",
  "weld*", "submerged", "cnc", "plc", "robot*", "crane", "hoist", "forklift", "hydraulic", "pneumatic", "conveyor",
  "galvaniz*", "zinc", "kettle", "plasma", "band saw", "saw line", "drill line", "lathe", "milling", "machining", "stamping",
  "casting", "forging", "extrusion", "molding", "boiler", "compressor", "chiller", "hvac", "switchgear", "breaker",
  "transformer", "panelboard", "vacuum", "kv", "voltage", "substation", "transmission", "tower", "pole", "lattice",
  "tubular", "harness", "wiring", "cad", "cam", "detailer", "fabricat*", "assembl*",
];
// Whole words (with plural/verb endings); a trailing * marks a stem. Common verbs ("saw", "drill") are only matched as
// equipment phrases, so "I saw your posting" isn't flagged.
const termRx = (t: string) =>
  t.endsWith("*") ? new RegExp(`\\b${t.slice(0, -1)}`) : new RegExp(`\\b${t}(?:s|es|ed|ing|ers?)?\\b`);
const PAY = /\$|\bpay\b|\bpaid\b|salary|wage|compensation|per hour|\/hr\b|\bhourly\b|\d\s?k\b/i;
// Growth or trend claims ("as you scale up") are only allowed when the inputs make the same claim in the same words.
const GROWTH = /\b(?:scal(?:e|es|ed|ing) up|grow(?:s|ing|th)?|expand(?:s|ed|ing)?|expansion|ramp(?:s|ed|ing)? up|booming|accelerat(?:e|es|ed|ing))\b/gi;
const PLACEHOLDER = /\[[^\]]{1,24}\]/g; // [first name], [your name]: slots for the caller, not claims
const PLACEHOLDERS_OK = new Set(["[first name]", "[your name]"]);
const OK_CAPS = new Set(["I", "I'm", "I'd", "I'll", "I've", "OK"]);

const norm = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
const numbers = (s: string) => new Set((s.replace(/(\d),(?=\d)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))));

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const monthsIn = (s: string) => [...s.matchAll(/\b\d{4}-(\d{2})-\d{2}\b/g)].flatMap((m) => {
  const name = MONTHS[Number(m[1]) - 1];
  return name ? [name, name.slice(0, 3)] : [];
});

/** Capitalised words that don't open a sentence, and acronyms: names of things, which must come from the inputs. */
function properNouns(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Z][A-Za-z0-9&'-]*/g)) {
    const before = text.slice(0, m.index).replace(/["'“‘(\s]+$/, "");
    const sentenceStart = before === "" || /[.?!:]$/.test(before);
    const acronym = /^[A-Z0-9&-]{2,}$/.test(m[0]);
    if ((!sentenceStart || acronym) && !OK_CAPS.has(m[0])) out.push(m[0]);
  }
  return out;
}

interface Ctx { inputs: string; src: string; srcWords: Set<string>; srcNums: Set<string>; hasPay: boolean; sentences: Record<string, string>; placeStems: Set<string> }

/**
 * The lead's own place words: the structured location ("San Antonio, Texas, United States") and any temporary site the
 * posting names ("based temporarily in NE San Antonio"). They say where, not what, so sharing them with a sentence
 * doesn't show the text uses it: "San Antonio" alone must not count as two shared words.
 */
function placeStems(inputs: string): Set<string> {
  const location = inputs.match(/^- Location: (.*)$/m)?.[1] ?? "";
  const sites = [...inputs.matchAll(/\b(?:based temporarily|temporarily based|temporarily located) (?:in|at) (.+?)(?= while\b|[,.;]|$)/gim)].map((m) => m[1]);
  return stems([location, ...sites].join(" "));
}

/**
 * The archetype's name is a label, not a fact: only its equipment and "deal with" text, the company text and the posting
 * ground anything. Sentence ID tags ("[D12]") aren't text either: their digits must never ground a number.
 */
const groundingText = (inputs: string) =>
  inputs.split("\n").filter((l) => !l.startsWith("PLANT ARCHETYPE:")).join("\n").replace(/\[[TD]\d+\] /g, "");

function context(allInputs: string, hasPay: boolean, sentences: Record<string, string>): Ctx {
  const inputs = groundingText(allInputs);
  const src = norm(inputs);
  return {
    inputs, src, hasPay, sentences, srcNums: numbers(inputs), placeStems: placeStems(allInputs),
    // Words both whole ("dis-tran") and split at dashes ("field service -lead" has "lead"), plus the month names of the
    // dates actually in the inputs, so "open since May 14, 2026" traces to "2026-05-14" without allowing any other month.
    srcWords: new Set([...src.split(/[^a-z0-9&'-]+/), ...src.split(/[^a-z0-9&']+/), ...monthsIn(inputs)]),
  };
}

/** Everything a piece of text states must be traceable to the inputs: numbers, names, pay, equipment. Plus the voice rule. */
function factProblems(raw: string, c: Ctx): string[] {
  const text = raw.replace(PLACEHOLDER, "");
  const problems: string[] = [];
  for (const n of numbers(text)) if (!c.srcNums.has(n)) problems.push(`number not in the inputs: ${n}`);
  if (!c.hasPay && PAY.test(text)) problems.push(`mentions pay, but the posting states none: "${text.match(PAY)![0]}"`);
  for (const w of properNouns(text)) if (!c.srcWords.has(norm(w))) problems.push(`name/term not in the inputs: "${w}"`);
  const lower = norm(text);
  for (const t of DOMAIN_TERMS) if (termRx(t).test(lower) && !termRx(t).test(c.src)) problems.push(`equipment/process term not in this lead's inputs: "${t}"`);
  for (const m of lower.matchAll(GROWTH)) if (!new RegExp(`\\b${m[0]}\\b`).test(c.src)) problems.push(`growth/trend claim not in the inputs: "${m[0]}"`);
  // A digit-to-digit range copied from the inputs ("2–6 active customer sites") may keep its dash; no other dash may.
  const dashed = raw.replace(/\d+(?:\.\d+)?\s?[—–]\s?\d+(?:\.\d+)?/g, (r) => (c.src.includes(norm(r)) ? "" : r));
  if (/[—–]/.test(dashed)) problems.push("contains an em/en dash (voice rule)");
  for (const p of raw.match(PLACEHOLDER) ?? []) if (!PLACEHOLDERS_OK.has(p)) problems.push(`placeholder other than [first name]/[your name]: "${p}"`);
  return problems;
}

// Words that carry no fact, so sharing only these with a cited sentence doesn't show the text uses it.
const STOP = new Set(("the and for with that this your you are was were have has had from into they them their there about " +
  "can not but any all one our out who how why its let get see say ask way yes may now new use per via did got " +
  "what which when where while will would could should just been being does doing more most some such than then very also " +
  "role position opening posting team help check looking still wanted want know sure understand makes sense time right " +
  "call calling back later reach touch email work working company plant people person someone involve involves").split(" "));
const stems = (s: string) =>
  new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.slice(0, 6)));

/** Content words a field must share with a sentence it cites: two, or all of them when the sentence has fewer than four. */
const MIN_SHARED = 2;
const SHORT_SENTENCE = 4;

/**
 * Sources are sentence IDs, filled in by code, so a quote can't be wrong; what can be wrong is an ID that doesn't
 * exist, or one the text doesn't use: each cited sentence must share enough content words with the field.
 * ponytail: word overlap, so it catches padding and one-word coincidences ("customer"), not a loose paraphrase.
 */
function sourceProblems(ids: string[], raw: string, c: Ctx): string[] {
  if (!ids.length) return ["no source cited for a non-null field"];
  const used = stems(raw);
  return ids.flatMap((id) => {
    if (!(id in c.sentences)) return [`source ID not in the inputs: "${id}"`];
    const words = [...stems(c.sentences[id])].filter((w) => !c.placeStems.has(w));
    const shared = words.filter((w) => used.has(w));
    const need = words.length < SHORT_SENTENCE ? words.length : MIN_SHARED;
    return shared.length >= need ? [] : [`cited sentence shares ${shared.length} of ${need} required content words with the text: [${id}] "${c.sentences[id]}"`];
  });
}

function checkField(g: Generation, f: FieldName, c: Ctx): FieldCheck {
  const raw = g[f].text;
  if (raw === null || raw.trim() === "") return { status: "null", problems: [] };
  const problems = [...sourceProblems(g[f].sourceIds ?? [], raw, c), ...factProblems(raw, c)];
  // Shape: the spec's structure and the ask-don't-tell voice.
  if (f === "why_now") {
    const sentences = raw.split(/(?<=[.?!])\s+/).filter(Boolean).length;
    if (sentences < 2 || sentences > 3) problems.push(`why_now has ${sentences} sentences, expected 2-3`);
  }
  if (f === "opening_script" && !raw.includes("?")) problems.push("opening_script asks nothing (ask it, don't state it)");
  return { status: problems.length ? "fail" : "pass", problems };
}

export function verifyGeneration(g: Generation, inputs: string, hasPay: boolean, sentences: Record<string, string>): Verification {
  const c = context(inputs, hasPay, sentences);
  const fields = {
    why_now: checkField(g, "why_now", c),
    opening_script: checkField(g, "opening_script", c),
  };
  return { pass: Object.values(fields).every((f) => f.status !== "fail"), fields };
}
