/**
 * Discovery questions are not generated. They are the build spec's fixed four, copied verbatim from the Intelligence
 * Sheet's "Then let him talk" list (spec Figure 8.1, v1.0 24 Sep 2026), dashes included. The only substitution is the
 * words for the opening(s): the spec's example had three seats open, so it says "those" and "these".
 */
const SPEC_SET = [
  "How long {have those} been open?",
  "What has the last hire or two looked like — what worked, what didn't?",
  "Is the posted range where you'd actually land for the right person?",
  "Who else is working {these} for you at the moment?",
];

/** "those"/"these" only when the posting says there is more than one opening; otherwise the one posting is "this one". */
export function fixedQuestions(openingCount: number | null): string[] {
  const several = openingCount !== null && openingCount > 1;
  return SPEC_SET.map((q) => q.replaceAll("{have those}", several ? "have those" : "has this one").replaceAll("{these}", several ? "these" : "this one"));
}
