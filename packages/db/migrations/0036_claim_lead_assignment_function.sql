-- Opportunities' "Add to My Day": claim a lead for a tenant, racing safely against another recruiter
-- (or another tab) doing the same thing at the same moment.
--
-- One function = one transaction, same reasoning as log_outcome (0021/0022/0023): the
-- read-or-create-or-reactivate decision must not interleave with a concurrent caller's.
--
-- The lead_assignments_tenant_lead_idx unique index (0001) is the actual race guard: two concurrent
-- inserts for the same (tenant, lead) can only ever leave one row behind, and the loser's insert raises
-- a real unique_violation (23505). The `for update` lock below additionally serializes the common case
-- (a lead that already has a row here, e.g. expired/released) so the second caller sees the first
-- caller's state change rather than racing past the `if` on stale data. Both paths — the lock's own
-- raise and a genuine insert conflict — surface as 23505, and the API maps that one code to "already
-- claimed" either way.
create function claim_lead_assignment(
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

  -- Active (new/viewed/contacted), converted, or suppressed: someone already holds or decided this
  -- lead. Only expired/released leads are free to re-claim.
  if v_row.state not in ('expired', 'released') then
    raise exception 'lead % already claimed for tenant %', p_lead_id, p_tenant_id using errcode = '23505';
  end if;

  update lead_assignments
  set state = 'new', seat_id = p_seat_id, delivered_at = now(), updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function claim_lead_assignment(uuid, uuid, uuid) from public, anon;
grant execute on function claim_lead_assignment(uuid, uuid, uuid) to authenticated;
