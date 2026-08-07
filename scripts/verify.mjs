#!/usr/bin/env node
/**
 * `npm run verify` — the end-to-end proof of this module, runnable by anyone.
 *
 *   1. wipe the database;
 *   2. push scripts/fixtures.json through the REAL ingest procedure over HTTP;
 *   3. run the REAL pipeline procedure until the queue is empty;
 *   4. read the picture back through the THREE READ PROCEDURES the UX team and
 *      other teams use — no SQL, no in-process shortcuts — and assert the
 *      shapes are coherent: every point resolves through a bubble to the
 *      verbatim payload that produced it;
 *   5. print the board a human can read in four minutes.
 *
 * It needs a database and a dev server. It loads .env.local itself and starts
 * the dev server if one is not already running, so the whole thing is:
 *
 *   npm run verify
 *
 * Plain .mjs on purpose: no build step, no TypeScript, no framework. A judge,
 * a teammate or another team can read it top to bottom and see exactly what was
 * proven — this file is a deliverable, not a test.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";

const ROOT = process.cwd();
const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const FIXTURES = path.join(ROOT, "scripts", "fixtures.json");

/** The window used for the windowed-read check. Fixtures span about 2h48m. */
const NARROW_WINDOW_MINS = 60;

const out = (line = "") => process.stdout.write(`${line}\n`);
const checks = [];

function check(ok, label, detail = "") {
  checks.push({ ok, label });
  out(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

// ─── environment ──────────────────────────────────────────────────────────────

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

// ─── the dev server ───────────────────────────────────────────────────────────

async function serverIsUp() {
  try {
    const response = await fetch(`${BASE_URL}/api/trpc/notes.list?input=${encodeURIComponent('{"json":null}')}`);
    return response.ok;
  } catch {
    return false;
  }
}

/** Returns a stop() the caller must call, so we never leave a server behind. */
async function ensureServer() {
  if (await serverIsUp()) {
    out(`using the dev server already running at ${BASE_URL}`);
    return () => {};
  }

  out(`no server at ${BASE_URL} — starting one (npm run dev)…`);
  const child = spawn("npm", ["run", "dev"], {
    cwd: ROOT,
    env: process.env,
    stdio: "ignore",
    detached: true,
  });

  const stop = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  };

  for (let i = 0; i < 60; i += 1) {
    await sleep(1000);
    if (await serverIsUp()) {
      out(`dev server ready after ${i + 1}s`);
      return stop;
    }
  }

  stop();
  throw new Error("dev server did not become ready within 60s");
}

// ─── tRPC over HTTP (superjson envelope) ──────────────────────────────────────

async function unwrap(response, name) {
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`${name} failed: ${body.error?.json?.message ?? response.status}`);
  }
  return body.result.data.json;
}

