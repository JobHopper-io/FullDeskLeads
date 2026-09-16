# @fdl/db

The only package that talks to Postgres. No other package or app writes a raw query — every
read and write goes through a repository here. That's what keeps `packages/db/migrations/` the
single source of truth for schema, and what makes `packages/db/src/types.ts` the only place row
shapes can drift from the SQL.

## Global vs tenant-scoped

The schema splits into two classes of table, and getting this split backwards breaks tenant
isolation and makes lead exclusivity impossible to reason about.

**Global** (no `tenant_id`, no RLS): `companies`, `raw_signals`, `hiring_signals`, `contacts`,
`leads`. This is the generation engine's output — enriched once, reusable across every tenant.
A lead existing isn't tied to any one customer.

**Tenant-scoped** (`tenant_id` required, RLS-enforced): `seats`, `configurations`, `exclusions`,
`score_records`, `lead_assignments`, `interaction_events`. This is where a specific customer's
state lives: what they've been shown, what they've done with it, their targeting rules, their
exclusion lists. `tenants` itself carries no RLS — a tenant row has no `tenant_id` column to
check against itself, so the tenant_isolation pattern doesn't apply to it.

`lead_assignments` is the join between a global lead and a tenant — the single most important
relationship in the schema.

Notes on the migration sequence:
- This Supabase project auto-enables RLS on every new public table regardless of migration
  content, so `0001` (schema) is followed by `0002` (enable RLS + policies on the six
  tenant-scoped tables) and `0003` (explicitly disable RLS on the global tables + `tenants`,
  undoing that platform default).
- `0004` fixes a real bug in `0002`'s policies: every `tenant_isolation` policy's subquery reads
  from `seats`, and `seats` carries its own `tenant_isolation` policy — so evaluating any policy
  re-triggers the `seats` policy, which re-triggers itself, raising "infinite recursion detected
  in policy for relation seats" (Postgres error 42P17). `0004` adds a `SECURITY DEFINER` function
  (`current_tenant_ids()`) that looks up the caller's tenant_id(s) running as its owner — exempt
  from RLS by default — and repoints all six policies at it, breaking the cycle.

Applying `0001` → `0002` → `0003` → `0004` in order reaches the same end state on any fresh copy
of this project.

## Access patterns

- **Workers** use the service-role key (`createServiceClient`), which bypasses RLS entirely.
  Correct and intentional — the pipeline writes across the whole system.
- **The API** uses the anon key plus a user JWT (`createScopedClient`). RLS policies check that
  `auth.uid()` resolves to a seat whose `tenant_id` matches the row's `tenant_id`.

## Repositories

One file per core object in `src/repositories/`, each exposing only the query methods a pipeline
stage or API route actually needs — not generic CRUD. See the `// Day N` comments in each file
for which stage of the 14-day build plan calls it.
