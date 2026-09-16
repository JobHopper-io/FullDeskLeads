-- Confirmed false-positive bug: find_similar_hiring_signal only ever compared role_title
-- similarity, so the same role title posted for two genuinely different real openings in two
-- different cities (e.g. "Residential Marketing Associate - Lenexa, KS" vs "...- Albert Lea,
-- MN", 0.654 similarity) was wrongly collapsed into one hiring_signal. Adding location to
-- what this function returns lets normalize.ts require a location match too, not just title
-- similarity, before treating something as a duplicate.

drop function if exists find_similar_hiring_signal(uuid, text, timestamptz);

create function find_similar_hiring_signal(
  p_company_id uuid,
  p_role_title text,
  p_detected_since timestamptz
)
returns table(hiring_signal_id uuid, role_title text, location text, similarity_score real)
language sql
stable
as $$
  select
    id as hiring_signal_id,
    role_title,
    location,
    similarity(lower(trim(role_title)), lower(trim(p_role_title))) as similarity_score
  from hiring_signals
  where company_id = p_company_id
    and detected_at >= p_detected_since
  order by similarity_score desc;
$$;
