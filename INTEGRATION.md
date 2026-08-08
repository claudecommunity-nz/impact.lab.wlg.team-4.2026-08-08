# Sending us data — integration guide

**For other teams. You do not need to know anything about this codebase.**

> **Status — Saturday 8 August, 12:30.** Every endpoint in this guide is live and
> every example below was run against a real server: intake (push and pull),
> `vectors.process`, and the three read procedures. Nothing here is a plan.
> `npm run verify` re-proves the whole chain end to end in one command.

## What this module is

This is Team 4's **universal intake and vector layer** for Problem 03. You send us
anything you have collected from public information — a post, a news item, a gauge
reading, a scraped row, a note someone typed — and we store it **losslessly** (bar
NUL bytes, which Postgres cannot hold at all — see *Rules worth knowing*) as a
*signal*: your original payload kept verbatim forever, plus a plain-text sentence,
a time, an optional location, and whatever structured fields you sent turned into
open key/value *annotations*. We then embed those sentences and group them into
bubbles, so that when several independent sources describe the same emerging
impact, that shows up as one bubble with a size, a velocity and a source-diversity
count — and every bubble can be traced back to the exact words you sent us. We
never present any of it as verified fact; we surface it for an intelligence team
to confirm.

**You do not have to match our schema.** An adapter absorbs the shape burden.
The only thing we truly need is something we can read as a sentence.

---

## Three ways to send data

The dev server runs at `http://localhost:3000`. Replace the host if we give you a
deployed URL.

### 1. One item at a time — `POST /api/trpc/signals.ingest`

```bash
curl -s -X POST 'http://localhost:3000/api/trpc/signals.ingest' \
  -H 'content-type: application/json' \
  -d '{"json":{"text":"Surface flooding on Adelaide Road, water over both lanes","source":"antenno","source_class":"human_report","occurred_at":"2026-08-08T09:12:00+12:00","lat":-41.3075,"lng":174.7762,"hazard":"flooding","verified":false,"source_url":"https://example.org/report/1234"}}'
```

**The minimal payload is just text.** This is a complete, valid request:

```bash
curl -s -X POST 'http://localhost:3000/api/trpc/signals.ingest' \
  -H 'content-type: application/json' \
  -d '{"json":{"text":"Tree down blocking Adelaide Road near Wallace Street"}}'
```

> **Why the `{"json": ...}` wrapper?** The API is tRPC with superjson, so the
> request body is your payload wrapped in `{"json": ...}` and the response is
> wrapped in `{"result":{"data":{"json": ...}}}`. Wrap it, unwrap it, done —
> there is nothing else to learn about tRPC to use this.

### 2. Many items at once — `POST /api/trpc/signals.ingestBatch`

Items go in `items`. **One bad item never sinks the batch**: you get a verdict per
item, in order. This example deliberately includes a bad item (`12345` is not an
object) and a payload with no readable text:

```bash
curl -s -X POST 'http://localhost:3000/api/trpc/signals.ingestBatch' \
  -H 'content-type: application/json' \
  -d '{"json":{"items":[
    {"text":"Slip across Ngaio Gorge Road, one lane open","source":"neighbourly","source_class":"human_report","occurred_at":"2026-08-08T08:40:00+12:00","location":{"lat":-41.2603,"lng":174.7742}},
    {"station":"Hutt River at Taita Gorge","stage_m":24.6,"trend":"rising","source":"hilltop","source_class":"sensor","timestamp":"2026-08-08T08:45:00+12:00"},
    12345,
    {"nothing_useful":null}
  ]}}'
```

Response (abridged, against a fresh database): `total: 4, created: 2, deduped: 0,
failed: 2` — run it twice and the two good items come back as `deduped: 2`
instead. Per failed item you get:

```json
{ "index": 2, "ok": false, "error": "Payload must be a JSON object or string, received a number" }
{ "index": 3, "ok": false, "error": "Could not derive any text from the payload — send a `text` field, or any readable scalar value" }
```

### 3. Drop a file in a folder — no HTTP at all

Write a `.json` file into `data/inbox/`. A poller picks it up, runs it through the
same adapter and the same ingest path, then moves the file to
`data/inbox/processed/` (or to `data/inbox/failed/` if it could not be read, with
the reason logged). The folder is its own status board.

The file may be any of these three shapes:

- a bare array of payloads: `[ {...}, {...} ]`
- an envelope: `{ "items": [ {...}, {...} ] }`
- a single payload: `{ "text": "..." }`

