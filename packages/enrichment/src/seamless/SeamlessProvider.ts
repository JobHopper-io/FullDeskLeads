import type { ContactCandidate, EnrichmentProvider } from "../EnrichmentProvider.interface.js";

// TODO(day 8): the only enrichment source in the base phase. Set a concurrency limit — every call has a real cost.
export const SeamlessProvider: EnrichmentProvider = {
  name: "seamless",
  lookup(_company: string, _title: string): Promise<ContactCandidate[]> {
    throw new Error("not implemented");
  },
};
