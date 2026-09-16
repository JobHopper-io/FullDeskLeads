import { z } from "zod";

export const companySizeBandSchema = z.enum(["startup", "small", "mid_market", "growth", "enterprise"]);
export const companyRevenueBandSchema = z.enum(["under_1m", "1m_10m", "10m_50m", "50m_250m", "250m_plus"]);
export const companyOwnershipTypeSchema = z.enum(["independent", "pe_backed", "family_owned", "public"]);

// Mirrors packages/db/migrations/0001_core_schema.sql `companies` table.
export const companySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  domain: z.string().nullable(),
  industry: z.string().nullable(),
  sizeBand: companySizeBandSchema.nullable(),
  revenueBand: companyRevenueBandSchema.nullable(),
  hqLocation: z.string().nullable(),
  ownershipType: companyOwnershipTypeSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CompanySizeBand = z.infer<typeof companySizeBandSchema>;
export type CompanyRevenueBand = z.infer<typeof companyRevenueBandSchema>;
export type CompanyOwnershipType = z.infer<typeof companyOwnershipTypeSchema>;
export type Company = z.infer<typeof companySchema>;
