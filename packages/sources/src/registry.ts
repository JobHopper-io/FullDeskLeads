import { GreenhouseSource } from "./greenhouse/GreenhouseSource.js";
import { LeverSource } from "./lever/LeverSource.js";
import type { SignalSource } from "./SignalSource.interface.js";

const sources: Record<string, SignalSource> = {
  [GreenhouseSource.name]: GreenhouseSource,
  [LeverSource.name]: LeverSource,
};

// The whole integration surface for adding a new source: implement SignalSource, register it
// here with a one-line entry.
export function getSource(name: string): SignalSource {
  const source = sources[name];
  if (!source) throw new Error(`no signal source registered for "${name}"`);
  return source;
}
