import { annotations, signals, type Db } from "@/db";
import { type Annotation } from "@/repositories/annotations/annotation-schema";
import { type Signal } from "./signal-schema";

/**
 * Writes a signal and its annotations atomically — a signal that lost its feed
 * annotations halfway through would be a silent data-quality lie.
 */
export async function createSignalRepo(args: {
  db: Db;
  signal: {
    source: string;
    sourceClass: string;
    text: string;
    raw: unknown;
    occurredAt: Date;
    lat?: number | null;
    lng?: number | null;
    geoConfidence?: number | null;
  };
  annotations: {
    key: string;
    value: string;
    confidence?: number | null;
    annotator: string;
  }[];
}): Promise<{ signal: Signal; annotations: Annotation[] }> {
  return args.db.transaction(async (tx) => {
    const [signal] = await tx
      .insert(signals)
      .values({
        source: args.signal.source,
        sourceClass: args.signal.sourceClass,
        text: args.signal.text,
        raw: args.signal.raw,
        occurredAt: args.signal.occurredAt,
        lat: args.signal.lat ?? null,
        lng: args.signal.lng ?? null,
        geoConfidence: args.signal.geoConfidence ?? null,
      })
      .returning();

    if (args.annotations.length === 0) return { signal, annotations: [] };

    const rows = await tx
      .insert(annotations)
      .values(
        args.annotations.map((a) => ({
          nodeId: signal.id,
          key: a.key,
          value: a.value,
          confidence: a.confidence ?? null,
          annotator: a.annotator,
        })),
      )
      .returning();

    return { signal, annotations: rows };
  });
}
