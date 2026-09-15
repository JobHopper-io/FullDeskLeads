import type { Queue } from "bullmq";

// TODO(day 4-5): register one repeatable ingest job per signal source (Greenhouse, Lever),
// each keyed by a board token from the source_companies config table.
export async function registerSchedules(_ingestQueue: Queue): Promise<void> {}
