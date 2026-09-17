-- emit.ts is required to "re-check eligibility from the score_records row for this signal and
-- tenant" (per the scoring/emission spec), but score_records had no column to check —
-- fit_score/freshness_score/confidence_score/priority_score don't encode eligibility on their
-- own, and inferring it from fit_score's current value would silently break once fit_score
-- becomes a real multi-dimension composite later. Explicit column instead.

alter table score_records add column eligible boolean not null default false;
