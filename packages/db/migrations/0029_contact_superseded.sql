-- Marks a contact row as replaced by a corrected enrichment of the same signal, without deleting it (history stays).
--
-- Why: when a role-mapping bug sent enrichment to the wrong function's people (Design Consultant searched as
-- engineering, Sales Engineer as engineering, Construction Accountant as construction...), re-enriching writes the
-- right contacts, but the old rows must stay. Left as they are, they would still be candidates the next time a lead is
-- built for that signal, and a stale, wrong contact could win the primary again. Scoring and emit skip rows with a
-- superseded_at (contactRepository.listByHiringSignalId); nothing else changes about them.
--
-- Null = current. Not backfilled: nothing is superseded until a re-enrichment says so.

alter table contacts add column superseded_at timestamptz;
