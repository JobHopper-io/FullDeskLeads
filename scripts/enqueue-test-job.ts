import { randomUUID } from "node:crypto";
import { createQueue, redisConnection, QUEUE_NAMES } from "@fdl/queue";
import { leadContractSchema, CONTRACT_VERSION, type LeadContract } from "@fdl/contracts";

const now = new Date().toISOString();

const fakeLead: LeadContract = leadContractSchema.parse({
  id: randomUUID(),
  contractVersion: CONTRACT_VERSION,
  status: "draft",
  quarantineReason: null,
  whyNow: null,
  pitchAngle: null,
  openingScript: null,
  roleIntelligence: null,
  objections: null,
  generationModelVersion: null,
  primaryContactId: randomUUID(),
  alternateContactIds: [],
  hiringSignal: {
    id: randomUUID(),
    companyId: randomUUID(),
    roleTitle: "Senior Recruiter",
    location: "Austin, TX",
    department: "Talent Acquisition",
    source: "greenhouse",
    sourcePostingId: "test-posting-1",
    postedDate: now.slice(0, 10),
    detectedAt: now,
    freshnessBand: "fresh",
    status: "active",
  },
  contact: {
    id: randomUUID(),
    companyId: randomUUID(),
    name: "Jordan Smoke-Test",
    title: "VP Talent",
    phone: null,
    phoneVerified: false,
    email: "jordan@example.com",
    emailVerified: false,
    confidenceScore: 0.9,
    source: "seamless",
  },
  company: {
    id: randomUUID(),
    name: "Acme Staffing Co",
    domain: "acmestaffing.example.com",
    industry: "staffing",
    sizeBand: "mid_market",
    revenueBand: "10m_50m",
    hqLocation: "Austin, TX",
    ownershipType: "independent",
    createdAt: now,
    updatedAt: now,
  },
  createdAt: now,
  updatedAt: now,
});

const ingestQueue = createQueue<LeadContract>(QUEUE_NAMES.INGEST);
const job = await ingestQueue.add(QUEUE_NAMES.INGEST, fakeLead);

console.log(`enqueued job ${job.id} onto ${QUEUE_NAMES.INGEST} — watch it flow through Bull Board`);

await ingestQueue.close();
await redisConnection.quit();