async function mutate(name, input) {
  const response = await fetch(`${BASE_URL}/api/trpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  return unwrap(response, name);
}

async function query(name, input) {
  const url = `${BASE_URL}/api/trpc/${name}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  return unwrap(await fetch(url), name);
}

/** For the deliberate not-found check: returns the error message instead of throwing. */
async function queryExpectingError(name, input) {
  const url = `${BASE_URL}/api/trpc/${name}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const body = await (await fetch(url)).json();
  return body.error?.json?.message ?? null;
}

// ─── the run ──────────────────────────────────────────────────────────────────

async function main() {
  await loadEnvLocal();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (.env.local or the shell)");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const stopServer = await ensureServer();

  try {
    // ── 1. clean ──────────────────────────────────────────────────────────────
    out("\n── clean ────────────────────────────────────────────────");
    await pool.query("truncate signals, annotations, edges, groups, projection_models, signal_vectors");
    out("wiped signals, annotations, edges, groups, projection_models, signal_vectors");

    // ── 2. ingest, through the real procedure ─────────────────────────────────
    out("\n── ingest (signals.ingestBatch) ──────────────────────────");
    const items = JSON.parse(await readFile(FIXTURES, "utf8"));
    const ingest = await mutate("signals.ingestBatch", { items });
    out(`total ${ingest.total} · created ${ingest.created} · deduped ${ingest.deduped} · failed ${ingest.failed}`);
    check(
      ingest.created === items.length && ingest.failed === 0,
      `all ${items.length} fixtures ingested through the ingest procedure`,
      `${ingest.created} created, ${ingest.failed} failed`,
    );

    // ── 3. process, through the real procedure ────────────────────────────────
    out("\n── process (vectors.process) ─────────────────────────────");
    const rounds = [];
    for (let i = 0; i < 20; i += 1) {
      const round = await mutate("vectors.process", { limit: 50 });
      rounds.push(round);
      out(
        `round ${i + 1}: pending=${round.pending} assigned=${round.assigned} new=${round.groupsCreated} ` +
          `joined=${round.groupsJoined} projected=${round.projected} labelled=${round.labelled} ` +
          `fitted=${round.fittedProjection} stub=${round.stubEmbeddings}`,
      );
      if (round.pending === 0) break;
    }
    const stubEmbeddings = rounds.some((r) => r.stubEmbeddings);
    const failures = rounds.flatMap((r) => r.failures);
    check(failures.length === 0, "every signal was placed", JSON.stringify(failures));
    check(
      rounds.filter((r) => r.fittedProjection).length === 1,
      "the projection basis was fitted exactly once",
    );

    // ── 4. read it back, through the read procedures only ─────────────────────
    out("\n── read (vectors.points · vectors.groups · vectors.groupDetail) ──");
    const points = await query("vectors.points", {});
    const groups = await query("vectors.groups", {});
    out(`${points.length} points · ${groups.length} bubbles`);

    check(
      points.length === items.length,
      "vectors.points returns one point per ingested signal",
      `${points.length}/${items.length}`,
    );
    check(
      points.every((p) => typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number"),
      "every point carries a 3D coordinate",
      `${points.filter((p) => p.x === null).length} unprojected`,
    );
    check(
      points.every((p) => typeof p.groupId === "string"),
      "every point is placed in a bubble",
      `${points.filter((p) => p.groupId === null).length} unplaced`,
    );

    const groupIds = new Set(groups.map((g) => g.id));
    check(
      points.every((p) => groupIds.has(p.groupId)),
      "every point's groupId is a bubble vectors.groups returned",
    );
    check(
      groups.every((g) => g.size === g.memberCount),
      "every bubble's cached size equals its counted member edges",
      groups.map((g) => `${g.size}/${g.memberCount}`).join(" "),
    );
    check(
      groups.reduce((sum, g) => sum + g.memberCount, 0) === points.length,
      "bubble membership accounts for every point exactly once",
    );
    check(
      groups.every((g) => g.center !== null),
      "every bubble has a 3D centre to draw at",
    );
    check(
      groups.every((g) => g.geoCentroid !== null),
      "every bubble carries a geo centroid another team can plot",
      `${groups.filter((g) => g.geoCentroid).length}/${groups.length} located`,
    );
    check(
      groups.every((g) => typeof g.label === "string" && g.label.length > 0),
      "every bubble has been named",
      groups.map((g) => `"${g.label}"`).join(" · "),
    );
    check(
      groups.every(
        (g) => g.verification !== null && Array.isArray(g.verification.sourceClasses),
      ),
      "every bubble carries a verification picture (counts, never a verdict)",
    );

    // ── 5. the drill-down: bubble → member → findings → verbatim payload ──────
    const details = [];
    for (const group of groups) {
      details.push(await query("vectors.groupDetail", { id: group.id }));
    }

    check(
      details.every((d, i) => d.members.length === groups[i].memberCount),
      "groupDetail returns exactly the members the board counted",
      details.map((d) => d.members.length).join(" "),
    );

    const members = details.flatMap((d) => d.members);
    check(
      members.every((m) => typeof m.membership.reason === "string" && m.membership.reason.length > 0),
      "every member says IN WORDS why it was placed there",
    );
    check(
      members.every((m) => typeof m.membership.weight === "number"),
      "every member carries the number behind that sentence (cosine weight)",
    );
    check(
      members.every((m) => m.raw !== null && typeof m.raw === "object" && Object.keys(m.raw).length > 0),
      "every member still holds its verbatim source payload",
    );
    check(
      members.every((m) => Array.isArray(m.annotations) && m.annotations.length > 0),
      "every member carries the findings asserted about it",
      `${members.reduce((sum, m) => sum + m.annotations.length, 0)} annotations across ${members.length} members`,
    );
    check(
      members.some((m) => m.annotations.some((a) => a.annotator === "feed")),
      "the sending team's own fields survived as annotations",
    );

    // THE traceability assertion: the galaxy is not decorative — every point on
    // it walks back through a bubble to the words somebody actually published.
    const rawBySignal = new Map(members.map((m) => [m.signalId, m.raw]));
    const traceable = points.filter((p) => {
      const raw = rawBySignal.get(p.signalId);
      return raw !== undefined && raw !== null && typeof raw === "object";
    });
    check(
      traceable.length === points.length,
      "EVERY point resolves through groupDetail to its verbatim payload",
      `${traceable.length}/${points.length}`,
    );

    // ── 6. windows ────────────────────────────────────────────────────────────
    const narrowPoints = await query("vectors.points", { windowMins: NARROW_WINDOW_MINS });
    const narrowGroups = await query("vectors.groups", { windowMins: NARROW_WINDOW_MINS });
    const allIds = new Set(points.map((p) => p.signalId));
    check(
      narrowPoints.length > 0 &&
        narrowPoints.length < points.length &&
        narrowPoints.every((p) => allIds.has(p.signalId)),
      `windowMins=${NARROW_WINDOW_MINS} narrows the picture to a subset`,
      `${narrowPoints.length}/${points.length} points, ${narrowGroups.length}/${groups.length} bubbles`,
    );

    // ── 7. the error path ─────────────────────────────────────────────────────
    const missing = await queryExpectingError("vectors.groupDetail", {
      id: "00000000-0000-4000-8000-000000000000",
    });
    check(
      typeof missing === "string" && missing.toLowerCase().includes("not found"),
      "an unknown bubble id fails loudly rather than returning an empty shell",
      missing ?? "no error returned",
    );

    // ── the board ─────────────────────────────────────────────────────────────
    out("\n── the board ────────────────────────────────────────────");
    out(`embedder: ${stubEmbeddings ? "OFFLINE STUB (lexical, not semantic)" : "AI Gateway (semantic)"}`);
    out("");
    out(
      pad("bubble", 34) +
        pad("size", 6) +
        pad("vel", 5) +
        pad("srcs", 6) +
        pad("verified", 10) +
        pad("conf", 6) +
        "centroid",
    );
    out("-".repeat(100));
    for (const group of groups) {
      out(
        pad(group.label ?? "(unnamed)", 34) +
          pad(String(group.size), 6) +
          pad(String(group.velocity), 5) +
          pad(String(group.sourceDiversity), 6) +
          pad(String(group.verification?.verifiedCount ?? 0), 10) +
          pad(
            group.verification?.meanConfidence === null ||
              group.verification?.meanConfidence === undefined
              ? "n/a"
              : group.verification.meanConfidence.toFixed(2),
            6,
          ) +
          (group.geoCentroid
            ? `${group.geoCentroid.lat.toFixed(4)}, ${group.geoCentroid.lng.toFixed(4)}`
            : "no coordinates"),
      );
    }

    // One full walk, printed — this is the demo: bubble → member → findings → raw.
    const walk = details.reduce((a, b) => (b.members.length > a.members.length ? b : a));
    const member = walk.members[0];
    out("\n── one full traceability walk ───────────────────────────");
    out(`bubble    "${walk.label}"  ·  ${walk.size} reports · ${walk.sourceDiversity} source classes`);
    out(`member    ${member.source} (${member.sourceClass}) at ${member.occurredAt}`);
    out(`           "${member.text}"`);
    out(`placed    weight ${member.membership.weight.toFixed(3)} — ${member.membership.reason}`);
    out(`findings  ${member.annotations.map((a) => `${a.key}=${a.value} [${a.annotator}]`).join(" · ")}`);
    out(`verbatim  ${JSON.stringify(member.raw)}`);

    // ── verdict ───────────────────────────────────────────────────────────────
    const failed = checks.filter((c) => !c.ok);
    out(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    if (failed.length > 0) {
      for (const f of failed) out(`  FAILED: ${f.label}`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
    stopServer();
  }
}

function pad(value, width) {
  return value.length >= width ? `${value.slice(0, width - 1)} ` : value.padEnd(width);
}

main().catch((err) => {
  out(`\nVERIFY ERRORED: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
});
