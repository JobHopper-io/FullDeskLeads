-- Every board posting known to be the same real job as a hiring_signal.
--
-- Why: cross-source dedup (normalize) keeps ONE hiring_signal per real job and, for a duplicate arriving from another
-- board, used to discard that copy's identity — hiring_signals.source/source_posting_id only ever held whichever copy
-- was seen first. Live re-verification at emit then checked only that copy, so if it was removed while the other board's
-- copy stayed live, the signal was wrongly expired. Now each copy (the retained one and every duplicate) is a row here,
-- and verification treats the signal as live if ANY copy is.
--
-- source_token is stored per copy because the duplicate's board token can differ from the retained one's, and the
-- raw_signal it came from is not linked to the hiring_signal. hiring_signals.source/source_posting_id are unchanged.
--
-- Backfilled from each existing hiring_signal's own posting; there are no recorded duplicates to backfill (the copies
-- were never stored). Global table, service-role only: RLS stays at the platform default with no policies, like source_companies.

create table hiring_signal_postings (
  hiring_signal_id uuid not null references hiring_signals (id) on delete cascade,
  source text not null,
  source_token text not null,
  source_posting_id text not null,
  created_at timestamptz not null default now(),
  primary key (hiring_signal_id, source, source_posting_id)
);

insert into hiring_signal_postings (hiring_signal_id, source, source_token, source_posting_id)
select hs.id, hs.source, rs.source_token, hs.source_posting_id
from hiring_signals hs
join raw_signals rs on rs.id = hs.raw_signal_id
where rs.source_token is not null
on conflict do nothing;
