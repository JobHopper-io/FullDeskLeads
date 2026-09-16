-- raw_signals has no reference back to the source_companies row it came from, and a source's
-- own response (e.g. Greenhouse's job JSON) carries no company identity of its own — so
-- normalize can't resolve a company from raw_payload alone once it only has a raw_signal id.
-- Nullable, additive: raw_payload stays the untouched fetch, this is provenance alongside it.

alter table raw_signals add column source_token text;
