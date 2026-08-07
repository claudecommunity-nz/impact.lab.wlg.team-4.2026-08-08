import { annotations, type Db } from "@/db";
import { type Annotation } from "./annotation-schema";

/** Bulk insert — enrichment writes many assertions about one node at a time. */
export async function createAnnotationsRepo(args: {
  db: Db;
  annotations: {
    nodeId: string;
    key: string;
    value: string;
    confidence?: number | null;
    annotator: string;
  }[];
}): Promise<Annotation[]> {
  if (args.annotations.length === 0) return [];
  return args.db
    .insert(annotations)
    .values(
      args.annotations.map((a) => ({
        nodeId: a.nodeId,
        key: a.key,
        value: a.value,
        confidence: a.confidence ?? null,
        annotator: a.annotator,
      })),
    )
    .returning();
}
