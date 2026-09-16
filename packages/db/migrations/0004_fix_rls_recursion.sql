-- Every tenant_isolation policy's subquery reads from `seats`, and `seats` itself carries a
-- tenant_isolation policy — so evaluating any of the six policies re-triggers the `seats`
-- policy, which re-triggers itself, and Postgres raises "infinite recursion detected in policy
-- for relation seats" (42P17). Standard fix: a SECURITY DEFINER function that looks up the
-- caller's tenant_id(s) running as its owner (exempt from RLS by default), breaking the cycle.

create function public.current_tenant_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select tenant_id from seats where user_id = auth.uid();
$$;

drop policy tenant_isolation on seats;
drop policy tenant_isolation on configurations;
drop policy tenant_isolation on exclusions;
drop policy tenant_isolation on score_records;
drop policy tenant_isolation on lead_assignments;
drop policy tenant_isolation on interaction_events;

create policy tenant_isolation on seats
  for all
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

create policy tenant_isolation on configurations
  for all
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

create policy tenant_isolation on exclusions
  for all
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

create policy tenant_isolation on score_records
  for all
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

create policy tenant_isolation on lead_assignments
  for all
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

create policy tenant_isolation on interaction_events
  for all
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));
