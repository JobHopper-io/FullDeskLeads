-- Specialty Filters (Settings): a recruiter's saved domain/industry preferences. They set the default view on
-- Opportunities and feed assignment (emit): leads matching a recruiter's filters are routed to them first, and
-- leads that don't match only fill the day as a clearly-tagged fallback.
--
-- "Recruiter" = a seat (seats.id). One row per seat. Row existence IS the "configured" signal: a seat that
-- never saved anything has no row, while a seat that pressed "Clear filters" has a row with every list empty
-- ("see everything" as an explicit, saved choice, not an absence).
--
-- Seam for a future tenant-wide override (nothing is built on it): seat_id is nullable and tenant_id is
-- nullable. Today every row has seat_id set and tenant_id null. A later tenant-level row would be
-- (seat_id null, tenant_id set), which the check and the unique indexes below already allow.

-- Adding a value later (e.g. 'stay_filtered_only') is `alter type ... add value`, not a table change.
create type preference_fallback as enum ('expand_to_general_pool');

create table recruiter_preferences (
  id uuid primary key default gen_random_uuid(),
  seat_id uuid references seats (id) on delete cascade,
  tenant_id uuid references tenants (id) on delete cascade,
  -- industryWordFor() values ("switchgear", "fintech", "the industry" ...), roleFamily() values or 'none',
  -- Opportunities' freshness bands (fresh/recent/ageing/stale), contentTier names (full/partial/bare).
  -- An empty array means "no filter on this axis".
  industry_filters text[] not null default '{}',
  role_family_filters text[] not null default '{}',
  freshness_filter text[] not null default '{}',
  content_tier_filter text[] not null default '{}',
  -- Tri-state: 'any' is a real option (not "unset"), 'yes' = only leads with a plant layer, 'no' = only without.
  archetype_filter text not null default 'any' check (archetype_filter in ('any', 'yes', 'no')),
  fallback_behavior preference_fallback not null default 'expand_to_general_pool',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recruiter_preferences_scope check (seat_id is not null or tenant_id is not null)
);

-- Not partial: PostgREST's upsert (ON CONFLICT (seat_id)) can't target a partial index. Postgres treats NULLs as
-- distinct in a unique index, so tenant-level rows (seat_id null) still don't collide with each other here.
create unique index recruiter_preferences_seat_idx on recruiter_preferences (seat_id);
create unique index recruiter_preferences_tenant_idx on recruiter_preferences (tenant_id) where seat_id is null;

alter table recruiter_preferences enable row level security;
-- A signed-in user reads and writes only their own seat's row (the API acts as the user). The pipeline uses the
-- service role and reads every seat's row at assignment time.
create policy own_seat on recruiter_preferences
  for all
  using (seat_id in (select id from seats where user_id = auth.uid()))
  with check (seat_id in (select id from seats where user_id = auth.uid()));

-- Marks an assignment that did NOT match the recruiter's saved filters and was assigned only to fill the day
-- (emit's fallback path). Shown as "Outside your filters" on My Day. A lead pulled in by hand from
-- Opportunities is a deliberate choice, never a fallback, so claim_lead_assignment resets it.
alter table lead_assignments add column outside_filters boolean not null default false;

-- 0036's function, one change: a re-claimed lead (expired/released) is a deliberate claim, so any earlier
-- fallback tag is cleared. The insert path relies on the column default (false).
create or replace function claim_lead_assignment(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_seat_id uuid
)
returns lead_assignments
language plpgsql
security invoker
as $$
declare
  v_row lead_assignments;
begin
  select * into v_row
  from lead_assignments
  where tenant_id = p_tenant_id and lead_id = p_lead_id
  for update;

  if not found then
    insert into lead_assignments (tenant_id, lead_id, seat_id, state, delivered_at)
    values (p_tenant_id, p_lead_id, p_seat_id, 'new', now())
    returning * into v_row;
    return v_row;
  end if;

  if v_row.state not in ('expired', 'released') then
    raise exception 'lead % already claimed for tenant %', p_lead_id, p_tenant_id using errcode = '23505';
  end if;

  update lead_assignments
  set state = 'new', seat_id = p_seat_id, delivered_at = now(), updated_at = now(), outside_filters = false
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;
