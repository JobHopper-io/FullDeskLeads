import type { PipelineStage } from "../stage.js";

// TODO(day 8): query Seamless.AI by company and likely title via @fdl/enrichment, write hits to contact.
export const enrich: PipelineStage<unknown> = async (input, log) => {
  log.info({ stage: "enrich" }, "stage received job");
  return input;
};
