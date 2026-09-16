-- Cross-source hiring_signal dedup currently does exact, case-sensitive role_title matching,
-- which misses the same real posting arriving from two sources with differently worded titles
-- ("Senior Recruiter" vs "Sr. Recruiter, Talent Acquisition"). pg_trgm's similarity() lets
-- normalize compare titles fuzzily instead.

create extension if not exists pg_trgm;

-- Matters once this query pattern needs to search without a company_id prefilter; today's
-- lookup is already narrowed to one company within a 14-day window, so this mostly future-proofs
-- rather than fixes a current bottleneck.
create index hiring_signals_role_title_trgm_idx on hiring_signals using gin (role_title gin_trgm_ops);

-- Cross-source dedup: is there an existing hiring_signal for this company, detected within the
-- freshness window, whose role_title is a close (not necessarily identical) match? Runs
-- server-side so the similarity computation and index live next to the data — see
-- packages/pipeline/src/normalize/normalize.ts for the threshold and why 0.65 is a starting
-- point, not a tuned value.
create function find_similar_hiring_signal(
  p_company_id uuid,
  p_role_title text,
  p_detected_since timestamptz,
  p_similarity_threshold real default 0.65
)
returns setof hiring_signals
language sql
stable
as $$
  select *
  from hiring_signals
  where company_id = p_company_id
    and detected_at >= p_detected_since
    and similarity(lower(trim(role_title)), lower(trim(p_role_title))) >= p_similarity_threshold
  order by similarity(lower(trim(role_title)), lower(trim(p_role_title))) desc;
$$;
