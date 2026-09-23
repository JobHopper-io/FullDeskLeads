/** Same threshold discipline as normalize.ts's DEDUP_SIMILARITY_THRESHOLD — not a new tuned value. */
export const COMPANY_NAME_SIMILARITY_THRESHOLD = 0.65;

const LEGAL_SUFFIXES = new Set(["inc", "llc", "corp", "corporation", "co", "company", "ltd", "limited"]);

// Whole-word abbreviation expansions, applied before the legal-suffix strip. Kept to real cases
// (Mfg vs Manufacturing scored 0.556 and falsely rejected Industrial Electric Mfg.); grow it only
// when a real case shows the need, same as LEGAL_SUFFIXES.
const ABBREVIATIONS: Record<string, string> = {
  mfg: "manufacturing",
  corp: "corporation",
  co: "company",
  bros: "brothers",
};

// Same normalization as normalize.ts's normalizeCompanyName (comparison only) plus the abbreviation
// expansion above. Duplicated rather than imported because @fdl/pipeline depends on this package.
function normalizeCompanyName(name: string): string {
  const words = name
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ABBREVIATIONS[word] ?? word);
  if (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

// pg_trgm's similarity() reimplemented (find_similar_hiring_signal uses the real one in SQL):
// per word, pad with 2 leading + 1 trailing space, take 3-char windows, score = Jaccard of the sets.
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.split(/[^a-z0-9]+/).filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

export function companyNameSimilarity(a: string, b: string): number {
  const ta = trigrams(normalizeCompanyName(a));
  const tb = trigrams(normalizeCompanyName(b));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

export interface CompanyEntityVerification {
  matches: boolean;
  similarity: number;
}

/** Does the company name Seamless returned refer to the company we have on file? */
export function verifyCompanyEntity(knownName: string, seamlessName: string): CompanyEntityVerification {
  const similarity = companyNameSimilarity(knownName, seamlessName);
  return { matches: similarity >= COMPANY_NAME_SIMILARITY_THRESHOLD, similarity };
}
