import { z } from "zod";
import { db } from "@/db";
import { GradeEventSchema } from "@/repositories/grade-events/grade-event-schema";
import { getGradeEventsRepo } from "@/repositories/grade-events/get-grade-events-repo";
import { createUseCase } from "@/utilities/create-use-case";

/** Thin CRUD use case — the ONLY caller of getGradeEventsRepo. */
export const getGradeEventsUseCase = createUseCase(
  {
    id: "get-grade-events",
    inputSchema: z.object({
      groupIds: z.array(z.uuid()).optional(),
      datasetId: z.string().optional(),
      asAt: z.date().optional(),
      since: z.date().optional(),
      alertFiredOnly: z.boolean().optional(),
      order: z.enum(["asc", "desc"]).optional(),
      limit: z.number().int().positive().optional(),
    }),
    outputSchema: z.array(GradeEventSchema),
  },
  async ({ success }, args) => {
    const { log, ...filters } = args;
    void log;
    return success(await getGradeEventsRepo({ db, ...filters }));
  },
);
