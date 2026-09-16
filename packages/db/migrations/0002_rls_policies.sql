-- RLS: tenant-scoped tables only. Global tables (companies, raw_signals, hiring_signals,
-- contacts, leads) carry no tenant_id and need no RLS — they are not customer-specific data.
-- tenants itself is not scoped here either: a tenant has no tenant_id of its own to check against.
--
-- Workers write through the service-role key, which bypasses RLS entirely — intentional, since
-- the pipeline writes across the whole system. The API reads and writes with the anon key plus
-- a user JWT, so every policy below resolves auth.uid() to a seat and checks that seat's tenant_id
-- against the row's tenant_id.

alter table seats enable row level security;
alter table configurations enable row level security;
alter table exclusions enable row level security;
alter table score_records enable row level security;
alter table lead_assignments enable row level security;
alter table interaction_events enable row level security;

create policy tenant_isolation on seats
  for all
  using (tenant_id in (select tenant_id from seats where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from seats where user_id = auth.uid()));

create policy tenant_isolation on configurations
  for all
  using (tenant_id in (select tenant_id from seats where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from seats where user_id = auth.uid()));

create policy tenant_isolation on exclusions
  for all
  using (tenant_id in (select tenant_id from seats where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from seats where user_id = auth.uid()));

create policy tenant_isolation on score_records
  for all
  using (tenant_id in (select tenant_id from seats where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from seats where user_id = auth.uid()));

create policy tenant_isolation on lead_assignments
  for all
  using (tenant_id in (select tenant_id from seats where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from seats where user_id = auth.uid()));

create policy tenant_isolation on interaction_events
  for all
  using (tenant_id in (select tenant_id from seats where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from seats where user_id = auth.uid()));
