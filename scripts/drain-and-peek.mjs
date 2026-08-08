#!/usr/bin/env node
// Drain the derive queue, then print a dataset's clusters. Usage: node scripts/drain-and-peek.mjs [dataset]
const base = "http://localhost:3000";
const dataset = process.argv[2] ?? "live";

for (let i = 0; i < 120; i++) {
  const r = await fetch(`${base}/api/trpc/vectors.process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { limit: 200 } }),
  });
  const o = (await r.json())?.result?.data?.json;
  if (!o) break;
  if (!o.locked && o.pending === 0) { console.log(`drained after ${i} rounds`); break; }
  if (o.locked) await new Promise((res) => setTimeout(res, 400));
}

const g = await fetch(
  `${base}/api/trpc/signals.geojson?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: { datasetId: dataset } } }))}`,
);
const fc = (await g.json())?.[0]?.result?.data?.json;
console.log(`${dataset} dataset: ${fc?.features?.length ?? "?"} clusters`);
for (const f of (fc?.features ?? []).slice(0, 8)) {
  const p = f.properties ?? {};
  console.log(` • ${String(p.label ?? "?").slice(0, 52)} | ${p.grade?.label?.slice(0, 40) ?? "?"} | ${p.independentSources}/${p.itemCount}`);
}
