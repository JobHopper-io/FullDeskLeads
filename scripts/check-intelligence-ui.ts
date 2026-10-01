// Run: npx tsx scripts/check-intelligence-ui.ts — apps/web's lib/intelligence.ts (the screens' read of objections and
// the plant layer), for a lead with no plant archetype (domain-expansion scoping pass, 2026-10-01): no
// descriptor/equipment/gap/why-hard/show-your-work force-fit, a domain-neutral "who", and a full 4-objection set with
// the company's own business in the {industry} slot instead of a plant word.
import assert from "node:assert/strict";
import { equipmentFor, objectionsFor, plantArchetypeOf, plantLayerFor } from "../apps/web/src/lib/intelligence.js";
import type { QueueItem } from "../apps/web/src/lib/types.js";

const base: QueueItem = {
  id: "x", state: "queued", deliveredAt: null, company: "Stripe", roleTitle: "Staff Software Engineer, Data Warehouse",
  location: null, contact: { name: "", title: "", phone: null, email: null }, freshnessBand: null, openingCount: null,
  shift: null, pay: null, payContext: null, jobDescription: null, employer: "Stripe", whyNow: null, contactId: "c",
  contactFlaggedAt: null, functionMatch: false, signalFirstSeen: "", postedDate: null, contactConfidence: 0,
  phoneVerifiedAt: null, openingScript: null, roleIntelligence: null, objections: null, noAnswerAttempts: 0,
  alternateContacts: [], nextActionAt: null, notes: [], lastEvent: null,
};

assert.equal(plantArchetypeOf(base), null, "Stripe has no documented plant archetype");
assert.equal(equipmentFor(base), null, "no equipment chips force-fit for a non-plant company");

const plant = plantLayerFor(base);
assert.equal(plant.descriptor, null);
assert.equal(plant.whyHard, null);
assert.equal(plant.showYourWork, null);
assert.equal(plant.gap, null);
assert.equal(plant.who, "Recruiter. Not a temp shop.", "never claims manufacturing for a company that isn't one");
assert.ok(plant.busy && plant.lightClose && plant.lightCloseGuided, "who/busy/light-close aren't plant-specific: always present, archetype or not");

const objections = objectionsFor(base);
assert.equal(objections.length, 4, "\"We post our own\" and \"Email me something\" are never dropped for a non-plant lead");
assert.equal(objections[1].response, "Makes sense. Are you getting fintech people through it, or mostly general applicants?");
assert.match(objections[3].response, /the fintech background\?$/);

// A lead already carrying stored objections (real generation, once that's built for these leads) is used as-is.
const stored: QueueItem = { ...base, objections: [{ objection: "Custom.", response: "Stored." }] };
assert.deepEqual(objectionsFor(stored), [{ objection: "Custom.", response: "Stored." }]);

// An employer with no mapped business (not one of the 17, and no archetype) still gets a word, never a guess.
const unmapped: QueueItem = { ...base, company: "Unknown Co", employer: "Unknown Co" };
assert.match(objectionsFor(unmapped)[1].response, /Are you getting the industry people/);

console.log("intelligence UI checks passed");
