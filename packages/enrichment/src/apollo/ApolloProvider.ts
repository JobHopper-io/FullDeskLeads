import type { ContactCandidate, EnrichmentProvider } from "../EnrichmentProvider.interface.js";

// TODO(phase two): fallback enrichment provider — not wired in the base build.
export const ApolloProvider: EnrichmentProvider = {
  name: "apollo",
  lookup(_company: string, _title: string): Promise<ContactCandidate[]> {
    throw new Error("not implemented");
  },
};
