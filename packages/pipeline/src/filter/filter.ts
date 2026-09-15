import type { PipelineStage } from "../stage.js";

// TODO(day 6, day 10): structural filter (freshness ceiling, record completeness) stands in for the
// full three-tier exclusion system. Reachability gate moves here day 10, once a contact exists to check.
export const filter: PipelineStage<unknown> = async (input, log) => {
  log.info({ stage: "filter" }, "stage received job");
  return input;
};