A ready-made example lives at `data/samples/inbox-example.json`:

```bash
cp data/samples/inbox-example.json data/inbox/my-feed-2026-08-08.json
```

Files go through exactly the same dedupe as the HTTP paths, so re-dropping a file
you already sent us over HTTP stores nothing twice.

The poller is a workflow; start it (rounds/interval optional — it defaults to a
15-second sweep) with:

```bash
curl -s -X POST 'http://localhost:3000/api/workflows/inbox-poller' \
  -H 'content-type: application/json' \
  -d '{"rounds":1,"intervalSeconds":1}'
```

---

## What happens to your fields

**Your whole payload is kept.** It is stored in the signal's `raw` column,
forever, whatever shape it had, and everything below is derived on top of it.
Two honest exceptions, both spelled out in *Rules worth knowing*: the derived
`text` is capped at 4000 characters (and each annotation value at 2000) — the
full original stays in `raw` — and NUL bytes are removed, because Postgres
cannot store them at all.

### Fields we recognise (all optional, aliases accepted)

| Signal field | Keys we look for |
|---|---|
| `text` | `text`, `content`, `body`, `message`, `description`, `summary`, `report`, `note` — combined with `title` / `headline` / `subject` when both are present |
| `source` | `source`, `source_name`, `sourceName`, `feed`, `origin`, `publisher`, `channel`, `account`, `author` |
| `source_class` | `source_class`, `sourceClass`, `source_type`, `sourceType` |
| `occurred_at` | `occurred_at`, `observed_at`, `timestamp`, `datetime`, `time`, `date`, `published_at`, `created_at` (ISO 8601, or epoch seconds/ms) |
| `lat` / `lng` | `lat`/`latitude` + `lng`/`lon`/`long`/`longitude`, or a nested `location`/`geo`/`position`/`point`/`geometry`/`coordinates` — **GeoJSON `[lng, lat]` order is understood**, including a full `{"type":"Feature","geometry":{...},"properties":{...}}` |
| `geo_confidence` | `geo_confidence`, `geoConfidence` (0–1; defaults to 1 when you send explicit coordinates) |

camelCase and snake_case both work. A property bag (`properties`, `meta`,
`metadata`, `attributes`, `fields`) is looked inside, so a GeoJSON Feature reads
as well as a flat object.

**If we can't find a `text` field we build the sentence from your other values**,
so `{"station":"Hutt River at Taita Gorge","stage_m":24.6,"trend":"rising"}`
becomes `"station: Hutt River at Taita Gorge; stage m: 24.6; trend: rising"`.
Check the `text` we echo back — if it reads badly, send a `text` field.

### Everything else becomes an annotation

Every **remaining top-level scalar** (string, number, boolean) is promoted to an
annotation: `{"hazard":"flooding"}` becomes the annotation `hazard = flooding`,
attributed to `feed` (you). Nested property bags are promoted the same way, and
`tags: ["outage","karori"]` becomes two `tag` annotations. **Invented keys are
kept** — the vocabulary is a convention, not a constraint. Unrecognised keys are
displayed but do not drive ranking.

You can also send annotations explicitly, with a confidence:

```json
"annotations": [{ "key": "hazard", "value": "flooding", "confidence": 0.8 }]
```

**Suggested keys** (use these where they fit, so they line up across teams):
`verified`, `confidence`, `source_url`, `hazard`, `location_text`, `severity`,
`urgency`, `people_count`.

### Rules worth knowing

- **`source_class` is open text.** `human_report`, `official_feed`, `sensor`,
  `media`, `social`, `operator_note` are suggestions; anything else is accepted
  as-is. Source diversity counts *distinct* values, so be consistent within your
  feed. Omitted becomes `unknown`.
- **`occurred_at` is optional.** If you omit it we use the time we received the
  item **and say so**: the signal gets an `assumed_occurred_at = true` annotation
  and the response sets `assumedOccurredAt: true`. We never silently invent a
  timestamp. If you know the real time, send it — the whole UI is time-scrubbed.
- **We dedupe on `source` + `text` + `occurred_at`.** Re-sending the same item is
  safe: you get the original id back with `created: false`, and nothing is stored
  twice. This holds under CONCURRENCY too, not just re-sends: the key is a unique
  index in the database, so ten simultaneous deliveries of one report (batched
  clients, parallel pollers, a retrying queue) still leave exactly one row — nine
  of them come back `created: false`. (Items with no `occurred_at` cannot dedupe
  against each other — their assumed time differs by milliseconds — so send
  `occurred_at` if you replay.)
