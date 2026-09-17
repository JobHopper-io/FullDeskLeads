-- New terminal status for hiring_signals that are internal-mobility/pipeline postings
-- ("Transfer Portal", "Job Shadowing Portal", internship postings) mixed into the same
-- Greenhouse/Lever feeds as real external openings — set by the filter stage before
-- enrichment ever sees the signal. Kept distinct from the existing 'filtered' status, per
-- instruction: this is a specific, auditable reason, not a generic filter rejection.
--
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as a statement that uses the new
-- value, so this is deliberately its own migration file, split from 0014's status_reason column.

alter type hiring_signal_status add value 'excluded';
