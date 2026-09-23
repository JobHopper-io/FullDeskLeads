// Restrained provenance for Layer 2: a customer can answer "why did I get this lead, how fresh is it"
// without seeing vendor names, internal scores or pipeline detail. Never add those here.

// Every real signal today is a Greenhouse/Lever job posting; the vendor is deliberately not surfaced.
export const SIGNAL_TYPE = "Public job posting";

// Thresholds are a product call (High ≥ 90%, Medium 75–89%, Low below); change them here only.
export function confidenceBand(confidence: number): "High" | "Medium" | "Low" {
  return confidence >= 0.9 ? "High" : confidence >= 0.75 ? "Medium" : "Low";
}

// The one place confidence is worded, so the queue list and Layer 2 always agree: "High · 99%".
export const confidenceLabel = (confidence: number) => `${confidenceBand(confidence)} · ${Math.round(confidence * 100)}%`;

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
