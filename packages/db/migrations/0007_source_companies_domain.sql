-- Company resolution across sources currently has no shared identity signal — two
-- source_companies rows for the same real company (one per Greenhouse, one per Lever) are
-- only ever linked by free-text company_name matching, which isn't reliable. A domain gives
-- normalize an authoritative match against companies.domain (already uniquely indexed) instead
-- of falling back to fuzzy name comparison every time.

alter table source_companies add column domain text;

create index source_companies_domain_idx on source_companies (lower(domain)) where domain is not null;
