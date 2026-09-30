/**
 * The plant layer is fixed copy, never generated, like objections.ts and questions.ts: the process descriptor, the
 * why-hard line, the show-your-work questions, the light close and the "I'm busy" / "Who is this?" replies. The gap is
 * the one computed field: the spec defines it per posting (what the posting names versus what the plant runs), so it is
 * a keyword comparison of the posting with the archetype's items, never a sentence written once for every lead.
 *
 * Where the spec prints the words (Figures 8.1, 9.1, 9.2, v1.0 24 Sep 2026) they are copied verbatim, dashes included.
 * Where it only shows the shape with a foundry example, the SWITCHGEAR_ASSEMBLY copy below is hand-written from the
 * archetype's own line (sources.ts) and needs Schepmont's review like the objection responses had.
 */
import type { ARCHETYPES } from "./sources.js";

type Archetype = keyof typeof ARCHETYPES;

/**
 * The process descriptor: one clause per company from its own verified site sentences (sources.ts facts), never per
 * archetype and never naming a city (spec 4, Stage 5 rules). Keyed by operating employer.
 */
export const DESCRIPTORS: Record<string, { text: string; from: string[] }> = {
  "Industrial Electric Manufacturing": {
    text: "Low and medium voltage switchgear and power quality equipment, with 1.5M+ sq. ft. of manufacturing capacity and over 75 years in power.",
    from: [
      "developed unique low and medium voltage switchgear systems",
      "power quality and power factor correction equipment",
      "Today, IEM has 1.5M+ sq.ft. of manufacturing capacity.",
      "With over 75 years dedicated to power solutions",
    ],
  },
};

export interface PlantLayer {
  /** "Why this one is hard": why the seat is hard at this kind of plant (spec why_hard_line). */
  whyHard: string;
  /** "Show you know the floor — ask, don't tell": pick one, asked as a question. */
  showYourWork: string[];
  /** The plant's items the gap compares a posting against, each with the words that count as the posting naming it. */
  gapItems: { label: string; words: RegExp }[];
}

export const PLANT_LAYER: Partial<Record<Archetype, PlantLayer>> = {
  SWITCHGEAR_ASSEMBLY: {
    whyHard: "a switchgear plant runs sheet-metal fabrication, copper bus and electrical test side by side. Plenty of people have worked one of those; few have worked around all three, and almost nobody qualified is actively applying.",
    showYourWork: [
      "Looks like you run sheet-metal fab, copper bus and electrical test all in-house. Is the test floor where the headaches usually land, or somewhere else?",
      "Most of the people I place into switchgear plants came up in electrical equipment or sheet-metal shops. Are you finding that too, or have you had luck bringing people in from other manufacturing?",
    ],
    gapItems: [
      { label: "the sheet-metal line (lasers, shears, turret punches)", words: /\blaser|\bshears?\b|\bturret|\bpunch|sheet[- ]?metal/i },
      { label: "copper bus processing", words: /\bcopper\b|\bbus ?bars?\b/i },
      { label: "the powder coat line", words: /powder[- ]?coat|\bpaint line/i },
      { label: "welding", words: /\bweld/i },
      { label: "electrical test equipment", words: /hi-?pot|\bmegger|electrical test|test equipment/i },
      { label: "building systems", words: /\bhvac\b|building systems|\bplumbing\b|\bboilers?\b|\bcompressors?\b/i },
    ],
  },
};

/** The spec's gap is defined for a maintenance hire: the equipment the role keeps running. No other role gets one. */
export const isMaintenance = (roleTitle: string) => /maintenance/i.test(roleTitle);

const list = (xs: string[], and: "and" | "or") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs[xs.length - 1]}`);

/**
 * The gap line for a maintenance posting: which of the plant's items the posting names, and which it never mentions.
 * Null for any other role, for an archetype with no plant layer, or when the posting names every item.
 */
export function gapLine(archetype: Archetype, roleTitle: string, postingText: string): string | null {
  const layer = PLANT_LAYER[archetype];
  if (!layer || !isMaintenance(roleTitle)) return null;
  const named = layer.gapItems.filter((i) => i.words.test(postingText)).map((i) => i.label);
  const missing = layer.gapItems.filter((i) => !i.words.test(postingText)).map((i) => i.label);
  if (!missing.length) return null;
  return `${named.length ? `Posting names ${list(named, "and")}. It` : "Posting"} never mentions ${list(missing, "or")}.`;
}

/** Light close, Intelligence Sheet wording (Figure 8.1), verbatim. */
export const LIGHT_CLOSE = "If it's useful, give me twenty minutes to get the full picture. We'd set interview times before we hang up, 5 to 7 business days out, and I'd have four people ready for them.";
/** Light close, Guided Sheet wording (Figures 9.1, 9.2), verbatim. */
export const LIGHT_CLOSE_GUIDED = "If it's worth twenty minutes, we'd put interview times on both calendars before we hang up — 5 to 7 business days out — and I'd have four people ready for those slots. Want to try it?";

/** "I'm busy" (Figure 9.1): the spec's "Are those three still open?" follows the opening count, as questions.ts does. */
export const busyReply = (openingCount: number | null) =>
  `No problem — one question and I'll let you go. ${openingCount !== null && openingCount > 1 ? "Are those still open?" : "Is this one still open?"}`;

/** "Who is this?" (Figure 9.1). "maintenance only" is only true on a maintenance hire, so other roles drop it. */
export const whoReply = (roleTitle: string) =>
  isMaintenance(roleTitle) ? "Recruiter — maintenance only, manufacturing only. Not a temp shop." : "Recruiter — manufacturing only. Not a temp shop.";
