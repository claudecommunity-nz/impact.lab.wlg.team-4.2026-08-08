import { z } from "zod";
import { db } from "@/db";
import { AnnotationSchema } from "@/repositories/annotations/annotation-schema";
import { createSignalRepo } from "@/repositories/signals/create-signal-repo";
import { SignalSchema } from "@/repositories/signals/signal-schema";
import { createUseCase } from "@/utilities/create-use-case";

/**
 * Thin CRUD use case — the ONLY caller of createSignalRepo. Signal and its feed
 * annotations are written in one transaction; business logic (adapting,
 * dedupe, assumed timestamps) lives in ingest-signal-use-case.ts.
 */
export const createSignalUseCase = createUseCase(
  {
    id: "create-signal",
    inputSchema: z.object({
      source: z.string().min(1),
      sourceClass: z.string().min(1),
      text: z.string().min(1),
      occurredAt: z.date(),
      /** When the collector captured it. Absent = the database clock. */
      ingestedAt: z.date().optional(),
      raw: z.unknown(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      geoConfidence: z.number().optional(),
      /** The namespace. Required — a row without one could cluster across datasets. */
      datasetId: z.string().min(1),
      externalId: z.string().optional(),
      author: z.string().optional(),
      url: z.string().optional(),
      quotedUrls: z.array(z.string()).optional(),
      synthetic: z.boolean().optional(),
      annotations: z.array(
        z.object({
          key: z.string().min(1),
          value: z.string(),
          confidence: z.number().optional(),
          annotator: z.string().min(1),
        }),
      ),
    }),
    outputSchema: z.object({
      signal: SignalSchema,
      annotations: z.array(AnnotationSchema),
      /** false = the unique dedupe index refused this write and we re-read the winner. */
      created: z.boolean(),
    }),
  },
  async ({ success }, args) => {
    const created = await createSignalRepo({
      db,
      signal: {
        source: args.source,
        sourceClass: args.sourceClass,
        text: args.text,
        raw: args.raw,
        occurredAt: args.occurredAt,
        ingestedAt: args.ingestedAt ?? null,
        lat: args.lat ?? null,
        lng: args.lng ?? null,
        geoConfidence: args.geoConfidence ?? null,
        datasetId: args.datasetId,
        externalId: args.externalId ?? null,
        author: args.author ?? null,
        url: args.url ?? null,
        quotedUrls: args.quotedUrls ?? null,
        synthetic: args.synthetic ?? false,
      },
      annotations: args.annotations,
    });
    return success(created);
  },
);
