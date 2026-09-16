-- Missed in the original schema design (0001): ingest has no way to know which companies to
-- poll, or under what board token, without this. Internal operational config, not customer
-- data — no tenant_id, and intentionally left at the platform's RLS-enabled-with-no-policies
-- default (see 0003's note on that default) rather than explicitly disabled like the global
-- generation-engine tables, since this table should NOT be freely readable: only the
-- service-role key (workers, scripts) ever needs it.

create table source_companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  source text not null,
  source_token text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index source_companies_source_token_idx on source_companies (source, source_token);
