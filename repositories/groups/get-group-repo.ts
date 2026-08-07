import { eq } from "drizzle-orm";
import { groups, type Db } from "@/db";
import { type Group } from "./group-schema";

export async function getGroupRepo(args: { db: Db; id: string }): Promise<Group | null> {
  const [row] = await args.db.select().from(groups).where(eq(groups.id, args.id)).limit(1);
  return row ?? null;
}
