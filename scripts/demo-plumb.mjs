#!/usr/bin/env node
/**
 * Plumb the demo story into the pipeline.
 *
 *   npm run demo:plumb                  # POST via signals.ingestBatch (needs the dev server)
 *   npm run demo:plumb -- --inbox       # drop a file in data/inbox/ (the poller path)
 *   npm run demo:plumb -- --keep-times  # leave the authored timestamps alone
 *   npm run demo:plumb -- --dataset=live
 *
 * Two paths because there are two ways in and they are not always both
 * available: the drop folder needs the inbox poller running, the POST needs the
 * dev server. Both land on the SAME adapter and the SAME ingest use case, so
 * neither is a shortcut — they are the pull and push halves of the intake,
 * exactly as another team would use them (INTEGRATION.md).
 *
 * The fixture is namespaced to the `demo` dataset, not `live`. Clustering never
 * crosses datasets (db/vocabulary.ts), so fabricated corroboration cannot reach
 * an operational picture no matter how many times this is run. View it at
 * `/board?dataset=demo`.
 *
 * Re-running is safe and worth showing: every item carries an `external_id`, so
 * a second run comes back `deduped` rather than inventing fresh corroboration
 * out of the same posts.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "data", "demo", "demo-items.json");
const INBOX = path.join(ROOT, "data", "inbox");

/** How long ago the newest item should look, so the board opens on fresh data. */
const NEWEST_AGE_MINUTES = 2;

const args = process.argv.slice(2);
const useInbox = args.includes("--inbox");
const keepTimes = args.includes("--keep-times");
// Default LIVE: the board is one feed now (87e1505) and reads live only. A
// default of "demo" made the worst failure mode — a working system showing an
// empty map. Pass --dataset=demo only if you deliberately want a sandbox.
const dataset = readFlag("--dataset") ?? "live";
const baseUrl = readFlag("--url") ?? process.env.BASE_URL ?? "http://localhost:3000";

const items = await loadItems();

if (useInbox) {
  await dropFile(items);
} else {
  await postBatch(items);
  await readBack();
}

// ─── the two paths ────────────────────────────────────────────────────────────

async function dropFile(payload) {
  await mkdir(INBOX, { recursive: true });
  const name = `demo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const target = path.join(INBOX, name);

  // A bare array — one of the three shapes the poller accepts — so the dropped
  // file carries nothing but items, with no envelope to misread.
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Dropped ${payload.length} items → data/inbox/${name}`);
  console.log("");
  console.log("The inbox poller sweeps every 15s. If it is not running, start one round:");
  console.log(
    `  curl -s -X POST '${baseUrl}/api/workflows/inbox-poller' \\\n    -H 'content-type: application/json' -d '{"rounds":1,"intervalSeconds":1}'`,
  );
  console.log("");
  console.log("The file moves to data/inbox/processed/ once it has been ingested.");
}

async function postBatch(payload) {
  const endpoint = `${baseUrl}/api/trpc/signals.ingestBatch`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // tRPC + superjson: the payload goes inside `{"json": ...}`.
      body: JSON.stringify({ json: { items: payload } }),
    });
  } catch (error) {
    console.error(`Could not reach ${endpoint} — is the dev server running?`);
    console.error(String(error));
    console.error("");
    console.error("No server? Use the drop-folder path instead:");
    console.error("  npm run demo:plumb -- --inbox");
    process.exit(1);
  }

  const body = await response.text();
  if (!response.ok) {
    console.error(`Ingest failed (HTTP ${response.status}):`);
    console.error(body.slice(0, 800));
    process.exit(1);
  }

  const result = JSON.parse(body)?.result?.data?.json;
  console.log(`Posted ${payload.length} items → ${endpoint}`);
  console.log(
    `  total ${result?.total ?? "?"} · created ${result?.created ?? "?"} · deduped ${
      result?.deduped ?? "?"
    } · failed ${result?.failed ?? "?"}`,
  );

  for (const failure of result?.results?.filter((entry) => entry?.ok === false) ?? []) {
    console.log(`  ! item ${failure.index}: ${failure.error}`);
  }

  await processPending();
}

/**
 * Drain the derive queue so freshly ingested items get embedded, assigned,
 * NAMED and projected. Without this the board shows unlabelled clusters —
 * naming lives in vectors.process, not in ingest.
 */
