# Sending us data — integration guide

**For other teams. You do not need to know anything about this codebase.**

> **Status — Saturday 8 August (v2).** Every endpoint in this guide is live and
> every example below was run against a real server: intake (push and pull),
> `vectors.process`, the three galaxy reads, and the **trust surface**
> (`signals.geojson`, `signals.detail`, `signals.alerts`). Nothing here is a
> plan. `npm run verify` re-proves the whole chain end to end in one command —
> 55 checks, all green.
>
> **What changed in v2, and what did not.** Ingest now folds an item all the way
> through — embed, cluster, grade — *before it answers*, so the response tells
> you which event your item joined and how well that event is currently
> evidenced. **Every field the v1 response promised is unchanged**, spelled the
> same and meaning the same; the new ones sit beside them. If you integrated
> against v1, you do not have to do anything.

### Two words that mean different things

| Word | What it is | Where you see it |
|---|---|---|
| **item** | one thing somebody published — a post, a gauge reading, a call | `itemId` (also returned as `id`) |
| **signal** | a *cluster* of items we believe describe one event | `signalId` |

An item is evidence. A signal is a candidate event. You send items; the map
shows signals. Nothing on the map is a confirmed fact.

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
| `dataset_id` | `dataset_id`, `datasetId`, `dataset` — the namespace. Omitted becomes `live` |
| `external_id` | `external_id`, `externalId`, `item_id`, `itemId`, `guid`, `id` — **your** stable id for this item |
| `author` | `author`, `username`, `screen_name`, `byline`, `user` |
| `url` | `url`, `link`, `permalink`, `source_url` — the canonical link to the item |
| `quoted_urls` | `quoted_urls`, `quotedUrls`, `quoted_url`, `in_reply_to_url` — a single link or an array |
| `synthetic` | `synthetic`, `is_synthetic`, `fixture` — `true` if this item was authored for a demo or a drill |

**The bottom five are new in v2 and all optional.** They buy you better dedupe
now and an honest independent-source count shortly (see *Why `author`, `url` and
`quoted_urls` matter* below). Sending none of them costs you nothing you had
before.

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
- **We dedupe two ways, and which one applies is up to you.**

  1. **If you send `external_id`,** identity is `dataset_id` + `source` +
     `external_id`, and nothing else is consulted. Re-polling your own feed and
     getting back an edited headline or a corrected timestamp is still **one
     item** — you get the original id with `created: false`, and the version we
     stored first is the one that survives (items are immutable). This is the
     one you want: it is the only key that survives a source editing itself.
  2. **If you do not,** identity is `dataset_id` + `source` + `text` +
     `occurred_at` — what was said, by whom, when. Items with no `occurred_at`
     cannot dedupe against each other (their assumed times differ by
     milliseconds), so send `occurred_at` if you replay.

  Both hold under CONCURRENCY, not just on re-sends: each is a unique index in
  the database, so ten simultaneous deliveries of one report (batched clients,
  parallel pollers, a retrying queue) still leave exactly one row — nine come
  back `created: false`. **A duplicate never changes a signal's `itemCount` or
  `independentSources`**, which is the whole point: re-delivery must not look
  like corroboration.

- **`dataset_id` is a hard wall.** It namespaces everything — items, clusters,
  grades, alerts — and **clustering never crosses it**. Send `live` (or nothing)
  for real collection; send anything else (`replay-0809`, `fixtures-demo`,
  `drill-a`) for a demo, a backfill or a test, and it can never corroborate,
  grade or alert against real events. `signals.geojson` defaults to `live`, so a
  fixture set cannot appear on the operational map by accident. The same item
  sent to two datasets is two separate observations, on purpose.

- **Why `author`, `url` and `quoted_urls` matter.** Three reposts of one
  photograph are **one** observation, not three, and printing "3 sources" for
  them would be the single most misleading number this system could produce. We
  collapse items into *origins* — by author identity, by quoted link, by
  near-identical text — and publish `independentSources` as the count of
  distinct **origins**, always beside `itemCount`, never instead of it. Send
  those fields and your reposts collapse correctly. (Origin fingerprinting is
  the one piece still landing: today `independentSources` is a placeholder of 1
  and **says so in every `reasons` array**. The field and its meaning will not
  change when the real thing arrives.)

- **`synthetic: true` if you made it up.** Fixture and drill items are carried
  through to every provenance entry and surface as `syntheticContributor` on the
  signal. A demonstration about trustworthiness must not itself pass fabricated
  content off as genuine.
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

Single ingest returns an echo of what we understood **and the event your item
just joined** — because the useful question is never "did you store it?", it is
"is anyone else reporting this?". You get the answer in the same call; there is
nothing to poll.

