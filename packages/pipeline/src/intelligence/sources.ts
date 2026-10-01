/**
 * The only company and archetype facts the intelligence generator may use. Everything here is copied verbatim:
 * archetype text from the evidence-backed proposals (2026-09-27), company sentences from each company's own verified
 * site (domain + name on file + stated parent, fetched 2026-09-27). Never edited, summarised or added to by hand;
 * anything a generated line says about a company must trace back to these strings or the posting's own fields.
 */

export interface Archetype {
  name: string;
  /** What a maintenance tech there actually contends with (the archetype's one line). */
  contendsWith: string;
  /** Five or six near-universal items only; distinguishing detail stays in the company descriptor. */
  equipment: string[];
  /**
   * The one hand-chosen word here (not copied from a source): the industry slot in the fixed objection responses
   * ("Are you getting ___ people through it", "the ___ background"), as the spec's foundry example uses "foundry".
   */
  industry: string;
  /**
   * What kind of operation this is, for whoReply's "Recruiter — ___ only" (plant.ts): "manufacturing" for a plant,
   * something else for an archetype that isn't one (added for COMMERCIAL_CONSTRUCTION_GC, which is a jobsite, not a
   * plant — claiming "manufacturing only" to a GC superintendent would be false).
   */
  domain: string;
}

export const ARCHETYPES = {
  SWITCHGEAR_ASSEMBLY: {
    name: "SWITCHGEAR_ASSEMBLY",
    contendsWith: "Sheet-metal fabrication (lasers, shears, turret punches), copper bus processing, the powder coat line, welding, electrical test equipment, and building systems across several plant buildings",
    equipment: ["laser cutters", "shears", "turret punches", "copper/bus bar processing", "powder coat line", "electrical test equipment"],
    industry: "switchgear",
    domain: "manufacturing",
  },
  STEEL_POLE_STRUCTURE_FAB: {
    name: "STEEL_POLE_STRUCTURE_FAB",
    contendsWith: "Submerged-arc seam welders on the pole lines, CNC drill and saw lines, overhead cranes moving long steel sections, hydraulic and electrical machinery under PLC control, forklifts and yard handling",
    equipment: ["submerged-arc seam welders", "CNC drill and saw lines", "overhead cranes and hoists", "hydraulic systems", "PLC controls"],
    industry: "steel fabrication",
    domain: "manufacturing",
  },
  /**
   * Agent-authored 2026-10-02, following the same "evidence-backed proposal" shape as the two archetypes above but
   * without one on file yet — needs Schepmont's review before it's relied on in a real call, same as those two were
   * flagged when first written. A commercial GC jobsite, not a plant: contendsWith/equipment describe jobsite
   * realities (trade coordination, schedule, safety, GC-side quality control), not literal equipment, since a GC
   * self-performs some trades (concrete, carpentry) but mostly coordinates subcontractors rather than running a
   * production line.
   */
  COMMERCIAL_CONSTRUCTION_GC: {
    name: "COMMERCIAL_CONSTRUCTION_GC",
    contendsWith: "Several subcontractor trades running on one schedule at once, the GC's own safety and quality-control program across every active site, the submittal/RFI back-and-forth with owner and architect, and self-performed concrete and carpentry crews alongside subbed-out trades",
    equipment: ["multi-trade schedule coordination", "jobsite safety program", "submittal/RFI process", "self-perform concrete and carpentry crews", "GC-side quality control", "multi-site staffing across one region"],
    industry: "commercial construction",
    domain: "commercial construction",
  },
} satisfies Record<string, Archetype>;

export interface CompanySource {
  /** The operating entity the posting is for, as its own site names it. */
  company: string;
  /** The employer a posting must be attributed to (operatingEmployer) for this source and its archetype to apply. */
  employer: string;
  parent: string | null;
  archetype: keyof typeof ARCHETYPES;
  sourceUrls: string[];
  /** Verbatim sentences from the verified site. */
  facts: string[];
}

