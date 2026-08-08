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
    await pool.query(
      "truncate signals, annotations, edges, groups, projection_models, signal_vectors, grade_events, source_registry",
    );
    out("wiped signals, annotations, edges, groups, projection_models, signal_vectors, grade_events, source_registry");

    // ── 1b. the source registry ───────────────────────────────────────────────
    out("\n── source registry (sources.seed) ───────────────────────");
    const seeded = await mutate("sources.seed", {});
    out(seeded.entries.map((e) => `${e.sourceId}=${e.reliability}`).join(" · "));
    check(
      seeded.seeded === 4 && seeded.entries.every((e) => e.reliability === "A"),
      "the four official sources seed at reliability A",
      `${seeded.seeded} entries`,
    );
    const reseeded = await mutate("sources.seed", {});
    check(
      reseeded.seeded === 4 && (await query("sources.list", {})).length === 4,
      "seeding is idempotent — four rows, not eight",
    );
    check(
      (await query("sources.list", { sourceIds: ["some-random-account"] })).length === 0,
      "a source nobody registered is simply absent (and therefore grades F)",
    );

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

    // ── 2b. the sync fold: ingest returns the cluster AND its grade ───────────
    //
    // Convergence Decision 2. A sender should not have to poll to find out
    // whether the thing they just reported was already being reported by three
    // other people, so ingest folds embed → assign → grade before it answers.
    out("\n── the synchronous fold (convergence Decision 2) ─────────");
    const folded = ingest.results.filter((r) => r.ok).map((r) => r.signal);

    check(
      folded.every((s) => s.itemId === s.id),
      "every item comes back under BOTH names — `id` (intake) and `itemId` (PRD)",
    );
    check(
      folded.every((s) => typeof s.signalId === "string"),
      "every item was folded into a cluster synchronously, at ingest time",
      `${folded.filter((s) => s.signalId === null).length} unplaced`,
    );
    check(
      folded.every((s) => s.grade !== null && typeof s.grade.label === "string"),
      "every ingest response carries the cluster's grade AFTER folding the item in",
      folded[0]?.grade?.label ?? "no grade",
    );
    check(
      folded.every((s) => s.reasons.length > 0),
      "every grade arrives with its reasons — never a bare verdict",
    );
    check(
      folded.every((s) => s.grade?.sourceReliability === "F"),
      "every fixture source is absent from the registry, so every cluster grades F (AC15.1)",
      [...new Set(folded.map((s) => s.grade?.sourceReliability))].join(","),
    );
    check(
      folded.every((s) => s.independentSources <= s.itemCount && s.independentSources > 0),
      "independentSources is counted, is never zero, and never exceeds itemCount",
      folded.map((s) => `${s.independentSources}/${s.itemCount}`).slice(0, 8).join(" "),
    );
    check(
      folded.some((s) => s.alertWorthy === true),
      "early single-source reports raise alerts rather than being silenced by their grade (AC27)",
      `${folded.filter((s) => s.alertWorthy).length}/${folded.length} alert-worthy`,
    );
    check(
      folded
        .filter((s) => s.alertWorthy)
        .every((s) => s.alertReasons.some((r) => r.startsWith("WEAK EVIDENCE"))),
      "…and each one states the weakness of its evidence in plain language (AC27.3)",
      folded.find((s) => s.alertWorthy)?.alertReasons.find((r) => r.startsWith("WEAK EVIDENCE")) ?? "",
    );
    check(
      folded.every((s) => s.foldWarnings.length === 0),
      "nothing degraded inside the fold",
      JSON.stringify(folded.flatMap((s) => s.foldWarnings)),
    );

    // The already-published intake contract, field by field. This is the check
    // that stops us breaking a team who integrated yesterday.
    const PUBLISHED_FIELDS = [
      "id",
      "created",
      "text",
      "source",
      "sourceClass",
      "occurredAt",
      "assumedOccurredAt",
      "annotationKeys",
    ];
    check(
      folded.every((s) => PUBLISHED_FIELDS.every((f) => s[f] !== undefined)),
      "every field INTEGRATION.md already promised is still present and still spelled the same",
      PUBLISHED_FIELDS.join(", "),
    );

    // ── 2c. dedupe, both paths (convergence Decision 4) ───────────────────────
    out("\n── dedupe (convergence Decision 4) ──────────────────────");
    const first = items.find((i) => typeof i?.text === "string");
    const original = folded[items.indexOf(first)];

    // Measured across the re-send, not against the original response: the
    // cluster legitimately grew between the two, as the rest of the batch
    // arrived. What must not move is what the DUPLICATE does to it.
    const before = await query("signals.detail", { signalId: original.signalId });
    const resent = await mutate("signals.ingest", first);
    const after = await query("signals.detail", { signalId: original.signalId });

    check(
      resent.created === false && resent.id === original.id,
      "re-sending an identical item returns the original id and stores nothing",
      `created=${resent.created}`,
    );
    check(
      resent.signalId === original.signalId &&
        after.itemCount === before.itemCount &&
        after.independentSources === before.independentSources,
      "a duplicate leaves itemCount and independentSources untouched (PRD AC2.3)",
      `${before.itemCount} → ${after.itemCount} items, cluster ${resent.signalId === original.signalId ? "unchanged" : "MOVED"}`,
    );

    const withId = {
      external_id: "verify-ext-1",
      source: "verify-collector",
      source_class: "media",
      text: "Slip closes Ngaio Gorge Road southbound",
      occurred_at: "2026-08-08T08:00:00Z",
      lat: -41.2603,
      lng: 174.7742,
    };
    const idFirst = await mutate("signals.ingest", withId);
    const idAgain = await mutate("signals.ingest", {
      ...withId,
      // A collector re-polling its own feed: same id, edited headline, later time.
      text: "Slip closes Ngaio Gorge Road southbound — contractors on site",
      occurred_at: "2026-08-08T08:40:00Z",
    });
    check(
      idFirst.created === true && idAgain.created === false && idAgain.id === idFirst.id,
      "external_id is identity: a re-worded, re-timed re-poll is still ONE item",
      `${idAgain.text}`,
    );
    check(
      idAgain.text === idFirst.text,
      "and the first version we stored is the one that survives — items are immutable",
    );

    // ── 2d. datasets never cross ──────────────────────────────────────────────
    const replay = await mutate("signals.ingest", { ...withId, dataset_id: "verify-fixtures" });
    check(
      replay.created === true && replay.datasetId === "verify-fixtures",
      "the SAME item in another dataset is a separate observation, not a duplicate",
    );
    check(
      replay.signalId !== idFirst.signalId,
      "…and it clusters separately: a drill can never corroborate a live event",
      `${replay.signalId} vs ${idFirst.signalId}`,
    );

    /** The fixtures, plus the two probes above that were genuinely stored. */
    const expectedItems = items.length + 2;

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
      points.length === expectedItems,
      "vectors.points returns one point per ingested signal",
      `${points.length}/${expectedItems}`,
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

    // Which embedder actually placed these signals — read off the items' own
    // `embedding_model` annotations rather than the pipeline's return value.
    // Ingest now embeds inside the synchronous fold, so `vectors.process` may
    // truthfully report that IT embedded nothing while every signal here was
    // still placed by the offline stub. The provenance is the honest source.
    const stubEmbeddings = members.some((m) =>
      m.annotations.some((a) => a.key === "embedding_model" && a.value.startsWith("stub/")),
    );
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

    // ── 5b. the published trust surface (PRD names) ──────────────────────────
    //
    // signals.geojson · signals.detail · signals.alerts — the cluster-oriented
    // contract other teams and the UX layer consume. "Signal" means a CLUSTER
    // out here; one raw item is an "item" (convergence Decision 1).
    out("\n── the trust surface (signals.geojson · detail · alerts) ──");
    const fc = await query("signals.geojson", {});
    out(`${fc.features.length} features · ${fc.unmappable.length} unmappable clusters`);

    check(
      fc.type === "FeatureCollection" && Array.isArray(fc.features),
      "signals.geojson returns a valid FeatureCollection (PRD AC31.1)",
    );
    check(
      fc.features.every(
        (f) =>
          f.type === "Feature" &&
          f.geometry.type === "Point" &&
          f.geometry.coordinates.length === 2 &&
          Math.abs(f.geometry.coordinates[0]) <= 180 &&
          Math.abs(f.geometry.coordinates[1]) <= 90,
      ),
      "every feature is a WGS84 Point in [lng, lat] order (AC31.2)",
    );
    check(
      fc.features.every(
        (f) => f.properties.grade !== null && f.properties.reasons.length > 0,
      ),
      "every feature carries an Admiralty grade AND the reasons behind it",
      fc.features[0]?.properties.grade?.label ?? "none",
    );
    check(
      fc.features.every(
        (f) =>
          typeof f.properties.itemCount === "number" &&
          typeof f.properties.independentSources === "number",
      ),
      "itemCount and independentSources are BOTH published, as distinct figures (AC10.1)",
      fc.features.map((f) => `${f.properties.independentSources}/${f.properties.itemCount}`).join(" "),
    );
    // Decision 3, the one that keeps this system honest: no blended number, ever.
    check(
      fc.features.every(
        (f) =>
          !("score" in f.properties) &&
          !("confidence" in f.properties) &&
          !("percentage" in f.properties),
      ),
      "NO blended confidence number is published anywhere (Decision 3 / AC14.3)",
    );
    check(
      fc.features.every((f) => f.properties.itemCount > 0),
      "no cluster is ever emitted without evidence behind it (AC33.2)",
    );
    check(
      fc.features.every((f) => f.properties.datasetId === "live"),
      "the live map contains no feature from a fixture dataset (AC4.2)",
      [...new Set(fc.features.map((f) => f.properties.datasetId))].join(","),
    );

    const replayFc = await query("signals.geojson", { datasetId: "verify-fixtures" });
    check(
      replayFc.features.length > 0 &&
        replayFc.features.every((f) => f.properties.datasetId === "verify-fixtures"),
      "…and asking for that dataset by name returns it, alone",
      `${replayFc.features.length} features`,
    );

    // Wellington, roughly: everything our fixtures describe is inside it.
    const WELLINGTON = { minLng: 174.6, minLat: -41.4, maxLng: 174.9, maxLat: -41.1 };
    const inside = await query("signals.geojson", { bbox: WELLINGTON });
    const elsewhere = await query("signals.geojson", {
      bbox: { minLng: 0, minLat: 0, maxLng: 1, maxLat: 1 },
    });
    check(
      inside.features.length === fc.features.length && elsewhere.features.length === 0,
      "a bounding box filters to the area asked for, and only that area (AC30.1)",
      `${inside.features.length} in Wellington, ${elsewhere.features.length} in the Gulf of Guinea`,
    );

    // The credibility floor, exercised against grades the rule table actually
    // produced: corroborated clusters (2+ independent origins) reach 3 and
    // survive it; a lone uncorroborated report grades 4 and does not.
    const credible = await query("signals.geojson", { minCredibility: 3 });
    const strict = await query("signals.geojson", { minCredibility: 2 });
    check(
      credible.features.length > 0 &&
        credible.features.length < fc.features.length &&
        credible.features.every((f) => f.properties.grade.infoCredibility <= 3),
      "minCredibility keeps the corroborated clusters and drops the rest (AC30.2)",
      `${credible.features.length}/${fc.features.length} clear 3 · ${strict.features.length} clear 2`,
    );
    check(
      strict.features.length === 0,
      "…and NOTHING reaches credibility 2 without an authoritative cross-check agreeing",
      `${strict.features.length} survived`,
    );
    check(
      fc.features.every((f) => f.properties.independentSources <= f.properties.itemCount),
      "independent origins never exceed the documents they were counted from (AC8.3)",
      fc.features.map((f) => `${f.properties.independentSources}/${f.properties.itemCount}`).join(" "),
    );

    // The drill-down, under the PRD's name.
    const detail = await query("signals.detail", {
      signalId: fc.features[0].properties.signalId,
    });
    check(
      detail.provenance.length > 0 && detail.provenance.length === detail.itemCount,
      "signals.detail returns one provenance entry per contributing item (AC33.1)",
      `${detail.provenance.length}/${detail.itemCount}`,
    );
    check(
      detail.provenance.every(
        (p) =>
          typeof p.excerpt === "string" &&
          p.excerpt.length > 0 &&
          typeof p.source === "string" &&
          typeof p.originId === "string" &&
          p.occurredAt !== undefined &&
          p.ingestedAt !== undefined,
      ),
      "each entry carries its verbatim excerpt, source, origin and BOTH timestamps (AC32.2)",
    );
    check(
      detail.provenance.every((p) => typeof p.synthetic === "boolean"),
      "the synthetic flag reaches every provenance entry (AC34.2)",
    );
    check(
      detail.originGroups.length > 0 &&
        detail.originGroups.reduce((sum, g) => sum + g.itemIds.length, 0) === detail.itemCount,
      "items are grouped by origin, and every item belongs to exactly one group (AC8.2)",
      `${detail.originGroups.length} origins`,
    );
    check(
      detail.independentSources === detail.originGroups.length,
      "independentSources IS the number of distinct origins, not a separate number (AC8.3)",
      `${detail.independentSources} vs ${detail.originGroups.length} groups`,
    );
    check(
      detail.provenance.every((p) =>
        detail.originGroups.some((g) => g.originId === p.originId && g.itemIds.includes(p.itemId)),
      ),
      "…and every provenance entry's originId resolves to the group it is listed in",
    );
    check(
      detail.gradeHistory.length > 0 &&
        detail.gradeHistory[0].fromGrade === null &&
        detail.gradeHistory.every((e) => e.reasons.length > 0),
      "the full grade history comes back, ordered, starting from no grade at all (AC25.2)",
      `${detail.gradeHistory.length} transitions`,
    );

    const detailMissing = await queryExpectingError("signals.detail", {
      signalId: "00000000-0000-4000-8000-000000000000",
    });
    check(
      typeof detailMissing === "string" && detailMissing.toLowerCase().includes("not found"),
      "an unknown signal id fails loudly rather than returning an empty shell",
    );

    const alerts = await query("signals.alerts", { since: "1970-01-01T00:00:00.000Z" });
    check(
      alerts.length > 0 && alerts.every((a) => a.alertReasons.length > 0),
      "signals.alerts returns real alerts, each carrying why it was raised (AC29.2)",
      `${alerts.length} alerts`,
    );
    check(
      alerts.every((a) => a.location !== null && typeof a.issueType === "string" && a.grade !== null),
      "every alert carries what it is, where it is, and how well evidenced (AC29.2)",
      [...new Set(alerts.map((a) => a.issueType))].join(","),
    );
    check(
      alerts.every((a, i) => i === 0 || new Date(alerts[i - 1].at) >= new Date(a.at)),
      "alerts come back most recent first (AC29.3)",
    );
    check(
      alerts.every((a) => a.datasetId === "live"),
      "…and the live feed carries no alert from a fixture dataset (AC4.1)",
      [...new Set(alerts.map((a) => a.datasetId))].join(","),
    );

    // AC28.2: alerts are TRANSITIONS. Re-grading unchanged evidence must be silent.
    const cursor = new Date(Date.now() + 1000).toISOString();
    await mutate("signals.ingest", first);
    const afterDuplicate = await query("signals.alerts", { since: cursor });
    check(
      afterDuplicate.length === 0,
      "re-sending an item that changes nothing emits NO alert — alerts are transitions, not states (AC28.2)",
      `${afterDuplicate.length} alerts after a duplicate`,
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
