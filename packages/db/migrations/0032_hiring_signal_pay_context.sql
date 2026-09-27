-- The source's own free-text pay description, stored verbatim (Lever's salaryDescriptionPlain), exactly as the company
-- wrote it. Deliberately separate from pay_min/pay_max/pay_interval/pay_currency: the point is to show the company's own
-- context (e.g. "Base Pay: Starting at $19/hour / Target Total Earnings: $78,000/year / Top Performers Earn: ...") next to
-- the structured number, not to reconcile or choose between the two. Never parsed, never edited; null when the source
-- has no such field (Greenhouse has none). Requires 0031.

alter table hiring_signals add column pay_context text;
