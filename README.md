# Impact Lab Wellington — Team 4

**Wellington City Council Emergency Management × Claude Code Community NZ**
Saturday 8 August 2026 · Waimanga Room, Wellington City Council

---

## Problem 03 — Identify and verify emerging local impacts from public information

> How might we use public online information to identify where emergency impacts may be emerging, while making the reliability and limitations of that information clear?

A prototype could collect relevant public posts, local news and community reports; identify likely locations and issue types; and show where several independent sources appear to describe the same event. It would not present social-media content as verified fact. It would identify signals for an intelligence team to investigate.

There may be an opportunity to develop this option in collaboration with doctoral research at Massey University's Joint Centre for Disaster Research, on multimodal generative AI for disaster situational awareness using social media. Early discussions with the WCC Emergency Management team have already identified possible overlap. Any collaboration would need to be agreed with the researcher and Massey University.

**Desired outcome:** WCC can detect possible impacts earlier and direct staff attention to matters needing confirmation.

*The common theme is improving the flow and use of information between communities and Council before and during an event.*

---

## What we're building

One working prototype, demoed in four minutes at 16:30.

Each team's module is meant to slot into a shared **common operating picture** —
a live map of emergency signals that the ten prototypes feed together. Aim for
something that can be pointed at a map, a feed or an API, rather than a
closed-off demo.

Two teams work each problem statement independently. That's deliberate: two
honest attempts at the same problem tell WCC more than one.

## Data

The public GIS datasets Wellington City Council Emergency Management shared are
catalogued, checked and made queryable here:

- **Catalogue + SDK** — https://github.com/claudecommunity-nz/wcc-emergency-gis-data
- **Browse the datasets** — https://claudecommunity-nz.github.io/wcc-emergency-gis-data/

74 datasets: flood, landslide, earthquake, tsunami, coastal inundation and
climate layers, plus emergency hubs, post-quake road reopening order, water
tanks, deprivation by area, and live river-level and rainfall telemetry.
`wcc_gis.py` is a single file with no dependencies — copy it and
`catalogue.json` into your project.

```python
import wcc_gis

wcc_gis.ids("tsunami")                                    # find datasets
wcc_gis.features("tsunami-evacuation-zones", at=(-41.2790, 174.7804))
wcc_gis.geojson("footpaths", bbox=wcc_gis.WELLINGTON)     # straight into MapLibre
wcc_gis.hilltop_data("Hutt River at Taita Gorge", "Flow")[-1]
```

Three traps worth knowing before you lose an hour to them:

- Everything is published in **NZTM2000, not lat/lng**. Request raw and your
  pins land off the coast of Africa. Always ask for `outSR=4326`.
- **A quarter of the layers are rasters** that advertise a query capability,
  then refuse to answer. Ask them for a PNG instead.
- **One query is silently capped** (`footpaths` has 8,130 features; a request
  returns 2,000). Page properly, or check `exceededTransferLimit`.

## Schedule

| Time | What |
|---|---|
| 08:00 | Arrival and mingle |
| 09:00 | Opening address & problem briefing |
| 09:30 | Build begins |
| 12:30 | Lunch + lightning talks |
| 16:00 | Submissions close |
| 16:30 | Demos + judging |
| 17:45 | Awards + next steps |

## Ground rules

- These are **hazard-planning layers, not live emergency information**.
  In an emergency, call 111.
- **The data is not ours.** Each dataset belongs to its publisher — WCC, Greater
  Wellington, GNS Science, NIWA, Wellington Water, MBIE, NZTA, MetService.
  Licence terms vary per dataset; check the dataset's page before publishing
  anything derived from it, and credit the publisher.
- Be considerate with request rates. These are council servers, and at least one
  host throttles under concurrent load.
- **Keep personal details out of this repo.** It is public. No participant
  names, contact details or application material.
- Treat public social content as a *signal to investigate*, never as verified
  fact — surfacing something unverified as confirmed is the failure mode these
  problem statements are most wary of.

