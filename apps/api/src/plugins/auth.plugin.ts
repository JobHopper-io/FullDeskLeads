import type { FastifyInstance } from "fastify";

// TODO(day 12): verify the Supabase Auth JWT on each request, decorate request.user.
export async function authPlugin(_app: FastifyInstance) {}
