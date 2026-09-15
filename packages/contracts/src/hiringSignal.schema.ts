import { z } from "zod";

// TODO(day 4-6): populated by the Greenhouse/Lever normalize step.
export const hiringSignalSchema = z.object({
  id: z.string().uuid(),
});

export type HiringSignal = z.infer<typeof hiringSignalSchema>;
