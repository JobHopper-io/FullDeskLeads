import { GreenhouseSource } from "./greenhouse/GreenhouseSource.js";
import { LeverSource } from "./lever/LeverSource.js";
import type { SignalSource } from "./SignalSource.interface.js";

export const sourceRegistry: Record<string, SignalSource> = {
  [GreenhouseSource.name]: GreenhouseSource,
  [LeverSource.name]: LeverSource,
};
