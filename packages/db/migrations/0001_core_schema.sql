-- Core schema: global generation-engine tables + tenant-scoped customer-state tables.
-- See packages/db/README.md for the global vs tenant-scoped split this schema encodes.

-- ── Enums ────────────────────────────────────────────────────────────────

create type tenant_plan as enum ('starter', 'professional', 'enterprise');
create type tenant_status as enum ('active', 'paused', 'churned');
create type seat_role as enum ('owner', 'admin', 'recruiter');

create type company_size_band as enum ('startup', 'small', 'mid_market', 'growth', 'enterprise');
create type company_revenue_band as enum ('under_1m', '1m_10m', '10m_50m', '50m_250m', '250m_plus');
create type company_ownership_type as enum ('independent', 'pe_backed', 'family_owned', 'public');

create type hiring_signal_freshness_band as enum ('fresh', 'recent', 'ageing', 'stale');
create type hiring_signal_status as enum ('active', 'filtered', 'expired');

create type lead_status as enum ('draft', 'ready', 'quarantined');

create type exclusion_type as enum (
  'do_not_contact', 'client', 'house_account', 'competitor', 'previously_rejected'
);

create type lead_assignment_state as enum (
  'new', 'viewed', 'contacted', 'converted', 'suppressed', 'expired'
);

-- ── tenants (tenant-scoped: the tenant itself; no RLS, see 0002) ───────────

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan tenant_plan not null default 'starter',
  status tenant_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── seats (tenant-scoped) ───────────────────────────────────────────────

create table seats (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  user_id uuid not null references auth.users (id),
  role seat_role not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

-- seats.user_id is the leading column in every RLS policy's subquery (0002) — index it directly,
-- since the (tenant_id, user_id) unique constraint above has tenant_id leading, not user_id.
create index seats_user_id_idx on seats (user_id);

-- ── companies (global) ──────────────────────────────────────────────────

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text,
  industry text,
  size_band company_size_band,
  revenue_band company_revenue_band,
  hq_location text,
  ownership_type company_ownership_type,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive, nullable-safe: identity resolution matches on domain regardless of case,
-- and companies without a known domain (not yet resolved) are allowed to duplicate.
create unique index companies_domain_unique_idx on companies (lower(domain)) where domain is not null;

-- ── raw_signals (global) ────────────────────────────────────────────────

create table raw_signals (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  raw_payload jsonb not null,
  fetched_at timestamptz not null,
  processed boolean not null default false,
  processing_error text
);

-- ── hiring_signals (global) ─────────────────────────────────────────────

create table hiring_signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id),
  raw_signal_id uuid references raw_signals (id),
  role_title text not null,
  location text,
  department text,
  source text not null,
  source_posting_id text not null,
  posted_date date,
  detected_at timestamptz not null default now(),
  freshness_band hiring_signal_freshness_band,
  status hiring_signal_status not null default 'active',
  created_at timestamptz not null default now()
);

-- Source-level dedup: the same posting fetched twice from the same source collapses to one row.
-- Cross-source dedup (day 6, same job on Greenhouse and Lever) is pipeline logic, not a DB constraint.
create unique index hiring_signals_source_dedup_idx on hiring_signals (company_id, source, source_posting_id);
create index hiring_signals_company_id_idx on hiring_signals (company_id);
create index hiring_signals_posted_date_idx on hiring_signals (posted_date);
create index hiring_signals_status_idx on hiring_signals (status);

-- ── contacts (global) ───────────────────────────────────────────────────

create table contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id),
  name text not null,
  title text not null,
  phone text,
  phone_verified boolean not null default false,
  email text,
  email_verified boolean not null default false,
  confidence_score numeric not null,
  source text not null,
  source_contact_id text,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index contacts_company_id_idx on contacts (company_id);

-- ── leads (global) ──────────────────────────────────────────────────────

create table leads (
  id uuid primary key default gen_random_uuid(),
  contract_version text not null,
  hiring_signal_id uuid not null references hiring_signals (id),
  primary_contact_id uuid not null references contacts (id),
  alternate_contact_ids uuid[] not null default '{}',
  why_now text,
  pitch_angle jsonb,
  opening_script text,
  role_intelligence jsonb,
  objections jsonb,
  generation_model_version text,
  status lead_status not null default 'draft',
  quarantine_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_quarantine_reason_required
    check (status <> 'quarantined' or quarantine_reason is not null)
);

create index leads_hiring_signal_id_idx on leads (hiring_signal_id);

-- ── configurations (tenant-scoped) ──────────────────────────────────────

create table configurations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  target_industries text[] not null default '{}',
  target_geographies text[] not null default '{}',
  target_size_bands text[] not null default '{}',
  version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index configurations_tenant_active_idx on configurations (tenant_id, is_active);

-- ── exclusions (tenant-scoped) ──────────────────────────────────────────

create table exclusions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  company_id uuid not null references companies (id),
  exclusion_type exclusion_type not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index exclusions_tenant_company_type_idx on exclusions (tenant_id, company_id, exclusion_type);
create index exclusions_tenant_id_idx on exclusions (tenant_id);

-- ── score_records (tenant-scoped) ───────────────────────────────────────

create table score_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  lead_id uuid not null references leads (id),
  fit_score numeric,
  freshness_score numeric,
  confidence_score numeric,
  priority_score numeric,
  computed_at timestamptz not null default now()
);

create unique index score_records_tenant_lead_idx on score_records (tenant_id, lead_id);

-- ── lead_assignments (tenant-scoped — global lead × tenant join) ───────

create table lead_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  lead_id uuid not null references leads (id),
  seat_id uuid references seats (id),
  state lead_assignment_state not null default 'new',
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A lead can only be assigned to a given tenant once — this is the exclusivity guarantee.
create unique index lead_assignments_tenant_lead_idx on lead_assignments (tenant_id, lead_id);
create index lead_assignments_tenant_state_idx on lead_assignments (tenant_id, state);

-- ── interaction_events (tenant-scoped) ──────────────────────────────────

create table interaction_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  lead_assignment_id uuid not null references lead_assignments (id),
  seat_id uuid references seats (id),
  event_type text not null,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);

create index interaction_events_lead_assignment_id_idx on interaction_events (lead_assignment_id);
create index interaction_events_tenant_occurred_idx on interaction_events (tenant_id, occurred_at);
