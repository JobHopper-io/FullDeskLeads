-- Real outcome dispositions + follow-ups, replacing the single hardcoded 'contacted' event.
-- Supersedes log_outcome from 0021 (dropped and recreated with a new signature).
--
-- What this adds:
--   * outcome_disposition / not_a_fit_reason enums
--   * interaction_events: disposition, note, follow_up_at, follow_up_note, not_a_fit_reason
--   * lead_assignments.next_action_at — when the lead is next due; /queue hides it until then
--   * contact_flags — tenant-scoped "bad contact data" flags (contacts is global and shared across
--     tenants, so a flag on the contacts row itself would leak between tenants)
--
-- Placeholders, deliberately not built yet:
--   * job_order / meeting_set are promotions to an Opportunities object that doesn't exist. They are
--     logged with payload {"promotion_pending": "opportunity"} and the assignment state is NOT set to
--     'converted'; a future Opportunities migration can backfill from those events.
--   * bad_contact_data only writes contact_flags; there is no internal quality queue yet.
--   * no_interest defers (via follow_up_at, chosen by the caller); the tenant-level close-vs-defer
--     rule doesn't exist yet.

create type outcome_disposition as enum (
  'no_answer', 'left_voicemail', 'gatekeeper', 'connected', 'no_interest', 'follow_up_later',
  'job_order', 'bad_contact_data', 'not_a_fit', 'do_not_contact', 'meeting_set'
);

create type not_a_fit_reason as enum (
  'wrong_size', 'wrong_industry', 'self_performs', 'existing_client', 'too_far', 'other'
);

-- Existing rows (event_type = 'contacted') keep disposition null. New rows also write
-- event_type = disposition::text so anything still reading event_type keeps working.
alter table interaction_events
  add column disposition outcome_disposition,
  add column note text,
  add column follow_up_at timestamptz,
  add column follow_up_note text,
  add column not_a_fit_reason not_a_fit_reason;

alter table lead_assignments add column next_action_at timestamptz;

create table contact_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  contact_id uuid not null references contacts (id),
  lead_assignment_id uuid references lead_assignments (id),
  seat_id uuid references seats (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, contact_id)
);

alter table contact_flags enable row level security;
create policy tenant_isolation on contact_flags
  for all
  using (tenant_id in (select current_tenant_ids()))
  with check (tenant_id in (select current_tenant_ids()));

drop function if exists log_outcome(uuid, uuid, uuid, text, lead_assignment_state);

-- One function = one transaction: the event, the state / next_action_at change and the side effects
-- (suppression, contact flag) all land or none do. security invoker: tenant_isolation RLS still applies.
--
-- p_company_id / p_contact_id are resolved by the API (the global leads/contacts/companies tables are
-- unreadable to this role) and only used for do_not_contact / bad_contact_data respectively.
--
-- State only moves between the live states: a converted / suppressed / expired assignment is never
-- pulled back, but the event and side effects are still written.
create function log_outcome(
  p_lead_assignment_id uuid,
  p_tenant_id uuid,
  p_seat_id uuid,
  p_disposition outcome_disposition,
  p_note text,
  p_follow_up_at timestamptz,
  p_not_a_fit_reason not_a_fit_reason,
  p_company_id uuid,
  p_contact_id uuid
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_event interaction_events;
  v_state lead_assignment_state;
  v_new_state lead_assignment_state := 'contacted';
  v_next_action timestamptz := p_follow_up_at;
  v_attempts int;
begin
  -- Lock the row so two concurrent outcomes serialize instead of racing on state / attempt count.
  select state into v_state
  from lead_assignments
  where id = p_lead_assignment_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'lead assignment not found' using errcode = 'P0002';
  end if;

  if p_disposition in ('follow_up_later', 'meeting_set') and p_follow_up_at is null then
    raise exception '% requires a date and time', p_disposition using errcode = '22023';
  end if;
  if p_follow_up_at is not null and p_follow_up_at <= now() then
    raise exception 'follow-up must be in the future' using errcode = '22023';
  end if;
  if p_disposition = 'not_a_fit' and p_not_a_fit_reason is null then
    raise exception 'not_a_fit requires a reason' using errcode = '22023';
  end if;
  if p_disposition = 'do_not_contact' and p_company_id is null then
    raise exception 'do_not_contact requires a company' using errcode = '22023';
  end if;
  if p_disposition = 'bad_contact_data' and p_contact_id is null then
    raise exception 'bad_contact_data requires a contact' using errcode = '22023';
  end if;

  if p_disposition = 'no_answer' then
    select count(*) + 1 into v_attempts
    from interaction_events
    where lead_assignment_id = p_lead_assignment_id and disposition = 'no_answer';
    -- 4th no-answer: out of attempts, the lead expires instead of returning to the queue.
    if v_attempts >= 4 then
      v_new_state := 'expired';
      v_next_action := null;
    end if;
  elsif p_disposition in ('not_a_fit', 'do_not_contact') then
    v_new_state := 'suppressed';
    v_next_action := null;
  end if;

  insert into interaction_events
    (tenant_id, lead_assignment_id, seat_id, event_type, disposition, note,
     follow_up_at, follow_up_note, not_a_fit_reason, payload)
  values
    (p_tenant_id, p_lead_assignment_id, p_seat_id, p_disposition::text, p_disposition, p_note,
     v_next_action, case when v_next_action is not null then p_note end,
     case when p_disposition = 'not_a_fit' then p_not_a_fit_reason end,
     case when p_disposition in ('job_order', 'meeting_set')
          then '{"promotion_pending": "opportunity"}'::jsonb else '{}'::jsonb end)
  returning * into v_event;

  if v_state in ('new', 'viewed', 'contacted') then
    update lead_assignments
    set state = v_new_state, next_action_at = v_next_action, updated_at = now()
    where id = p_lead_assignment_id and tenant_id = p_tenant_id
    returning state into v_state;
  end if;

  if p_disposition = 'do_not_contact' then
    insert into exclusions (tenant_id, company_id, exclusion_type)
    values (p_tenant_id, p_company_id, 'do_not_contact')
    on conflict (tenant_id, company_id, exclusion_type) do nothing;
  elsif p_disposition = 'bad_contact_data' then
    insert into contact_flags (tenant_id, contact_id, lead_assignment_id, seat_id)
    values (p_tenant_id, p_contact_id, p_lead_assignment_id, p_seat_id)
    on conflict (tenant_id, contact_id) do nothing;
  end if;

  return to_jsonb(v_event) || jsonb_build_object('state', v_state, 'attempts', v_attempts);
end;
$$;

revoke all on function log_outcome(uuid, uuid, uuid, outcome_disposition, text, timestamptz, not_a_fit_reason, uuid, uuid) from public, anon;
grant execute on function log_outcome(uuid, uuid, uuid, outcome_disposition, text, timestamptz, not_a_fit_reason, uuid, uuid) to authenticated;
