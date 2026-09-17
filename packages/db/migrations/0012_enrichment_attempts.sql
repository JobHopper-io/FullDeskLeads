-- Durable per-signal enrichment audit trail. Previously the only record of what happened to a
-- given hiring_signal was a stdout log line from whatever process ran it (worker or script) —
-- fine live, but nothing survived past terminal scrollback for auditing after the fact. Every
-- enrichHiringSignal call now writes one row here, success or not, regardless of caller.
--
-- Internal operational data, not customer-facing — same rationale as source_companies (0005):
-- left at the platform's RLS-enabled-with-no-policies default rather than explicitly disabled,
-- so only the service-role key (workers, scripts) can read or write it.

create table enrichment_attempts (
  id uuid primary key default gen_random_uuid(),
  hiring_signal_id uuid not null references hiring_signals (id),
  status text not null,
  contact_id uuid references contacts (id),
  confidence numeric,
  message text,
  attempted_at timestamptz not null default now()
);

create index enrichment_attempts_hiring_signal_id_idx on enrichment_attempts (hiring_signal_id);
