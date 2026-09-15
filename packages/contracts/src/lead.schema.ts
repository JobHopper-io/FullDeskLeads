import { z } from "zod";

// TODO(day 3): full field inventory, frozen once defined — every later stage writes against this.
export const leadSchema = z.object({
  id: z.string().uuid(),
});

export type Lead = z.infer<typeof leadSchema>;
