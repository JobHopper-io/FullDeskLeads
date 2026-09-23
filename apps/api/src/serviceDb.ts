import { createServiceClient } from "@fdl/db";
import { loadEnv } from "@fdl/shared";

// The global tables (leads, contacts, hiring_signals, companies) return no rows to an authenticated user in
// this database, so the routes that need them use the service client. Only ever query it by ids taken from
// the caller's own tenant-filtered rows — never by anything from the request.
let serviceDb: ReturnType<typeof createServiceClient> | undefined;
export const service = () => (serviceDb ??= createServiceClient(loadEnv()));
