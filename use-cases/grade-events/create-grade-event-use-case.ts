import { z } from "zod";
import { db } from "@/db";
import { GradeSchema } from "@/db/vocabulary";
import { GradeEventSchema } from "@/repositories/grade-events/grade-event-schema";
import { createGradeEventRepo } from "@/repositories/grade-events/create-grade-event-repo";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — the ONLY caller of createGradeEventRepo. Append only. */
export const createGradeEventUseCase = createUseCase(
  {
    id: "create-grade-event",
    inputSchema: z.object({
      groupId: z.uuid(),
      datasetId: z.string().min(1),
      fromGrade: GradeSchema.nullable(),
      toGrade: GradeSchema,
      /** Threaded, never read from a wall clock — replay depends on it. */
      at: z.date(),
      independentSources: z.number().int(),
      itemCount: z.number().int(),
      reasons: z.array(z.string()),
      alertFired: z.boolean(),
      alertReasons: z.array(z.string()).nullable(),
    }),
    outputSchema: GradeEventSchema,
  },
  async ({ success }, args) => {
    const { log, ...event } = args;
    void log;
    return success(await createGradeEventRepo({ db, event }));
  },
);
