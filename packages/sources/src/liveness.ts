/**
 * live: the posting is on the board. gone: the board is reachable and the posting is not on it.
 * unknown: we could not tell (network error, rate limit, 5xx, dead board token) — never the same as gone.
 */
export type PostingLiveness = "live" | "gone" | "unknown";

const RETRY_DELAYS_MS = [500, 1500];
const TIMEOUT_MS = 30_000; // Lever's full board list has taken ~9s

/** A response, or null if the request never completed. Retries network errors, 429 and 5xx; anything else is final. */
async function get(url: string, fetchFn: typeof fetch): Promise<Response | null> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      // network error or timeout: same as a retryable status
    }
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= RETRY_DELAYS_MS.length) return res;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

/**
 * Both boards answer 404 for a removed job AND for a dead/renamed board token, so a job 404 alone proves nothing
 * about the job. It only counts as gone once the board's own job list is reachable and lacks the posting; a dead
 * board (list 404) is a token problem, not a removal, so it stays unknown.
 */
export async function checkLiveness(
  opts: { postingUrl: string; boardUrl: string; boardHasPosting: (board: unknown) => boolean },
  fetchFn: typeof fetch = fetch,
): Promise<PostingLiveness> {
  const posting = await get(opts.postingUrl, fetchFn);
  if (posting?.status === 200) return "live";
  if (posting?.status !== 404) return "unknown";

  const board = await get(opts.boardUrl, fetchFn);
  if (board?.status !== 200) return "unknown";
  try {
    return opts.boardHasPosting(await board.json()) ? "live" : "gone";
  } catch {
    return "unknown";
  }
}

/** One real job can be on several boards: live if ANY copy is; gone only when every copy is confirmed gone. */
export function combineLiveness(results: PostingLiveness[]): PostingLiveness {
  if (results.includes("live")) return "live";
  return results.includes("unknown") || results.length === 0 ? "unknown" : "gone";
}
