import { createLogger } from "@fdl/shared";
import type { RawPosting, SignalSource } from "../SignalSource.interface.js";
import { checkLiveness } from "../liveness.js";

const log = createLogger("lever-source");

interface LeverPosting {
  id: string;
  text: string;
  categories?: { location?: string | null; team?: string | null };
  createdAt?: number;
}

export const LeverSource: SignalSource = {
  name: "lever",

  async fetchPostings(token: string): Promise<RawPosting[]> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
    const response = await fetch(url);

    if (response.status === 404) {
      // A dead or renamed board token — never let one bad company break the run for every other.
      log.warn({ token }, "lever board not found — skipping");
      return [];
    }
    if (!response.ok) {
      throw new Error(`lever fetch failed for board "${token}": ${response.status} ${response.statusText}`);
    }

    const postings = (await response.json()) as LeverPosting[];

    return postings.map((posting) => ({
      sourceJobId: posting.id,
      title: posting.text,
      location: posting.categories?.location ?? null,
      department: posting.categories?.team ?? null,
      postedDate: posting.createdAt ? new Date(posting.createdAt).toISOString().slice(0, 10) : null,
      rawPayload: posting,
    }));
  },

  checkPosting(token, sourceJobId, fetchFn) {
    const board = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}`;
    return checkLiveness(
      {
        postingUrl: `${board}/${encodeURIComponent(sourceJobId)}`,
        boardUrl: `${board}?mode=json`,
        boardHasPosting: (body) => (body as LeverPosting[]).some((posting) => posting.id === sourceJobId),
      },
      fetchFn,
    );
  },
};
