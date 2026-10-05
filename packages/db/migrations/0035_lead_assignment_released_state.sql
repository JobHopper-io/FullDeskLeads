-- "Remove from My Day" (Opportunities work) manually deactivates an assignment without logging an
-- outcome. Distinct from 'suppressed' (an outcome disposition: not_a_fit/do_not_contact) and 'expired'
-- (the no-answer sweep) — both of those are a recruiter's real decision about the lead and stay out of
-- Opportunities. 'released' means "nobody decided anything, just put it back in the pool."
--
-- Own migration file: a new enum value must be committed before any statement in the same session can
-- reference it, so the function that uses it (0036) has to land in a later migration.
alter type lead_assignment_state add value 'released';
