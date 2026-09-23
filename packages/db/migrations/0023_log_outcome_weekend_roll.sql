-- Server-side weekend roll-forward for follow-up dates, so the rule holds whatever a client sends.
-- A follow_up_at that falls on a Saturday or Sunday (in the caller's time zone) moves to the next
-- Monday at 9:00 in that zone — the same rule as apps/web's nextBusinessDay()/shortcutDate().
--
-- Exceptions, so deliberate choices stay exactly as picked:
--   * p_follow_up_is_custom = true: the recruiter chose that date/time themselves (Custom).
--   * meeting_set: a meeting time is a fact, not a default.
-- A client that omits the flag gets the roll, so the rule is the default and only an explicit
-- "custom" claim opts out.
--
-- p_time_zone is the caller's IANA zone (e.g. Asia/Karachi). There is no tenant time zone setting yet,
-- so the client supplies it; an unknown or missing zone falls back to UTC.
--
-- Supersedes log_outcome from 0022 (same body plus the roll; two new trailing parameters).

drop function if exists log_outcome(uuid, uuid, uuid, outcome_disposition, text, timestamptz, not_a_fit_reason, uuid, uuid);

create function log_outcome(
  p_lead_assignment_id uuid,
  p_tenant_id uuid,
  p_seat_id uuid,
  p_disposition outcome_disposition,
  p_note text,
  p_follow_up_at timestamptz,
  p_not_a_fit_reason not_a_fit_reason,
  p_company_id uuid,
  p_contact_id uuid,
  p_follow_up_is_custom boolean default false,
  p_time_zone text default 'UTC'
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
  v_tz text := case when exists (select 1 from pg_timezone_names where name = p_time_zone) then p_time_zone else 'UTC' end;
  v_local timestamp;
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

  -- Roll a weekend default forward to Monday 9:00 (isodow: Sat = 6 -> +2 days, Sun = 7 -> +1 day).
  if v_next_action is not null and not p_follow_up_is_custom and p_disposition <> 'meeting_set' then
    v_local := v_next_action at time zone v_tz;
    if extract(isodow from v_local) in (6, 7) then
      v_next_action := (date_trunc('day', v_local) + (8 - extract(isodow from v_local)::int) * interval '1 day' + interval '9 hours') at time zone v_tz;
    end if;
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

revoke all on function log_outcome(uuid, uuid, uuid, outcome_disposition, text, timestamptz, not_a_fit_reason, uuid, uuid, boolean, text) from public, anon;
grant execute on function log_outcome(uuid, uuid, uuid, outcome_disposition, text, timestamptz, not_a_fit_reason, uuid, uuid, boolean, text) to authenticated;
