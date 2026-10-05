import type { FastifyInstance } from "fastify";
import { WORKABLE_ASSIGNMENT_STATES } from "@fdl/db";
import { recruiterPreferencesRepository } from "@fdl/db";
import type { FreshnessBand } from "@fdl/shared";
import {
  EMPTY_PREFERENCES, TIER_OF_NAME, leadAttributes, matchesFilters, preferencesToFilters, rowToPreferences,
  type ContentTier, type FilterSet, type LeadAttributes, type LeadFacts, type RoleFamily, type SpecialtyPreferences,
} from "@fdl/pipeline";
import type { FastifyRequest } from "fastify";
import { requireSeat } from "../plugins/auth.plugin.js";
import { service } from "../serviceDb.js";

// ── Opportunities: the lead pool outside every recruiter's own My Day ──────────────────────────────
//
// "In My Day" = a lead_assignments row in a workable state (new/viewed/contacted — @fdl/db's
// WORKABLE_ASSIGNMENT_STATES, the same set apps/web's isActive() checks). Since lead_assignments has one
// row per (tenant, lead) ever (migration 0001's unique index), that single column already answers "is
// this tenant's pool, or is someone working it right now" — there's no per-seat queue to reconcile.
// A lead with no row at all (never scored eligible, or scored but excluded) and a lead whose row moved to
// 'expired' (sweep) or 'released' (My Day's "Remove") both read as "not workable" and surface here.
// 'converted' and 'suppressed' do not reappear: those are a recruiter's own decision about the lead,
// not a queue-management state, so Opportunities leaves them alone.

export interface OpportunityItem {
  leadId: string;
  company: string;
  roleTitle: string;
  location: string | null;
  industry: string;
  roleFamily: RoleFamily | null;
  hasArchetype: boolean;
  contentTier: ContentTier;
  contentTierName: "full" | "partial" | "bare";
  /** The recruiter has saved Specialty Filters and this lead does not match them (shown as "Outside your filters"). */
  outsideFilters: boolean;
  freshnessBand: FreshnessBand;
  postedDate: string | null;
  signalFirstSeen: string;
  contactStatus: "verified" | "pending" | "none";
  whyNowPreview: string | null;
}

interface RawRow {
  id: string;
  role_title: string;
  department: string | null;
  location: string | null;
  posted_date: string | null;
  detected_at: string;
  company_id: string;
  company: { name: string };
  raw_signal: { raw_payload: unknown } | null;
  // leads.hiring_signal_id has no unique constraint (only a plain index), so PostgREST can't prove this
  // embed is one-to-one and always returns it as an array, even though emit.ts's own findByHiringSignalId
  // treats it as singular in practice. !inner guarantees at least one element when the row is returned.
  lead: [RawLead];
}

