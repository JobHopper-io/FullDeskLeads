-- The company HQ city and state Seamless reported for the same search result as the contact, kept beside
-- contact_city / contact_state (0024) so site_vs_corporate can be recomputed later, with a different radius or
-- comparison, without re-spending credits. Until now only the computed flag was stored, and the HQ side of the
-- comparison was thrown away (the first multi-contact test had to infer it).
--
-- Per result, not per company: for a group like Crest each brand reports its own HQ (Beta Engineering: Pineville,
-- Louisiana; Millennium Galvanizing: Convent, Louisiana).
-- Nullable and not backfilled: the older contacts predate these columns and that data was never kept.

alter table contacts
  add column company_hq_city text,
  add column company_hq_state text;
