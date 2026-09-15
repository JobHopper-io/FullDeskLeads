import { z } from "zod";

// TODO(day 8): populated by the Seamless.AI enrichment step.
export const contactSchema = z.object({
  id: z.string().uuid(),
  confidenceScore: z.number().min(0).max(1),
  source: z.string(),
});

export type Contact = z.infer<typeof contactSchema>;
