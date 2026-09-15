import type { RawPosting, SignalSource } from "../SignalSource.interface.js";

// TODO(day 5): api.lever.co, no auth required. Same fetch/normalize pattern as Greenhouse.
export const LeverSource: SignalSource = {
  name: "lever",
  fetch(_boardToken: string): Promise<RawPosting[]> {
    throw new Error("not implemented");
  },
};
