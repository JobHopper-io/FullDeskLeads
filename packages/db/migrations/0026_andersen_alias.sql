-- Renewal by Andersen is a brand Andersen Corporation operates under, added to Andersen Corporation's aliases
-- (same column and pattern as Crest's nine in 0025), so the wrong-company filter stops dropping its people.
-- Evidence: in the 8-signal multi-contact test, Gerald Laming (company "Renewal by Andersen", renewalbyandersen.com)
-- was dropped for all three Andersen signals at name similarity 0.45 against "Andersen Corporation".
--
-- Idempotent: only appends when it isn't there already, so re-running it can't create a duplicate alias.

update companies
   set aliases = array_append(aliases, 'Renewal by Andersen')
 where name = 'Andersen Corporation'
   and not ('Renewal by Andersen' = any (aliases));

do $$
begin
  if not exists (select 1 from companies where name = 'Andersen Corporation' and 'Renewal by Andersen' = any (aliases)) then
    raise exception 'expected Andersen Corporation to have the Renewal by Andersen alias';
  end if;
end $$;
