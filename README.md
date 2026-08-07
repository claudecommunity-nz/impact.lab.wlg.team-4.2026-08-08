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

## Module status — universal intake + vector layer

What Team 4 ships: **a universal intake** (any payload from any team, stored
losslessly) and **a vector layer** (embeddings → bubbles with size, velocity and
source diversity, plus a 3D projection), with full traceability from any bubble
back to the verbatim source payload. Integration guide for other teams:
[INTEGRATION.md](INTEGRATION.md).

**Prove it in one command:** `npm run verify` — wipes the database, ingests the
fixture set through the real ingest procedure, runs the pipeline, reads it all
back through the three read procedures, asserts the chain holds, and prints the
board. It starts a dev server if one is not running. 22/22 green as committed.

### What works

| | |
|---|---|
| **Intake, push** | `signals.ingest` / `signals.ingestBatch` — any JSON object, one bad item never sinks a batch, dedupe on `source`+`text`+`occurred_at` |
| **Intake, pull** | drop `.json` files in `data/inbox/`; the poller workflow moves them to `processed/` or `failed/` |
| **Lossless storage** | your payload verbatim in `raw`, forever; top-level scalars promoted to open annotations; `occurred_at` optional and *said so* via an `assumed_occurred_at` annotation |
| **Grouping** | `vectors.process` — embed → assign → name → project; time window, then a hard 1.5km geo gate, then cosine. Every `member_of` edge carries a weight **and** a sentence |
| **Reads (frozen shapes)** | `vectors.points` (galaxy), `vectors.groups` (bubbles + **geo centroids** other teams can plot), `vectors.groupDetail` (bubble → members → all annotations → verbatim `raw`) |
| **Honesty** | `verification` counts corroboration, never asserts truth; the embedder used is recorded per signal as an annotation |

### What is stubbed

**Embeddings, until `AI_GATEWAY_API_KEY` is set.** With no key the pipeline uses
a deterministic lexical stub of the same 1536 dimensions, so everything
downstream works today; grouping is by shared words, not meaning ("inundation"
will not match "flooding"). Set the key and the same code path calls
`openai/text-embedding-3-small` instead — no code change, and the join threshold
switches with it. **Bubble names** use the same switch: a
`hazard — locality` template without a key, Claude reading the member reports
with one. Both are reported honestly (`stubEmbeddings`, `stub`) so a UI can say
which it was.

Nothing else is faked: the database, the procedures, the grouping, the
projection and the traceability chain are all real.

### Seams for teammates

- **UX team** — build on the three read procedures; their shapes are frozen. A
  bubble is `{ center, geoCentroid, size, velocity, sourceDiversity,
  verification, label, memberCount, firstSeen, lastSeen }`; drilling in gives
  every member with all its annotations, why it was placed, and its raw payload.
  Tolerate `null` on `x/y/z`, `groupId`, `geoCentroid` and `label` — each null is
  a real state (not projected, not grouped, no coordinates, not named yet), and
  rendering it as zero would be a lie. Read use cases live in
  `use-cases/vectors/`; the router is `use-cases/vectors/vectors-router.ts`.
- **Pipeline team** — send us anything (INTEGRATION.md); your findings arrive as
  annotations and come back out of `groupDetail` in full, including keys we have
  never seen. The vocabulary in `db/vocabulary.ts` is a set of suggestions, not
  a schema you must satisfy. New source shapes are absorbed in
  `workflows/adapters/`, never by changing the tables.
- **Anyone** — `scripts/fixtures.json` is the demo dataset; `npm run verify` is
  the proof; `npm run proof:vectors` additionally proves the grouping maths and
  that two clean runs produce byte-identical coordinates.

## The codebase

Team base template: Next.js 16 + TypeScript + Tailwind/shadcn (+ AI Elements) ·
tRPC v11 (single transport) · Drizzle + Postgres · Vercel AI SDK via AI Gateway ·
Vercel Workflows · TanStack Query + Virtual · pino.

Get running: `npm i` → copy `.env.example` to `.env.local` and fill it →
`npm run db:push` → `npm run dev`. The `/notes` slice is the reference
implementation of every pattern; layer rules live in `AGENTS.md`, `docs/`, and
per-folder `CLAUDE.md`s. Adding an entity: use the `new-entity` skill.
