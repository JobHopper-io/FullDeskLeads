export interface ContactCandidate {
  name: string;
  title: string;
  confidenceScore: number;
  source: string;
}

export interface EnrichmentProvider {
  name: string;
  lookup(company: string, title: string): Promise<ContactCandidate[]>;
}
