import { loadEnv, createLogger } from "@fdl/shared";

const log = createLogger("seamless-client");

const BASE_URL = "https://api.seamless.ai/api/client/v1";

const DEFAULT_POLL_MAX_ATTEMPTS = 10;
const DEFAULT_POLL_INTERVAL_MS = 3000;

/** Seamless returns 429s org-wide, not per key — retry a handful of times before giving up. */
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_FALLBACK_WAIT_MS = 5000;

export class SeamlessAuthError extends Error {
  constructor(message = "Seamless.AI rejected the request (401) — check SEAMLESS_API_KEY") {
    super(message);
    this.name = "SeamlessAuthError";
  }
}

export class SeamlessCreditsError extends Error {
  constructor(message = "Seamless.AI rejected the request (422) — likely out of credits") {
    super(message);
    this.name = "SeamlessCreditsError";
  }
}

export class SeamlessPollTimeoutError extends Error {
  constructor(public readonly pendingRequestIds: string[]) {
    super(`Seamless.AI research poll timed out with ${pendingRequestIds.length} request(s) still pending`);
    this.name = "SeamlessPollTimeoutError";
  }
}

export interface SearchContactResult {
  searchResultId: string;
  name: string;
  title: string;
}

export type SeamlessResearchStatus =
  | "queued"
  | "researching"
  | "done"
  | "error"
  | "missing"
  | "duplicate"
  | "not found"
  | "contact-already-researched"
  | "credits-exhausted";

const TERMINAL_STATUSES = new Set<SeamlessResearchStatus>([
  "done",
  "error",
  "missing",
  "duplicate",
  "not found",
  "credits-exhausted",
]);

export interface SeamlessContact {
  // Assumption, not confirmed against a real poll response yet: the researched contact's own
  // Seamless id lives here, alongside the fields the docs do confirm. Cheap to fix once the
  // first real "done" response lands — see enrich.ts's source_contact_id usage.
  contactId: string;
  fullName: string;
  title: string;
  contactPhone1: string | null;
  contactPhone1TotalAI: string | null;
  email1: string | null;
  email1TotalAI: string | null;
  email1EmailAI: "valid" | "invalid" | "risky" | null;
}

