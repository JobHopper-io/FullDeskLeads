-- Confirmed real bug: nothing enforced at most one contact per hiring_signal, and a past
-- ad-hoc recovery script wrote two contacts rows for the same hiring_signal_id in 3 cases
-- (cleaned up before this migration). contactRepository.findByHiringSignalId assumed
-- uniqueness via .maybeSingle() and threw (PGRST116) the moment scoring hit one of them for
-- real. Same nullable-safe pattern as companies.domain (migration 0001).

create unique index contacts_hiring_signal_id_unique_idx
  on contacts (hiring_signal_id)
  where hiring_signal_id is not null;
