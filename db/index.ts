import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Standard Postgres driver — works unchanged against local Docker Postgres,
 * Supabase (use the transaction-pooler connection string in serverless), or any
 * other Postgres. The pool connects lazily on first query.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });

/** Pass this into repo functions — repositories never import `db` themselves. */
export type Db = typeof db;

export * from "./schema";