- **Long text is truncated, and we say so.** The stored sentence is capped at
  **4000 characters** and each annotation value at **2000**; anything longer is
  cut, an ellipsis appended, and a `text_truncated = true` annotation written.
  Your full original is untouched in `raw`, so nothing is actually lost — but if
  you send whole news articles, expect the `text` we echo back to be shorter than
  what you sent.
- **NUL bytes (`U+0000`) are removed.** Postgres rejects them in both `text` and
  `jsonb`, so a single one anywhere in a payload would otherwise fail the item.
  We delete them (substituted with nothing — no replacement character) from the
  sentence, from annotation keys and values, and from `raw`, then write a
  `nul_bytes_stripped = true` annotation. Nothing else in your payload changes.
  This is common in scraped social and news text.
- **Blank text is a rejection, not a signal.** A payload whose text is empty or
  whitespace-only fails with *"Could not derive any text from the payload…"* — an
  empty sentence would be embedded and grouped into a bubble that says nothing.
- **Coordinates we cannot use are reported, not silently dropped.** Values
  outside WGS84 range (`lat` beyond ±90, `lng` beyond ±180) or half a pair are
  NOT stored as `lat`/`lng`: the response comes back with `geoDropped: true` and
  the signal gets a `geo_dropped` annotation saying which values were refused.
  They still live in `raw`. The signal ingests normally and groups on meaning and
  time — missing geography never blocks you.
- **Top level beats a property bag.** If the same key appears both at the top
  level and inside `properties` / `meta` / `metadata` / `attributes` / `fields`,
  the top-level value is the one promoted to an annotation. The nested one is
  still in `raw`, but it will not appear twice.
- **A bare string is a valid payload — in the batch and file paths.**
  `"Tree down on Adelaide Road"` as an item in `signals.ingestBatch`, or as an
  entry in a dropped file, is adapted like any object. `signals.ingest` (the
  single-item endpoint) takes a JSON **object** only, so send
  `{"text":"Tree down on Adelaide Road"}` there.
- **Nothing you send is treated as verified.** Reliability is shown, not hidden.

---

## What you get back

Single ingest returns an echo of what we understood — check it if a payload reads
oddly:

```json
{
  "id": "896ad279-a487-45d8-bfde-0a8506412cf9",
  "created": true,
  "text": "Road closed at Kent Terrace, Wellington Water on site",
  "source": "wcc-gis",
  "sourceClass": "official_feed",
  "occurredAt": "2026-08-07T21:20:00.000Z",
  "assumedOccurredAt": false,
  "geoDropped": false,
  "annotationKeys": ["hazard", "verified", "type"]
}
```

(remember: inside `{"result":{"data":{"json": ... }}}`).

- `id` — the signal id. Keep it; it is how you refer to this item forever.
- `created` — `false` means it matched an item already stored (dedupe).
- `text` / `source` / `sourceClass` / `occurredAt` — what we parsed out of you.
- `assumedOccurredAt` — `true` means you did not send a time and we used now.
- `geoDropped` — `true` means you sent coordinates we could not use (out of
  range, or only half a pair) and this signal is stored without a location. Check
  this if your pins are missing from the map; the values are still in `raw`.
- `annotationKeys` — the keys we kept. Ours (rather than yours) show up here too
  when a rule fired: `assumed_occurred_at`, `text_truncated`, `geo_dropped`,
  `nul_bytes_stripped`.

Batch ingest returns counts plus a per-item verdict:

```json
{
  "total": 4,
  "created": 2,
  "deduped": 0,
  "failed": 2,
  "results": [
    { "index": 0, "ok": true, "signal": { "id": "…", "created": true, "…": "…" } },
    { "index": 2, "ok": false, "error": "Payload must be a JSON object or string, received a number" }
  ]
}
```

An item only fails when we cannot derive any text from it — including when the
text you sent is empty or whitespace-only. Everything else degrades instead of
failing: unusable coordinates are reported, long text is truncated, NUL bytes are
removed, unknown keys are kept. The error string says what to fix; re-send just
that item.

---

## Turning signals into bubbles — `POST /api/trpc/vectors.process`

Ingest only stores facts. Grouping is a separate, idempotent verb you (or our
poller) can call at any time:

```bash
curl -X POST http://localhost:3000/api/trpc/vectors.process \
  -H 'content-type: application/json' \
  -d '{"json":{"limit":50}}'
```

