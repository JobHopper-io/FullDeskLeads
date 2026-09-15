import type { PipelineStage } from "../stage.js";

// TODO(phase two): full identity resolution — entity mismatch detection, quarantine, reversible merge log.
export const resolveIdentity: PipelineStage<unknown> = async (input, log) => {
  log.info({ stage: "resolve-identity" }, "stage received job");
  return input;
};
