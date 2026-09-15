import type { RawPosting, SignalSource } from "../SignalSource.interface.js";

// TODO(day 4): GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true, no auth required.
export const GreenhouseSource: SignalSource = {
  name: "greenhouse",
  fetch(_boardToken: string): Promise<RawPosting[]> {
    throw new Error("not implemented");
  },
};
