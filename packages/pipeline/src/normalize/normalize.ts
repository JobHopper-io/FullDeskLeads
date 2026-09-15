import type { PipelineStage } from "../stage.js";

// TODO(day 4-5): parse raw_signal into the hiring_signal shape, source-agnostic.
export const normalize: PipelineStage<unknown> = async (input, log) => {
  log.info({ stage: "normalize" }, "stage received job");
  return input;
};
