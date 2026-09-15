import { createLogger } from "@fdl/shared";
import { ingest, normalize, resolveIdentity, dedupe, filter, enrich, selectContact, score, emit } from "@fdl/pipeline";

// TODO(day 11): run the full chain, ingest through emit, against real data with no manual steps.
const log = createLogger("run-pipeline-once");
let job: unknown = {};
for (const stage of [ingest, normalize, resolveIdentity, dedupe, filter, enrich, selectContact, score, emit]) {
  job = await stage(job, log);
}
