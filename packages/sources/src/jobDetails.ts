/**
 * Call-sheet facts parsed out of one posting: opening count, shift, posted pay. Pure — no I/O — so it can be run over
 * stored raw payloads to measure coverage. The rule everywhere: null unless the posting clearly says it. Nothing is
 * guessed from a title, a magnitude, or a bare "$".
 */
export interface JobDetails {
  openingCount: number | null;
  shift: string | null;
  payMin: number | null;
  payMax: number | null;
  payInterval: "hour" | "year" | null;
  payCurrency: string | null;
  /** The source's own free-text pay description, verbatim (Lever's salaryDescriptionPlain). Never parsed or edited. */
  payContext: string | null;
}

// ── text ────────────────────────────────────────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
};
const decodeEntities = (s: string) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    const code = dec ? Number(dec) : hex ? parseInt(hex, 16) : null;
    if (code !== null) return code <= 0x10ffff ? String.fromCodePoint(code) : m;
    return NAMED_ENTITIES[name.toLowerCase()] ?? m;
  });
/**
 * Full stops that don't end a sentence, as a lookbehind to put before a sentence-end pattern: the job description
 * dialog's abbreviations (etc., Inc., vs., e.g., i.e., U.S.; any case) and US state/DC codes ("Pineville, LA. plant").
 * The state codes are uppercase only, so "contact me." or "this or." still end a sentence.
 */
const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY";
export const NOT_A_SENTENCE_END = String.raw`(?<!\b(?:[Ee][Tt][Cc]|[Ii][Nn][Cc]|[Vv][Ss]|[Ee]\.[Gg]|[Ii]\.[Ee]|[Uu]\.[Ss]|${US_STATES.split(" ").join("|")})\.)`;

/** In `listItems` text: "•" starts a list item, LIST_END ends a list, so what follows a list is not its last item. */
export const LIST_END = "¶";

/**
 * Greenhouse's content is HTML-escaped HTML: decode, drop the tags, decode again (&amp;nbsp;). Lever's is plain or raw
 * HTML. `listItems` marks each <li> with a "•" and each list's end with LIST_END, so a list survives flattening.
 */
