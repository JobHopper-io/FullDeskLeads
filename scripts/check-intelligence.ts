// Run: npx tsx scripts/check-intelligence.ts — the intelligence QA rules on synthetic generations, and the Courier
// wrapper's failure handling on a fake fetch (timeout, 500, garbage). No network, no database.
import assert from "node:assert/strict";
import { verifyGeneration, type Generation } from "../packages/pipeline/src/intelligence/verify.js";
import { callCourier } from "../packages/pipeline/src/intelligence/courier.js";
import { callSentences, generateIntelligence, stripForCall, titleForCall } from "../packages/pipeline/src/intelligence/generate.js";
import { operatingEmployer } from "../packages/sources/src/jobDetails.js";
import { postingText } from "../packages/sources/src/jobDetails.js";
import { applicantsFor, fixedObjections } from "../packages/pipeline/src/intelligence/objections.js";
import { ARCHETYPES, COMPANY_SOURCES, archetypeForEmployer, industryWordFor } from "../packages/pipeline/src/intelligence/sources.js";
import { fixedQuestions } from "../packages/pipeline/src/intelligence/questions.js";
import { intelligenceReviewer, readVerdict, reviewGeneration, reviewUser } from "../packages/pipeline/src/intelligence/review.js";
import { DESCRIPTORS, busyReply, gapLine, whoReply } from "../packages/pipeline/src/intelligence/plant.js";

