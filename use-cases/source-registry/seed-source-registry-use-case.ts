import { z } from "zod";
import { SourceRegistryEntrySchema } from "@/repositories/source-registry/source-registry-schema";
import { createUseCase } from "@/utilities/create-use-case";
import { upsertSourceRegistryUseCase } from "./upsert-source-registry-use-case";

/**
 * The sources we already know are authoritative, and nothing else.
 *
 * Four entries, deliberately: these are the official feeds whose statements a
 * duty officer would already act on without a second source. EVERY other
 * source — every account, every news site, every neighbour — is absent, and
 * absence grades F ("reliability cannot be judged"). That asymmetry is the
 * point: we start by trusting almost nobody, and the registry is how trust is
 * earned, one operator judgement at a time.
 *
 * Idempotent: seeding twice leaves four rows, not eight.
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