One call embeds, groups, names and projects up to 50 unplaced signals, oldest
`occurred_at` first. Call it until `pending` comes back `0`. Two callers racing
is safe: the second gets `locked: false` and does nothing.

```json
{ "locked": true, "pending": 25, "embedded": 25, "assigned": 25,
  "groupsCreated": 3, "groupsJoined": 22, "projected": 25, "labelled": 3,
  "fittedProjection": true, "stubEmbeddings": true, "failures": [] }
```

### How a signal is placed

Gates first, similarity second — this order is the design, not an optimisation:

1. **Time** — only bubbles active within 6h of the signal's `occurred_at` are candidates.
2. **Geography — a HARD 1.5km gate** whenever both the signal and the bubble have
   coordinates. Semantic closeness never overcomes geographic separation:
   "flooding in Aro Valley" and "flooding in Petone" score ~0.95 and are always two
   incidents. **A signal with no coordinates skips the gate** and groups on meaning
   and time alone — missing geography never blocks you.
3. **Cosine similarity** against surviving bubbles' centroids. Above the join
   threshold it joins the best one; otherwise it starts a new bubble.

Every `member_of` edge records both the number and the sentence:

```
weight 0.891  reason "cosine 0.89; 107m and 16min apart"
weight 1.000  reason "new bubble: closest match scored cosine 0.81 but sits 5.2km away (hard gate 1.5km)"
weight 0.933  reason "cosine 0.93; no coordinates to compare and 14min apart"
```

### What each bubble caches

Every number below is a fold over the bubble's members — drop the groups, re-run
`vectors.process`, and you get the same numbers back.

| Field | Meaning |
|---|---|
| `mass` | member count |
| `velocity` | members inside the last hour of the bubble's own `occurred_at` clock |
| `sourceDiversity` | `COUNT(DISTINCT source_class)` — how independent the corroboration is |
| `verification` | `{ verifiedCount, meanConfidence, sourceClasses[], distinctSources, scoreBreakdown }` folded from members' `verified` / `confidence` annotations |
| `score` | **internal ordering key only** — `mass × 0.5 ^ (age / 6h)`, where age is how long ago the bubble last heard anything |
| `centroidLat` / `centroidLng` | mean position of the members that have coordinates |

`score` decides what order bubbles come back in and nothing else. It is
deliberately two inputs an operator can check by eye — how many reports, and how
recently — rather than a black-box ranking model, and it is deliberately NOT
published as a number: a single blended figure reads like a confidence, and this
system does not tell anyone what to believe. What you do get is the arithmetic,
in words, on every bubble as `verification.scoreBreakdown` (e.g. `"mass 13 ×
recency 0.717 (2.9h ago, 6.0h half-life) = 9.32"`), so the ordering can always be
argued with. It is recomputed each time the bubble is re-folded, so it is fresh
as of that bubble's last member.

`verification` counts corroboration; it never asserts that anything is true. Send
`verified` and `confidence` on your payloads and they show up here.

### The 3D projection (the galaxy)

Signals get `x, y, z` in a PCA basis **fitted once** on the first 20+ embedded
signals and then never refitted — otherwise bubbles jump between frames and two
time ranges cannot be compared. Consequences for you:

- before the basis exists, signals legitimately have **no** coordinates: tolerate a
  null vec3 rather than assuming the origin;
- the basis is stored as plain numbers (`mean`, `components`), so you can reproduce
  any coordinate yourself with `dot(embedding - mean, components[i])`;
- coordinates are reproducible: the same signals in produce byte-identical
  coordinates out.

### One caveat to read before you trust a bubble

`stubEmbeddings: true` in the response means no `AI_GATEWAY_API_KEY` was set, so
grouping used our deterministic **lexical** stand-in rather than a semantic
embedding model. It groups on shared words, not on meaning — "inundation" will not
match "flooding". Everything works and the numbers are real, but say so in your UI.

Be precise about what the stub is doing, because it is easy to overclaim: with
the stub, **cosine ranks correctly, while geography and time do the separating**.
Measured over our 25 fixtures, same-hazard pairs average 0.85 and different-hazard
pairs 0.79 — the distributions overlap, so with the geo gate disabled every
fixture collapses into one bubble at the 0.80 stub threshold. The semantic signal
is genuinely there and picks the right bubble by *argmax* (the two ungeolocated
fixtures score 0.93 against their true bubble versus 0.85 and 0.84 against the
runner-up), but the partition you see is produced mostly by the 1.5km gate and the
6h window. With a Gateway key the similarities spread out and the threshold starts
carrying its own weight. The correct-partition plateau for the *gated* pipeline
runs from about 0.60 to 0.80, which is why 0.80 is a safe stub default rather than
a tuned one.
Each signal also carries an `embedding_model` annotation recording which embedder
placed it. Set the key and the same pipeline upgrades with no code change.

