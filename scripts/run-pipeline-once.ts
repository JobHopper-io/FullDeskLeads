import { createLogger } from "@fdl/shared";
import { resolveIdentity, dedupe, filter, enrich, selectContact, score, emit } from "@fdl/pipeline";

// TODO(day 11): run the full chain against real data with no manual steps. ingest/normalize
// have real implementations now (see scripts/run-greenhouse-ingest.ts) but a different shape
// than the rest of this stub chain — runIngestForCompany takes a source_companies row and
// normalizeRawSignal takes a raw_signal id, neither passes a generic `job` through. This chain
// picks back up once resolve-identity onward have real logic too.
const log = createLogger("run-pipeline-once");
let job: unknown = {};
for (const stage of [resolveIdentity, dedupe, filter, enrich, selectContact, score, emit]) {
  job = await stage(job, log);
}
