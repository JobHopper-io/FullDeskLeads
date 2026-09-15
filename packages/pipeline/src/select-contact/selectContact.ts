import type { PipelineStage } from "../stage.js";

// TODO(day 8): star the single highest-confidence contact. Full weighted algorithm deferred to phase two.
export const selectContact: PipelineStage<unknown> = async (input, log) => {
  log.info({ stage: "select-contact" }, "stage received job");
  return input;
};
