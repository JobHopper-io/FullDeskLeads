import { z } from "zod";
import { companySchema } from "./company.schema.js";
import { contactSchema } from "./contact.schema.js";
import { hiringSignalSchema } from "./hiringSignal.schema.js";

export const CONTRACT_VERSION = "1.0.0";

export const leadStatusSchema = z.enum(["draft", "ready", "quarantined"]);

// Full lead payload: every column on `leads` (packages/db/migrations/0001_core_schema.sql),
// plus its hiring_signal/contact/company joins flattened in as nested objects so a consumer
// (API, frontend) has everything to render a lead card without a second fetch.
//
// why_now, pitch_angle, opening_script, role_intelligence, and objections are nullable, not
// optional: every lead row has these columns, they're just unpopulated in the base phase
// (AI generation lands later). A consumer must handle "present but null", not "may be absent".
export const leadContractSchema = z.object({
  id: z.string().uuid(),
  contractVersion: z.literal(CONTRACT_VERSION),
  status: leadStatusSchema,
  quarantineReason: z.string().nullable(),

  whyNow: z.string().nullable(),
  pitchAngle: z.unknown().nullable(),
  openingScript: z.string().nullable(),
  roleIntelligence: z.unknown().nullable(),
  objections: z.unknown().nullable(),
  generationModelVersion: z.string().nullable(),

  primaryContactId: z.string().uuid(),
  alternateContactIds: z.array(z.string().uuid()),

  hiringSignal: hiringSignalSchema,
  contact: contactSchema,
  company: companySchema,

  createdAt: z.string(),
  updatedAt: z.string(),
});

export type LeadStatus = z.infer<typeof leadStatusSchema>;
export type LeadContract = z.infer<typeof leadContractSchema>;