export const COMPANY_SOURCES = {
  INDUSTRIAL_ELECTRIC: {
    company: "Industrial Electric Manufacturing",
    employer: "Industrial Electric Manufacturing",
    parent: null,
    archetype: "SWITCHGEAR_ASSEMBLY",
    sourceUrls: ["https://www.iemfg.com/about/"],
    facts: ["Industrial Electric Mfg (IEM) began in a barn on a family ranch in Fremont, California. We grew along with Silicon Valley, expanding to a 12,000 sq. ft. facility in 1957, 70,000 sq. ft. in 1980, 105,000 sq. ft. in 2003, and 135,000 sq. ft. by 2013. Today, IEM has 1.5M+ sq.ft. of manufacturing capacity.", "Beginning in 1979, IEM pioneered the development and deployment of fully-integrated CAD and manufacturing systems with the first CAD/CAM system for electrical equipment metal fabrication.", "IEM developed a groundbreaking version of the medium voltage vacuum breaker in the 1980s, pioneered the use of breakers on 21kV systems, and was the first to design a 3000A freestanding breaker for utilities.", "In 1997, IEM brought its specialized expertise to power quality and power factor correction equipment, and has since developed unique low and medium voltage switchgear systems well suited to the increased power and small footprint requirements of numerous industries.", "With over 75 years dedicated to power solutions, IEM brings deep expertise across critical industries—including healthcare, data centers, manufacturing, and energy—delivering reliable solutions for complex, high-stakes environments."],
  },
  DIS_TRAN_STEEL: {
    company: "DIS-TRAN Steel",
    employer: "DIS-TRAN Steel",
    parent: "Crest Industries",
    archetype: "STEEL_POLE_STRUCTURE_FAB",
    sourceUrls: ["https://www.distransteel.com/about", "https://www.distransteel.com/services", "https://www.distransteel.com/transmission", "https://www.distransteel.com/substation"],
    facts: ["Since 1965, we've been building quality high voltage infrastructure for utilities across the United States while consistently maintaining our standards: simple values backed by honest relationships with our customers.", "Our engineers work hand-in-hand with our steel detailers to tackle any project from basic equipment stands to the most complex steel structure or high-voltage substation arrangement. We pride ourselves on engineering and fabricating the highest quality transmission towers and substations for the utility industry.", "Our hard-working and dedicated team at multiple state-of-the-art facilities allow us to fabricate any size project, expedite schedules, and deliver results for customers across the country. Our internal QA/QC measures and real time scheduling and product tracking mean we deliver on time, every time.", "Whether you need tapered tubular, standard, or custom transmission structures, our team of professional engineers, detailers, and fabricators delivers every time. With over 50 years of experience in manufacturing utility structures, multiple locations across the country, quick quoting, and high responsiveness, DIS-TRAN Steel provides the product integrity your project needs and deserves.", "Our in-house production facilities in the South and Mid-West allow us to efficiently fabricate small to large sized structures. From single pole columns, guyed structures, lattice, H-frame, river and road crossing towers, DIS-TRAN can engineer, detail and fabricate virtually any structure for utility applications. Not sure what structure fits your needs?", "Power substations are the backbone of utility systems, and there’s no room for downtime or failure. These steel structures are our bread and butter. Supported by stellar service, our design and manufacture of steel substation components—from folded plate tapered tubular structures, lattice, and standard shapes—deliver the durability and extended service life your grid relies on."],
  },
  /**
   * facts deliberately empty (2026-10-02): spawglass.com refuses every fetch attempt (ECONNRESET on /, /about,
   * /about-us/, /markets, www and non-www, http and https — 8 tries; iemfg.com fetches fine from the same tool, so
   * this looks like spawglass.com's own bot protection, not a transient issue). sourceUrls below are the right pages
   * (found by search, not fetched), kept so whoever can reach the site knows where to pull verbatim sentences from.
   * Until then this entry has no verified facts to cite — DESCRIPTORS has no SpawGlass entry either, so the UI
   * honestly shows "Plant descriptor isn't generated yet." rather than a fabricated one.
   */
  SPAWGLASS: {
    company: "SpawGlass",
    employer: "SpawGlass",
    parent: null,
    archetype: "COMMERCIAL_CONSTRUCTION_GC",
    sourceUrls: ["https://spawglass.com/about-us/", "https://spawglass.com/spawglass-builds/"],
    facts: [],
  },
} satisfies Record<string, CompanySource>;

/** The archetype a posting's employer (@fdl/sources operatingEmployer) calls for, or null if no archetype is documented for it. */
export const archetypeForEmployer = (employer: string | null) =>
  Object.values(COMPANY_SOURCES).find((c) => c.employer === employer)?.archetype ?? null;

/**
 * The industry word for a lead with no plant archetype (objections.ts's {industry} slot), the same kind of
 * hand-chosen short word as an Archetype's own `industry` field — not copied from a source, just what the company is.
 * Covers the companies added for the tech/HR domain-expansion scoping pass (2026-10-01); anything else (a plant
 * company with no archetype documented yet, or any future unmapped employer) falls back to the honest generic
 * "the industry" rather than guessing. SpawGlass no longer needs an entry here: it has its own archetype now
 * (COMMERCIAL_CONSTRUCTION_GC, 2026-10-02), so industryWordFor resolves it through archetypeForEmployer instead.
 */
export const NON_PLANT_INDUSTRY: Record<string, string> = {
  Airbnb: "travel tech",
  Stripe: "fintech",
  Figma: "design software",
  Asana: "productivity software",
  Gusto: "HR/payroll software",
  Brex: "fintech",
  Robinhood: "fintech",
  Webflow: "web design software",
  Doximity: "healthcare networking software",
  Lattice: "HR software",
  Buildkite: "devops software",
  Mercury: "fintech",
  Checkr: "background-check software",
  "Culture Amp": "HR software",
  Mixpanel: "product analytics software",
  Justworks: "HR/PEO software",
  Carta: "equity management software",
};

/** The {industry} word for any employer: the archetype's for a plant lead, this company's own business otherwise. */
export const industryWordFor = (employer: string | null): string => {
  const archetype = archetypeForEmployer(employer);
  if (archetype) return ARCHETYPES[archetype].industry;
  return (employer && NON_PLANT_INDUSTRY[employer]) || "the industry";
};
