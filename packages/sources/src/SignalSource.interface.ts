import type { RawPosting } from "@fdl/contracts";

export type { RawPosting };

export interface SignalSource {
  name: string;
  fetchPostings(token: string): Promise<RawPosting[]>;
}
