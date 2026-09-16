import { z } from "zod";

// Mirrors packages/db/migrations/0001_core_schema.sql `configurations` table.
export const configurationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  targetIndustries: z.array(z.string()),
  targetGeographies: z.array(z.string()),
  targetSizeBands: z.array(z.string()),
  version: z.number().int(),
  isActive: z.boolean(),
});

export type Configuration = z.infer<typeof configurationSchema>;
