/**
 * Runtime proof for the vector layer, against the REAL procedures and the REAL
 * database — no mocks, no in-process shortcuts.
 *
 *   1. wipe the derived and factual tables;
 *   2. push scripts/fixtures.json through `signals.ingestBatch` over HTTP;
 *   3. call `vectors.process` until the pending queue is empty;
 *   4. assert the grouping, the edges, the folded metrics and the projection
 *      with SQL, not with the pipeline's own return values;
 *   5. do the whole thing a second time from clean and require the galaxy
 *      coordinates to come back BYTE-IDENTICAL — the stability rule, tested.
 *
 * Usage (dev server must be running on PORT, default 3000):
 *   export $(grep -v '^#' .env.local | grep -v '^$' | xargs)
 *   npm run proof:vectors
 *
 * This file writes to stdout rather than through pino on purpose: its output IS
 * the deliverable — a PASS/FAIL report a human reads in four minutes — and a
 * stream of JSON log lines is not that. Nothing here is imported by the app.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const BASE_URL = process.env.PROOF_BASE_URL ?? "http://localhost:3000";
const FIXTURES = path.join(process.cwd(), "scripts", "fixtures.json");

/** Expected shape of the fixture set — see scripts/fixtures.json. */
const EXPECTED = {
  signals: 25,
  groups: 3,
  groupTolerance: 1,
  lonerText: "Traffic signals out at the Karori Road intersection",
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Check = { ok: boolean; label: string; detail: string };
const checks: Check[] = [];

function check(ok: boolean, label: string, detail = ""): void {
  checks.push({ ok, label, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}\n`);
}

// ─── tRPC over HTTP (superjson wire format) ───────────────────────────────────

async function callProcedure<T>(pathName: string, input: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}/api/trpc/${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: input }),
  });

  const body = (await response.json()) as {
    result?: { data?: { json: T } };
    error?: { json?: { message?: string } };
  };

  if (!response.ok || body.error) {
    throw new Error(`${pathName} failed: ${body.error?.json?.message ?? response.status}`);
  }
  return body.result!.data!.json;
}

// ─── one full run ─────────────────────────────────────────────────────────────

type ProcessResult = {
  locked: boolean;
  pending: number;
  embedded: number;
  assigned: number;
  groupsCreated: number;
  groupsJoined: number;
  projected: number;
  fittedProjection: boolean;
  stubEmbeddings: boolean;
  failures: { signalId: string; error: string }[];
};

async function wipe(): Promise<void> {
  await pool.query(
    "truncate signals, annotations, edges, groups, projection_models, signal_vectors",
  );
}

async function run(label: string): Promise<{ coordinates: string; process: ProcessResult[] }> {
  process.stdout.write(`\n── run ${label} ─────────────────────────────────────────\n`);
  await wipe();

  const items = JSON.parse(await readFile(FIXTURES, "utf8")) as unknown[];
  const ingest = await callProcedure<{ total: number; created: number; failed: number }>(
    "signals.ingestBatch",
    { items },
  );
  process.stdout.write(
    `ingested: ${ingest.created}/${ingest.total} created, ${ingest.failed} failed\n`,
  );

  const rounds: ProcessResult[] = [];
  for (let i = 0; i < 20; i += 1) {
    const result = await callProcedure<ProcessResult>("vectors.process", { limit: 50 });
    rounds.push(result);
    process.stdout.write(
      `process round ${i + 1}: pending=${result.pending} assigned=${result.assigned} ` +
        `new=${result.groupsCreated} joined=${result.groupsJoined} projected=${result.projected} ` +
        `fitted=${result.fittedProjection} stub=${result.stubEmbeddings}\n`,
    );
    if (result.pending === 0) break;
  }

  // Exact text, so a last-bit difference cannot hide behind JS number printing.
  const { rows } = await pool.query<{ text: string; x: string; y: string; z: string }>(
    `select s.text, v.x::text as x, v.y::text as y, v.z::text as z
       from signal_vectors v join signals s on s.id = v.signal_id
      where v.kind = 'pca3'
      order by s.text`,
  );

  return { coordinates: JSON.stringify(rows), process: rounds };
}

// ─── assertions, straight off the database ────────────────────────────────────

async function assertState(rounds: ProcessResult[]): Promise<void> {
  process.stdout.write("\n── assertions ───────────────────────────────────────────\n");

  const failures = rounds.flatMap((r) => r.failures);
  check(failures.length === 0, "no signal failed to be placed", JSON.stringify(failures));

  const signals = await one<{ count: string }>("select count(*)::text as count from signals");
  check(
    Number(signals.count) === EXPECTED.signals,
    `all ${EXPECTED.signals} fixtures ingested`,
    `${signals.count} signals`,
  );

  const groups = await rowsOf<{
    id: string;
    mass: number;
    velocity: number;
    source_diversity: number;
    verification: Record<string, unknown> | null;
    centroid_lat: number | null;
    members: string;
  }>(
    `select g.id, g.mass, g.velocity, g.source_diversity, g.verification, g.centroid_lat,
            (select count(*)::text from edges e where e.to_id = g.id and e.rel = 'member_of') as members
       from groups g order by g.mass desc`,
  );

  check(
    Math.abs(groups.length - EXPECTED.groups) <= EXPECTED.groupTolerance,
    `group count within ±${EXPECTED.groupTolerance} of ${EXPECTED.groups}`,
    `${groups.length} groups: masses ${groups.map((g) => g.mass).join(", ")}`,
  );

  check(
    groups.every((g) => g.mass === Number(g.members)),
    "every group's cached mass equals its member-edge count",
    groups.map((g) => `${g.mass}/${g.members}`).join(" "),
  );

  // The loner: semantically and geographically apart, so it must stand alone.
  const loner = await one<{ mass: number; members: string }>(
    `select g.mass, (select count(*)::text from edges e where e.to_id = g.id and e.rel = 'member_of') as members
       from groups g
       join edges e on e.to_id = g.id and e.rel = 'member_of'
       join signals s on s.id = e.from_id
      where s.text like $1`,
    [`${EXPECTED.lonerText}%`],
  );
  check(Number(loner.members) === 1, "the loner signal is alone in its own bubble", `mass ${loner.mass}`);

  // Every grouping decision must carry a number AND a sentence.
  const edges = await one<{ total: string; weighted: string; reasoned: string }>(
    `select count(*)::text as total,
            count(weight)::text as weighted,
            count(*) filter (where length(trim(reason)) > 0)::text as reasoned
       from edges where rel = 'member_of'`,
  );
  check(
    Number(edges.total) === EXPECTED.signals &&
      edges.total === edges.weighted &&
      edges.total === edges.reasoned,
    "every member_of edge carries a weight and a human-readable reason",
    `${edges.total} edges, ${edges.weighted} weighted, ${edges.reasoned} with a reason`,
  );

  const sample = await rowsOf<{ reason: string; weight: number }>(
    "select reason, weight from edges where rel = 'member_of' order by weight desc limit 3",
  );
  for (const row of sample) {
    process.stdout.write(`      e.g. weight ${row.weight.toFixed(3)} — "${row.reason}"\n`);
  }

  // Source diversity and the verification fold.
  const biggest = groups.filter((g) => g.mass > 1);
  check(
    biggest.length > 0 && biggest.every((g) => g.source_diversity > 1),
    "multi-member bubbles count more than one distinct source_class",
    biggest.map((g) => `mass ${g.mass}: ${g.source_diversity} classes`).join("; "),
  );

  check(
    groups.every(
      (g) =>
        g.verification !== null &&
        typeof g.verification.verifiedCount === "number" &&
        Array.isArray(g.verification.sourceClasses),
    ),
    "every bubble carries a computed verification picture",
    JSON.stringify(biggest[0]?.verification ?? {}),
  );

  check(
    groups.some((g) => (g.verification?.meanConfidence as number | null) !== null),
    "mean confidence folded from member annotations",
    String(biggest[0]?.verification?.meanConfidence ?? "null"),
  );

  check(
    groups.every((g) => g.velocity > 0 && g.velocity <= g.mass),
    "velocity is a real count inside the last hour of each bubble's clock",
    groups.map((g) => `${g.velocity}/${g.mass}`).join(" "),
  );

  // Purity: every bubble should describe ONE event. The fixtures carry a
  // `hazard` annotation nobody in the pipeline reads, which makes it a clean
  // held-out label for whether the grouping actually grouped.
  const impure = await one<{ count: string }>(
    `select count(*)::text as count from (
       select e.to_id, count(distinct a.value) as hazards
         from edges e join annotations a on a.node_id = e.from_id and a.key = 'hazard'
        where e.rel = 'member_of'
        group by e.to_id
     ) t where t.hazards > 1`,
  );
  check(
    Number(impure.count) === 0,
    "every bubble is hazard-pure against the held-out label",
    `${impure.count} mixed bubbles`,
  );

  // Ungeolocated signals must still be grouped — absent geography never blocks.
  const ungeolocated = await one<{ total: string; grouped: string }>(
    `select count(*)::text as total,
            count(e.id)::text as grouped
       from signals s
       left join edges e on e.from_id = s.id and e.rel = 'member_of'
      where s.lat is null`,
  );
  check(
    Number(ungeolocated.total) > 0 && ungeolocated.total === ungeolocated.grouped,
    "ungeolocated signals skip the geo gate and still get grouped",
    `${ungeolocated.grouped}/${ungeolocated.total}`,
  );

  // Projection.
  const projected = await one<{ count: string; kinds: string }>(
    "select count(*)::text as count, count(distinct kind)::text as kinds from signal_vectors",
  );
  check(
    Number(projected.count) === EXPECTED.signals,
    "every signal has galaxy coordinates",
    `${projected.count} points in ${projected.kinds} basis`,
  );

  const model = await one<{ fitted_on: number; dims: number; variance: string }>(
    `select (model->>'fittedOn')::int as fitted_on,
            (model->>'dimensions')::int as dims,
            model->>'explainedVariance' as variance
       from projection_models where kind = 'pca3'`,
  );
  check(
    model.fitted_on >= 20 && model.dims === 1536,
    "the PCA basis was fitted once and stored as plain numbers",
    `fitted on ${model.fitted_on} signals, ${model.dims}d, variance ${model.variance}`,
  );

  const fits = rounds.filter((r) => r.fittedProjection).length;
  check(fits === 1, "the basis was fitted exactly once across the whole run", `${fits} fit(s)`);

  // The demo view.
  process.stdout.write("\n── bubbles ──────────────────────────────────────────────\n");
  const board = await rowsOf<{
    mass: number;
    velocity: number;
    source_diversity: number;
    verified: number;
    confidence: number | null;
    sample: string;
  }>(
    `select g.mass, g.velocity, g.source_diversity,
            (g.verification->>'verifiedCount')::int as verified,
            (g.verification->>'meanConfidence')::float as confidence,
            (select s.text from edges e join signals s on s.id = e.from_id
              where e.to_id = g.id and e.rel = 'member_of' order by s.occurred_at limit 1) as sample
       from groups g order by g.mass desc`,
  );
  for (const row of board) {
    process.stdout.write(
      `  mass ${String(row.mass).padStart(2)} · velocity ${row.velocity} · ${row.source_diversity} source classes · ` +
        `${row.verified} verified · mean confidence ${row.confidence?.toFixed(2) ?? "n/a"}\n     "${row.sample}"\n`,
    );
  }
}

async function one<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await pool.query<T>(sql, params);
  return rows[0];
}

async function rowsOf<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const first = await run("A");
  await assertState(first.process);

  const second = await run("B");

  process.stdout.write("\n── determinism ──────────────────────────────────────────\n");
  check(
    first.coordinates === second.coordinates && first.coordinates.length > 2,
    "two clean runs produce byte-identical galaxy coordinates",
    `${JSON.parse(first.coordinates).length} points compared`,
  );

  const failed = checks.filter((c) => !c.ok);
  process.stdout.write(
    `\n${checks.length - failed.length}/${checks.length} checks passed\n`,
  );
  await pool.end();
  if (failed.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  process.stdout.write(`\nPROOF ERRORED: ${err instanceof Error ? err.stack : String(err)}\n`);
  await pool.end();
  process.exitCode = 1;
});
