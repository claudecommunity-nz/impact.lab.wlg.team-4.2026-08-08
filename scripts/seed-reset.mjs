#!/usr/bin/env node
/**
 * `npm run seed:reset` — one clean slate, and the registry back on its feet.
 *
 *   npm run seed:reset            # wipe everything, re-seed the source registry
 *   npm run seed:reset -- --keep-registry
 *
 * This is the FIRST step of the canonical rebuild in DEMO.md, and it exists
 * because the alternative people reached for was `npm run verify` — which does
 * truncate, but then re-ingests its own fixtures and leaves a harness's probe
 * data behind. Using a test harness as a reset button cost this team its board
 * state three times in one afternoon, once silently: 130 collected real signals
 * vanished and nobody noticed until a re-load reported "created 130, deduped 0".
 *
 * So: a reset that ONLY resets, says exactly what it removed, and puts back the
 * one thing nothing else can rebuild from a file — the source registry, without
 * which every cluster on the board grades F and the demo quietly makes no sense.
 *
 * The registry is re-seeded through the REAL `sources.seed` procedure rather
 * than an INSERT here, so the list of authoritative sources has exactly one
 * definition (`use-cases/source-registry/seed-source-registry-use-case.ts`) and
 * this script can never drift from it.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const ROOT = process.cwd();
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const keepRegistry = process.argv.includes("--keep-registry");

/**
 * Everything derived and everything raw. `source_registry` is listed last and
 * re-seeded immediately after, because it is the only table here whose contents
 * are a JUDGEMENT rather than a re-runnable import — an operator's "this source
 * has been right all week" cannot be regenerated from a fixture file.
 */
const TABLES = [
  "signals",
  "annotations",
  "edges",
  "groups",
  "grade_events",
  "projection_models",
  "signal_vectors",
];

const out = (line = "") => process.stdout.write(`${line}\n`);

async function loadEnvLocal() {
  try {
    const text = await readFile(path.join(ROOT, ".env.local"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq);
      if (process.env[key] === undefined) process.env[key] = trimmed.slice(eq + 1);
    }
  } catch {
    // No .env.local: DATABASE_URL may still come from the shell.
  }
}

async function main() {
  await loadEnvLocal();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (.env.local or the shell)");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const tables = keepRegistry ? TABLES : [...TABLES, "source_registry"];

  try {
    // Count first, so the output is a receipt rather than a promise. A reset
    // that prints "done" is indistinguishable from a reset that hit the wrong
    // database, and this one is destructive.
    const before = {};
    for (const table of tables) {
      const { rows } = await pool.query(`select count(*)::int as n from ${table}`);
      before[table] = rows[0].n;
    }

    await pool.query(`truncate ${tables.join(", ")}`);

    out("── wiped ────────────────────────────────────────────────");
    for (const table of tables) out(`  ${table.padEnd(20)} ${before[table]} rows`);
    if (keepRegistry) out("  source_registry      KEPT (--keep-registry)");

    if (!keepRegistry) {
      out("\n── re-seeding the source registry ───────────────────────");
      const response = await fetch(`${BASE_URL}/api/trpc/sources.seed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: {} }),
      }).catch(() => null);

      if (!response || !response.ok) {
        // Loud, not silent. An empty registry grades every cluster F, which
        // looks like a working board making a defensible judgement — the most
        // expensive kind of wrong.
        out(`  FAILED — no dev server at ${BASE_URL}`);
        out("  The registry is EMPTY. Every cluster will grade F until you run:");
        out(`    curl -s -X POST -H 'content-type: application/json' -d '{"json":{}}' \\`);
        out(`      ${BASE_URL}/api/trpc/sources.seed`);
        process.exitCode = 1;
        return;
      }

      const body = await response.json();
      const seeded = body?.result?.data?.json;
      out(`  ${seeded.seeded} sources seeded: ${seeded.entries.map((e) => e.sourceId).join(", ")}`);
    }

    out("\nClean. Next: npm run signals:load  →  npm run demo:plumb -- --http");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  out(`\nSEED RESET FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
