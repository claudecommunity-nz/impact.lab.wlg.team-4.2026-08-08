import { groups, type Db } from "@/db";
import { type Group } from "./group-schema";

type GroupInsert = typeof groups.$inferInsert;

export async function createGroupRepo(args: {
  db: Db;
  group: Omit<GroupInsert, "id" | "updatedAt">;
}): Promise<Group> {
  const [row] = await args.db.insert(groups).values(args.group).returning();
  return row;
}
