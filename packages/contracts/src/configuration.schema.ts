import { z } from "zod";

// TODO(day 9): per-tenant target industry, geography, and company size band.
export const configurationSchema = z.object({
  tenantId: z.string().uuid(),
});

export type Configuration = z.infer<typeof configurationSchema>;
