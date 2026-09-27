import type { RawPosting } from "@fdl/contracts";
import type { PostingLiveness } from "./liveness.js";

export type { RawPosting };

export interface SignalSource {
  name: string;
  fetchPostings(token: string): Promise<RawPosting[]>;
  /** Is this one posting still on the live board? Never throws: an inconclusive check is "unknown", not "gone". */
  checkPosting(token: string, sourceJobId: string, fetchFn?: typeof fetch): Promise<PostingLiveness>;
}
