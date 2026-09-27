-- When a hiring_signal's status last changed (active -> excluded, active -> expired, ...). Set by
-- hiringSignalRepository.setStatus, the one place every status write goes through, and only when the status actually
-- changes: re-running a filter on an already-excluded signal does not move it.
--
-- Deliberately NOT backfilled. Every status change before this column existed happened silently, so its real time is
-- unknown; null means "changed before we tracked it", not "never changed". Do not fill these with a guess.

alter table hiring_signals add column status_changed_at timestamptz;