## Licence

Code here is MIT unless stated otherwise. The data is not covered by it.

---

## Module status — intake, vector layer, trust scoring

What Team 4 ships, in three layers on one substrate: **a universal intake** (any
payload from any team, stored losslessly), **a vector layer** (embeddings →
bubbles with size, velocity and source diversity, plus a 3D projection), and
**trust scoring** — origin fingerprinting and an Admiralty grade, so the number
on screen is independent *witnesses* rather than documents. Full traceability
from any pin back to the verbatim source payload. Integration guide for other
teams: [INTEGRATION.md](INTEGRATION.md). Demo script: [DEMO.md](DEMO.md).

**Prove it in two commands:**

```bash
npm run proof:grading   # 56 assertions on the pure rule table — no db, no clock, <1s
npm run verify          # 66 end-to-end through the real procedures over HTTP
```

`proof:grading` tells you which RULE broke; `verify` tells you the whole chain
holds. `verify` wipes the database and starts a dev server if one is not
running, so it really is one command — but never run it once a demo dataset is
loaded.

### What works

| | |
|---|---|
| **Intake, push** | `signals.ingest` / `signals.ingestBatch` — any JSON object, one bad item never sinks a batch, dedupe on `source`+`text`+`occurred_at` enforced by a unique index (ten simultaneous deliveries still leave one row) |
| **Intake, pull** | drop `.json` files in `data/inbox/`; the poller workflow moves them to `processed/` or `failed/` |
| **Lossless storage** | your payload verbatim in `raw`, forever; top-level scalars promoted to open annotations; `occurred_at` optional and *said so* via an `assumed_occurred_at` annotation |
| **Grouping** | `vectors.process` — embed → assign → name → project; time window, then a hard 1.5km geo gate, then cosine. Every `member_of` edge carries a weight **and** a sentence |
| **Reads (frozen shapes)** | `vectors.points` (galaxy), `vectors.groups` (bubbles + **geo centroids** other teams can plot), `vectors.groupDetail` (bubble → members → all annotations → verbatim `raw`) |
| **Independent origins** | `utilities/origin-fingerprint.ts` collapses copy-paste text, quoted-URL inheritance and repeat authors, so 21 items can honestly report 14 witnesses. `signals.detail` returns the origin groups **with the sentence explaining each collapse** |
| **Grading** | `utilities/grading.ts` — Admiralty A–F × 2–6, two axes never blended, reliability from a registry that defaults to F. Every grade carries ordered `reasons[]` naming the evidence it used |
| **Alerting** | `signals.alerts` — transitions, never states. `alertWorthy` is computed **independently of the grade**, so an early single-source report alerts with its weakness written into `alertReasons` |
| **Trust surface** | `signals.ingest` (folds synchronously and returns the cluster's grade), `signals.geojson`, `signals.detail`, `signals.alerts`; `asAt` replays the picture as it stood |
| **Honesty** | `verification` counts corroboration, never asserts truth; the embedder used is recorded per signal as an annotation; credibility **1 is unreachable** — the grading module throws rather than write "confirmed" |

### What is stubbed

**Embeddings, until `AI_GATEWAY_API_KEY` is set.** With no key the pipeline uses
a deterministic lexical stub of the same 1536 dimensions, so everything
downstream works today; grouping is by shared words, not meaning ("inundation"
will not match "flooding"). Say it precisely on stage: **with the stub, cosine
RANKS correctly while geography and time SEPARATE** — over the fixtures,
same-hazard pairs average 0.85 against different-hazard 0.79, so the
distributions overlap and the partition you see is produced mostly by the 1.5km
gate and the 6h window. The semantic signal is real but works by argmax (the
ungeolocated fixtures pick their true bubble at 0.93 versus 0.85 for the
runner-up), not by the threshold. For the *gated* pipeline the correct 13/11/1
partition holds anywhere from 0.60 to 0.80, so 0.80 is a safe default rather than
a tuned one. Set the key and the same code path calls
`openai/text-embedding-3-small` instead — no code change, and the join threshold
switches with it. **Bubble names** use the same switch: a
`hazard — locality` template without a key, Claude reading the member reports
with one. Both are reported honestly (`stubEmbeddings`, `stub`) so a UI can say
which it was.

**The authoritative cross-check, entirely.** No river-gauge or susceptibility
lookup is wired to a claim, so `hazardCrossCheck` reports `no_applicable_layer`
on every cluster and says so in every `reasons` array. This is why nothing in
the system reaches credibility 2 — that rule requires an authoritative layer to
*agree* — and `verify` asserts exactly that. The contradiction rule (credibility
5) is built and proven, waiting only for the lookup. It is the highest-value
next thing to build, and the seam is shaped for it:
`clusterFactsFromItems` takes an optional `hazardCrossCheck` that overrides the
honest default.

**No live collectors.** Items arrive by drop-folder or by POST; anyone's
collector can send us anything today, but we built no scrapers.

Nothing else is faked: the database, the procedures, the grouping, the grading,
the projection and the traceability chain are all real.

### Seams for teammates

- **UX team** — build on the three read procedures; their shapes are frozen. A
  bubble is `{ center, geoCentroid, size, velocity, sourceDiversity,
  verification, label, memberCount, firstSeen, lastSeen }`, returned ranked by an
  internal score (mass decayed by how long ago the bubble last heard anything);
  the number itself stays internal, but the arithmetic behind the order ships on
  every bubble as `verification.scoreBreakdown`; drilling in gives
  every member with all its annotations, why it was placed, and its raw payload.
  Tolerate `null` on `x/y/z`, `groupId`, `geoCentroid` and `label` — each null is
  a real state (not projected, not grouped, no coordinates, not named yet), and
  rendering it as zero would be a lie. Read use cases live in
  `use-cases/vectors/`; the router is `use-cases/vectors/vectors-router.ts`.
- **Pipeline team** — send us anything (INTEGRATION.md); your findings arrive as
  annotations and come back out of `groupDetail` in full, including keys we have
  never seen. The vocabulary in `db/vocabulary.ts` is a set of suggestions, not
  a schema you must satisfy. New source shapes are absorbed in
  `utilities/adapters/`, never by changing the tables.
- **Anyone** — `scripts/fixtures.json` is the demo dataset and `npm run verify`
  is the proof (it loads `.env.local` and starts a dev server itself, so it
  really is one command). `npm run proof:vectors` additionally proves the
  grouping maths and that two clean runs produce byte-identical coordinates — it
  talks to the database directly, so it needs the env in the shell and a dev
  server already running:

  ```bash
  export $(grep -v '^#' .env.local | grep -v '^$' | xargs) && npm run proof:vectors
  ```

## The codebase

Team base template: Next.js 16 + TypeScript + Tailwind/shadcn (+ AI Elements) ·
tRPC v11 (single transport) · Drizzle + Postgres · Vercel AI SDK via AI Gateway ·
Vercel Workflows · TanStack Query + Virtual · pino.

Get running — copy-paste, in bash, from a fresh shell:

```bash
npm i
cp .env.example .env.local          # then fill in DATABASE_URL (+ AI_GATEWAY_API_KEY if you have one)
export $(grep -v '^#' .env.local | grep -v '^$' | xargs)   # drizzle-kit reads the shell, not .env.local
npm run db:push
npm run dev
```

The `export` line is not optional for `db:push`: `drizzle.config.ts` reads
`process.env.DATABASE_URL` directly and nothing loads `.env.local` for
drizzle-kit, so without it you get *"Either connection `url` or `host`,
`database` are required"*. Next.js itself loads `.env.local` on its own — `npm
run dev` needs no prefix.

The `/notes` slice is the reference implementation of every pattern; layer rules
live in `AGENTS.md`, `docs/`, and per-folder `CLAUDE.md`s. Adding an entity: use
the `new-entity` skill.
