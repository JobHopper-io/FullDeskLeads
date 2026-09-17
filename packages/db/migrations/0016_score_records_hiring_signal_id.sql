-- Confirmed schema/order-of-operations mismatch: score_records.lead_id was not null, but
-- scoring runs before a lead exists (a lead is only created at emission, once a signal is
-- known to be eligible) — so scoring has nothing to put in lead_id at write time. Mirrors the
-- same pattern already used for contacts.hiring_signal_id: score at hiring_signal_id, then
-- emission updates the same row with lead_id once the lead is created, rather than writing a
-- second row.

alter table score_records alter column lead_id drop not null;
alter table score_records add column hiring_signal_id uuid references hiring_signals (id);

create unique index score_records_tenant_hiring_signal_idx
  on score_records (tenant_id, hiring_signal_id)
  where hiring_signal_id is not null;
