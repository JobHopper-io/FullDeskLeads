import { z } from "zod";

// Mirrors packages/db/migrations/0001_core_schema.sql `contacts` table.
export const contactSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  name: z.string(),
  title: z.string(),
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  confidenceScore: z.number().min(0).max(1),
  source: z.string(),
});

export type Contact = z.infer<typeof contactSchema>;
