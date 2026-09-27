import { createLogger } from "@fdl/shared";
import { hiringSignalRepository, leadAssignmentRepository } from "@fdl/db";
import { getDb } from "../db.js";
import { filterReasonFor } from "../filter/filter.js";
import { checkPostingStillLive, expireGonePosting } from "../verify/verifyLive.js";

const log = createLogger("sweep");

export type SweepOutcome =
  | "signal-already-inactive" // the signal was invalidated after the lead was emitted (excluded / expired / filtered)
  | "excluded" // a filter rule now excludes it
  | "expired" // its posting is confirmed gone from every board it was on
  | "live"
  | "unknown" // the source could not be checked: left exactly as it is, retried next sweep
  | "error";

export interface SweepFinding {
  hiringSignalId: string;
  leadId: string;
  company: string;
  roleTitle: string;
  outcome: SweepOutcome;
  detail: string | null;
  /** Assignments moved to expired (would be, in a dry run). */
  expiredAssignmentIds: string[];
}

/**
 * Re-runs the same decisions the pipeline already makes before a lead exists — the filter rules and live re-verification —
 * against every lead a recruiter can still work, because a signal can be invalidated after its lead was emitted and
 * nothing else looks back. When a signal is no longer valid, its status is set (with status_changed_at, via setStatus)
 * and every workable assignment of that lead moves to expired. A can't-check result changes nothing.
 *
 * Never touches interaction_events, so a recruiter's call history stays exactly as logged.
 * dryRun reports what would change and writes nothing.
 */
export async function sweepEmittedLeads(opts: { dryRun?: boolean } = {}): Promise<{ assignmentsChecked: number; signalsChecked: number; findings: SweepFinding[] }> {
  const dryRun = opts.dryRun ?? false;
  const db = getDb();
  const assignments = leadAssignmentRepository(db);
  const workable = await assignments.listWorkable();

  // One check per signal, however many tenants hold its lead.
  const bySignal = new Map<string, typeof workable>();
  for (const a of workable) bySignal.set(a.hiring_signal_id, [...(bySignal.get(a.hiring_signal_id) ?? []), a]);

  const findings: SweepFinding[] = [];
  for (const [hiringSignalId, group] of bySignal) {
    const { lead_id: leadId, company, role_title: roleTitle, signal_status: status } = group[0];
    const finding = { hiringSignalId, leadId, company, roleTitle, expiredAssignmentIds: [] as string[] };
    const record = (outcome: SweepOutcome, detail: string | null) => findings.push({ ...finding, outcome, detail });
    try {
      let invalid: { outcome: SweepOutcome; detail: string } | null = null;

      if (status !== "active") {
        // The status is already recorded (and stays: its original change is not restamped).
        invalid = { outcome: "signal-already-inactive", detail: `signal status is ${status}` };
      } else {
        const reason = await filterReasonFor(hiringSignalId);
        if (reason) {
          if (!dryRun) await hiringSignalRepository(db).setStatus(hiringSignalId, "excluded", reason);
          invalid = { outcome: "excluded", detail: reason };
        } else {
          const liveness = await checkPostingStillLive(hiringSignalId);
          if (liveness === "gone") {
            if (!dryRun) await expireGonePosting(hiringSignalId);
            invalid = { outcome: "expired", detail: "posting no longer on its source board" };
          } else {
            record(liveness, null);
            continue;
          }
        }
      }

      const ids = dryRun ? group.map((g) => g.id) : await assignments.expireWorkableForLead(leadId);
      findings.push({ ...finding, ...invalid, expiredAssignmentIds: ids });
      log.info({ hiringSignalId, leadId, company, roleTitle, ...invalid, assignments: ids.length, dryRun }, "lead sweep: signal no longer valid — assignment(s) expired");
    } catch (error) {
      // One bad signal must not abort the sweep for every other lead.
      log.error({ hiringSignalId, err: error }, "lead sweep: failed on this signal — left as is");
      record("error", error instanceof Error ? error.message : String(error));
    }
  }

  const tally = findings.reduce<Record<string, number>>((t, f) => ((t[f.outcome] = (t[f.outcome] ?? 0) + 1), t), {});
  log.info({ assignmentsChecked: workable.length, signalsChecked: bySignal.size, tally, dryRun }, "lead sweep complete");
  return { assignmentsChecked: workable.length, signalsChecked: bySignal.size, findings };
}
