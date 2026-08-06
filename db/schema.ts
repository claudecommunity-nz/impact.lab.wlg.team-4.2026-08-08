import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Example entity — the reference implementation the docs walk through.
 * Copy this shape (table here → zod schema + queries in repositories/<entity>/)
 * when adding real entities.
 */
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