This is a real response, from the curl at the top of this guide:

```json
{
  "id": "8b708f91-4385-4453-afe7-2247d3333b48",
  "created": true,
  "text": "Surface flooding on Adelaide Road, water over both lanes",
  "source": "antenno",
  "sourceClass": "human_report",
  "occurredAt": "2026-08-07T21:12:00.000Z",
  "assumedOccurredAt": false,
  "geoDropped": false,
  "annotationKeys": ["hazard", "verified", "source_url"],

  "itemId": "8b708f91-4385-4453-afe7-2247d3333b48",
  "signalId": "fa7b626e-73d5-4071-962c-752098f5a1b8",
  "grade": {
    "sourceReliability": "F",
    "infoCredibility": 4,
    "label": "F4 — reliability cannot be judged / doubtful"
  },
  "reasons": [
    "stub: grading module pending",
    "single origin assumed: origin fingerprinting is not wired yet, so independentSources is reported as 1 regardless of the 1 item in this cluster",
    "source reliability defaults to F: the registry lookup lands with the rule table"
  ],
  "alertWorthy": false,
  "independentSources": 1,
  "itemCount": 1,
  "datasetId": "live",
  "externalId": null,
  "synthetic": false,
  "foldWarnings": []
}
```

(remember: inside `{"result":{"data":{"json": ... }}}`).

Everything above the blank line is v1, unchanged. Everything below it is new:

- `itemId` — the same value as `id`, under the name the trust surface uses.
- `signalId` — **the event your item was folded into.** Pass it to
  `signals.detail`. `null` means the fold degraded (see `foldWarnings`); the item
  is stored regardless and the pipeline will place it on its next sweep.
- `grade` — the event's Admiralty grade **after** counting your item.
  `sourceReliability` is A–F (who said it), `infoCredibility` is 1–6 (how well
  corroborated). **They are never blended into one number**; a single percentage
  would be false precision, and knowing "a reliable source said something we
  cannot corroborate" is a different state from "an unknown source said something
  three others confirm". `1` ("confirmed") is unreachable by code — only a person
  can write it.
- `reasons` — why, in order, most decisive first. Render these next to the grade.
- `alertWorthy` — computed **independently of the grade**. In hour zero nothing
  has corroboration yet, so a grade-driven alert would stay silent in exactly the
  window that matters. A weak early signal can be alert-worthy *with its weakness
  stated*.
- `independentSources` / `itemCount` — distinct origins, and raw items. Always
  show both. Never show `itemCount` as if it were source count.
- `datasetId` / `externalId` / `synthetic` — what we recorded of your identity
  fields.
- `foldWarnings` — non-fatal trouble, one sentence each, usually empty. Your item
  is **always stored**; losing an observation because an embedder timed out would
  be the worst possible trade, so the fold degrades and says so instead.

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

## The trust surface — graded signals on a map

Three read procedures. **If you are building a map, `signals.geojson` is the only
one you need**; the other two are the drill-down and the alert feed. All are
tRPC *queries*, so they are `GET` with the input in the query string, same
superjson envelope.

Every response below was run against a live server.

### `signals.geojson` — hand this straight to MapLibre

```bash
curl -s -G 'http://localhost:3000/api/trpc/signals.geojson' \
  --data-urlencode 'input={"json":{}}'
```

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [174.81472, -41.31732] },
      "properties": {
        "signalId": "a733091c-445a-4730-be50-8d293a07152d",
        "datasetId": "live",
        "grade": {
          "sourceReliability": "F",
          "infoCredibility": 4,
          "label": "F4 — reliability cannot be judged / doubtful"
        },
        "reasons": ["stub: grading module pending", "…"],
        "independentSources": 1,
        "itemCount": 22,
        "alertWorthy": false,
        "syntheticContributor": false,
        "label": "wind — Broadway, Miramar",
        "locationCertainty": "inferred",
        "sourceClasses": ["human_report","media","official_feed","operator_note","sensor","social"],
        "firstSeen": "2026-08-08T06:00:00.000Z",
        "lastSeen": "2026-08-08T08:46:00.000Z",
        "confirmedBy": null,
        "radiusM": 187
      }
    }
  ],
  "unmappable": []
}
```

Standard GeoJSON: `Point` geometry, WGS84, `[lng, lat]` order. No conversion, no
second call.

**Inputs, all optional:**

| Input | Meaning |
|---|---|
| `datasetId` | Defaults to `"live"`. Fixture and replay datasets never appear unless you ask for them by name. |
| `asAt` | ISO timestamp. Returns the picture **as it was knowable then** — only items we had *captured* by that instant, and the grade that was current then, not today's. This is the time-scrub control. |
| `bbox` | `{minLng, minLat, maxLng, maxLat}` — only signals inside it. |
| `minCredibility` | 1–6 on the Admiralty scale, where **1 is best**. Keeps features at least this credible (`infoCredibility <= minCredibility`). Ungraded signals never clear it. |
| `limit` | Max features (default and max 500). |

```bash
# a bounding box around Wellington, and only reasonably credible signals
curl -s -G 'http://localhost:3000/api/trpc/signals.geojson' \
  --data-urlencode 'input={"json":{"bbox":{"minLng":174.6,"minLat":-41.4,"maxLng":174.9,"maxLat":-41.1},"minCredibility":3}}'

