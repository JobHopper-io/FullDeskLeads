import { createLogger } from "@fdl/shared";
import { companyRepository, contactRepository, enrichmentAttemptRepository, hiringSignalRepository } from "@fdl/db";
import { SeamlessClient, SeamlessPollTimeoutError, type PollResult } from "@fdl/enrichment";
import { getDb } from "../db.js";

const log = createLogger("enrich");

const client = new SeamlessClient();

/** Real credit balance from Seamless's X-PublicAPI-Credits header, not an assumption from the docs. */
export function getSeamlessCreditSnapshot(): { first: number | null; last: number | null } {
  return client.getCreditBalanceSnapshot();
}

/**
 * Placeholder heuristic for who to search for at a company: a keyword match on the hiring
 * signal's own role_title, pointed at a plausible supervisor/manager title in that function.
 * The real contact-selection algorithm is a separate later task — this just gives searchContacts
 * something reasonable to search on.
 *
 * Confirmed by direct testing against real data: the original 4-branch version sent 20 of 25
 * real role_titles from one company to the same generic fallback, which made Seamless return
 * the identical contact for genuinely unrelated roles (Construction Manager, CNC Machinist,
 * Buyer, Boilermaker A all resolved to the same HR Manager). Branches below were added to cover
 * exactly the role families observed collapsing.
 *
 * Deliberately not special-cased here: intern/transfer-portal/job-shadowing postings ("2027
 * Internships", "Transfer Portal", "Job Shadowing Portal") aren't roles with a hiring manager to
 * search for in the normal sense — they fall through to the generic fallback rather than getting
 * their own hint branch, since giving them a hint would imply this heuristic can meaningfully
 * point at someone for them. Whether they should be filtered out before ever reaching enrichment
 * is a separate, unresolved question.
 */
export function deriveJobTitleHints(roleTitle: string): string[] {
  const title = roleTitle.toLowerCase();
  if (title.includes("production") || title.includes("manufactur")) {
    return ["Production Manager", "Production Supervisor", "Plant Manager"];
  }
  if (title.includes("maintenance") || title.includes("facilit")) {
    return ["Maintenance Manager", "Maintenance Supervisor", "Facilities Manager"];
  }
  if (title.includes("warehouse") || title.includes("logistics") || title.includes("distribution")) {
    return ["Warehouse Manager", "Logistics Manager", "Operations Manager"];
  }
  if (title.includes("driver") || title.includes("cdl") || title.includes("transport") || title.includes("fleet")) {
    return ["Fleet Manager", "Transportation Manager", "Operations Manager"];
  }
  if (title.includes("construction") || title.includes("build") || title.includes("superintendent")) {
    return ["Construction Manager", "Project Manager", "Site Superintendent"];
  }
  if (
    title.includes("machinist") ||
    title.includes("cnc") ||
    title.includes("fabricat") ||
    title.includes("weld") ||
    title.includes("boilermaker")
  ) {
    return ["Plant Manager", "Production Manager", "Operations Manager"];
  }
  if (title.includes("engineer") || title.includes("design")) {
    return ["Engineering Manager", "Director of Engineering", "VP Engineering"];
  }
  if (title.includes("procurement") || title.includes("buyer") || title.includes("purchasing")) {
    return ["Procurement Manager", "Purchasing Director", "Supply Chain Manager"];
  }
  if (title.includes("business development") || title.includes("sales") || title.includes("marketing")) {
    return ["Director of Business Development", "Sales Manager", "VP Sales"];
  }
  if (title.includes("accounting") || title.includes("finance") || title.includes("account")) {
    return ["Controller", "Finance Director", "CFO"];
  }
  return ["Operations Manager", "General Manager", "HR Manager"];
}

/** "98%" -> 0.98. Null when Seamless didn't return a confidence figure at all. */
export function parseConfidence(percent: string | null | undefined): number | null {
  if (!percent) return null;
  const value = Number.parseFloat(percent.replace("%", ""));
  if (Number.isNaN(value)) return null;
  return Math.max(0, Math.min(1, value / 100));
}

