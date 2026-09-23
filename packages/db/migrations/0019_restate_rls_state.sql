-- Why this exists: live RLS state was found to have drifted from what 0003 intended. 0003 disabled
-- RLS on the global tables, but in the live database companies and leads (and the other global
-- tables) returned zero rows to authenticated users, and source_companies' state was unknown —
-- consistent with RLS having been re-enabled after 0003 ran (or 0003 never taking effect). Rather
-- than trusting migration history, this restates the intended state of each table explicitly.
-- ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY is idempotent, so this is correct whatever the
-- live state is right now.

-- Global generation-engine tables: not tenant-scoped, no RLS (see packages/db/README.md).
alter table companies disable row level security;
alter table raw_signals disable row level security;
alter table hiring_signals disable row level security;
alter table contacts disable row level security;
alter table leads disable row level security;

-- Supabase grants anon/authenticated privileges on public tables by default, so with RLS off those
-- roles could read these tables directly through PostgREST — every contact's name and phone, every
-- lead — using only the public anon key. Nothing legitimate does that: the API and workers reach
-- these tables only via the service-role key (which bypasses grants). So the real protection is
-- zero privilege for these roles, not RLS alone. Revoke explicitly (idempotent).
revoke all on table companies from anon, authenticated;
revoke all on table raw_signals from anon, authenticated;
revoke all on table hiring_signals from anon, authenticated;
revoke all on table contacts from anon, authenticated;
revoke all on table leads from anon, authenticated;

-- Internal operational config: RLS enabled with zero policies, so only the service-role key
-- (workers, scripts) can read or write it. Do NOT add a policy to this table (see 0005).
alter table source_companies enable row level security;

-- Same reasoning as above: nothing but the service-role key ever touches this table, so make that
-- the enforced reality (zero privilege for anon/authenticated) rather than relying on RLS alone.
revoke all on table source_companies from anon, authenticated;