# the picture as it stood at 09:00
curl -s -G 'http://localhost:3000/api/trpc/signals.geojson' \
  --data-urlencode 'input={"json":{"asAt":"2026-08-08T09:00:00Z"}}'
```

**Four things this endpoint deliberately refuses to do**, each of which you
should reflect in your UI:

- **It never emits a signal with no evidence behind it.** Filtered to nothing by
  `asAt`? Then it is simply absent, not an empty marker.
- **It never guesses a location.** A signal no item could place is **excluded
  from `features`** and listed in `unmappable` (`{signalId, itemCount}`) instead.
  *Please render that list somewhere* — a map that silently drops what it cannot
  place reads as "nothing is happening there", and a radio call with no
  coordinates is still evidence. `signals.detail` returns those signals in full.
- **It never publishes a blended confidence number.** There is no `score`, no
  percentage, no 0–1 "trust". Two axes, both visible, or nothing.
- **It never crosses datasets.**

`locationCertainty` is `"stated"` (one item gave us a coordinate — draw the point
exactly), `"inferred"` (we averaged several — draw `radiusM` as a halo, it is the
distance to the furthest contributor) or `"unknown"`.

`syntheticContributor: true` means at least one contributing item was authored
for a demo or drill. Mark it visibly.

### `signals.detail` — open one event and judge the evidence yourself

```bash
curl -s -G 'http://localhost:3000/api/trpc/signals.detail' \
  --data-urlencode 'input={"json":{"signalId":"a733091c-445a-4730-be50-8d293a07152d"}}'
```

Returns every field of the `properties` block above, plus three arrays:

```json
{
  "signalId": "a733091c-445a-4730-be50-8d293a07152d",
  "itemCount": 22,
  "independentSources": 1,

  "provenance": [
    {
      "itemId": "f3ae808c-16a7-43a4-b573-4584d8d2338f",
      "originId": "f3ae808c-16a7-43a4-b573-4584d8d2338f",
      "source": "radio-log",
      "sourceClass": "operator_note",
      "author": null,
      "url": null,
      "quotedUrls": [],
      "excerpt": "Wind gusts in Miramar have brought roofing iron down on Broadway",
      "occurredAt": "2026-08-08T08:46:00.000Z",
      "ingestedAt": "2026-08-08T00:32:54.011Z",
      "synthetic": false,
      "lat": null, "lng": null,
      "membershipReason": "cosine 0.93; no coordinates to compare and 14min apart",
      "membershipWeight": 0.9308297
    }
  ],

  "originGroups": [
    { "originId": "f3ae808c-…", "itemIds": ["f3ae808c-…"] }
  ],

  "gradeHistory": [
    {
      "at": "2026-08-08T00:32:53.737Z",
      "fromGrade": null,
      "toGrade": { "sourceReliability": "F", "infoCredibility": 4, "label": "F4 — …" },
      "independentSources": 1,
      "itemCount": 1,
      "reasons": ["stub: grading module pending", "…"],
      "alertFired": false,
      "alertReasons": null
    }
  ]
}
```

- **`provenance`** — one entry per contributing item, newest first, never empty.
  `excerpt` is the words somebody actually published, verbatim. **Both clocks are
  here on purpose**: `occurredAt` is when it happened or was published,
  `ingestedAt` is when *we* learned of it. They are often hours apart, and only
  the second one answers "what could we have known at 10:00?".
  `membershipReason` is the clustering decision in words — an operator who cannot
  read why two reports were merged cannot act on the merge.
- **`originGroups`** — `originId` → the items tracing to that one observation.
  This is where three reposts of one photo collapse into one row. (Today each
  item is its own origin; the shape is final, the collapsing is landing.)
- **`gradeHistory`** — append-only, oldest first, starting from `fromGrade: null`.
  Never edited, never deleted. This is how you show a grade *moving* as evidence
  arrived, and it is the record behind every alert.

Unlike `signals.geojson`, this returns signals that **cannot be placed on a map**.
Undrawable is not the same as unimportant.

An unknown id is a `BAD_REQUEST` with `Signal <id> not found`, not an empty shell.

### `signals.alerts` — what a duty officer missed

```bash
curl -s -G 'http://localhost:3000/api/trpc/signals.alerts' \
  --data-urlencode 'input={"json":{"since":"2026-08-08T09:00:00Z"}}'
