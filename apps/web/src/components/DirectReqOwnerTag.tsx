import type { QueueItem } from "../lib/types";

// "Direct req owner": the lead's primary contact is function-tier, i.e. found by the search for this role's own
// function, so they likely own the hiring need. Same tag as freshness (a dot and a word); it only shows when true.
export default function DirectReqOwnerTag({ item }: { item: QueueItem }) {
  if (!item.directReqOwner) return null;
  return (
    <span className="tag owner" title="Found by the search for this role's own function, so likely owns the hiring need.">
      Direct req owner
    </span>
  );
}
