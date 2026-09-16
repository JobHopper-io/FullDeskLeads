// Row shapes as returned by supabase-js (snake_case, matching the SQL column names in
// packages/db/migrations/0001_core_schema.sql). Kept here, not in @fdl/contracts, because
// these are storage-shaped rows — the lead *contract* (day 3) is a distinct, external-facing shape.

export type TenantPlan = "starter" | "professional" | "enterprise";
export type TenantStatus = "active" | "paused" | "churned";
export type SeatRole = "owner" | "admin" | "recruiter";
export type CompanySizeBand = "startup" | "small" | "mid_market" | "growth" | "enterprise";
export type CompanyRevenueBand = "under_1m" | "1m_10m" | "10m_50m" | "50m_250m" | "250m_plus";
export type CompanyOwnershipType = "independent" | "pe_backed" | "family_owned" | "public";
export type HiringSignalFreshnessBand = "fresh" | "recent" | "ageing" | "stale";
export type HiringSignalStatus = "active" | "filtered" | "expired";
export type LeadStatus = "draft" | "ready" | "quarantined";
export type ExclusionType =
  | "do_not_contact"
  | "client"
  | "house_account"
  | "competitor"
  | "previously_rejected";
export type LeadAssignmentState = "new" | "viewed" | "contacted" | "converted" | "suppressed" | "expired";

export interface TenantRow {
  id: string;
  name: string;
  plan: TenantPlan;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
}

export interface SeatRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: SeatRole;
  created_at: string;
}

export interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_band: CompanySizeBand | null;
  revenue_band: CompanyRevenueBand | null;
  hq_location: string | null;
  ownership_type: CompanyOwnershipType | null;
  created_at: string;
  updated_at: string;
}

export interface RawSignalRow {
  id: string;
  source: string;
  source_token: string | null;
  raw_payload: unknown;
  fetched_at: string;
  processed: boolean;
  processing_error: string | null;
}

export interface SourceCompanyRow {
  id: string;
  company_name: string;
  source: string;
  source_token: string;
  domain: string | null;
  is_active: boolean;
  created_at: string;
}

export interface HiringSignalRow {
  id: string;
  company_id: string;
  raw_signal_id: string | null;
  role_title: string;
  location: string | null;
  department: string | null;
  source: string;
  source_posting_id: string;
  posted_date: string | null;
  detected_at: string;
  freshness_band: HiringSignalFreshnessBand | null;
  status: HiringSignalStatus;
  created_at: string;
}

export interface ContactRow {
  id: string;
  company_id: string;
  name: string;
  title: string;
  phone: string | null;
  phone_verified: boolean;
  email: string | null;
  email_verified: boolean;
  confidence_score: number;
  source: string;
  source_contact_id: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface LeadRow {
  id: string;
  contract_version: string;
  hiring_signal_id: string;
  primary_contact_id: string;
  alternate_contact_ids: string[];
  why_now: string | null;
  pitch_angle: unknown;
  opening_script: string | null;
  role_intelligence: unknown;
  objections: unknown;
  generation_model_version: string | null;
  status: LeadStatus;
  quarantine_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConfigurationRow {
  id: string;
  tenant_id: string;
  target_industries: string[];
  target_geographies: string[];
  target_size_bands: string[];
  version: number;
  is_active: boolean;
  created_at: string;
}

export interface ExclusionRow {
  id: string;
  tenant_id: string;
  company_id: string;
  exclusion_type: ExclusionType;
  expires_at: string | null;
  created_at: string;
}

export interface ScoreRecordRow {
  id: string;
  tenant_id: string;
  lead_id: string;
  fit_score: number | null;
  freshness_score: number | null;
  confidence_score: number | null;
  priority_score: number | null;
  computed_at: string;
}

export interface LeadAssignmentRow {
  id: string;
  tenant_id: string;
  lead_id: string;
  seat_id: string | null;
  state: LeadAssignmentState;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InteractionEventRow {
  id: string;
  tenant_id: string;
  lead_assignment_id: string;
  seat_id: string | null;
  event_type: string;
  payload: unknown;
  occurred_at: string;
}
