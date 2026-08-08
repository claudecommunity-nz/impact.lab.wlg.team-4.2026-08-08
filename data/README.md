# data/

Datasets for identifying emerging local impacts from public information.

**One rule: `raw/` is real, `synthetic/` is written.** Never mix them in a view
without labelling which is which.

```
raw/          real, as pulled from live sources — nothing invented
  reddit/     r/Wellington + r/newzealand, 26 hazard terms, past year
  mastodon/   3 NZ instances, 10 hazard tags — 391 posts, 159 with real media
  geonet/     crowd-sourced felt reports, geolocated (GNS Science)
  weather/    extreme rainfall days + live MetService CAP alerts
  news/       RNZ, Wellington.Scoop, NZ Herald, Stuff + official feeds
synthetic/    written content, anchored to real events. Every record is
              marked synthetic: true and carries ground-truth labels.
  media/      placeholder assets, stamped "NOT A REAL PHOTO"
reference/    real anchor events (GeoNet ids, measured river flow)
scripts/      the pullers — re-run any of these to refresh
```

## What's in each

| File | Rows | What it is |
|---|---|---|
| `raw/mastodon/mastodon_posts.json` | 391 | Real posts, 159 with real image/video URLs |
| `raw/news/mixed_feeds_corpus.json` | 385 | Real records from 11 live sources |
| `raw/geonet/geonet_felt_wellington.json` | 4 quakes | **~33,000 public felt reports**, each with lat/lng + MMI |
| `raw/weather/rainfall_events.json` | 26 | Extreme rainfall days, cross-checked against river flow |
| `raw/weather/metservice_cap_current.xml` | 3 | Live CAP alerts — polygons + severity/certainty/urgency |
| `synthetic/corpus-labelled.json` | 45 in 13 clusters | Labelled test set with expected confidence bands |
| `reference/events.json` | 6 | Real anchor events |

## Things that will bite you

- **Relays are not witnesses.** `journeysbot` restates one NZTA feed and was 15
  of 40 posts in the live `#wellington` tag. Count `independence_key`, never
  record count.
- **GeoNet's `publicID` filter barely separates events.** The Porirua M5.2 and
  the Te Araroa M5.7 were 54 seconds apart and share 1,903 of ~1,905 felt-report
  locations. The authority can't cleanly attribute them either.
- **Most rainfall gauges are dead and don't say so.** Of ~70 candidates only 2
  are live; Kelburn returns 2004 data, Avalon returns 1991. Always check
  `reading.time`.
- **Rain upstream ≠ flood here.** 2025-10-11 saw 1mm at Berhampore while the
  Hutt hit 463 m³/s.
- **Author handles are pseudonymised** — this repo is public.

## Refreshing

```bash
python3 scripts/harvest.py       # live feeds -> raw/news/
python3 scripts/pull_posts.py    # reddit (rate-limited, ~20 min)
python3 scripts/build_corpus.py  # rebuild synthetic/corpus-labelled.json
```

`wcc_gis.py` + `catalogue.json` in the repo root cover the GIS layers and
Hilltop telemetry.
