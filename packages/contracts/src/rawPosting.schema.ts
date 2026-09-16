import { z } from "zod";

// Loosely-typed intermediate shape a SignalSource maps its response into — not the final
// hiring_signal contract. Just enough structure, source-agnostic, to carry a posting through
// to normalize, plus the untouched original response fragment for provenance/debugging.
export const rawPostingSchema = z.object({
  sourceJobId: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  department: z.string().nullable(),
  postedDate: z.string().nullable(),
  rawPayload: z.unknown(),
});

export type RawPosting = z.infer<typeof rawPostingSchema>;
