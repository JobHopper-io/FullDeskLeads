import type { ContactCandidate, EnrichmentProvider } from "./EnrichmentProvider.interface.js";

/** Tries providers in priority order, returns the first real hit. Base phase: [SeamlessProvider] only. */
export async function waterfall(
  providers: EnrichmentProvider[],
  company: string,
  title: string,
): Promise<ContactCandidate[]> {
  for (const provider of providers) {
    const candidates = await provider.lookup(company, title);
    if (candidates.length > 0) return candidates;
  }
  return [];
}
