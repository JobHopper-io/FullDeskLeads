-- Confirmed bug: enrichment's "already enriched" check (hiringSignalRepository.listWithoutContact)
-- was scoped to contacts.company_id, so a contact found for *any one* role at a company (e.g. an
-- internship posting) caused every other hiring_signal at that company — regardless of role — to
-- be silently skipped as already enriched. A contacts row is going forward one enrichment result
-- for one specific hiring_signal, not a company-wide cache, so the check needs to scope to that
-- instead.

alter table contacts add column hiring_signal_id uuid references hiring_signals (id);

create index contacts_hiring_signal_id_idx on contacts (hiring_signal_id);

-- Nullable, not backfilled: the pre-existing contacts rows were written before hiring_signal_id
-- was recorded anywhere, so there's no reliable way to know which of their originating
-- hiring_signal triggered them after the fact. Leaving them null rather than guessing, and
-- logging which rows so this is visible, not silently ambiguous.
do $$
declare
  orphaned_ids uuid[];
begin
  select array_agg(id) into orphaned_ids from contacts where hiring_signal_id is null;
  if orphaned_ids is not null then
    raise notice 'contacts rows left with null hiring_signal_id (predate this column, no reliable backfill source): %', orphaned_ids;
  end if;
end $$;
