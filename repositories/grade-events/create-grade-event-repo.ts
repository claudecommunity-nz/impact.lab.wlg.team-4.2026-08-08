import { gradeEvents, type Db } from "@/db";
import { type Grade } from "@/db/vocabulary";
import { type GradeEvent } from "./grade-event-schema";

/** Appends one transition. There is deliberately no update and no delete repo. */
export async function createGradeEventRepo(args: {
  db: Db;
  event: {
    groupId: string;
    datasetId: string;
    fromGrade: Grade | null;
    toGrade: Grade;
    at: Date;
    independentSources: number;
    itemCount: number;
    reasons: string[];
    alertFired: boolean;
    alertReasons: string[] | null;
  };
}): Promise<GradeEvent> {
  const [row] = await args.db.insert(gradeEvents).values(args.event).returning();
  return row as GradeEvent;
}
