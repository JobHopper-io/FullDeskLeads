-- Confirmed bug: find_similar_hiring_signal compared a new posting against every recent
-- hiring_signal at the company, including ones from the *same* source. Two separate postings from
-- one source (distinct source_posting_id) are two separate requisitions by definition, but
-- differing only by level (I/II/III), seniority (Senior/Lead), shift (First/Second) or region
-- still scored above the similarity threshold — 11 of 13 same-source collapses at Industrial
-- Electric Manufacturing were false merges, permanently unreachable as leads.
--
-- Fuzzy title/location matching exists to catch the same real job posted on two different
-- platforms, so it now only considers hiring_signals from OTHER sources. Same-source duplicate
-- protection is the unique index on (company_id, source, source_posting_id) and is unchanged.

drop function if exists find_similar_hiring_signal(uuid, text, timestamptz);

create function find_similar_hiring_signal(
  p_company_id uuid,
  p_role_title text,
  p_detected_since timestamptz,
  p_source text
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
    and source <> p_source
  order by similarity_score desc;
$$;