async function processPending() {
  for (let round = 1; round <= 30; round++) {
    const res = await fetch(`${baseUrl}/api/trpc/vectors.process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { limit: 100 } }),
    });
    if (!res.ok) {
      console.log(`  vectors.process → HTTP ${res.status} (labels may lag; re-run to finish)`);
      return;
    }
    const out = (await res.json())?.result?.data?.json;
    if (!out) return;
    if (!out.locked && out.pending === 0) {
      console.log(`  derive drained in ${round - 1} round(s) — clusters embedded, graded and named`);
      return;
    }
    if (out.locked) await new Promise((r) => setTimeout(r, 500));
  }
  console.log("  derive still had pending work after 30 rounds — run vectors.process again");
}

/**
 * Read the picture back out of the published surface, not out of our own input.
 *
 * The point of the demo is the trust surface, so the script proves the round
 * trip: what the map will actually draw, with the grade and the independent-vs-
 * total counts that the board puts in front of an operator.
 */
async function readBack() {
  const input = encodeURIComponent(JSON.stringify({ json: { datasetId: dataset } }));
  const endpoint = `${baseUrl}/api/trpc/signals.geojson?input=${input}`;

  const response = await fetch(endpoint).catch(() => null);
  if (!response?.ok) {
    console.log("");
    console.log("(Could not read the map layer back — check the dev server.)");
    return;
  }

  const collection = JSON.parse(await response.text())?.result?.data?.json;
  const features = collection?.features ?? [];

  console.log("");
  console.log(`signals.geojson(${dataset}) → ${features.length} mappable signals`);
  for (const feature of features.slice(0, 10)) {
    const properties = feature.properties ?? {};
    console.log(
      `  • ${String(properties.label ?? properties.signalId ?? "?").slice(0, 44).padEnd(44)}` +
        ` grade=${properties.grade?.label ?? "ungraded"}` +
        ` origins=${properties.independentSources ?? "?"}/${properties.itemCount ?? "?"}`,
    );
  }
  if (collection?.unmappable?.length) {
    console.log(`  + ${collection.unmappable.length} held but not placeable (shown in the gutter)`);
  }
  console.log("");
  console.log(`Open the board: ${baseUrl}/board?dataset=${dataset}`);
}

// ─── loading ──────────────────────────────────────────────────────────────────

function readFlag(name) {
  const match = args.find((arg) => arg.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

async function loadItems() {
  const file = JSON.parse(await readFile(SOURCE, "utf8"));
  const authored = Array.isArray(file) ? file : file.items;

  if (!Array.isArray(authored) || authored.length === 0) {
    console.error(`No items found in ${SOURCE}`);
    process.exit(1);
  }

  const namespaced = authored.map((item) => ({ ...item, dataset_id: dataset }));
  return keepTimes ? namespaced : slideToNow(namespaced);
}

/**
 * Slide the whole story forward so the newest item is a couple of minutes old,
 * keeping every gap between items exactly as authored.
 *
 * The demo is judged on a board showing a live picture; items stamped with the
 * morning they were written would arrive already stale, and widening the
 * board's window to compensate would be tuning the product to fit the fixture.
 * Items with no `occurred_at` are left alone — the ingest rule defaults them to
 * capture time and annotates that it assumed, which is worth demonstrating
 * rather than papering over.
 */
function slideToNow(authored) {
  const stamped = authored
    .map((item) => Date.parse(item.occurred_at ?? ""))
    .filter((value) => Number.isFinite(value));

  if (stamped.length === 0) return authored;

  const offset = Date.now() - NEWEST_AGE_MINUTES * 60_000 - Math.max(...stamped);

  return authored.map((item, index) => {
    const original = Date.parse(item.occurred_at ?? "");
    if (!Number.isFinite(original)) return item;
    const occurred = original + offset;
    // Capture clock (intel 9331d51): collection TRAILS occurrence by a plausible
    // lag, deterministic per item, and never lands in the future. This is what
    // lets asAt scrub a real history instead of a 0.7s ingest burst. Ingest
    // records declared_captured_at beside it — the honesty valve; don't strip.
    const lagMs = (3 + ((index * 7) % 6)) * 60_000;
    const captured = Math.min(occurred + lagMs, Date.now() - 30_000);
    return {
      ...item,
      occurred_at: new Date(occurred).toISOString(),
      captured_at: new Date(Math.max(captured, occurred)).toISOString(),
    };
  });
}