```

```json
[]
```

**That empty array is the honest answer, not a stub with the lights off.** Alerts
fire on a grade *transition*, never on a state — a feed that re-delivered the
same three events every thirty seconds is a feed people stop reading — and the
grading module currently in place is a placeholder that never sets `alertWorthy`
(it says so in every `reasons` array it writes). The query is real and reads the
same append-only log you see in `gradeHistory`; the feed fills itself when the
rule table lands, with no shape change and nothing for you to migrate.

Poll it with `since` = the `at` of the last alert you saw. Inputs: `since`
(required), `datasetId` (defaults to `live`), `limit` (max 200). Results are
newest first. Each alert carries `{signalId, datasetId, at, issueType, location,
grade, alertReasons, independentSources, itemCount}`.

### `sources.list` — why something graded the way it did

Source reliability (the A–F axis) comes from a registry, not from code. A source
**absent from it grades `F`** — "reliability cannot be judged" — never a middle
grade, because knowing nothing about a source is not the same as knowing it is
mediocre.

```bash
curl -s -G 'http://localhost:3000/api/trpc/sources.list' --data-urlencode 'input={"json":{}}'
```

```json
[
  { "sourceId": "geonet",     "name": "GeoNet",                  "reliability": "A", "kind": "official" },
  { "sourceId": "metservice", "name": "MetService",              "reliability": "A", "kind": "official" },
  { "sourceId": "nzta",       "name": "NZTA Waka Kotahi",        "reliability": "A", "kind": "official" },
  { "sourceId": "wcc",        "name": "Wellington City Council", "reliability": "A", "kind": "official" }
]
```

Four entries, deliberately: these are the feeds a duty officer would already act
on without a second source. Everything else starts unknown and earns its way up.
`POST sources.seed` re-seeds these idempotently; `POST sources.upsert` records an
operator's judgement (`{entries:[{sourceId, name, reliability, kind, notes}]}`)
without a deploy — which matters, because during a real event an operator learns
which accounts are reliable long before we do.

---

## Turning signals into bubbles — `POST /api/trpc/vectors.process`

**You almost certainly do not need this any more.** Since v2, `signals.ingest`
embeds, clusters and grades each item before it answers, so the ordinary path is
already complete when your call returns. `vectors.process` remains as the
idempotent sweeper: it picks up anything the synchronous fold could not finish
(see `foldWarnings`), names new bubbles, and fits the galaxy's 3D projection —
which is a batch operation by nature and cannot happen one item at a time. Our
poller calls it; so can you, at any time, safely:

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

> **Which set do you want?** These three are the **galaxy** — the 3D embedding
> view, for exploring how reports relate to each other in meaning-space. The
> trust surface above (`signals.geojson` / `detail` / `alerts`) is the **map and
> the grade**, in the PRD's vocabulary. Both read the same clusters from the same
> database; neither wraps the other. Building a map? Use the trust surface.
> Building the galaxy? Use these. Note the vocabulary flips: here a "signal" is
> one raw item and a "group" is the cluster, which is the internal naming.

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

`npm run verify` wipes the database, seeds the source registry, ingests the
fixture set through the ingest procedure, runs the pipeline, then reads it all
back through **every published procedure in this guide** — no SQL, no in-process
shortcuts — and asserts the chain holds. **55 checks, all green**, including:

- every field this guide promised in v1 is still present and still spelled the
  same (the check that stops us breaking you);
- both dedupe paths, including a re-worded re-poll under one `external_id`, and
  that a duplicate leaves `itemCount` and `independentSources` untouched;
- that the same item in two datasets clusters separately;
- that `signals.geojson` is a valid FeatureCollection of WGS84 Points, every
  feature graded, with reasons, with `itemCount` and `independentSources` as
  distinct figures — and **no `score`, `confidence` or percentage anywhere**;
- that `signals.detail` returns one provenance entry per item, each with its
  verbatim excerpt, source, origin and both timestamps;
- that *every* point resolves through `groupDetail` to a verbatim payload.

It prints the board and one full traceability walk. If you change something and
that stays green, you have not broken us.