---

## Reading the bubbles back

Three read procedures, and they are one drill-down rather than three views:
`points` draws the galaxy, `groups` draws the bubbles over it, `groupDetail`
opens one bubble all the way down to the verbatim payloads behind it.

**These shapes are frozen.** We will add fields; we will not rename or remove
one. Reads are tRPC *queries*, so they are `GET` with the input in the query
string (mutations above are `POST`) — same superjson envelope either way.

Every example below was run against a live server; the responses are real.

### `vectors.points` — every signal as a point in the galaxy

```bash
curl -s -G 'http://localhost:3000/api/trpc/vectors.points' \
  --data-urlencode 'input={"json":{"windowMins":360,"limit":2}}'
```

```json
{"result":{"data":{"json":[
  { "signalId": "735f1b51-8477-4b79-b8cf-0456fc57df4f",
    "x": 0.1516786599183387, "y": -0.043746859952825574, "z": 0.07860943740054817,
    "groupId": "f80d754f-d891-4b19-b73b-05c3fb0d4dfe" },
  { "signalId": "f0bc8ea5-bd9e-411e-856b-5e256cc52f4b",
    "x": 0.19418689350412896, "y": 0.1288669986664732, "z": 0.010157244818500466,
    "groupId": "f80d754f-d891-4b19-b73b-05c3fb0d4dfe" }
]}}}
```

**Two nulls are legitimate here and must be rendered, not filtered.** `x/y/z` is
null when the signal has not been projected yet (the basis is fitted once, on the
first 20+ embedded signals) — do not substitute the origin, or every unplaced
point piles up at the centre of your map and reads as a real cluster.
`groupId` is null when a signal is ingested but not yet grouped; call
`vectors.process` and it fills in.

### `vectors.groups` — the bubbles (this is the map layer)

```bash
curl -s -G 'http://localhost:3000/api/trpc/vectors.groups' \
  --data-urlencode 'input={"json":{"windowMins":360}}'
```

```json
{
  "id": "f80d754f-d891-4b19-b73b-05c3fb0d4dfe",
  "center": { "x": 0.1783, "y": -0.0137, "z": -0.0005 },
  "geoCentroid": { "lat": -41.29436666666667, "lng": 174.76170000000002 },
  "size": 13,
  "velocity": 5,
  "sourceDiversity": 6,
  "verification": {
    "distinctSources": 7, "distinctSourceClasses": 6,
    "verifiedCount": 5, "meanConfidence": 0.7437499999999999,
    "sourceClasses": ["human_report","media","official_feed","operator_note","sensor","social"],
    "scoreBreakdown": "mass 13 × recency 0.717 (2.9h ago, 6.0h half-life) = 9.32"
  },
  "label": "flooding — Aro Street",
  "memberCount": 13,
  "firstSeen": "2026-08-08T06:05:00.000Z",
  "lastSeen": "2026-08-08T08:53:00.000Z"
}
```

**`geoCentroid` is why this is a common-operating-picture layer and not a private
UI.** It is the mean position of the members that carry coordinates, in plain
WGS84 lat/lng — plot it straight into MapLibre, ArcGIS or whatever your map is,
size the marker by `size`, and you have our bubbles on your map with no
coordinate conversion and no call to us beyond this one. (Our own galaxy view
uses `center`, which is 3D embedding space, not geography — ignore it on a map.)

`geoCentroid` is null when no member had coordinates; that is a real state (a
radio call with no location still groups), so draw those in a list, not at 0,0.

Field by field:

| Field | Meaning |
|---|---|
| `size` | member count — the bubble's radius |
| `velocity` | members inside the last hour of the bubble's own `occurred_at` clock |
| `sourceDiversity` | `COUNT(DISTINCT source_class)` — how independent the corroboration is |
| `verification` | counts folded from members' `verified` / `confidence` annotations — **never a verdict**. `verification.scoreBreakdown` is the sentence behind the ORDER bubbles arrive in |
| `label` | a short name; null until the pipeline names it (see the caveat below) |
| `memberCount` | counted from the edges on every read; equals `size` unless the pipeline is mid-run |
| `firstSeen` / `lastSeen` | the bubble's lifespan, on the `occurred_at` clock |

