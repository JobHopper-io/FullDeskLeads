import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { configurationRepository } from "../repositories/configurationRepository.js";
import { seatRepository } from "../repositories/seatRepository.js";
import { tenantRepository } from "../repositories/tenantRepository.js";

interface DummyTenantSeed {
  tenantName: string;
  userEmail: string;
  targetIndustries: string[];
  targetGeographies: string[];
  targetSizeBands: string[];
}

const DUMMY_TENANTS: DummyTenantSeed[] = [
  {
    tenantName: "Riverbend Staffing",
    userEmail: "dummy-tenant-a@fulldeskleads.test",
    targetIndustries: ["logistics", "manufacturing"],
    targetGeographies: ["Texas", "Oklahoma"],
    targetSizeBands: ["small", "mid_market"],
  },
  {
    tenantName: "Northgate Recruiting",
    userEmail: "dummy-tenant-b@fulldeskleads.test",
    targetIndustries: ["fintech", "healthtech"],
    targetGeographies: ["California", "New York"],
    targetSizeBands: ["growth", "enterprise"],
  },
];

// Requires a service-role client: db.auth.admin.createUser needs admin access, and creating
// a seat before that seat exists in RLS's own eyes would fail under the anon key.
export async function seedDummyTenants(db: SupabaseClient) {
  const tenants = tenantRepository(db);
  const seats = seatRepository(db);
  const configurations = configurationRepository(db);

  const results = [];
  for (const seed of DUMMY_TENANTS) {
    const tenant = await tenants.create({ name: seed.tenantName });

    const { data: authUser, error: authError } = await db.auth.admin.createUser({
      email: seed.userEmail,
      password: randomUUID(),
      email_confirm: true,
    });
    if (authError) throw authError;

    const seat = await seats.create({ tenantId: tenant.id, userId: authUser.user.id, role: "owner" });
    const configuration = await configurations.create({
      tenantId: tenant.id,
      targetIndustries: seed.targetIndustries,
      targetGeographies: seed.targetGeographies,
      targetSizeBands: seed.targetSizeBands,
    });

    results.push({ tenant, seat, configuration });
  }
  return results;
}
