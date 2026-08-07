# Sending us data — integration guide

**For other teams. You do not need to know anything about this codebase.**

## What this module is

This is Team 4's **universal intake and vector layer** for Problem 03. You send us
anything you have collected from public information — a post, a news item, a gauge
reading, a scraped row, a note someone typed — and we store it **losslessly** as a
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

**Nothing is ever discarded.** Your entire payload is stored verbatim in the
signal's `raw` column, forever, whatever shape it had. Everything below is on top
of that.

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
  twice. (Items with no `occurred_at` cannot dedupe against each other — their
  assumed time differs by milliseconds — so send `occurred_at` if you replay.)
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
  "annotationKeys": ["hazard", "verified", "type"]
}
```

(remember: inside `{"result":{"data":{"json": ... }}}`).

- `id` — the signal id. Keep it; it is how you refer to this item forever.
- `created` — `false` means it matched an item already stored (dedupe).
- `text` / `source` / `sourceClass` / `occurredAt` — what we parsed out of you.
- `assumedOccurredAt` — `true` means you did not send a time and we used now.
- `annotationKeys` — the keys we kept.

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

An item only fails when we cannot derive any text from it. The error string says
what to fix; re-send just that item.

---

## Turning signals into bubbles — `POST /api/trpc/vectors.process`

Ingest only stores facts. Grouping is a separate, idempotent verb you (or our
poller) can call at any time:

```bash
curl -X POST http://localhost:3000/api/trpc/vectors.process \
  -H 'content-type: application/json' \
  -d '{"json":{"limit":50}}'
```

One call embeds, groups and projects up to 50 unplaced signals, oldest
`occurred_at` first. Call it until `pending` comes back `0`. Two callers racing
is safe: the second gets `locked: false` and does nothing.

```json
{ "locked": true, "pending": 25, "embedded": 25, "assigned": 25,
  "groupsCreated": 3, "groupsJoined": 22, "projected": 25,
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
| `verification` | `{ verifiedCount, meanConfidence, sourceClasses[], distinctSources }` folded from members' `verified` / `confidence` annotations |
| `centroidLat` / `centroidLng` | mean position of the members that have coordinates |

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
Each signal also carries an `embedding_model` annotation recording which embedder
placed it. Set the key and the same pipeline upgrades with no code change.

---

## Reading the bubbles back

Read procedures under `groups.*` land in Phase 3 on the same `/api/trpc` endpoint,
projected by `(level, time-window)` — the same envelope convention as above. What
is already guaranteed and already true in the database:

- Every bubble is reachable down to its members through `member_of` edges, and
  **every edge carries a weight and a human-readable reason** for why that item
  was placed there.
- Every member is a signal, and every signal still holds your original payload in
  `raw`. So any number on the board traces back to the verbatim source you sent.

Ask Team 4 if you need a shape locked in earlier than that — if you tell us what
you need, we will point a procedure at it.
