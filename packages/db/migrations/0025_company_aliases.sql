-- Brand names a company operates under, so the wrong-company filter in multi-contact enrichment can tell a real
-- employee of a subsidiary from a person at an unrelated company.
--
-- Confirmed need: Crest Industries' own postings name its brands in the `department` field, and 21 of the 24
-- contacts already stored for Crest sit on other brands' domains (16 on betaengineering.com). A filter that only
-- knows "Crest Industries" and crestoperations.com would reject nearly all of them.
--
-- Names only, no domains: a result is matched by its company name against companies.name and every alias (same
-- similarity measure and threshold as verifyCompanyEntity), so brands whose domains differ from their names
-- (millenniumgalv.com vs Millennium Galvanizing) need no separate list. Empty for every other company: their
-- existing contacts all sit on the company's own domain, so they need no aliases today.
--
-- Seeded for Crest Industries with exactly the nine brands confirmed against independent sources. Deliberately NOT
-- included: Migues Deloach and crestindustries.com. Neither is confirmed as a Crest brand, and a wrong alias is the
-- one way this filter can fail (it would wave through a wrong-company contact).

alter table companies add column aliases text[] not null default '{}';

update companies
   set aliases = array[
     'DIS-TRAN Steel',
     'DIS-TRAN Packaged Substations',
     'Crest Natural Resources',
     'Crest Operations',
     'Crest Properties',
     'Beta Engineering',
     'Mid-State Supply',
     'Millennium Galvanizing',
     'Avant Organics'
   ]
 where name = 'Crest Industries';

do $$
begin
  if not exists (select 1 from companies where name = 'Crest Industries' and cardinality(aliases) = 9) then
    raise exception 'expected exactly one Crest Industries row seeded with 9 aliases';
  end if;
end $$;
