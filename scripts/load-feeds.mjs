#!/usr/bin/env node
// Load the data-team's captured feeds (data/feeds/*.json) through the real ingest.
//   node scripts/load-feeds.mjs                     → all feeds, dataset "feeds"
//   node scripts/load-feeds.mjs --since-days 30     → only recent items
//   node scripts/load-feeds.mjs --dataset live      → choose the namespace deliberately
// Their shape: { platform, posts: [{ id, platform, subreddit, post_type,
// author_display, posted_at, title, text, ... }] } — mapped onto INTEGRATION.md's
// contract; everything else rides along in raw untouched.
import { readFile } from "node:fs/promises";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const DATASET = flag("--dataset", "feeds");
const SINCE_DAYS = Number(flag("--since-days", "0"));
const BASE = flag("--url", "http://localhost:3000");
const cutoff = SINCE_DAYS > 0 ? Date.now() - SINCE_DAYS * 86_400_000 : 0;


/** Me-as-classifier: a keyword pass so feed items arrive with an issue hint
 *  when the text supports one. Unmatched items stay unclassified honestly. */
function classify(text) {
  const t = text.toLowerCase();
  const rules = [
    ["flooding", /flood|under ?water|surface water|ponding|inundat|water over|burst.*(bank|pipe|main)/],
    ["wind", /wind|gale|gust|roof (iron|lifting|off)|tree (down|fallen)|blown/],
    ["earthquake", /earthquake|quake|shaking|felt report|seismic|aftershock/],
    ["landslip", /slip|landslide|landslip|rockfall|bank collapsed/],
    ["power_outage", /power (out|cut|outage)|no power|lines down|blackout/],
    ["road", /road (closed|blocked)|crash|collision|traffic|detour|highway|sh[12]\b/],
    ["coastal_inundation", /storm surge|king tide|waves? over|coastal flood|swell/],
  ];
  for (const [issue, re] of rules) if (re.test(t)) return issue;
  return null;
}

/** POST with retry: a dev server mid-derive can sit on a request past undici's
 *  headers timeout, and one slow answer must not kill a 6000-item load. */
async function post(url, body, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status >= 500) throw new Error(`http ${res.status}`);
      return (await res.json())?.result?.data?.json;
    } catch (err) {
      if (attempt >= attempts) throw err;
      console.log(`  retry ${attempt}: ${err.cause?.code ?? err.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const files = globSync("data/feeds/*.json", { cwd: ROOT }).map((f) => path.join(ROOT, f));
let total = 0, created = 0, deduped = 0, failed = 0;

for (const file of files) {
  const doc = JSON.parse(await readFile(file, "utf8"));
  const posts = doc.posts ?? doc.items ?? [];
  const mapped = posts
    .filter((p) => (p.text ?? p.title ?? "").trim().length > 0)
    .filter((p) => !cutoff || Date.parse(p.posted_at ?? p.published_at ?? "") >= cutoff)
    .map((p) => ({
      ...p, // everything they captured survives into raw
      text: [p.title, p.text].filter(Boolean).join(" — ").slice(0, 4000),
      source: [p.platform ?? doc.platform ?? "feed", p.subreddit ?? p.feed ?? ""]
        .filter(Boolean).join("-"),
      sourceClass: (p.platform ?? doc.platform) === "news" ? "media" : "social",
      occurredAt: p.posted_at ?? p.published_at ?? undefined,
      externalId: p.id != null ? String(p.id) : undefined,
      author: p.author_display ?? p.author ?? undefined,
      url: p.url ?? p.permalink ?? undefined,
      datasetId: DATASET,
      synthetic: false, // real captured public content
      annotations: (() => {
        const issue = classify([p.title, p.text].filter(Boolean).join(" "));
        return issue ? [{ key: "hazard", value: issue, confidence: 0.6 }] : [];
      })(),
    }));

  for (let i = 0; i < mapped.length; i += 100) {
    const batch = mapped.slice(i, i + 100);
    const out = await post(`${BASE}/api/trpc/signals.ingestBatch`, { json: { items: batch } });
    total += out?.total ?? 0; created += out?.created ?? 0;
    deduped += out?.deduped ?? 0; failed += out?.failed ?? 0;
  }
  console.log(`${path.basename(file)} → ${mapped.length} mapped`);
}
console.log(`ingested: total ${total} · created ${created} · deduped ${deduped} · failed ${failed}`);

// drain the derive queue so the dataset is grouped, graded and named
for (let round = 0; round < 500; round++) {
  const out = await post(`${BASE}/api/trpc/vectors.process`, { json: { limit: 200 } });
  if (!out) break;
  if (!out.locked && out.pending === 0) { console.log(`derive drained in ${round} rounds`); break; }
  if (out.locked) await new Promise((r) => setTimeout(r, 400));
}
console.log(`Explore: ${BASE}/board?dataset=${DATASET}`);
