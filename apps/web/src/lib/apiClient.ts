// TODO(day 12): thin fetch wrapper against the Fastify read endpoints, carrying the Supabase auth token.
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}
