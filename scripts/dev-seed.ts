import { createServiceClient, seedDummyTenants } from "@fdl/db";
import { loadEnv } from "@fdl/shared";

// TODO(day 2): seed two dummy tenants and two dummy seats, then confirm isolation by querying as each.
const env = loadEnv();
const db = createServiceClient(env);
await seedDummyTenants(db);