export interface PollResult {
  requestId: string;
  status: SeamlessResearchStatus;
  message?: string;
  contact?: SeamlessContact;
  // Shape unconfirmed until the first real company poll lands — kept raw on purpose.
  company?: Record<string, unknown>;
  searchResultId?: string;
  // Only observed populated on a "duplicate" result — points at the original request that's
  // already in progress or done, which is what enrich.ts's duplicate-recovery follows.
  additionalData?: { initialRequestId?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SeamlessClient {
  constructor(private readonly apiKey: string = loadEnv().SEAMLESS_API_KEY) {}

  // Real credit balance from the X-PublicAPI-Credits header, captured on every response that
  // carries one — not an assumption from the docs about what a call costs. first/last let a
  // caller report "consumed this run" without needing its own separate balance check.
  private firstSeenCreditBalance: number | null = null;
  private lastSeenCreditBalance: number | null = null;

  getCreditBalanceSnapshot(): { first: number | null; last: number | null } {
    return { first: this.firstSeenCreditBalance, last: this.lastSeenCreditBalance };
  }

  private async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Token: this.apiKey,
        ...init.headers,
      },
    });

    if (response.status === 401) throw new SeamlessAuthError();
    if (response.status === 422) throw new SeamlessCreditsError();

    if (response.status === 429) {
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new Error(`Seamless.AI rate limit exceeded after ${MAX_RATE_LIMIT_RETRIES} retries: ${path}`);
      }
      const retryAfterHeader = response.headers.get("Retry-After");
      const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : RATE_LIMIT_FALLBACK_WAIT_MS;
      log.warn({ path, attempt, waitMs }, "seamless rate limit hit — backing off and retrying");
      await sleep(waitMs);
      return this.request<T>(path, init, attempt + 1);
    }

    if (!response.ok) {
      throw new Error(`Seamless.AI request failed: ${response.status} ${response.statusText} (${path})`);
    }

    const creditsHeader = response.headers.get("X-PublicAPI-Credits");
    if (creditsHeader !== null) {
      const credits = Number(creditsHeader);
      if (!Number.isNaN(credits)) {
        if (this.firstSeenCreditBalance === null) this.firstSeenCreditBalance = credits;
        this.lastSeenCreditBalance = credits;
      }
      log.info({ path, creditsRemaining: creditsHeader }, "seamless credit balance after this call");
    }

    return (await response.json()) as T;
  }

  /** POST /search/contacts. Never throws on zero results — returns an empty array. */
  async searchContacts(domain: string, jobTitleHints: string[]): Promise<SearchContactResult[]> {
    const result = await this.request<{ data: { searchResultId: string; name: string; title: string }[] }>(
      "/search/contacts",
      {
        method: "POST",
        body: JSON.stringify({ companyDomain: [domain], jobTitle: jobTitleHints, limit: 10 }),
      },
    );
    return (result.data ?? []).map(({ searchResultId, name, title }) => ({ searchResultId, name, title }));
  }

  /** POST /contacts/research. Consumes one credit per id submitted — logged here so spend is visible. */
  async researchContacts(searchResultIds: string[]): Promise<string[]> {
    log.info({ count: searchResultIds.length }, "submitting Seamless research request — 1 credit per id");
    const result = await this.request<{ requestIds: string[] }>("/contacts/research", {
      method: "POST",
      body: JSON.stringify({ searchResultIds }),
    });
    return result.requestIds ?? [];
  }

  /** POST /search/companies. Returns the raw rows (shape unconfirmed) — every row has a searchResultId. */
  async searchCompanies(domain: string): Promise<({ searchResultId: string } & Record<string, unknown>)[]> {
    const result = await this.request<{ data: ({ searchResultId: string } & Record<string, unknown>)[] }>(
      "/search/companies",
      { method: "POST", body: JSON.stringify({ companyDomain: [domain], limit: 5 }) },
    );
    return result.data ?? [];
  }

  /** POST /companies/research. Consumes credits per id submitted — logged here so spend is visible. */
  async researchCompanies(searchResultIds: string[]): Promise<string[]> {
    log.info({ count: searchResultIds.length }, "submitting Seamless company research request");
    const result = await this.request<{ requestIds: string[] }>("/companies/research", {
      method: "POST",
      body: JSON.stringify({ searchResultIds }),
    });
    return result.requestIds ?? [];
  }

  /** GET /{contacts|companies}/research/poll. */
  async pollResearch(requestIds: string[], kind: "contacts" | "companies" = "contacts"): Promise<PollResult[]> {
    const query = requestIds.map(encodeURIComponent).join(",");
    const result = await this.request<{ data: PollResult[] }>(`/${kind}/research/poll?requestIds=${query}`);
    return result.data ?? [];
  }

  /**
   * Polls until every requestId reaches a terminal status, only re-polling the ones still
   * queued/researching each round. Throws SeamlessPollTimeoutError (rather than returning
   * partial data silently) if maxAttempts is exhausted with requests still pending.
   */
  async pollUntilDone(
    requestIds: string[],
    options: { maxAttempts?: number; intervalMs?: number; kind?: "contacts" | "companies" } = {},
  ): Promise<PollResult[]> {
    const maxAttempts = options.maxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;
    const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    const results = new Map<string, PollResult>();
    let pending = [...requestIds];

    for (let attempt = 0; attempt < maxAttempts && pending.length > 0; attempt++) {
      if (attempt > 0) await sleep(intervalMs);
      const polled = await this.pollResearch(pending, options.kind);
      for (const result of polled) results.set(result.requestId, result);
      pending = pending.filter((id) => {
        const status = results.get(id)?.status;
        return status === undefined || !TERMINAL_STATUSES.has(status);
      });
    }

    if (pending.length > 0) throw new SeamlessPollTimeoutError(pending);

    return requestIds.map((id) => results.get(id)!);
  }
}
