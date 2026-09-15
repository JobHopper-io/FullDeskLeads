import type { PipelineStage } from "../stage.js";

// TODO(day 9-10): freshness band + fit check against real per-tenant configuration.
export const score: PipelineStage<unknown> = async (input, log) => {
  log.info({ stage: "score" }, "stage received job");
  return input;
};
