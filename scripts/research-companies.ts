import { createServiceClient, companyRepository } from "@fdl/db";
import { loadEnv } from "@fdl/shared";
import { SeamlessClient, verifyCompanyEntity } from "../packages/enrichment/src/index.js";

// tsx --env-file=.env scripts/research-companies.ts crestoperations.com andersencorp.com
// Looks up the name we have on file per domain, and only trusts a Seamless company (and only
// spends a research credit on it) if its name matches. Mismatch => logged loudly, description discarded.
const db = createServiceClient(loadEnv());
const client = new SeamlessClient();
const companies = companyRepository(db);

// "all" (or no args) = every company in the table that has a domain.
const args = process.argv.slice(2);
const domains =
  args.length && args[0] !== "all"
    ? args
    : ((await db.from("companies").select("domain").not("domain", "is", null)).data ?? []).map((c) => c.domain as string);
console.log(`Running against ${domains.length} domain(s)`);
const summary: string[] = [];

for (const domain of domains) {
  const known = await companies.findByDomain(domain);
  if (!known) {
    console.error(`\n[SKIP] ${domain}: no company on file with this domain`);
    summary.push(`${domain}: skipped (not on file)`);
    continue;
  }
  const found = await client.searchCompanies(domain);
  const hit = found[0];
  if (!hit) {
    console.error(`\n[NO RESULT] ${domain}: Seamless search returned nothing`);
    summary.push(`${domain}: search returned nothing`);
    continue;
  }

  const seamlessName = String(hit.name ?? "");
  const { matches, similarity } = verifyCompanyEntity(known.name, seamlessName);
  if (!matches) {
    console.error(
      `\n[ENTITY MISMATCH — DESCRIPTION DISCARDED]\n  domain:        ${domain}\n  our name:      ${known.name}\n  seamless name: ${seamlessName}\n  similarity:    ${similarity.toFixed(3)}`,
    );
    summary.push(`${domain}: search description=${hit.description ? "yes" : "no"}, guard=REJECTED (sim ${similarity.toFixed(3)}, seamless="${seamlessName}"), research=not run`);
    continue;
  }

  console.log(`\n[VERIFIED] ${domain}: "${known.name}" ~ "${seamlessName}" (similarity ${similarity.toFixed(3)})`);
  console.log(`description: ${JSON.stringify(hit.description ?? null)}`);
  const polled = await client.pollUntilDone(await client.researchCompanies([hit.searchResultId]), { kind: "companies" });
  for (const r of polled) {
    summary.push(`${domain}: search description=${hit.description ? "yes" : "no"}, guard=PASSED (sim ${similarity.toFixed(3)}), research=${r.status}, research description=${r.company?.description ? "yes" : "no"}`);
    const researchedName = String(r.company?.name ?? "");
    const v = verifyCompanyEntity(known.name, researchedName);
    if (r.status !== "done" || !v.matches) {
      console.error(`[RESEARCH NOT TRUSTED] ${domain}: status=${r.status} our="${known.name}" researched="${researchedName}" similarity=${v.similarity.toFixed(3)}`);
    } else {
      console.log(`[RESEARCH VERIFIED] ${domain}: "${researchedName}" (similarity ${v.similarity.toFixed(3)})\ndescription: ${JSON.stringify(r.company?.description)}`);
    }
  }
}
console.log("\nSUMMARY\n" + summary.join("\n"));
console.log("\ncredits", client.getCreditBalanceSnapshot());
