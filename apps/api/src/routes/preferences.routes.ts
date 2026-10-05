import type { FastifyInstance, FastifyRequest } from "fastify";
import { recruiterPreferencesRepository } from "@fdl/db";
import { EMPTY_PREFERENCES, FAMILY_TITLES, INDUSTRY_OPTIONS, rowToPreferences, type SpecialtyPreferences } from "@fdl/pipeline";
import { requireSeat } from "../plugins/auth.plugin.js";

const ROLE_FAMILY_VALUES = [...Object.keys(FAMILY_TITLES), "none"];

const list = (values: readonly string[]) => ({ type: "array", uniqueItems: true, items: { type: "string", enum: values } }) as const;

// Scoped to the caller's own seat only (request.seat.id, from the verified JWT) — nothing here reads a seat id from
// the request, so there is no way to read or write another recruiter's preferences. A later tenant-wide override
// would be a different row (migration 0038's seam) layered above this, not a change to these routes.
async function respond(request: FastifyRequest) {
  const row = await recruiterPreferencesRepository(request.db).findBySeat(request.seat.id);
  return {
    // false only for a seat that has never saved: a saved "Clear filters" is configured:true with every list empty.
    configured: !!row,
    preferences: row ? rowToPreferences(row) : EMPTY_PREFERENCES,
    fallbackBehavior: row?.fallback_behavior ?? "expand_to_general_pool",
    options: { industry: INDUSTRY_OPTIONS },
  };
}

export async function preferencesRoutes(app: FastifyInstance) {
  app.get("/me/preferences", { preHandler: requireSeat }, async (request) => respond(request));

  // Full replace: the body always carries every axis, so "see everything" is sent (and saved) explicitly as
  // empty lists + archetype "any", never inferred from missing fields.
  app.put<{ Body: SpecialtyPreferences }>(
    "/me/preferences",
    {
      preHandler: requireSeat,
      schema: {
        body: {
          type: "object",
          required: ["industry", "roleFamily", "freshness", "tier", "archetype"],
          additionalProperties: false,
          properties: {
            industry: list(INDUSTRY_OPTIONS),
            roleFamily: list(ROLE_FAMILY_VALUES),
            freshness: list(["fresh", "recent", "ageing", "stale"]),
            tier: list(["full", "partial", "bare"]),
            archetype: { type: "string", enum: ["any", "yes", "no"] },
          },
        },
      },
    },
    async (request) => {
      await recruiterPreferencesRepository(request.db).upsertForSeat(request.seat.id, request.body);
      return respond(request);
    },
  );
}
