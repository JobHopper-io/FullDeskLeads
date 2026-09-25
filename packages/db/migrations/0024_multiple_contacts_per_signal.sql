-- Multi-contact resolution (Machine V4 Stage 3): a hiring_signal can now have several real, distinct
-- contacts (a primary plus alternates), capped at 4 in code to start.
--
-- Migration 0018 enforced "at most one contact per hiring_signal" to stop the same person being written
-- twice for one signal (a confirmed recovery-script bug that broke findByHiringSignalId's .maybeSingle()).
-- That guarantee is kept, at the right grain: the same person (source_contact_id, Seamless's own id)
-- can't appear twice for the same signal, but different people can. The same person on *different* signals
-- is unaffected (there are 41 distinct people across 215 contacts today).
--
-- Applies cleanly to existing data: every current signal has at most one contact (0018 guaranteed it),
-- and all 215 rows have a source_contact_id.
--
-- The partial predicate skips rows missing either column, as 0018 did for hiring_signal_id: the 3 legacy
-- contacts with no hiring_signal_id stay unconstrained. Enrichment always writes source_contact_id and
-- skips a candidate that lacks one, so a new row can't slip past this index.

drop index if exists contacts_hiring_signal_id_unique_idx;

create unique index contacts_signal_person_unique_idx
  on contacts (hiring_signal_id, source_contact_id)
  where hiring_signal_id is not null and source_contact_id is not null;

-- Where the contact is, from Seamless's search response (it was always returned, never stored), and
-- whether that is the company's own primary location. site_vs_corporate is computed at write time against
-- Seamless's company HQ city + state for the same result (companies.hq_location is empty for every
-- company, so it can't be the reference):
--   'corporate'  contact city + state equal the company HQ's
--   'site'       both known and they differ
--   null         city or state missing on either side: unknown, not guessed
-- Nullable, and not backfilled: the 215 existing contacts predate these columns and that data was never
-- kept. Guessing at it would be fabricating history.

alter table contacts
  add column contact_city text,
  add column contact_state text,
  add column site_vs_corporate text
    constraint contacts_site_vs_corporate_check check (site_vs_corporate in ('site', 'corporate'));
