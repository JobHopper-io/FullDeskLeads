-- Lets "what did this duplicate actually resolve to" be queried directly against the DB going
-- forward, instead of needing terminal scrollback to recover a requestId that was never
-- persisted. Nullable, and deliberately not backfilled: older rows predate these columns and
-- that data doesn't exist — guessing at it would be fabricating history.

alter table enrichment_attempts add column request_id text;
alter table enrichment_attempts add column search_result_id text;
