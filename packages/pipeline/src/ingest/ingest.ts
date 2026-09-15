import type { PipelineStage } from "../stage.js";

// TODO(day 3-4): logging-only skeleton. Real fetch-and-write-to-raw_signal lands day 4 (Greenhouse), day 5 (Lever).
export const ingest: PipelineStage<unknown> = async (input, log) => {
  log.info({ stage: "ingest" }, "stage received job");
  return input;
};