### `vectors.groupDetail` — bubble → member → findings → verbatim payload

```bash
curl -s -G 'http://localhost:3000/api/trpc/vectors.groupDetail' \
  --data-urlencode 'input={"json":{"id":"f80d754f-d891-4b19-b73b-05c3fb0d4dfe"}}'
```

Returns every field of the group above, plus `members[]` (newest first). One
member, verbatim from a live response:

```json
{
  "signalId": "2e654e4d-e14d-4c68-8a67-639d73e9d672",
  "occurredAt": "2026-08-08T08:39:00.000Z",
  "ingestedAt": "2026-08-07T23:53:29.442Z",
  "source": "radio-log",
  "sourceClass": "operator_note",
  "text": "Surface flooding on Aro Street, water over the road outside the shops",
  "lat": null, "lng": null, "geoConfidence": null,
  "point": { "x": 0.1966, "y": 0.0868, "z": 0.0531 },
  "annotations": [
    { "key": "note", "value": "called in over the radio, no coordinates given", "confidence": null, "annotator": "feed", "createdAt": "2026-08-07T23:53:29.442Z" },
    { "key": "hazard", "value": "flooding", "confidence": null, "annotator": "feed", "createdAt": "2026-08-07T23:53:29.442Z" },
    { "key": "embedding_model", "value": "stub/lexical-hash-1536", "confidence": null, "annotator": "rule", "createdAt": "2026-08-07T23:53:29.487Z" }
  ],
  "membership": {
    "weight": 0.9325876,
    "reason": "cosine 0.93; no coordinates to compare and 14min apart",
    "createdAt": "2026-08-07T23:53:29.602Z"
  },
  "raw": {
    "note": "called in over the radio, no coordinates given",
    "text": "Surface flooding on Aro Street, water over the road outside the shops",
    "hazard": "flooding",
    "source": "radio-log",
    "occurred_at": "2026-08-08T08:39:00Z",
    "source_class": "operator_note"
  }
}
```

This is the part worth reading twice:

- **`annotations` is EVERY annotation on that member**, including keys we have
  never heard of. If you send us findings, they come back here attributed to
  `feed` — we do not filter them down to a vocabulary we recognise.
- **`membership` is the grouping decision, as a number and as a sentence.** An
  operator who cannot read *why* two reports were merged cannot act on the merge.
- **`raw` is your payload, verbatim value for value**, whatever shape it had. It
  is never rewritten and it outlives every derived number above it. This is the
  end of the traceability chain: any bubble → any member → the words somebody
  published. One caveat if you plan to *hash-compare* it against your own
  serialisation to prove custody: the column is `jsonb`, which normalises key
  order (and would collapse duplicate keys), so compare by deep value equality,
  not by byte string. Every value you sent comes back exactly as you sent it —
  the only edit we ever make is removing NUL bytes, and we annotate when we do.

An unknown id is a `BAD_REQUEST` with `Group <id> not found`, not an empty shell.

### `windowMins` — the same everywhere

Optional on `points` and `groups`; absent means everything we hold. It is the
last N minutes of the picture, **anchored on the newest observation we hold, or
now, whichever is later**. Anchoring on the wall clock alone would make a
replayed or seeded dataset (a drill, a backfill, a demo) entirely invisible, and
would drop signals from any feed whose clock runs ahead of ours. In live
operation the newest signal *is* roughly now, so it means exactly what you
expect.

### Caveats to carry into your UI

- **`label` may be null**, and is written by the pipeline, not at read time.
  With no `AI_GATEWAY_API_KEY` set, names come from a template built from the
  hazard and location annotations you send us (`"flooding — Aro Street"`); with a
  key, Claude names the bubble from the member reports. Either way the name
  describes what was *reported*, never that it is confirmed.
- **`stubEmbeddings: true`** from `vectors.process` means grouping was lexical,
  not semantic (see the caveat in the previous section). Say so in your UI.
- **`verification` counts corroboration; it never asserts truth.** Please keep
  that distinction visible when you render it — it is the whole point of this
  problem statement.

### Proving it yourself

`npm run verify` wipes the database, ingests the fixture set through the ingest
procedure, runs the pipeline, then reads it all back through these three
procedures and asserts the chain holds — including that *every* point resolves
through `groupDetail` to a verbatim payload. It prints the board and one full
traceability walk. If you change something and that stays green, you have not
broken us.
