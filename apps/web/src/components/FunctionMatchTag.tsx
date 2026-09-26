import type { QueueItem } from "../lib/types";

// The ONE place this tag's wording lives; the queue list, the lead card and the Layer 2 header all render this component.
//
// What it guarantees, and no more: the lead's primary contact was returned by the search for this role's own function
// (a Maintenance Manager on a maintenance opening), not by the site-lead or HR fallback searches. That is a proxy for
// owning the hiring need, not confirmation of it, so the label says "Function match" and the tooltip says what it means.
export const FUNCTION_MATCH_LABEL = "Function match";
export const FUNCTION_MATCH_HINT =
  "Found by the search for this role's own function (for example a Maintenance Manager on a maintenance opening), so likely closer to the hiring need than an HR or site contact. Not confirmed as the owner of the requisition.";

// Same tag as freshness (a dot and a word); it only shows when true.
export default function FunctionMatchTag({ item }: { item: QueueItem }) {
  if (!item.functionMatch) return null;
  return (
    <span className="tag function-match" title={FUNCTION_MATCH_HINT}>
      {FUNCTION_MATCH_LABEL}
    </span>
  );
}
