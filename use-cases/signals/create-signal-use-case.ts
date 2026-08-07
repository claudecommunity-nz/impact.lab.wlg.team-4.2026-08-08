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
      raw: z.unknown(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      geoConfidence: z.number().optional(),
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
        lat: args.lat ?? null,
        lng: args.lng ?? null,
        geoConfidence: args.geoConfidence ?? null,
      },
      annotations: args.annotations,
    });
    return success(created);
  },
);
