-- 0008's find_similar_hiring_signal filtered by threshold inside SQL, so anything below 0.65
-- never made it back to the caller — which meant only threshold-crossing comparisons could be
-- logged. To build a real distribution of cross-source similarity scores (the whole point of
-- logging them), every comparison within scope needs to come back, score included, so
-- normalize.ts can log all of them and decide the threshold itself.

drop function if exists find_similar_hiring_signal(uuid, text, timestamptz, real);

create function find_similar_hiring_signal(
  p_company_id uuid,
  p_role_title text,
  p_detected_since timestamptz
)
returns table(hiring_signal_id uuid, role_title text, similarity_score real)
language sql
stable
as $$
  select
    id as hiring_signal_id,
    role_title,
    similarity(lower(trim(role_title)), lower(trim(p_role_title))) as similarity_score
  from hiring_signals
  where company_id = p_company_id
    and detected_at >= p_detected_since
  order by similarity_score desc;
$$;
