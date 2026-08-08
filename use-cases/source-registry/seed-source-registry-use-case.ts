import { z } from "zod";
import { SourceRegistryEntrySchema } from "@/repositories/source-registry/source-registry-schema";
import { createUseCase } from "@/utilities/create-use-case";
import { upsertSourceRegistryUseCase } from "./upsert-source-registry-use-case";

/**
 * The sources we already know are authoritative, and nothing else.
 *
 * Every entry here is an agency SPEAKING FOR ITSELF about something it owns, or
 * an instrument reporting its own reading. EVERY other source — every account,
 * every news site, every neighbour — is absent, and absence grades F
 * ("reliability cannot be judged"). That asymmetry is the point: we start by
 * trusting almost nobody, and the registry is how trust is earned, one operator
 * judgement at a time.
 *
 * Three sources are deliberately NOT here, and the distinction is the whole
 * argument of this table rather than an oversight:
 *
 *   - **a scanner or radio log is not the agency speaking.** `fenz-scanner` and
 *     `radio-log` are somebody listening to emergency radio traffic and
 *     relaying what they think they heard. That is a genuinely useful early
 *     signal and it is not Fire and Emergency making a statement, so it grades
 *     F and has to earn corroboration like anything else.
 *   - **a newsroom reports, it does not observe.** RNZ, Stuff and
 *     Wellington.Scoop are usually reporting somebody else's observation — and
 *     origin fingerprinting will often collapse them into the post they quoted,
 *     which is the correct answer and would be hidden by an A.
 *   - **a council intake queue is not the council asserting.** `wcc-service-
 *     requests` and `wremo-community-report` are official systems carrying
 *     members of the public's reports. The channel is official; the claim is
 *     not. Grading the channel would launder the claim.
 *
 * Idempotent: seeding twice leaves one row per source, not two.
 */
export const OFFICIAL_SOURCES = [
  {
    sourceId: "metservice",
    name: "MetService",
    reliability: "A" as const,
    kind: "official",
    notes: "National weather authority; severe weather warnings are its statutory role.",
  },
  {
    sourceId: "geonet",
    name: "GeoNet",
    reliability: "A" as const,
    kind: "official",
    notes: "GNS Science geological hazard monitoring; instrumented, not reported.",
  },
  {
    sourceId: "nzta",
    name: "NZTA Waka Kotahi",
    reliability: "A" as const,
    kind: "official",
    notes: "State highway operator; road closures come from the people who close them.",
  },
  {
    sourceId: "wcc",
    name: "Wellington City Council",
    reliability: "A" as const,
    kind: "official",
    notes: "Territorial authority; owns the local roads, water and emergency response.",
  },
  {
    sourceId: "wcc-duty-officer",
    name: "WCC Emergency Management duty officer",
    reliability: "A" as const,
    kind: "official",
    notes: "The Council officer on shift, writing about their own response. First-hand, and accountable for it.",
  },
  {
    sourceId: "wremo",
    name: "Wellington Region Emergency Management Office",
    reliability: "A" as const,
    kind: "official",
    notes: "The regional CDEM group. Its warnings are its statutory function.",
  },
  {
    sourceId: "fenz-media",
    name: "Fire and Emergency New Zealand (media)",
    reliability: "A" as const,
    kind: "official",
    notes: "FENZ speaking for itself about its own callouts — not a scanner relay of them.",
  },
  {
    sourceId: "police-media",
    name: "New Zealand Police (media)",
    reliability: "A" as const,
    kind: "official",
    notes: "Police media releases; cordons and closures come from the people setting them.",
  },
  {
    sourceId: "gw-hilltop",
    name: "Greater Wellington Hilltop telemetry",
    reliability: "A" as const,
    kind: "sensor",
    notes: "River stage and rainfall gauges. Instrumented, not reported — it measures rather than believes.",
  },
  {
    sourceId: "aro-gauge-01",
    name: "Aro Valley stream gauge",
    reliability: "A" as const,
    kind: "sensor",
    notes: "Instrumented water-level reading.",
  },
  {
    sourceId: "miramar-anemometer",
    name: "Miramar anemometer",
    reliability: "A" as const,
    kind: "sensor",
    notes: "Instrumented wind reading.",
  },
];

export const seedSourceRegistryUseCase = createUseCase(
  {
    id: "seed-source-registry",
    inputSchema: z.looseObject({}),
    outputSchema: z.object({
      seeded: z.number().int(),
      entries: z.array(SourceRegistryEntrySchema),
    }),
  },
  async ({ success, error }, { log }) => {
    const upserted = await upsertSourceRegistryUseCase({ entries: OFFICIAL_SOURCES, log });
    if (upserted.error) return error(upserted.error);

    log?.info(
      { seeded: upserted.data.length, sources: OFFICIAL_SOURCES.map((s) => s.sourceId) },
      "Source registry seeded with the official A-reliability sources",
    );

    return success({ seeded: upserted.data.length, entries: upserted.data });
  },
);
