#!/usr/bin/env node
// Ingest the data-team's collected signals (already contract-shaped) into the feed.
//   npm run signals:load                          → data/signals/latest.json
//   npm run signals:load -- --file <path>         → a specific capture file
// signals:collect WRITES those files; this is the missing second half that
// ingests them. Re-running is safe — externalId dedupe makes it a no-op.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fileArg = args[args.indexOf("--file") + 1];
const FILE = args.includes("--file") ? path.resolve(ROOT, fileArg) : path.join(ROOT, "data/signals/latest.json");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const doc = JSON.parse(await readFile(FILE, "utf8"));
const items = Array.isArray(doc) ? doc : (doc.items ?? doc.signals ?? []);
if (items.length === 0) {
  console.error(`No items in ${FILE}`);
  process.exit(1);
}

let created = 0, deduped = 0, failed = 0;
for (let i = 0; i < items.length; i += 200) {
  const res = await fetch(`${BASE}/api/trpc/signals.ingestBatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { items: items.slice(i, i + 200) } }),
  });
  const out = (await res.json())?.result?.data?.json;
  created += out?.created ?? 0; deduped += out?.deduped ?? 0; failed += out?.failed ?? 0;
}
console.log(`${path.basename(FILE)}: ${items.length} items → created ${created} · deduped ${deduped} · failed ${failed}`);

for (let round = 0; round < 60; round++) {
  const res = await fetch(`${BASE}/api/trpc/vectors.process`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { limit: 200 } }),
  });
  const out = (await res.json())?.result?.data?.json;
  if (!out) break;
  if (!out.locked && out.pending === 0) { console.log(`derive drained in ${round} rounds`); break; }
  if (out.locked) await new Promise((r) => setTimeout(r, 400));
}
