// Run: npx tsx --env-file=.env scripts/backfill-job-details.ts [--apply] — parses opening count / shift / posted pay
// out of the stored raw payload of every existing hiring_signal (no board is re-fetched). Dry run by default; --apply
// writes and REQUIRES migrations 0031 and 0032 to be applied first. Only signals where at least one field was found are written;
// the rest stay null, which is the correct value for a posting that doesn't say.
import { createServiceClient, hiringSignalRepository } from "@fdl/db";
import { loadEnv } from "@fdl/shared";
import { extractJobDetails } from "../packages/sources/src/jobDetails.js";

const apply = process.argv.includes("--apply");
const db = createServiceClient(loadEnv());
const signals = hiringSignalRepository(db);
type Row = { id: string; role_title: string; source: string; raw_signals: { raw_payload: { rawPayload: unknown } } | null };
const rows: Row[] = [];
for (let from = 0; ; from += 100) {
  const { data, error } = await db.from("hiring_signals").select("id, role_title, source, raw_signals(raw_payload)").range(from, from + 99);
  if (error) throw error;
  rows.push(...(data as unknown as Row[]));
  if (data.length < 100) break;
}

let found = 0;
for (const r of rows) {
  if (!r.raw_signals) continue; // no stored payload to parse
  const d = extractJobDetails(r.source, r.role_title, r.raw_signals.raw_payload.rawPayload);
  if (Object.values(d).every((v) => v === null)) continue;
  found++;
  if (apply) await signals.setJobDetails(r.id, d);
}
console.log(`${rows.length} signals | with at least one parsed field: ${found} | ${apply ? "written" : "dry run, nothing written (pass --apply after migrations 0031 + 0032)"}`);