const htmlToText = (s: string, listItems = false) => {
  const html = decodeEntities(s);
  const marked = listItems ? html.replace(/<li\b[^>]*>/gi, " • ").replace(/<\/(?:ul|ol)>/gi, ` ${LIST_END} `) : html;
  return decodeEntities(marked.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
};

interface LeverRaw {
  createdAt?: number;
  descriptionPlain?: string; openingPlain?: string; additionalPlain?: string; salaryDescriptionPlain?: string;
  lists?: { text?: string; content?: string }[];
  salaryRange?: { min?: unknown; max?: unknown; currency?: unknown; interval?: unknown } | null;
}
interface GreenhouseRaw {
  first_published?: string | null;
  content?: string;
  metadata?: { value_type?: string; value?: unknown }[] | null;
}

/**
 * When the source says the posting was first published, from the untouched payload: Greenhouse's first_published (never
 * its updated_at, which moves on every edit), Lever's createdAt (Lever exposes no separate publish date). Null if absent.
 */
export function firstPublishedDate(source: string, raw: unknown): string | null {
  if (source === "greenhouse") return (raw as GreenhouseRaw).first_published ?? null;
  if (source === "lever") {
    const at = (raw as LeverRaw).createdAt;
    return typeof at === "number" ? new Date(at).toISOString() : null;
  }
  return null;
}

/**
 * Which company a posting is really for. Crest Industries posts for its operating subsidiaries on one Lever board, so
 * for Crest it is the posting's Lever department ("DIS-TRAN Steel", "Millennium Galvanizing"...), never a text mention:
 * a galvanizer's posting says it works "with DIS-TRAN Steel". Only with no department, the opening sentence, and only
 * when it names the employer ("DIS-TRAN Steel, located in...", "... is looking for", "Come join our team at ..."),
 * not a partner. Any other board's company is its own employer.
 * A department that isn't a company ("Transfer Portal (Current Employees Only)", "All Companies") is returned as is,
 * so it matches no archetype and a lead on it fails attribution rather than being guessed.
 */
export function operatingEmployer(companyName: string, raw: unknown): string | null {
  if (companyName !== "Crest Industries") return companyName;
  const r = raw as { categories?: { department?: string }; descriptionPlain?: string };
  const department = r.categories?.department?.trim();
  if (department) return department;
  const opening = (r.descriptionPlain ?? "").trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  const m = opening.match(/^(?:come join our team at\s+)?([A-Z][\w&.' -]*?)(?:,\s+located in\b|\s+is (?:looking|seeking|hiring)\b|\s+has an opening\b|!)/i);
  return m?.[1]?.trim() || null;
}

/** `listItems`: keep list items apart ("•"), for callers that split the text into sentences. Off for extraction. */
export function postingText(source: string, raw: unknown, listItems = false): string {
  if (source === "greenhouse") return htmlToText((raw as GreenhouseRaw).content ?? "", listItems);
  const r = raw as LeverRaw;
  return htmlToText(
    // Lever's list content is bare <li>s with no <ul>, so its end is marked here.
    [r.descriptionPlain, r.openingPlain, ...(r.lists ?? []).flatMap((l) => [l.text, listItems && l.content ? `${l.content}</ul>` : l.content]), r.additionalPlain, r.salaryDescriptionPlain]
      .filter(Boolean)
      .join(" "),
    listItems,
  );
}

// ── pay ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Nothing pays under this per hour, so a "range" below it is a placeholder or a typo (real Greenhouse data has "$3–6"), not a wage. */
const MIN_PLAUSIBLE_MAX = 7;

type Pay = Pick<JobDetails, "payMin" | "payMax" | "payInterval" | "payCurrency">;
const NO_PAY: Pay = { payMin: null, payMax: null, payInterval: null, payCurrency: null };

const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)\s*([kK])?`;
const RANGE = new RegExp(String.raw`\$\s?${NUM}\s*(?:-|–|—|to)\s*(?:\$\s?)?${NUM}(?<tail>[^$]{0,40})`, "g");
const PERIOD = /per\s+(?:hour|year|annum)|\/\s*(?:hr|hour|yr|year)|\bhr\.|\b(?:hourly|annually|annual|yearly|an\s+hour|a\s+year)\b/i; // bare "HR" is not "hour"
const PERIOD_MAX_DISTANCE = 25; // the period word must sit right after the amount, not in the next sentence
const LABEL = /(?:salary|compensation|comp|pay|wage)(?:\s+range)?\W{0,4}$|(?:pay rate|hourly rate|base (?:pay|salary))\W{0,4}$/i;
/** Wording that means the figure is earnings potential, not posted pay: it must never be read as the posted range. */
const EARNINGS_TALK = /commission|\bOTE\b|on-target|\bearn(?:s|ing|ings)?\b|potential|bonus|profit|incentive|top performers/i;
const RANGE_LABEL = /\b(?:salary|compensation|comp|pay)\s+range\b/gi;
const CURRENCY = /\b(USD|CAD|EUR|GBP|AUD)\b/;

const toNumber = (digits: string, k?: string) => Number(digits.replace(/,/g, "")) * (k ? 1000 : 1);
const intervalOf = (period: string): "hour" | "year" => (/hour|hr/i.test(period) ? "hour" : "year");

interface TextRange { min: number; max: number; interval: "hour" | "year" | null; currency: string | null; labelled: boolean; earningsTalk: boolean }
function textRanges(text: string): TextRange[] {
  const out: TextRange[] = [];
  for (const m of text.matchAll(RANGE)) {
    const min = toNumber(m[1], m[2]);
    const max = toNumber(m[3], m[4]);
    const tail = m.groups!.tail;
    const period = tail.match(PERIOD);
    const start = m.index!;
    out.push({
      min,
      max,
      interval: period && period.index! <= PERIOD_MAX_DISTANCE ? intervalOf(period[0]) : null,
      currency: tail.match(CURRENCY)?.[1] ?? null,
      labelled: LABEL.test(text.slice(Math.max(0, start - 40), start)),
      earningsTalk: EARNINGS_TALK.test(text.slice(Math.max(0, start - 80), start + m[0].length + 80)),
    });
  }
  return out;
}

const validRange = (min: number, max: number) => Number.isFinite(min) && Number.isFinite(max) && min > 0 && min <= max && max >= MIN_PLAUSIBLE_MAX;
const isoCode = (v: unknown) => (typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : null);

const LEVER_INTERVALS: Record<string, "hour" | "year"> = { "per-hour-wage": "hour", "per-year-salary": "year" };

function structuredPay(source: string, raw: unknown, text: string): Pay {
  if (source === "lever") {
    const sr = (raw as LeverRaw).salaryRange;
    const interval = typeof sr?.interval === "string" ? LEVER_INTERVALS[sr.interval] : undefined;
    // An interval we don't recognise (per-month, ...) makes the numbers unusable rather than assumed.
    if (typeof sr?.min === "number" && typeof sr.max === "number" && interval && validRange(sr.min, sr.max)) {
      return { payMin: sr.min, payMax: sr.max, payInterval: interval, payCurrency: isoCode(sr.currency) };
    }
    return NO_PAY;
  }
  // Greenhouse: a custom "currency_range" metadata field. Boards leave it at 0–0 when unset, which is not a range.
  for (const m of (raw as GreenhouseRaw).metadata ?? []) {
    if (m.value_type !== "currency_range" || !m.value || typeof m.value !== "object") continue;
    const v = m.value as { min_value?: unknown; max_value?: unknown; unit?: unknown };
    const min = Number(v.min_value);
    const max = Number(v.max_value);
    if (!validRange(min, max)) continue;
    // The structured range has a currency but no interval: take it from the text only when the text states this same range.
    const same = textRanges(text).find((r) => Math.abs(r.min - min) < 1 && Math.abs(r.max - max) < 1 && r.interval);
    return { payMin: min, payMax: max, payInterval: same?.interval ?? null, payCurrency: isoCode(v.unit) };
  }
  return NO_PAY;
}

/** Text fallback: one explicit, labelled-or-period range with no earnings talk around it. Several different ones = ambiguous = none. */
function textPay(text: string): Pay {
  const found = textRanges(text).filter((r) => (r.interval || r.labelled) && !r.earningsTalk && validRange(r.min, r.max));
  // A posting can carry one labelled range per location ("[Surrey Compensation Range: CAD 34.62/hr - 56.25/hr] [Jacksonville
  // Compensation Range: $85,000 - 125,000]"), and one may be written in a form we don't parse. If there are more labelled
  // ranges than parsed ones, one is unaccounted for, so we can't say which is the posted pay.
  if ((text.match(RANGE_LABEL) ?? []).length > found.length) return NO_PAY;
  const distinct = new Map(found.map((r) => [`${r.min}|${r.max}|${r.interval}`, r]));
  if (distinct.size !== 1) return NO_PAY;
  const [r] = distinct.values();
  return { payMin: r.min, payMax: r.max, payInterval: r.interval, payCurrency: r.currency };
}

// ── opening count ───────────────────────────────────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// "3 openings", "two vacancies", "2 open positions", "4 positions available". A bare "N positions" is not enough
// ("$120,000 Position Summary" must never read as a count), and the number must not sit inside another number or an amount.
const OPENINGS = /(?<![\d,.$])\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:immediate|new|full[- ]time)\s+)?(?:openings?|vacanc(?:y|ies)|open\s+positions?|positions?\s+(?:available|open))\b/gi;

function openingCount(text: string): number | null {
  const counts = new Set([...text.matchAll(OPENINGS)].map((m) => NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1])).filter((n) => n >= 1));
  return counts.size === 1 ? [...counts][0] : null;
}

// ── shift ───────────────────────────────────────────────────────────────────────────────────────────────────

const KIND = String.raw`(?:1st|2nd|3rd|first|second|third|day|night|evening|overnight|weekend|swing|rotating)`;
// "second shift", and lists like "day, night and weekend shifts" (every kind in the list is captured).
const SHIFT_PHRASE = new RegExp(String.raw`\b(?:${KIND}\s*(?:,|/|&|and|or)?\s*)+shifts?\b`, "gi");
const KIND_WORD = new RegExp(String.raw`\b${KIND}\b`, "gi");
const CANONICAL: Record<string, string> = { "1st": "first", "2nd": "second", "3rd": "third" };
const canonical = (k: string) => CANONICAL[k.toLowerCase()] ?? k.toLowerCase();

const kindsIn = (text: string) => new Set([...text.matchAll(SHIFT_PHRASE)].flatMap((m) => [...m[0].matchAll(KIND_WORD)].map((k) => canonical(k[0]))));

/**
 * The title is the posting's own label for the opening, so it wins: "- Night Shift", "(Second Shift)", or a trailing
 * "- Nights". Only when the title names none does the body count, and only if it names exactly one shift; a body that
 * lists several shifts (or a title naming two) is not one opening's shift, so it stays null.
 */
function shift(title: string, body: string): string | null {
  const fromTitle = kindsIn(title);
  const trailing = title.match(/[-–(]\s*(nights?|overnights?|weekends?)\s*\)?\s*$/i);
  if (trailing) fromTitle.add(canonical(trailing[1].replace(/s$/i, "")));
  if (fromTitle.size) return fromTitle.size === 1 ? [...fromTitle][0] : null;
  const fromBody = kindsIn(body);
  return fromBody.size === 1 ? [...fromBody][0] : null;
}

/** Lever only; Greenhouse has no such field. Kept exactly as written: no trimming, no parsing, no reconciling with the structured range. */
function payContext(source: string, raw: unknown): string | null {
  const v = source === "lever" ? (raw as LeverRaw).salaryDescriptionPlain : undefined;
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

// ── entry point ─────────────────────────────────────────────────────────────────────────────────────────────

/** `raw` is the source's untouched posting (RawPosting.rawPayload). Structured fields win over anything in the text. */
export function extractJobDetails(source: string, title: string, raw: unknown): JobDetails {
  const text = postingText(source, raw);
  const structured = structuredPay(source, raw, text);
  return {
    openingCount: openingCount(`${title} ${text}`),
    shift: shift(title, text),
    ...(structured.payMin !== null ? structured : textPay(text)),
    payContext: payContext(source, raw),
  };
}
