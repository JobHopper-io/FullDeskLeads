import type { PipelineStage } from "../stage.js";

// TODO(day 10): write the finished lead (global) and a lead_assignment (tenant-scoped),
// hardcoded placeholder in place of generated intelligence.
export const emit: PipelineStage<unknown> = async (input, log) => {
  log.info({ stage: "emit" }, "stage received job");
  return input;
};
