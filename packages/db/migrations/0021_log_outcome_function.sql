-- POST /outcomes must write an interaction_event AND move the lead_assignment's state, or neither.
-- supabase-js can't run a multi-statement transaction, so both writes live in one function (a
-- function body is a single transaction: any exception rolls back everything it did).
--
-- State only moves forward: the event is always written, but state becomes p_new_state only while
-- the assignment is still 'new' or 'viewed', so a later click never pulls a converted / suppressed /
-- expired lead back to 'contacted'.
--
-- security invoker: runs as the calling user, so the tenant_isolation RLS policies still apply on top
-- of the explicit tenant_id check below.

create function log_outcome(
  p_lead_assignment_id uuid,
  p_tenant_id uuid,
  p_seat_id uuid,
  p_event_type text,
  p_new_state lead_assignment_state
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_event interaction_events;
  v_state lead_assignment_state;
begin
  -- Lock the row so two concurrent outcomes serialize instead of racing on state.
  select state into v_state
  from lead_assignments
  where id = p_lead_assignment_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'lead assignment not found' using errcode = 'P0002';
  end if;

  insert into interaction_events (tenant_id, lead_assignment_id, seat_id, event_type)
  values (p_tenant_id, p_lead_assignment_id, p_seat_id, p_event_type)
  returning * into v_event;

  if v_state in ('new', 'viewed') then
    update lead_assignments
    set state = p_new_state, updated_at = now()
    where id = p_lead_assignment_id and tenant_id = p_tenant_id
    returning state into v_state;
  end if;

  return to_jsonb(v_event) || jsonb_build_object('state', v_state);
end;
$$;

-- Only logged-in users may call it (the API calls it with the user's JWT); never anon.
revoke all on function log_outcome(uuid, uuid, uuid, text, lead_assignment_state) from public, anon;
grant execute on function log_outcome(uuid, uuid, uuid, text, lead_assignment_state) to authenticated;
