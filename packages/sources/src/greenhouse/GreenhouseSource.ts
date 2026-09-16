import { createLogger } from "@fdl/shared";
import type { RawPosting, SignalSource } from "../SignalSource.interface.js";

const log = createLogger("greenhouse-source");

interface GreenhouseJob {
  id: number;
  title: string;
  location?: { name: string | null } | null;
  departments?: { name: string }[];
  first_published?: string | null;
  updated_at?: string;
}

interface GreenhouseJobsResponse {
  jobs: GreenhouseJob[];
}

export const GreenhouseSource: SignalSource = {
  name: "greenhouse",

  async fetchPostings(token: string): Promise<RawPosting[]> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
    const response = await fetch(url);

    if (response.status === 404) {
      // A dead or renamed board token — never let one bad company break the run for every other.
      log.warn({ token }, "greenhouse board not found — skipping");
      return [];
    }
    if (!response.ok) {
      throw new Error(`greenhouse fetch failed for board "${token}": ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as GreenhouseJobsResponse;

    return body.jobs.map((job) => ({
      sourceJobId: String(job.id),
      title: job.title,
      location: job.location?.name ?? null,
      department: job.departments?.[0]?.name ?? null,
      postedDate: (job.first_published ?? job.updated_at ?? "").slice(0, 10) || null,
      rawPayload: job,
    }));
  },
};
