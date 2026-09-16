-- This Supabase project auto-enables Row Level Security on every new table in the public
-- schema (a platform default, independent of migration content) — so the six global tables
-- created in 0001 came out RLS-enabled with zero policies, which denies all anon/authenticated
-- reads on them (only the service-role key bypasses). That contradicts the global vs
-- tenant-scoped split: global tables carry no tenant_id and are meant to be freely readable.
-- Disabling RLS here restores the intended design. Running 0001 → 0002 → 0003 in order on a
-- fresh project reaches the same end state, since this runs after 0001's CREATE TABLEs
-- regardless of when it was added.

alter table tenants disable row level security;
alter table companies disable row level security;
alter table raw_signals disable row level security;
alter table hiring_signals disable row level security;
alter table contacts disable row level security;
alter table leads disable row level security;
