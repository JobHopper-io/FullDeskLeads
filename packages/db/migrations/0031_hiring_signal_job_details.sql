-- Call-sheet facts parsed from the posting itself: opening count, shift, and posted pay.
--
-- All nullable, and null means "the posting did not clearly say" — never a guess. Real postings often omit these and the
-- absence is itself a signal, so nothing is ever back-filled with a default.
--   opening_count  only an explicit number ("3 openings"); no source has a structured field for it.
--   shift          as the posting states it: day, night, weekend, first, second, third, evening, overnight, swing, rotating.
--   pay_min/max    the posted range (a single posted figure is min = max). Lever's salaryRange and Greenhouse's
--                  currency_range metadata are parsed directly; a range in the description text is used only when it
--                  is explicitly labelled or carries a period word and is not commission/OTE wording.
--   pay_interval   'hour' | 'year'. Lever states it; Greenhouse's structured range does not, so it is taken from the
--                  description's period word or left null. Never inferred from how big the number is.
--   pay_currency   ISO code as stated (USD, CAD, ...). Null when the posting shows only a bare "$".
--
-- Apply before deploying the code that reads/writes these columns (normalize, the API's lead select).

alter table hiring_signals
  add column opening_count integer check (opening_count > 0),
  add column shift text,
  add column pay_min numeric,
  add column pay_max numeric,
  add column pay_interval text check (pay_interval in ('hour', 'year')),
  add column pay_currency text check (pay_currency ~ '^[A-Z]{3}$'),
  add constraint hiring_signals_pay_range_check check (pay_min is null or pay_max is null or pay_min <= pay_max);