interface RawLead {
  id: string;
  why_now: string | null;
  opening_script: string | null;
  role_intelligence: unknown;
  objections: unknown;
  primary_contact_id: string;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

function parseList(v: unknown): string[] | null {
  if (typeof v !== "string" || !v.trim()) return null;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Quote a value for a raw PostgREST `.or()` filter string (commas/parens/quotes would otherwise be read as syntax). */
function pgQuote(v: string): string {
  return /[,()"]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

const TIER_NAME: Record<ContentTier, "full" | "partial" | "bare"> = { 2: "full", 1: "partial", 0: "bare" };

function factsOf(row: RawRow): LeadFacts {
  const lead = row.lead[0];
  return {
    roleTitle: row.role_title, department: row.department, companyName: row.company.name, rawPayload: row.raw_signal?.raw_payload ?? null,
    postedDate: row.posted_date, detectedAt: row.detected_at,
    openingScript: lead.opening_script, roleIntelligence: lead.role_intelligence, objections: lead.objections,
  };
}

function toItem(row: RawRow, a: LeadAttributes, outsideFilters: boolean): OpportunityItem {
  const lead = row.lead[0];
  return {
    leadId: lead.id,
    company: row.company.name,
    roleTitle: row.role_title,
    location: row.location,
    industry: a.industry,
    roleFamily: a.roleFamily,
    hasArchetype: a.hasArchetype,
    contentTier: a.contentTier,
    contentTierName: TIER_NAME[a.contentTier],
    outsideFilters,
    freshnessBand: a.freshnessBand,
    postedDate: row.posted_date,
    signalFirstSeen: row.detected_at,
    contactStatus: "none", // filled in once per returned page, from the contacts lookup
    whyNowPreview: lead.why_now ? truncate(lead.why_now, 160) : null,
  };
}

/** The hiring_signal ids a search term matches, via company name, role title or contact name — or null for "no search". */
async function searchCandidateIds(q: string): Promise<string[] | null> {
  const needle = q.trim();
  if (!needle) return null;
  const like = `%${needle}%`;
  const db = service();
  const [byTitle, byCompany, byContact] = await Promise.all([
    db.from("hiring_signals").select("id").ilike("role_title", like).limit(1000),
    db.from("companies").select("id").ilike("name", like).limit(500),
    db.from("contacts").select("id").ilike("name", like).limit(500),
  ]);
  if (byTitle.error) throw byTitle.error;
  if (byCompany.error) throw byCompany.error;
  if (byContact.error) throw byContact.error;

  const ids = new Set<string>(byTitle.data.map((r) => r.id as string));

  const companyIds = byCompany.data.map((r) => r.id as string);
  if (companyIds.length) {
    const { data, error } = await db.from("hiring_signals").select("id").in("company_id", companyIds).limit(2000);
    if (error) throw error;
    for (const r of data) ids.add(r.id as string);
  }

  const contactIds = byContact.data.map((r) => r.id as string);
  if (contactIds.length) {
    const { data, error } = await db.from("leads").select("hiring_signal_id").in("primary_contact_id", contactIds).limit(2000);
    if (error) throw error;
    for (const r of data) ids.add(r.hiring_signal_id as string);
  }

  return [...ids];
}

type Sort = "newest" | "company" | "tier";
interface Cursor { sort: Sort; a: string; b: string }

function decodeCursor(raw: unknown, sort: Sort): Cursor | null {
  if (typeof raw !== "string" || !raw) return null;
  let decoded: Cursor;
  try {
    decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid cursor"), { statusCode: 400 });
  }
  if (decoded.sort !== sort) throw Object.assign(new Error("cursor does not match sort"), { statusCode: 400 });
  return decoded;
}

const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c), "utf8").toString("base64url");

const BATCH = 100;
// ponytail: content tier / industry / role family / archetype presence aren't stored columns (employer and
// archetype are computed per request too), so they can't be pushed into the SQL WHERE/ORDER. Each round fetches a
// DB-ordered, DB-filtered (search/exclusion/status) batch and filters it in Node with the shared @fdl/pipeline
// matcher: zero drift from what My Day shows, at the cost of possibly a few empty-looking "load more" clicks under
// a narrow filter combination. MAX_ROUNDS bounds one request's worst case at 500 scanned rows. If a heavily-
// filtered Opportunities view ever needs a guaranteed full page in one round trip, promote these four into stored
// columns (populated at emit time) instead of raising this number.
const MAX_ROUNDS = 5;
// The Settings live count walks the whole pool, so it gets a deeper cap and reports "capped" past it.
const COUNT_MAX_ROUNDS = 30;

interface FilterQuery { industry?: string; roleFamily?: string; tier?: string; archetype?: string; freshness?: string }
const FILTER_QUERY_SCHEMA = {
  industry: { type: "string" }, roleFamily: { type: "string" }, tier: { type: "string" },
  archetype: { type: "string" }, freshness: { type: "string" },
} as const;

function filtersFromQuery(q: FilterQuery): FilterSet {
  const list = (v: unknown) => parseList(v);
  const industry = list(q.industry), roleFamilies = list(q.roleFamily), tiers = list(q.tier), archetype = list(q.archetype), freshness = list(q.freshness);
  return {
    industry: industry ? new Set(industry) : null,
    roleFamily: roleFamilies ? new Set(roleFamilies) : null,
    tier: tiers ? new Set(tiers.map((t) => TIER_OF_NAME[t]).filter((t) => t !== undefined)) : null,
    archetype: archetype ? new Set(archetype as ("yes" | "no")[]) : null,
    freshness: freshness ? new Set(freshness as FreshnessBand[]) : null,
  };
}

/** This recruiter's saved Specialty Filters (their seat's row); `configured` false = never saved anything. */
async function loadSaved(request: FastifyRequest): Promise<{ configured: boolean; preferences: SpecialtyPreferences; filters: FilterSet }> {
  const row = await recruiterPreferencesRepository(request.db).findBySeat(request.seat.id);
  const preferences = row ? rowToPreferences(row) : EMPTY_PREFERENCES;
  return { configured: !!row, preferences, filters: preferencesToFilters(preferences) };
}

interface ScanMatch { item: OpportunityItem; contactId: string }

/**
 * Walks this tenant's Opportunities pool (leads not in anyone's workable My Day, minus excluded companies) in
 * DB order, from `cursor`, keeping rows that pass `filters`, until `limit` matches, the pool ends, or `maxRounds`
 * batches have been scanned. The returned cursor is the last row scanned (not the last match), so the next call
 * resumes exactly after it: no skips, no duplicates.
 */
async function scanPool(
  request: FastifyRequest,
  opts: { filters: FilterSet; saved: { configured: boolean; filters: FilterSet }; sort: Sort; cursor: Cursor | null; limit: number; maxRounds: number; q?: string },
): Promise<{ matches: ScanMatch[]; lastScanned: Cursor | null; exhausted: boolean; stoppedEarly: boolean }> {
  const { tenantId } = request.seat;
  const { filters, saved, sort, limit } = opts;

  // Workable assignments (this tenant's My Day, whoever on the tenant holds them) and active
  // exclusions both gate the pool before any row is even fetched.
  const [{ data: active, error: activeError }, { data: exclusions, error: exclusionError }] = await Promise.all([
    request.db.from("lead_assignments").select("lead_id").eq("tenant_id", tenantId).in("state", WORKABLE_ASSIGNMENT_STATES),
    request.db.from("exclusions").select("company_id").eq("tenant_id", tenantId).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
  ]);
  if (activeError) throw activeError;
  if (exclusionError) throw exclusionError;
  const excludeLeadIds = active.map((a) => a.lead_id as string);
  const excludedCompanyIds = [...new Set(exclusions.map((e) => e.company_id as string))];

  let matchedSignalIds: string[] | null = null;
  if (opts.q) {
    matchedSignalIds = await searchCandidateIds(opts.q);
    if (matchedSignalIds && matchedSignalIds.length === 0) return { matches: [], lastScanned: opts.cursor, exhausted: true, stoppedEarly: false };
  }

  const matches: ScanMatch[] = [];
  let lastScanned = opts.cursor;
  let exhausted = false;
  let stoppedEarly = false;

  roundLoop: for (let round = 0; round < opts.maxRounds; round++) {
    let q = service()
      .from("hiring_signals")
      .select(
        `id, role_title, department, location, posted_date, detected_at, company_id,
         company:companies!inner ( name ),
         raw_signal:raw_signals ( raw_payload ),
         lead:leads!inner ( id, why_now, opening_script, role_intelligence, objections, primary_contact_id, status )`,
      )
      .eq("status", "active")
      .eq("lead.status", "ready");

    if (excludeLeadIds.length) q = q.not("lead.id", "in", `(${excludeLeadIds.join(",")})`);
    if (excludedCompanyIds.length) q = q.not("company_id", "in", `(${excludedCompanyIds.join(",")})`);
    if (matchedSignalIds) q = q.in("id", matchedSignalIds);

    if (sort === "company") {
      q = q.order("name", { referencedTable: "company", ascending: true }).order("id", { ascending: true });
    } else {
      // "tier" has no SQL order (see MAX_ROUNDS note above); it scans newest-first like the default
      // and is re-sorted after fetching, same as My Day ranks by tier within the API's own order.
      q = q.order("detected_at", { ascending: false }).order("id", { ascending: false });
    }

    if (lastScanned) {
      const keyCol = sort === "company" ? "company.name" : "detected_at";
      const op = sort === "company" ? "gt" : "lt";
      q = q.or(`${keyCol}.${op}.${pgQuote(lastScanned.a)},and(${keyCol}.eq.${pgQuote(lastScanned.a)},id.${op}.${lastScanned.b})`);
    }

    const { data, error } = await q.limit(BATCH);
    if (error) throw error;
    const rows = data as unknown as RawRow[];

    for (const row of rows) {
      lastScanned = { sort, a: sort === "company" ? row.company.name : row.detected_at, b: row.id };
      const attrs = leadAttributes(factsOf(row));
      if (matchesFilters(attrs, filters)) {
        matches.push({ item: toItem(row, attrs, saved.configured && !matchesFilters(attrs, saved.filters)), contactId: row.lead[0].primary_contact_id });
        if (matches.length === limit) { stoppedEarly = true; break roundLoop; }
      }
    }
    if (rows.length < BATCH) { exhausted = true; break; }
  }
  return { matches, lastScanned, exhausted, stoppedEarly };
}

export async function opportunitiesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: FilterQuery & { q?: string; sort?: Sort; cursor?: string; limit?: string } }>(
    "/opportunities",
    {
      preHandler: requireSeat,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 200 },
            ...FILTER_QUERY_SCHEMA,
            sort: { type: "string", enum: ["newest", "company", "tier"] },
            cursor: { type: "string" },
            limit: { type: "string", pattern: "^[0-9]+$" },
          },
        },
      },
    },
    async (request, reply) => {
      const sort: Sort = request.query.sort ?? "newest";
      const limit = Math.min(Math.max(Number(request.query.limit ?? 25) || 25, 1), 100);

      let cursor: Cursor | null;
      try {
        cursor = decodeCursor(request.query.cursor, sort);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }

      const saved = await loadSaved(request);
      const { matches: found, lastScanned, exhausted, stoppedEarly } = await scanPool(request, {
        filters: filtersFromQuery(request.query), saved, sort, cursor, limit, maxRounds: MAX_ROUNDS, q: request.query.q,
      });

      // A tier re-sort (no SQL order for "tier") keeps each item paired with its contact id.
      const matches = sort === "tier" ? [...found].sort((a, b) => b.item.contentTier - a.item.contentTier) : found;

      // One contacts lookup for the page actually returned, not per scanned row.
      const contactIds = [...new Set(matches.map((m) => m.contactId))];
      const { data: contacts, error: contactError } = contactIds.length
        ? await service().from("contacts").select("id, phone, phone_verified").in("id", contactIds)
        : { data: [] as { id: string; phone: string | null; phone_verified: boolean }[], error: null };
      if (contactError) throw contactError;
      const contactById = new Map(contacts.map((c) => [c.id, c]));
      for (const { item, contactId } of matches) {
        const c = contactById.get(contactId);
        item.contactStatus = !c?.phone ? "none" : c.phone_verified ? "verified" : "pending";
      }

      const nextCursor = stoppedEarly || !exhausted ? (lastScanned ? encodeCursor(lastScanned) : null) : null;
      return reply.send({ items: matches.map((m) => m.item), nextCursor });
    },
  );

  // Settings' live "X leads currently match these filters": the same pool and the same matcher as the list above,
  // counted instead of paged. `capped` = the scan stopped before the end of the pool, so the true count is higher.
  app.get<{ Querystring: FilterQuery }>(
    "/opportunities/count",
    { preHandler: requireSeat, schema: { querystring: { type: "object", additionalProperties: false, properties: FILTER_QUERY_SCHEMA } } },
    async (request, reply) => {
      const { matches, exhausted } = await scanPool(request, {
        filters: filtersFromQuery(request.query), saved: { configured: false, filters: preferencesToFilters(EMPTY_PREFERENCES) },
        sort: "newest", cursor: null, limit: Number.POSITIVE_INFINITY, maxRounds: COUNT_MAX_ROUNDS,
      });
      return reply.send({ count: matches.length, capped: !exhausted });
    },
  );

  // "Add to My Day", single or bulk: one claim per lead id, each its own transaction (claim_lead_assignment,
  // migration 0036). First writer wins the (tenant_id, lead_id) row; everyone else gets "already_claimed",
  // never a duplicate assignment and never a silent no-op.
  app.post<{ Body: { leadIds: string[] } }>(
    "/opportunities/claim",
    {
      preHandler: requireSeat,
      schema: {
        body: {
          type: "object",
          required: ["leadIds"],
          additionalProperties: false,
          properties: { leadIds: { type: "array", minItems: 1, maxItems: 200, items: { type: "string", format: "uuid" } } },
        },
      },
    },
    async (request, reply) => {
      const { tenantId, id: seatId } = request.seat;
      const results: { leadId: string; status: "claimed" | "already_claimed" }[] = [];
      // Sequential: claim_lead_assignment already serializes per-row at the DB, and a bulk selection is at
      // most a couple hundred ids — not worth the complexity of a fan-out here.
      for (const leadId of request.body.leadIds) {
        const { error } = await request.db.rpc("claim_lead_assignment", { p_tenant_id: tenantId, p_lead_id: leadId, p_seat_id: seatId });
        if (error && error.code !== "23505") throw error;
        results.push({ leadId, status: error ? "already_claimed" : "claimed" });
      }
      return reply.code(207).send({ results });
    },
  );

  // "Remove from My Day" (My Day page): puts the lead back in the pool without logging an outcome.
  // Only a workable assignment can be released — a converted/suppressed/expired/already-released one
  // 404s rather than silently doing nothing, so the client can tell "nothing happened" from "it worked".
  app.post<{ Params: { leadAssignmentId: string } }>(
    "/lead-assignments/:leadAssignmentId/release",
    {
      preHandler: requireSeat,
      schema: { params: { type: "object", required: ["leadAssignmentId"], properties: { leadAssignmentId: { type: "string", format: "uuid" } } } },
    },
    async (request, reply) => {
      const { data, error } = await request.db
        .from("lead_assignments")
        .update({ state: "released", updated_at: new Date().toISOString() })
        .eq("id", request.params.leadAssignmentId)
        .eq("tenant_id", request.seat.tenantId)
        .in("state", WORKABLE_ASSIGNMENT_STATES)
        .select("id, state")
        .maybeSingle();
      if (error) throw error;
      if (!data) return reply.code(404).send({ error: "lead assignment not found or not active" });
      return reply.send(data);
    },
  );
}
