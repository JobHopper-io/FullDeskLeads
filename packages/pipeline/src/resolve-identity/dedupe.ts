import type { PipelineStage } from "../stage.js";

// TODO(day 6): dedup within the freshness window, checked across both sources.
export const dedupe: PipelineStage<unknown> = async (input, log) => {
  log.info({ stage: "dedupe" }, "stage received job");
  return input;
};
