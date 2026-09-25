import { createServiceClient, hiringSignalRepository } from "@fdl/db";
import { enrichHiringSignal, getSeamlessCreditSnapshot } from "@fdl/pipeline";
import { loadEnv, createLogger } from "@fdl/shared";

// Direct-call debugging path, same idea as scripts/run-ingest.ts: bypasses BullMQ/Redis and calls
// enrichHiringSignal for every hiring_signal without a contact yet. This spends real Seamless
// credits, so the caller must explicitly say how many signals to burn through:
//   tsx scripts/run-enrichment.ts 5      # small real slice, cheap sanity check
//   tsx scripts/run-enrichment.ts all    # every pending signal
const arg = process.argv[2];

const log = createLogger("run-enrichment");
const db = createServiceClient(loadEnv());

let pending = await hiringSignalRepository(db).listWithoutContact();

// Optional scope: `--ids=<hiring_signal_id>,<id>` runs exactly those signals (they must still be pending).
const idsArg = process.argv.find((a) => a.startsWith("--ids="));
if (idsArg) {
  const wanted = new Set(idsArg.slice("--ids=".length).split(","));
  pending = pending.filter((s) => wanted.has(s.id));
}

// Optional scope: `--domains=a.com,b.com` restricts the run to those companies (matched on companies.domain).
const domainsArg = process.argv.find((a) => a.startsWith("--domains="));
if (domainsArg) {
  const wanted = new Set(domainsArg.slice("--domains=".length).split(",").map((d) => d.toLowerCase()));
  const { data: companies } = await db.from("companies").select("id,domain");
  const ids = new Set((companies ?? []).filter((c) => c.domain && wanted.has(c.domain.toLowerCase())).map((c) => c.id));
  pending = pending.filter((s) => ids.has(s.company_id));
}

if (!arg) {
  console.error(`
${pending.length} hiring_signal(s) have no contact yet — each one spends real Seamless credits.

Usage:
  tsx scripts/run-enrichment.ts <limit>   run against the first <limit> signals
  tsx scripts/run-enrichment.ts all       run against all ${pending.length}
  add --domains=a.com,b.com to restrict either form to those companies
  add --ids=<id>,<id> to run exactly those hiring_signals
`);
  process.exit(1);
}

const limit = arg === "all" ? pending.length : Number(arg);
if (!Number.isInteger(limit) || limit <= 0) {
  console.error(`Invalid limit "${arg}" — expected a positive integer or "all".`);
  process.exit(1);
}

const targets = pending.slice(0, limit);
console.log(`Running enrichment against ${targets.length} of ${pending.length} pending hiring_signal(s)...`);

// Every call is 2-4 real HTTP requests against Seamless's 60/min org-wide ceiling — same
// concurrency as the queue worker (apps/workers/src/workers/enrich.worker.ts). Confirmed by
// real load: concurrency=3 sat at ~60 requests/minute per endpoint with zero headroom and
// produced real 429s. Dropped to 2 for actual margin below the ceiling.
const RUN_CONCURRENCY = 2;

const statusCounts = new Map<string, number>();
let processed = 0;
let contactsFound = 0;
let contactsWritten = 0;
let researchSubmitted = 0;
const contactCountBySignal = new Map<number, number>();
let researchCallsMade = 0;

async function runOne(hiringSignalId: string): Promise<void> {
  try {
    const { contactId, terminalStatus, contactIds, researchSubmitted: submitted } = await enrichHiringSignal(hiringSignalId);
    const n = contactIds?.length ?? (contactId ? 1 : 0);
    contactsWritten += n;
    researchSubmitted += submitted ?? 0;
    contactCountBySignal.set(n, (contactCountBySignal.get(n) ?? 0) + 1);
    const status = terminalStatus ?? "unknown";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    // Confirmed conflated with actual billed credits: this counts researchContacts calls made,
    // not confirmed spend — a "duplicate" result may or may not cost a credit (unconfirmed against
    // Seamless's real billing behavior). The credit snapshot below, from the real
    // X-PublicAPI-Credits response header, is the actual number — this is left in as a request
    // count for comparison, not renamed to imply it's verified spend.
    if (status !== "no-domain" && status !== "no-search-results") researchCallsMade++;
    if (contactId) contactsFound++;
  } catch (err) {
    statusCounts.set("threw", (statusCounts.get("threw") ?? 0) + 1);
    log.error({ hiringSignalId, err }, "enrichment threw — continuing with the rest of the batch");
  } finally {
    processed++;
  }
}

async function runWithConcurrency(ids: string[], concurrency: number): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < ids.length) {
      const id = ids[next++];
      await runOne(id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
}

await runWithConcurrency(
  targets.map((signal) => signal.id),
  RUN_CONCURRENCY,
);

const { first, last } = getSeamlessCreditSnapshot();
const creditLine =
  first !== null && last !== null
    ? `${first} -> ${last}  (${first - last} actually consumed this run, per the real X-PublicAPI-Credits header)`
    : "not observed this run (no response carried the header, or no requests were made)";

console.log(`
Enrichment summary
-------------------
Signals processed:              ${processed}
Signals with a contact (done):  ${contactsFound}
Contacts written in total:      ${contactsWritten}
Contacts per signal:            ${[...contactCountBySignal.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n}: ${c}`).join("   ")}
Signals with 2+ contacts:       ${[...contactCountBySignal.entries()].filter(([n]) => n >= 2).reduce((a, [, c]) => a + c, 0)} of ${processed}
Contacts sent to research:      ${researchSubmitted}
No contact found:               ${processed - contactsFound}
Research requests submitted:    ${researchCallsMade}  (a request count, not confirmed billed credits — see below)
Seamless credit balance:        ${creditLine}

By terminal status:
${[...statusCounts.entries()].map(([status, count]) => `  ${status}: ${count}`).join("\n")}
`);
