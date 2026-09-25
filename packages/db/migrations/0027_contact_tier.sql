-- Which kind of contact this is for the opening, known exactly at search time: enrichment now runs one search
-- per tier, so the tier of the search that found a person is the person's tier.
--   function  the role family's own managers (Maintenance Manager for a maintenance opening)
--   site      site leadership (Plant Manager, Operations Manager, General Manager)
--   hr        HR / talent acquisition
-- A lead's primary contact is the highest-confidence one within the best tier that has anyone (function first).
--
-- Nullable and not backfilled: contacts written before this column existed came from one combined search, so
-- which tier found them was never recorded (the 215 old contacts and the 27 from the first multi-contact test).
-- Readers fall back to a keyword guess on the title for those rows, which is approximate.

alter table contacts
  add column tier text constraint contacts_tier_check check (tier in ('function', 'site', 'hr'));
