import { z } from "zod";

export const hiringSignalFreshnessBandSchema = z.enum(["fresh", "recent", "ageing", "stale"]);
export const hiringSignalStatusSchema = z.enum(["active", "filtered", "expired", "excluded"]);

// Mirrors packages/db/migrations/0001_core_schema.sql `hiring_signals` table.
export const hiringSignalSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  roleTitle: z.string(),
  location: z.string().nullable(),
  department: z.string().nullable(),
  source: z.string(),
  sourcePostingId: z.string(),
  postedDate: z.string().nullable(),
  detectedAt: z.string(),
  freshnessBand: hiringSignalFreshnessBandSchema.nullable(),
  status: hiringSignalStatusSchema,
});

export type HiringSignalFreshnessBand = z.infer<typeof hiringSignalFreshnessBandSchema>;
export type HiringSignalStatus = z.infer<typeof hiringSignalStatusSchema>;
export type HiringSignal = z.infer<typeof hiringSignalSchema>;
