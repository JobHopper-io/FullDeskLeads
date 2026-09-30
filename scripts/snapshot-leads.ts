// Run: npx tsx --env-file=.env scripts/snapshot-leads.ts — READ-ONLY fingerprint of every emitted lead: its assignments,
// its signal's status and all interaction events, as counts plus a sha256. Run before and after anything that could touch
// real leads (a check suite, a sweep): identical output means nothing changed.
import { createHash } from "node:crypto";
import { createServiceClient } from "@fdl/db";
import { loadEnv } from "@fdl/shared";
const db = createServiceClient(loadEnv());
const leads = (await db.from("leads").select("id, hiring_signal_id").order("id")).data!;
const asg = (await db.from("lead_assignments").select("id, lead_id, state, next_action_at, updated_at").in("lead_id", leads.map((l) => l.id)).order("id")).data!;
const sig = (await db.from("hiring_signals").select("id, status, status_reason, status_changed_at").in("id", leads.map((l) => l.hiring_signal_id)).order("id")).data!;
const ev = (await db.from("interaction_events").select("*").order("id")).data!;
const states = asg.reduce<Record<string, number>>((t, a) => ((t[a.state] = (t[a.state] ?? 0) + 1), t), {});
console.log(`leads ${leads.length} | assignments ${asg.length} ${JSON.stringify(states)} | signals ${JSON.stringify(sig.reduce<Record<string, number>>((t, s) => ((t[s.status] = (t[s.status] ?? 0) + 1), t), {}))} | events ${ev.length} | sha256 ${createHash("sha256").update(JSON.stringify({ leads, asg, sig, ev })).digest("hex").slice(0, 16)}`);