const inputs = `COMPANY: Industrial Electric Manufacturing
TYPICAL EQUIPMENT: [T1] laser cutters; shears; turret punches; copper/bus bar processing; powder coat line; electrical test equipment
- [T2] Beginning in 1979, IEM pioneered the first CAD/CAM system for electrical equipment metal fabrication.
THE JOB POSTING:
- Role: Test Supervisor
- Location: Fremont, California
- Shift: not stated
- Pay: not stated in the posting
- Posted: 2026-09-11 (open 17 days)
POSTING DESCRIPTION (the job posting's own text):
[D1] This position requires 100% in-office presence in Fremont.
[D2] Occasional travel (up to 75%) to customer sites.
[D3] Supports 2–6 active customer sites.`;
const S: Record<string, string> = {
  T1: "laser cutters; shears; turret punches; copper/bus bar processing; powder coat line; electrical test equipment",
  T2: "Beginning in 1979, IEM pioneered the first CAD/CAM system for electrical equipment metal fabrication.",
  D1: "This position requires 100% in-office presence in Fremont.", D2: "Occasional travel (up to 75%) to customer sites.", D3: "Supports 2–6 active customer sites.",
};
const field = (text: string | null, sourceIds: string[]) => ({ text, sourceIds, sources: sourceIds.map((id) => S[id]) });
const good: Generation = {
  why_now: field("The Test Supervisor role in Fremont has been open 17 days. It asks for 100% in-office presence.", ["D1"]),
  opening_script: field("Hi [first name], this is [your name]. I saw the role needs travel to customer sites; is it still open?", ["D2"]),
};
const check = (g: Generation, inp = inputs, pay = false) => verifyGeneration(g, inp, pay, S);
const v = check(good);
assert.ok(v.pass, JSON.stringify(v.fields));
const bad = (f: (g: Generation) => void) => { const g = structuredClone(good); f(g); return check(g); };
const reason = (r: ReturnType<typeof verifyGeneration>, field: keyof Generation) => r.fields[field].problems.join(" | ");
assert.match(reason(bad((g) => (g.why_now.text = "Open 45 days now. It is a tough role.")), "why_now"), /number not in the inputs: 45/);
assert.match(reason(bad((g) => (g.why_now.text = "The role pays $80,000. It has been open 17 days.")), "why_now"), /mentions pay/);
assert.match(reason(bad((g) => (g.opening_script.text = "Hi, I hear Siemens is your big customer. Is that right?")), "opening_script"), /name\/term not in the inputs: "Siemens"/);
assert.match(reason(bad((g) => (g.opening_script.text = "Hi [first name], who runs the press brake and the robot cell for this in-office role?")), "opening_script"), /press brake/);
assert.match(reason(bad((g) => (g.opening_script.text = "Hi [first name] — quick one. Is it open?")), "opening_script"), /dash/);
assert.match(reason(bad((g) => (g.opening_script.text = "Hi [first name], I work maintenance hires.")), "opening_script"), /asks nothing/);
assert.equal(bad((g) => (g.why_now = field(null, []))).fields.why_now.status, "null", "an honest null is not a failure");
// Sources are sentence IDs: a field needs at least one, and every one must exist in the inputs.
assert.match(reason(bad((g) => (g.why_now.sourceIds = [])), "why_now"), /no source cited/);
assert.match(reason(bad((g) => (g.why_now.sourceIds = ["D1", "D9"])), "why_now"), /source ID not in the inputs: "D9"/);
// A cited sentence must share two content words with the text, or all of them if it has fewer than four.
assert.match(reason(bad((g) => (g.why_now.text = "The Test Supervisor role in Fremont has been open 17 days. Is it still open?")), "why_now"), /shares 0 of 2 required/, "the lead's own location (Fremont) is not a shared content word");
// A temporary site the posting names counts as a place too: "San Antonio" twice is not two shared words.
const siteInputs = inputs + "\n[D4] This position will be based temporarily in NE San Antonio while our new plant comes online.\n[D5] Our permanent location is at Brooks, San Antonio.";
const siteS = { ...S, D4: "This position will be based temporarily in NE San Antonio while our new plant comes online.", D5: "Our permanent location is at Brooks, San Antonio." };
const site = (text: string, ids: string[]) => verifyGeneration({ ...good, why_now: { text, sourceIds: ids, sources: ids.map((i) => siteS[i as keyof typeof siteS]) } }, siteInputs, false, siteS).fields.why_now;
assert.match(site("The role in NE San Antonio has been open 17 days. It asks for 100% in-office presence.", ["D1", "D5"]).problems.join(), /\[D5\]/, "sharing only San Antonio with the Brooks sentence is not a use");
assert.equal(site("The position is based temporarily in NE San Antonio while the new plant comes online. It has been open 17 days.", ["D4"]).status, "pass", "a sentence actually used still passes on its other words");
assert.match(reason(check({ ...good, why_now: field("The role needs travel. It has been open 17 days.", ["D2"]) }), "why_now"), /\[D2\]/, "one word of a longer sentence isn't a use");
const S2 = { ...S, D4: "Inspects equipment before use." };
const short = (text: string) => verifyGeneration({ ...good, why_now: { text, sourceIds: ["D4"], sources: [S2.D4] } }, inputs + "\n[D4] Inspects equipment before use.", false, S2).fields.why_now;
assert.equal(short("It has been open 17 days. Does the role inspect equipment before use?").status, "pass", "a short sentence used in full");
assert.match(short("It has been open 17 days. Does the role inspect equipment?").problems.join(), /shares 2 of 3/, "a sentence under four content words must be used in full");
// Every cited sentence must be used: citing a sentence the text never uses fails the field.
assert.match(reason(bad((g) => (g.why_now.sourceIds = ["D1", "D2"])), "why_now"), /\[D2\] "Occasional travel/);
// An ID tag's digits are not text: "[D3]" in the inputs doesn't ground a "3" in the output.
assert.match(reason(bad((g) => (g.why_now.text = "The role has 3 openings. It asks for 100% in-office presence.")), "why_now"), /number not in the inputs: 3/);
// Growth or trend claims need the same words in the inputs; the archetype's name grounds nothing.
assert.match(reason(bad((g) => (g.opening_script.text = "Hi [first name], is the travel to customer sites growing as you scale up?")), "opening_script"), /growth\/trend claim not in the inputs: "scale up"/);
assert.equal(check({ ...good, why_now: field("The in-office presence Test Supervisor role is open as the plant is growing. It has been 17 days.", ["D1"]) }, inputs + " The plant is growing.").fields.why_now.status, "pass", "a growth claim the posting makes is allowed");
assert.match(reason(check({ ...good, opening_script: field("Hi [first name], do the laser cutters and shears feed the switchgear assembly line?", ["T1"]) }, inputs.replace("COMPANY:", "PLANT ARCHETYPE: SWITCHGEAR_ASSEMBLY\nCOMPANY:")), "opening_script"), /"assembl\*"/, "an archetype name is not grounding");
// A digit range copied from the posting may keep its dash; a range the posting doesn't have, or any other dash, fails.
assert.equal(bad((g) => ((g.why_now.text = "The role supports 2–6 active customer sites. It has been open 17 days."), (g.why_now.sourceIds = ["D3"]))).fields.why_now.status, "pass");
assert.match(reason(bad((g) => (g.why_now.text = "The role supports 2–17 customer sites. It has been open 17 days.")), "why_now"), /dash/);
// [first name] and [your name] are the only placeholders.
assert.match(reason(bad((g) => (g.opening_script.text = "Hi [contact name], this is [your name]. Is the Test Supervisor role open?")), "opening_script"), /placeholder/);
assert.equal(check({ ...good, why_now: field("Pay is $80,000 a year for an in-office presence role. Open 17 days.", ["D1"]) }, inputs.replace("not stated in the posting", "80000 to 90000 USD per year"), true).fields.why_now.status, "pass", "stated pay may be used");
assert.ok(!reason(bad((g) => (g.opening_script.text = "Hi [first name], I saw your posting. Is it still open?")), "opening_script").includes("saw"), "'I saw' is not equipment");
// A reformatted date from the inputs is grounded; any other month is not.
assert.equal(bad((g) => (g.why_now.text = "The in-office presence Test Supervisor role has been open since September 11, 2026. That is 17 days.")).fields.why_now.status, "pass");
assert.match(reason(bad((g) => (g.why_now.text = "The Test Supervisor role has been open since May 11, 2026. That is 17 days.")), "why_now"), /"May"/);
// A title word joined to a dash in the posting ("Field Service –Lead") is still a word from the inputs.
assert.equal(check({ ...good, why_now: field("The in-office presence Field Service Lead role is open. It has been 17 days.", ["D1"]) }, inputs.replace("Role: Test Supervisor", "Role: Field Service –Lead")).fields.why_now.status, "pass");

// Courier failure handling: every failure comes back as a value after exactly one retry; nothing throws.
process.env.GEMMA_API_KEY = "test-key";
let calls = 0;
const failing = (kind: "timeout" | "500" | "garbage") => (async () => {
  calls++;
  if (kind === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  if (kind === "500") return new Response("upstream down", { status: 500 });
  return new Response(JSON.stringify({ status: "completed", output: [{ content: [{ text: "not json at all" }] }] }), { status: 200 });
}) as unknown as typeof fetch;
for (const kind of ["timeout", "500"] as const) {
  calls = 0;
  const r = await callCourier({ system: "s", user: "u" }, failing(kind));
  assert.equal(r.ok, false); assert.equal(calls, 2, `${kind}: one call plus one retry`); assert.equal(r.attempts, 2);
}
let recovered = 0;
const flaky = (async () => (++recovered === 1 ? new Response("busy", { status: 503 }) : new Response(JSON.stringify({ status: "completed", model: "Gemma 4 26B A4B", output: [{ content: [{ text: "ok" }] }] }), { status: 200 }))) as unknown as typeof fetch;
const ok = await callCourier({ system: "s", user: "u" }, flaky);
assert.ok(ok.ok && ok.attempts === 2, "a failure then a success recovers on the retry");
let limited = 0;
const creditLimit = (async () => (limited++, new Response(JSON.stringify({ detail: "Tier credit limit reached for this period." }), { status: 429 }))) as unknown as typeof fetch;
const lim = await callCourier({ system: "s", user: "u" }, creditLimit);
assert.ok(!lim.ok && /^HTTP 429/.test(lim.error) && lim.attempts === 1 && limited === 1, "a 429 (credit limit) fails fast: no retry, error surfaced");
const signal = { id: "x", role_title: "Test Supervisor", location: "Fremont, California", shift: null, pay_min: null, pay_max: null, pay_interval: null, pay_currency: null, posted_date: "2026-09-11" } as never;
calls = 0;
const g = await generateIntelligence(signal, "INDUSTRIAL_ELECTRIC", null, "Industrial Electric Manufacturing", failing("garbage"));
assert.ok(!g.ok && /invalid JSON twice/.test(g.error!) && calls === 2 && g.invalidOutputs!.length === 2, "invalid JSON is retried once, then fails as a format failure");
let n = 0;
const goodJson = JSON.stringify({ why_now: { text: null, sources: [] }, opening_script: { text: "Hi [first name], it's [your name]. Who covers the laser cutters and shears there?", sources: ["[T1]", "T99"] } });
const onceBad = (async () => new Response(JSON.stringify({ status: "completed", output: [{ content: [{ text: ++n === 1 ? "{broken" : goodJson }] }] }), { status: 200 })) as unknown as typeof fetch;
const rj = await generateIntelligence(signal, "INDUSTRIAL_ELECTRIC", null, "Industrial Electric Manufacturing", onceBad);
assert.ok(rj.ok && rj.invalidOutputs!.length === 1, "one invalid output then a valid one: the lead generates, and the bad output is kept");
// The code fills each cited ID with its exact sentence; an ID that doesn't exist fills nothing and fails the field.
assert.deepEqual(rj.generation!.opening_script.sourceIds, ["T1", "T99"]);
assert.equal(rj.generation!.opening_script.sources[0], rj.sentences.T1); assert.equal(rj.generation!.opening_script.sources.length, 1);
assert.ok(!/TYPICAL EQUIPMENT|PLANT ARCHETYPE/.test(rj.inputs), "a role that isn't maintenance gets no archetype equipment lines");
const maint = await generateIntelligence({ ...(signal as object), role_title: "Maintenance Technician" } as never, "INDUSTRIAL_ELECTRIC", null, "Industrial Electric Manufacturing", onceBad);
assert.match(maint.inputs, /TYPICAL EQUIPMENT: \[T2\] /); assert.match(maint.inputs, /COMPANY FACTS[^]*- \[T3\] /); assert.match(rj.verification!.fields.opening_script.problems.join(), /"T99"/);
// Discovery questions are the spec's fixed four, never generated; role intelligence is left as the placeholder.
assert.equal(rj.roleIntelligence, null); assert.equal(Object.keys(rj.generation!).join(), "why_now,opening_script");
assert.deepEqual(rj.discoveryQuestions.questions, ["How long has this one been open?", "What has the last hire or two looked like — what worked, what didn't?", "Is the posted range where you'd actually land for the right person?", "Who else is working this one for you at the moment?"]);
assert.deepEqual(fixedQuestions(3).filter((q) => /those|these/.test(q)), ["How long have those been open?", "Who else is working these for you at the moment?"]);
assert.equal(fixedQuestions(1)[0], "How long has this one been open?");
// Attribution: Crest's operating employer is the Lever department, never a text mention; the opening sentence only
// when there's no department, and only when it names the employer. A mismatch fails the lead before any model call.
assert.equal(operatingEmployer("Crest Industries", { categories: { department: "Millennium Galvanizing" }, descriptionPlain: "Communicate quality requirements with DIS-TRAN Steel." }), "Millennium Galvanizing");
assert.equal(operatingEmployer("Crest Industries", { categories: { department: "DIS-TRAN Steel" } }), "DIS-TRAN Steel");
assert.equal(operatingEmployer("Crest Industries", { descriptionPlain: "DIS-TRAN Steel, located in Eunice, LA, is looking for machinists." }), "DIS-TRAN Steel");
assert.equal(operatingEmployer("Crest Industries", { descriptionPlain: "Come join our team at DIS-TRAN Steel! Our people are great." }), "DIS-TRAN Steel");
assert.equal(operatingEmployer("Crest Industries", { descriptionPlain: "Communicate quality requirements with DIS-TRAN Steel and resolve issues." }), null, "a partner mention is not the employer");
assert.equal(operatingEmployer("Industrial Electric Manufacturing", {}), "Industrial Electric Manufacturing");
calls = 0;
const wrong = await generateIntelligence(signal, "DIS_TRAN_STEEL", null, "Millennium Galvanizing", failing("garbage"));
assert.ok(!wrong.ok && /attribution: employer "Millennium Galvanizing"/.test(wrong.error!) && calls === 0 && !wrong.attribution.ok, "a mismatched employer fails without calling the model");
assert.ok(!(await generateIntelligence(signal, "DIS_TRAN_STEEL", null, "Transfer Portal (Current Employees Only)", failing("garbage"))).attribution.ok);
// The posted title's dash is a space in the inputs, so the model never copies it and the checks never see it.
assert.equal(titleForCall("Field Service –Lead"), "Field Service Lead"); assert.equal(titleForCall("Welder — Night Shift"), "Welder Night Shift");
// Objections by operating employer: a DIS-TRAN Steel posting (Crest's Lever department) gets DIS-TRAN's archetype, so its
// industry slot is "steel fabrication"; another Crest company's posting gets no archetype and so no filled slot.
const dt = archetypeForEmployer(operatingEmployer("Crest Industries", { categories: { department: "DIS-TRAN Steel" } }));
assert.equal(dt, "STEEL_POLE_STRUCTURE_FAB");
assert.equal(fixedObjections(ARCHETYPES[dt!].industry, "Fitter I", true)[1].response, "Makes sense. Are you getting steel fabrication people through it, or mostly general welding applicants?");
assert.match(fixedObjections(ARCHETYPES[dt!].industry, "Fitter I", true)[3].response, /the steel fabrication background\?$/);
assert.equal(archetypeForEmployer(operatingEmployer("Crest Industries", { categories: { department: "Millennium Galvanizing" } })), null);
assert.equal(archetypeForEmployer("Industrial Electric Manufacturing"), "SWITCHGEAR_ASSEMBLY");
// A lead with no plant archetype: "We post our own" uses the company's own business, never drops the slot, and the
// applicant-pool guess never pretends to know a trade it has none of — always "general applicants".
assert.equal(industryWordFor("Stripe"), "fintech");
assert.equal(industryWordFor("Millennium Galvanizing"), "the industry", "a company with no archetype and no mapped business still gets a word, never a guess");
assert.equal(fixedObjections(industryWordFor("Stripe"), "Senior Software Engineer, Build Loop", false)[1].response, "Makes sense. Are you getting fintech people through it, or mostly general applicants?");
assert.equal(fixedObjections(industryWordFor("Stripe"), "Staff Software Engineer, Data Warehouse", false)[1].response, "Makes sense. Are you getting fintech people through it, or mostly general applicants?", "the warehouse-keyword false positive never fires without an archetype");
// The intelligence splitter doesn't end a sentence at a state code or the dialog's abbreviations.
assert.deepEqual(callSentences("DIS-TRAN Steel has an opening at our Pineville, LA. plant. Reimbursement (e.g. gym). Contact me. Next one."), ["DIS-TRAN Steel has an opening at our Pineville, LA. plant.", "Reimbursement (e.g. gym).", "Contact me.", "Next one."]);
// Objections are the spec's fixed set, never generated, with the archetype's industry word in the slot.
assert.deepEqual(rj.objections.pairs.map((p) => p.objection), ["We don't use agencies.", "We post our own.", "Too expensive.", "Email me something."]);
assert.equal(rj.objections.pairs[1].response, "Makes sense. Are you getting switchgear people through it, or mostly general applicants?", "a role outside every family gets the fallback");
assert.equal(applicantsFor("CNC Machinist", true), "general machinist applicants"); assert.equal(applicantsFor("Materials Supervisor", true), "general materials applicants");
assert.equal(applicantsFor("Equipment Operator", true), "general material handling applicants"); assert.equal(applicantsFor("Machine Operator", true), "general equipment operator applicants"); assert.equal(applicantsFor("Maintenance Technician", true), "general maintenance applicants");
assert.equal(applicantsFor("Maintenance Technician", false), "general applicants", "no archetype: never guesses a trade, even off a title that would otherwise match one");
assert.ok(!JSON.stringify(rj.objections).includes("foundry") && !JSON.stringify(rj.objections).includes("{industry}"));
const t = await generateIntelligence(signal, "INDUSTRIAL_ELECTRIC", null, "Industrial Electric Manufacturing", failing("timeout"));
assert.ok(!t.ok && /TimeoutError/.test(t.error!) && t.attempts === 2, "a timed-out lead fails cleanly after one retry");
console.log("ok");

// Description stripping: boilerplate and pay go, real duties stay (including "commissioning", and content glued to a
// boilerplate heading with no full stop between).
const stripped = stripForCall("Come join our team at DIS-TRAN Steel! Our people – not our machinery - are our biggest assets. DIS-TRAN Steel, located in Eunice, LA, is looking for experienced CNC Machinists to join our team. Lead start-up and commissioning activities at customer sites. Qualifications: 3 to 7 years in planning Compensation actually offered will vary. [Compensation: USD $82,000 - $103,000] We offer a competitive benefits package. DIS-TRAN Steel is an affirmative action and equal opportunity employer. More information regarding Referral Programs can be found here. Use of AI At IEM, we are committed to a fair hiring process.");
assert.equal(stripped, "DIS-TRAN Steel, located in Eunice, LA, is looking for experienced CNC Machinists to join our team. Lead start-up and commissioning activities at customer sites. Qualifications: 3 to 7 years in planning");
// List items survive flattening as separate sentences (Greenhouse content is HTML-escaped); extraction is unchanged.
const gh = { content: "&lt;p&gt;Key Responsibilities:&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Develop schedules&lt;/li&gt;&lt;li&gt;Utilize ERP&lt;/li&gt;&lt;/ul&gt;" };
assert.deepEqual(callSentences(postingText("greenhouse", gh, true)), ["Key Responsibilities:", "Develop schedules", "Utilize ERP"]);
assert.equal(postingText("greenhouse", gh), "Key Responsibilities: Develop schedules Utilize ERP");
console.log("ok: description stripping");

// The review gate (review.ts): off unless INTELLIGENCE_REVIEWER names a reviewer; the verdict is read strictly, and a
// reviewer that can't answer or answers in a shape we can't read fails the lead.
const setReviewer = (v: string | undefined) => (v === undefined ? delete process.env.INTELLIGENCE_REVIEWER : (process.env.INTELLIGENCE_REVIEWER = v));
for (const [v, want] of [[undefined, null], ["", null], ["true", null], ["Gemma", null], ["gemma", "gemma"], ["claude", "claude"]] as const) {
  setReviewer(v); assert.equal(intelligenceReviewer(), want, `INTELLIGENCE_REVIEWER=${JSON.stringify(v)}`);
}
setReviewer(undefined);
const gen: Generation = { why_now: { text: "Open 13 days. It leads daily test operations.", sourceIds: ["D1"], sources: [] }, opening_script: { text: "Who runs the Hi-Pot testing?", sourceIds: ["D2"], sources: [] } };
const claim = (c: Partial<{ claim: string; about: string; source: string; source_says: string; faithful: boolean }>) => ({ claim: "leads daily test operations", about: "role_duty", source: "D1", source_says: "duty", faithful: true, ...c });
const age = claim({ claim: "Open 13 days", about: "role_other", source: "posting_line", source_says: "location_or_timing" });
const ok2 = (why: object[], open: object[] = [claim({ claim: "runs the Hi-Pot testing", source: "D2" })]) => readVerdict(JSON.stringify({ why_now: { claims: why }, opening_script: { claims: open } }), gen)!;
const rules = (v: ReturnType<typeof ok2>) => v.problems.map((p) => `${p.field}:${p.rule}`);
assert.ok(ok2([age, claim({})]).fields.why_now.pass && ok2([age, claim({})]).fields.opening_script.pass, "a faithful duty from a duty sentence passes, next to the posting's age");
assert.deepEqual(rules(ok2([age])), ["why_now:unused_citation", "why_now:no_duty"], "age alone: no duty, and the cited sentence is unused");
assert.deepEqual(rules(ok2([age, claim({ source: "D1", source_says: "perk" })])), ["why_now:wrong_subject", "why_now:no_duty"], "a duty taken from a perk sentence");
assert.deepEqual(rules(ok2([claim({ faithful: false })])), ["why_now:invented_fact", "why_now:no_duty"], "an unfaithful duty");
assert.deepEqual(rules(ok2([claim({}), claim({ claim: "for a new plant", source: "none", about: "company" })])), ["why_now:invented_fact"], "a claim with no source");
assert.deepEqual(rules(ok2([claim({ source: "[D1]" })], [])), ["opening_script:unreadable", "opening_script:unused_citation"], "no claims in a field; a bracketed ID still matches");
assert.ok(ok2([claim({ claim: "LEADS daily test operations" })]).problems.length === 0);
assert.equal(readVerdict("not json", gen), null);
const pass = { claims: [claim({})] };
process.env.GEMMA_API_KEY ??= "test";
const reply = (text: string) => (async () => new Response(JSON.stringify({ status: "completed", model: "Gemma 4 26B A4B", output: [{ content: [{ text }] }] }), { status: 200 })) as unknown as typeof fetch;
assert.ok(!(await reviewGeneration("gemma", "INPUTS", gen, reply("garbage"))).pass, "unreadable review output twice fails the lead");
assert.ok((await reviewGeneration("gemma", "INPUTS", gen, reply(JSON.stringify({ why_now: pass, opening_script: { claims: [claim({ source: "D2" })] } })))).pass);
assert.ok(!(await reviewGeneration("gemma", "INPUTS", gen, failing("500"))).pass, "an unreachable reviewer fails the lead");
assert.ok(!/D1/.test(reviewUser("INPUTS", gen)), "the reviewer isn't shown what was cited; the code checks citations against its labels");
console.log("ok: review gate");

// The plant layer (plant.ts): fixed copy, the descriptor traceable to the company's own site, and the gap computed per
// maintenance posting.
{
  const iem = COMPANY_SOURCES.INDUSTRIAL_ELECTRIC.facts.join(" ");
  for (const f of DESCRIPTORS["Industrial Electric Manufacturing"].from) assert.ok(iem.includes(f), `descriptor source is on the site: ${f}`);
  assert.ok(!/fremont|san antonio|texas|california/i.test(DESCRIPTORS["Industrial Electric Manufacturing"].text), "the descriptor names no city");
  assert.equal(gapLine("SWITCHGEAR_ASSEMBLY", "Maintenance Technician", "Troubleshoot PLCs, welding repairs and hydraulic presses."),
    "Posting names welding. It never mentions the sheet-metal line (lasers, shears, turret punches), copper bus processing, the powder coat line, electrical test equipment or building systems.");
  assert.equal(gapLine("SWITCHGEAR_ASSEMBLY", "Maintenance Tech", "HVAC, copper bus bar, turret punch, powder coat, welding, Hi-Pot"), null, "a posting naming everything has no gap");
  assert.equal(gapLine("SWITCHGEAR_ASSEMBLY", "Test Supervisor", "Hi-Pot and Megger"), null, "the gap is defined for maintenance hires only");
  assert.equal(gapLine("STEEL_POLE_STRUCTURE_FAB", "Maintenance Technician", "cranes"), null, "an archetype with no plant layer has no gap");
  assert.match(gapLine("SWITCHGEAR_ASSEMBLY", "Maintenance Technician", "Keep things running.")!, /^Posting never mentions /);
  assert.equal(busyReply(null), "No problem — one question and I'll let you go. Is this one still open?");
  assert.equal(busyReply(3), "No problem — one question and I'll let you go. Are those still open?");
  assert.equal(whoReply("Buyer", "manufacturing"), "Recruiter — manufacturing only. Not a temp shop.");
  assert.equal(whoReply("Maintenance Technician", "manufacturing"), "Recruiter — maintenance only, manufacturing only. Not a temp shop.");
  assert.equal(whoReply("Recruiter", null), "Recruiter. Not a temp shop.", "no archetype: never claims manufacturing for a company that isn't one");
  assert.equal(whoReply("Superintendent", "commercial construction"), "Recruiter — commercial construction only. Not a temp shop.", "a non-manufacturing archetype (COMMERCIAL_CONSTRUCTION_GC) names its own domain, never 'manufacturing'");
  console.log("ok: plant layer");
}
