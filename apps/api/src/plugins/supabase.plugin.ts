import type { FastifyInstance } from "fastify";

// TODO(day 12): decorate request with a tenant-scoped Supabase client via @fdl/db createScopedClient.
export async function supabasePlugin(_app: FastifyInstance) {}
