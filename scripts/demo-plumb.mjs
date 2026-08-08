#!/usr/bin/env node
// Plumb the demo story into the pipeline.
//   node scripts/demo-plumb.mjs            → POST via signals.ingestBatch (needs dev server)
//   node scripts/demo-plumb.mjs --inbox    → copy the file into data/inbox/ (poller path)
import { readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = resolve(root, "data/demo/demo-items.json");
const base = process.env.BASE_URL ?? "http://localhost:3000";

if (process.argv.includes("--inbox")) {
  mkdirSync(resolve(root, "data/inbox"), { recursive: true });
  const dest = resolve(root, "data/inbox", `demo-${Date.now()}.json`);
  copyFileSync(file, dest);
  console.log(`dropped → ${dest} (the inbox poller will ingest it)`);
  process.exit(0);
}

const items = JSON.parse(readFileSync(file, "utf8"));
const res = await fetch(`${base}/api/trpc/signals.ingestBatch?batch=1`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ 0: { json: { items } } }),
});
const body = await res.json();
const out = body?.[0]?.result?.data?.json ?? body;
console.log(`ingestBatch → HTTP ${res.status}`);
console.log(JSON.stringify({ total: out.total, created: out.created, deduped: out.deduped, failed: out.failed }, null, 2));

const geo = await fetch(
  `${base}/api/trpc/signals.geojson?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: { datasetId: "demo" } } }))}`,
);
const gbody = await geo.json();
const fc = gbody?.[0]?.result?.data?.json;
console.log(`geojson(demo) → ${fc?.features?.length ?? "??"} features`);
for (const f of (fc?.features ?? []).slice(0, 10)) {
  const p = f.properties ?? {};
  console.log(` • ${String(p.label ?? p.title ?? f.id ?? "?").slice(0, 48)} | grade=${p.grade?.label ?? "?"} | origins=${p.independentSources ?? "?"}/${p.itemCount ?? "?"}`);
}
