import { createLogger } from "@fdl/shared";
import { hiringSignalPostingRepository, hiringSignalRepository } from "@fdl/db";
import { combineLiveness, getSource, type PostingLiveness } from "@fdl/sources";
import { getDb } from "../db.js";

const log = createLogger("verify-live");

/**
 * Re-hits the source board(s) (same endpoints ingest uses). The same real job can be on more than one board
 * (cross-source dedup keeps every copy, migration 0030), so it is live if ANY copy is and gone only when every
 * copy is confirmed gone — the retained copy dying must not expire a job still live on the other board. Anything that
 * stops us from checking — unreachable source, dead board token, no recorded copy — is "unknown", never "gone".
 * Read-only.
 */
export async function checkPostingStillLive(hiringSignalId: string): Promise<PostingLiveness> {
  const copies = await hiringSignalPostingRepository(getDb()).listByHiringSignalId(hiringSignalId);
  if (copies.length === 0) {
    log.warn({ hiringSignalId }, "no recorded source posting to re-verify this signal under — treating as unknown, not gone");
    return "unknown";
  }
  const results: PostingLiveness[] = [];
  for (const copy of copies) {
    const result = await getSource(copy.source).checkPosting(copy.source_token, copy.source_posting_id);
    if (result === "live") return "live"; // no need to hit the other boards
    results.push(result);
  }
  return combineLiveness(results);
}

/** The status write for a posting confirmed gone. Shared by emit (before a lead exists) and the sweep (after). */
export async function expireGonePosting(hiringSignalId: string): Promise<void> {
  await hiringSignalRepository(getDb()).setStatus(hiringSignalId, "expired", `posting-gone: no longer on source board at ${new Date().toISOString()}`);
}
