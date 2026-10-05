-- Opportunities' search box matches company name and contact name too, not just role title (which
-- already has a trigram index from 0008). pg_trgm is already enabled; same index shape as 0008's.
create index companies_name_trgm_idx on companies using gin (name gin_trgm_ops);
create index contacts_name_trgm_idx on contacts using gin (name gin_trgm_ops);
