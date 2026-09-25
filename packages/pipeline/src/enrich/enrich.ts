import { createLogger } from "@fdl/shared";
import { companyRepository, contactRepository, enrichmentAttemptRepository, hiringSignalRepository } from "@fdl/db";
import { SeamlessClient, SeamlessPollTimeoutError, type PollResult } from "@fdl/enrichment";
import { getDb } from "../db.js";
import { MAX_CONTACTS_PER_SIGNAL, buildTitleTargets, selectCandidates, siteVsCorporate, tierOf } from "./multiContact.js";

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
  /** The signal's primary contact: the highest-confidence one found. */
  contactId: string | null;
  confidence: number | null;
  // Additive: every contact written this call (primary first), and how many contacts were sent to research
  // (each is 1 credit unless Seamless already had it), so a run can report hit rate and spend.
  contactIds?: string[];
  researchSubmitted?: number;
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

    // One search (1 credit) over three tiers of title (the role family's own, site leadership, HR), then up to
    // MAX_CONTACTS_PER_SIGNAL distinct people from it, at most one per tier before any tier repeats.
    const jobTitleHints = buildTitleTargets(deriveJobTitleHints(hiringSignal.role_title));
    const searchResults = await client.searchContacts(company.domain, jobTitleHints);
    if (searchResults.length === 0) {
      log.info({ hiringSignalId, domain: company.domain, jobTitleHints }, "seamless search returned no candidates");
      await recordAttempt("no-search-results");
      return { contactId: null, confidence: null, terminalStatus: "no-search-results" };
    }

    // Seamless returns other companies' people when the domain filter has no exact hit, so anyone who isn't
    // this company's (by domain or company name) is dropped before a single research credit is spent on them.
    const { picked, rejected } = selectCandidates(searchResults, {
      domain: company.domain,
      companyName: company.name,
      aliases: company.aliases,
    });
    if (rejected.length > 0) {
      log.info(
        { hiringSignalId, domain: company.domain, rejected: rejected.map((x) => `${x.result.name}: ${x.reason}`) },
        "search results dropped as not this company's people",
      );
    }
    if (picked.length === 0) {
      await recordAttempt("no-matching-company", {
        message: `${searchResults.length} search result(s), none from this company (${rejected[0]?.reason ?? "n/a"})`,
      });
      return { contactId: null, confidence: null, terminalStatus: "no-matching-company" };
    }

    // Research every picked person in one request. Seamless returns one requestId per id submitted, in order.
    const requestIds = await client.researchContacts(picked.map((c) => c.searchResultId));
    if (requestIds.length !== picked.length) {
      throw new Error(`seamless returned ${requestIds.length} requestId(s) for ${picked.length} researched contact(s)`);
    }

    let results: PollResult[];
    try {
      results = await client.pollUntilDone(requestIds);
    } catch (err) {
      if (!(err instanceof SeamlessPollTimeoutError)) throw err;
      // Keep whoever finished; the ones still pending are simply not contacts this time.
      log.warn({ hiringSignalId, pending: err.pendingRequestIds.length }, "seamless research poll timed out — keeping the contacts that finished");
      results = await client.pollResearch(requestIds);
    }
    const byRequest = new Map(results.map((res) => [res.requestId, res]));

    // Narrow, single-shot recovery, now for the whole batch in one call: a "duplicate" carries no contact object,
    // only a pointer (additionalData.initialRequestId) to the original request, which is often already done.
    // Polling those once submits no new research (zero additional credits). If one is still pending, unresolved
    // or has no usable phone it falls through to the failure handling below: no loop, no further retry.
    const duplicateOf = new Map<string, string>();
    for (const res of results) {
      if (res.status === "duplicate" && res.additionalData?.initialRequestId) duplicateOf.set(res.requestId, res.additionalData.initialRequestId);
    }
    const recoveredByInitial = new Map<string, PollResult>();
    if (duplicateOf.size > 0) {
      for (const rec of await client.pollResearch([...new Set(duplicateOf.values())])) recoveredByInitial.set(rec.requestId, rec);
    }

    interface Found {
      candidate: (typeof picked)[number];
      requestId: string;
      contact: NonNullable<PollResult["contact"]>;
      confidence: number | null;
      recovered: boolean;
    }
    const found: Found[] = [];
    const failures: string[] = [];
    const seenPeople = new Set<string>();
    picked.forEach((candidate, i) => {
      const requestId = requestIds[i];
      const res = byRequest.get(requestId);
      let final: PollResult | undefined = res?.status === "done" && res.contact ? res : undefined;
      let recovered = false;
      const initial = duplicateOf.get(requestId);
      if (!final && initial) {
        const rec = recoveredByInitial.get(initial);
        if (rec?.status === "done" && rec.contact) {
          log.info({ hiringSignalId, requestId, initialRequestId: initial }, "duplicate's initial request already resolved — recovering its contact instead of discarding it");
          final = rec;
          recovered = true;
        }
      }
      if (!final) {
        // error/missing/duplicate (unrecovered)/not found/credits-exhausted are all expected outcomes for some
        // fraction of lookups, not thrown errors — just log and move on.
        log.info({ hiringSignalId, requestId, status: res?.status, message: res?.message }, "seamless research did not produce a usable contact");
        failures.push(res?.status ?? "no-result");
        return;
      }
      // Seamless can return contactPhone1 as "" rather than omitting it — not a usable contact for outreach.
      if (!final.contact!.contactPhone1) {
        log.info({ hiringSignalId, requestId, recovered }, "seamless research done but returned no usable phone — treating as not found");
        failures.push("no-phone");
        return;
      }
      // The (hiring_signal_id, source_contact_id) key (migration 0024) needs Seamless's own id, and two picked
      // candidates can resolve to the same person (a duplicate recovering to another pick's request).
      const personId = final.contact!.contactId;
      if (!personId || seenPeople.has(personId)) {
        failures.push(personId ? "same-person" : "no-contact-id");
        return;
      }
      seenPeople.add(personId);
      found.push({ candidate, requestId, contact: final.contact!, confidence: parseConfidence(final.contact!.contactPhone1TotalAI), recovered });
    });

    if (found.length === 0) {
      // Same terminal statuses as before: with one candidate this is exactly the old behavior. With several, the
      // status is the first failure's.
      const status = failures[0] ?? "no-result";
      await recordAttempt(status, { message: failures.length > 1 ? `all ${failures.length} researched contacts failed: ${failures.join(", ")}` : null });
      return { contactId: null, confidence: null, terminalStatus: status, researchSubmitted: picked.length };
    }

    const created: { id: string; confidence: number | null; source: Found }[] = [];
    for (const f of found) {
      const cand = f.candidate;
      try {
        const contact = await contacts.create({
          companyId: company.id,
          hiringSignalId,
          name: f.contact.fullName,
          title: f.contact.title,
          phone: f.contact.contactPhone1,
          email: f.contact.email1,
          confidenceScore: f.confidence ?? 0,
          source: "seamless",
          sourceContactId: f.contact.contactId,
          contactCity: cand.city,
          contactState: cand.state,
          siteVsCorporate: siteVsCorporate(cand.city, cand.state, cand.companyCity, cand.companyState),
        });
        created.push({ id: contact.id, confidence: f.confidence, source: f });
      } catch (err) {
        // A concurrent run for the same signal already wrote this person: the unique key did its job.
        if ((err as { code?: string }).code === "23505") {
          log.warn({ hiringSignalId, sourceContactId: f.contact.contactId }, "contact already stored for this signal — skipping the duplicate");
          continue;
        }
        throw err;
      }
    }
    if (created.length === 0) {
      await recordAttempt("done", { message: "every researched contact was already stored for this signal" });
      return { contactId: null, confidence: null, terminalStatus: "done", contactIds: [], researchSubmitted: picked.length };
    }

    // Primary = highest confidence (the same rule emit applies when it writes leads.primary_contact_id).
    const ordered = [...created].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const primary = ordered[0];
    requestId = primary.source.requestId;
    searchResultId = primary.source.candidate.searchResultId;

    log.info(
      {
        hiringSignalId,
        contactIds: ordered.map((c) => c.id),
        confidences: ordered.map((c) => c.confidence),
        tiers: created.map((c) => tierOf(c.source.contact.title)),
        contacts: created.length,
        picked: picked.length,
        recovered: created.filter((c) => c.source.recovered).length,
      },
      "enrichment produced contacts",
    );
    await recordAttempt("done", {
      contactId: primary.id,
      confidence: primary.confidence,
      message: `${created.length} contact(s) of ${picked.length} researched${created.some((c) => c.source.recovered) ? `; ${created.filter((c) => c.source.recovered).length} recovered via duplicate's initialRequestId` : ""}`,
    });

    return {
      contactId: primary.id,
      confidence: primary.confidence,
      contactIds: ordered.map((c) => c.id),
      researchSubmitted: picked.length,
      terminalStatus: "done",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ hiringSignalId, err }, "enrichHiringSignal threw an unexpected error");
    await recordAttempt("error", { message });
    return { contactId: null, confidence: null, terminalStatus: "error" };
  }
}
