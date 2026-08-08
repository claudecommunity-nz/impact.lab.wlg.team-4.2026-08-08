# Convergence — Trust Scoring PRD × Vector Layer substrate

Two plans, one system. The Trust Scoring PRD (grading, origins, alerts) builds ON
the vector-layer substrate (intake, storage, clustering, embeddings, reads) —
never beside it. This file records the binding decisions. If you are a fresh
session holding the PRD: **do not create a parallel schema — extend this one.**

## Vocabulary (Decision 1)

| Concept | Internal (tables/code) | Published API (other teams) |
|---|---|---|
| One raw item | `signals` row | "item" (`itemId`) |
| Cluster of items = one candidate event | `groups` row (level 1) | **"signal"** (`signalId`) — the PRD's language wins externally |

The published surface uses the PRD's names (`signals.ingest`, `signals.geojson`,
`signals.detail`, `signals.alerts`); translation happens in the router layer only.
Internal code never says "signal" to mean a cluster.

## One ingest (Decision 2)

`signals.ingest` is the single ingest for everyone (ours, their collectors, other
teams). Extended input (all optional, adapters absorb shape burden as before):
`datasetId` (default "live"), `externalId`, `author`, `url`, `quotedUrls[]`,
`publishedAt`, `synthetic`. Single-item ingest folds SYNCHRONOUSLY (embed →
origin → assign → grade) and returns the superset
`{itemId, signalId, grade, created, ...}` — backwards compatible with the
already-published INTEGRATION.md response. Batch folds per-item in order.

## Grade replaces score in public (Decision 3)

- Published surfaces expose the Admiralty `grade {sourceReliability A–F,
  infoCredibility 2–6, label}` + ordered `reasons[]` + `independentSources` +
  `itemCount`. **Never a blended confidence number** (PRD AC14.3).
- `groups.score` survives as an INTERNAL ordering key only — stripped from every
  published response.
- `infoCredibility: 1` ("confirmed") is unreachable by code — the grading module
  throws. `confirmedBy` is never machine-set.

## Dedupe (Decision 4)

Two partial unique indexes on `signals`:
1. `(dataset_id, source, external_id)` where `external_id` is not null — wins
   when the collector has a stable id.
2. `(dataset_id, source, md5(text), occurred_at)` where `external_id` is null —
   the fallback.
`onConflictDoNothing` + re-select; concurrency-safe. `datasetId` namespaces live
vs replay vs fixtures (PRD story 4) — clustering never crosses datasets.

## Time

`occurred_at` = PRD's `publishedAt` (when it happened / was published).
`ingested_at` = PRD's `capturedAt` (when we learned of it). `asAt` filters on
`ingested_at`. `now` is threaded through use cases like `log` — no wall-clock
reads in grading/decay/novelty (replay depends on it).

## The module seam

Two pure modules (no DB, no HTTP, no clock — `now` is a parameter), tested via
`npm run proof:grading` (exit non-zero on failure):

- `utilities/origin-fingerprint.ts`: items → `originId` per item. Collapses:
  near-duplicate text (embedding cosine ≥ 0.95 when vectors exist; normalized
  text similarity fallback), quoted-URL inheritance, same source+author.
  `independentSources` = distinct originIds in a cluster. Surfaced number is
  ALWAYS independent origins, never item count.
- `utilities/grading.ts`: `ClusterFacts` → `{grade, reasons[], alertWorthy,
  alertReasons[]}`. Rule table per PRD AC16 (2+ origins + consistent cross-check
  → 2; either alone → 3; single origin → 4; contradicted → 5; unresolvable
  location/time → 6), unknown source defaults F, best reliability wins,
  A-source override (≥3, with a reason), credibility 1 throws.
  **Alert-worthiness is computed independently of grade** — the PRD's most
  important behaviour: early single-source signals alert WITH their weakness
  stated.

```ts
type ClusterFacts = {
  independentOrigins: number; itemCount: number;
  bestSourceReliability: "A"|"B"|"C"|"D"|"E"|"F";
  hazardCrossCheck: { result: "consistent"|"inconsistent"|"no_applicable_layer"; detail?: string };
  locationCertainty: "stated"|"inferred"|"unknown";
  firstSeen: Date; lastSeen: Date; now: Date;
}
```

`grade_events` is append-only: every transition records fromGrade, toGrade, at,
independentSources, reasons, alertFired. `asAt` grade = last event ≤ asAt.

## In scope today / out

IN: decisions above; `source_registry` table (default F, seed official sources A);
`signals.geojson` (FeatureCollection, WGS84 points, unmappable items excluded but
in `detail`; inferred locations carry `radiusM`); `signals.detail` (provenance,
origin groups, grade history); `signals.alerts` (since + datasetId, transitions
only); synthetic flag carried to provenance; hazard cross-check recorded honestly
(`no_applicable_layer` default; river-gauge lookup only if trivially wired).

OUT (today): Reddit/RNZ collectors (drop-folder + ingest cover the demo; GeoNet
optional stretch), image hashing, blind-spot overlay + inspector UI (UX teammate
builds on the published reads), Supabase cutover (connection-string swap later),
recovery phase, auth.

## Phase B landed — what the seam turned into

Both pure modules are built and wired; `npm run proof:grading` (54 assertions,
no db, no clock) and `npm run verify` (66 end to end) both pass. Three places
where the implementation is narrower or wider than the sketch above, recorded
because each was a judgement call rather than a detail:

1. **The A-source override applies only where corroboration is the binding
   weakness** — i.e. it lifts credibility 4 to 3, and deliberately does NOT lift
   5 or 6. AC19.1 says "at least credibility 3 regardless of ORIGIN COUNT", and
   origin count is the only weakness it should answer: an official source does
   not make a contradiction go away (AC21 wants that flagged, not hidden) and it
   cannot tell us where something is. When the floor is withheld, the reasons
   say so explicitly rather than staying silent.

2. **`ClusterFacts` gained three additive fields** — `bestSourceId` (so the
   reliability sentence can name the evidence), `issueType` (which chooses the
   decay half-life), and `timeCertainty: stated | assumed | unknown`. Only
   `unknown` grades 6; `assumed` — the collector sent no timestamp and ingest
   defaulted it — is a weakness printed in the reasons, not an unjudgeable
   cluster, because we do still know when we learned of it.
   `contradictingOrigins` is in the contract and proven, and passes 0 today:
   nothing writes `contradicts` edges yet, and inventing a number would be worse
   than reporting the one we can defend.

3. **The hazard cross-check is `no_applicable_layer`, honestly, on every
   cluster.** No river-gauge lookup is wired. This is why nothing in the system
   currently reaches credibility 2 — that rule requires a CONSISTENT
   authoritative cross-check — and `verify` asserts exactly that. The
   difference between "we checked and nothing disagreed" and "nothing has
   checked this" is the difference this module exists to keep visible.

Near-duplicate detection carries one addition worth knowing about: the embedding
path (cosine ≥ 0.95) also requires ≥ 0.5 token overlap. A shared meaning is not
a shared origin — two witnesses on opposite corners of one flooded intersection
score ~0.97 and must stay two observations, or the module erases exactly the
corroboration it exists to find. Heavy wording overlap (Jaccard ≥ 0.85) still
collapses on its own, so an unembedded item is handled the same way.

## Existing substrate the PRD builds on (already validated)

Intake + adapters + drop-folder (INTEGRATION.md), gated cosine clustering with
weight+reason edges, deterministic fit-once PCA 3D projection, `vectors.points`
/ `vectors.groups` / `vectors.groupDetail` for the 3D UX, `npm run verify` +
`npm run proof:vectors`.