export async function enrichHiringSignal(hiringSignalId: string): Promise<{
  contactId: string | null;
  confidence: number | null;
  // Extra beyond the base contract, additive only: lets run-enrichment.ts break its summary down
  // by outcome (done/error/missing/credits-exhausted/no-domain/...) without re-deriving it.
  terminalStatus?: string;
}> {
  const db = getDb();
  const hiringSignals = hiringSignalRepository(db);
  const companies = companyRepository(db);
  const contacts = contactRepository(db);
  const attempts = enrichmentAttemptRepository(db);

  // Durable record of what happened, success or not — every branch below calls this exactly
  // once before returning, so results survive past terminal stdout for auditing after the fact.
  // requestId/searchResultId are read from the outer closure below (null until known) so a
  // "what did this duplicate actually resolve to" question is answerable straight from the
  // table going forward, without needing terminal scrollback.
  async function recordAttempt(
    status: string,
    opts: { contactId?: string | null; confidence?: number | null; message?: string | null } = {},
  ): Promise<void> {
    await attempts.create({ hiringSignalId, status, requestId, searchResultId, ...opts });
  }

  let searchResultId: string | null = null;
  let requestId: string | null = null;

  // Everything below is wrapped so that no call into this function can ever leave a gap in
  // enrichment_attempts — rate-limit exhaustion, or any other unexpected exception, gets
  // recorded as status: "error" and returns nulls, the same shape as every other
  // terminal-but-unsuccessful outcome (no-phone, poll-timeout, ...) rather than throwing and
  // leaving the caller (worker or script) as the only place that ever saw it happen.
  try {
    const hiringSignal = await hiringSignals.findById(hiringSignalId);
    if (!hiringSignal) throw new Error(`hiring_signal ${hiringSignalId} not found`);

    const company = await companies.findById(hiringSignal.company_id);
    if (!company) throw new Error(`company ${hiringSignal.company_id} not found`);

    if (!company.domain) {
      log.warn(
        { hiringSignalId, companyId: company.id, companyName: company.name },
        "company has no domain — skipping enrichment, no reliable search possible",
      );
      await recordAttempt("no-domain");
      return { contactId: null, confidence: null, terminalStatus: "no-domain" };
    }

    const jobTitleHints = deriveJobTitleHints(hiringSignal.role_title);
    const searchResults = await client.searchContacts(company.domain, jobTitleHints);
    if (searchResults.length === 0) {
      log.info({ hiringSignalId, domain: company.domain, jobTitleHints }, "seamless search returned no candidates");
      await recordAttempt("no-search-results");
      return { contactId: null, confidence: null, terminalStatus: "no-search-results" };
    }

    // Single highest-relevance candidate for now — full weighted selection is a separate later task.
    const topCandidate = searchResults[0];
    searchResultId = topCandidate.searchResultId;
    [requestId] = await client.researchContacts([searchResultId]);

    let results: PollResult[];
    try {
      results = await client.pollUntilDone([requestId]);
    } catch (err) {
      if (err instanceof SeamlessPollTimeoutError) {
        log.warn({ hiringSignalId, requestId }, "seamless research poll timed out — treating as no contact found");
        await recordAttempt("poll-timeout");
        return { contactId: null, confidence: null, terminalStatus: "poll-timeout" };
      }
      throw err;
    }

    const result = results[0];
    let finalResult: PollResult | undefined = result.status === "done" && result.contact ? result : undefined;
    let recoveredViaDuplicate = false;

    // Narrow, single-shot recovery: a "duplicate" carries no contact object itself, only a
    // pointer (additionalData.initialRequestId) to the original request. That original request
    // is often already done — polling it once (no new research submitted, zero additional
    // credits) can recover a real, already-researched contact instead of discarding it. If the
    // initial request is itself still pending, unresolved, or has no usable phone, this falls
    // through to the normal not-found/no-phone handling below — no loop, no further retry.
    if (!finalResult && result.status === "duplicate" && result.additionalData?.initialRequestId) {
      const [recovered] = await client.pollResearch([result.additionalData.initialRequestId]);
      if (recovered?.status === "done" && recovered.contact) {
        log.info(
          { hiringSignalId, requestId, initialRequestId: result.additionalData.initialRequestId },
          "duplicate's initial request already resolved — recovering its contact instead of discarding it",
        );
        finalResult = recovered;
        recoveredViaDuplicate = true;
      }
    }

    if (!finalResult) {
      // error/missing/duplicate (unrecovered)/not found/credits-exhausted are all expected
      // outcomes for some fraction of lookups, not thrown errors — just log and move on.
      log.info(
        { hiringSignalId, requestId, status: result.status, message: result.message },
        "seamless research did not produce a usable contact",
      );
      await recordAttempt(result.status, { message: result.message ?? null });
      return { contactId: null, confidence: null, terminalStatus: result.status };
    }

    // Seamless can return contactPhone1 as "" rather than omitting it — that's not a usable
    // contact for outreach, so treat it the same as not-found rather than writing a phoneless
    // "success" with confidence 0.
    if (!finalResult.contact!.contactPhone1) {
      log.info(
        { hiringSignalId, requestId, recoveredViaDuplicate },
        "seamless research done but returned no usable phone — treating as not found",
      );
      await recordAttempt("no-phone");
      return { contactId: null, confidence: null, terminalStatus: "no-phone" };
    }

    const confidence = parseConfidence(finalResult.contact!.contactPhone1TotalAI);
    const contact = await contacts.create({
      companyId: company.id,
      hiringSignalId,
      name: finalResult.contact!.fullName,
      title: finalResult.contact!.title,
      phone: finalResult.contact!.contactPhone1,
      email: finalResult.contact!.email1,
      confidenceScore: confidence ?? 0,
      source: "seamless",
      sourceContactId: finalResult.contact!.contactId,
    });

    log.info(
      {
        hiringSignalId,
        contactId: contact.id,
        confidence,
        hasPhone: !!contact.phone,
        hasEmail: !!contact.email,
        recoveredViaDuplicate,
      },
      "enrichment produced a contact",
    );
    await recordAttempt("done", {
      contactId: contact.id,
      confidence,
      message: recoveredViaDuplicate ? "recovered via duplicate's initialRequestId" : null,
    });

    return { contactId: contact.id, confidence, terminalStatus: "done" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ hiringSignalId, err }, "enrichHiringSignal threw an unexpected error");
    await recordAttempt("error", { message });
    return { contactId: null, confidence: null, terminalStatus: "error" };
  }
}
