# data/scripts — collectors

Every file in `data/` is reproducible from here. Nothing is hand-maintained.

## Run order matters

`make_feeds.py` rebuilds the feeds **from source** and knows nothing about the
enrichment steps. Running it on its own silently strips media objects from
`facebook.json` and `media_local` paths from `mastodon.json`. Always finish the
chain:

```bash
# 1. collect (each writes into data/raw/)
python3 data/scripts/harvest.py                  # news + official + social RSS
REDDIT_CORPUS_KEY=... python3 data/scripts/pull_reddit_deep.py
REDDIT_CORPUS_KEY=... python3 data/scripts/pull_warning_mentions.py
python3 data/scripts/pull_metservice_history.py  # near-empty; see below

# 2. generate the simulated Facebook channel
ANTHROPIC_API_KEY=... python3 data/scripts/generate_synthetic.py
python3 data/scripts/build_corpus.py             # hand-authored labelled clusters
python3 data/scripts/make_facebook_feed.py

# 3. flatten to feeds  ── STRIPS ENRICHMENT, so always run step 4 after
python3 data/scripts/make_feeds.py

# 4. re-apply enrichment
python3 data/scripts/make_placeholder_images.py  # facebook media + verdicts
python3 data/scripts/fetch_media.py              # mastodon media_local
```

## What each one does

| Script | Output | Notes |
|---|---|---|
| `harvest.py` | `raw/news/mixed_feeds_corpus.json` | 15 live feeds. Parses by **shape**, not URL — Stuff and The Spinoff serve Atom from RSS-looking paths. "ok, 0 records" means you got that wrong. |
| `pull_reddit_deep.py` | `raw/reddit/reddit_corpus_deep.json` | 4,022 records, 957 time-sliced queries. **The base URL is an ephemeral tunnel and will die** — the API contract is documented in the docstring. |
| `pull_warning_mentions.py` | `raw/weather/warning_mentions.json` | 180 warning mentions, cross-checked against gauge data. |
| `pull_metservice_history.py` | `raw/weather/metservice_warnings_history.json` | Yields 13 South Island road-snow alerts and nothing for Wellington. MetService keeps no archive and the Internet Archive never crawled the Wellington alerts. Kept for the audit trail, not the data. |
| `generate_synthetic.py` | `synthetic/corpus-labelled-large.json` | 100 labelled clusters, simulated Facebook. Needs `ANTHROPIC_API_KEY`. `--dry-run` prints specs without calling the API. |
| `build_corpus.py` | `synthetic/corpus-labelled.json` | 13 hand-authored clusters. Deterministic, no API. |
| `make_facebook_feed.py` | `feeds/facebook_feed.json` | Flattens to posts, adds check-ins, engagement, location. |
| `make_feeds.py` | `feeds/*.json` | One flat feed per platform. |
| `make_placeholder_images.py` | `media/facebook/*.svg` | 59 cards with verification verdicts. |
| `fetch_media.py` | `media/mastodon/` | 188 real attachments. **Gitignored** — other people's photos, public repo. |

## Things that will bite you

- **Reddit rate-limits hard.** Direct `reddit.com` scraping 429s after ~3 rapid
  requests and tightens as you push. `pull_reddit_deep.py` uses the corpus API
  instead, which has no rate limit.
- **The corpus API's `subreddit` filter 500s** (ClickHouse: unknown identifier
  `subreddit_name`), and `/v1/thread/{id}` 404s. Both worked around client-side.
- **Most Hilltop rainfall gauges are dead and don't say so** — of ~70 candidates
  only 2 are live; Kelburn returns 2004 data, Avalon 1991. Check `reading.time`.
- **GeoNet felt reports carry no text**, anywhere — the API, the CAP docs and
  the open-data S3 bucket were all checked. They are numeric corroboration only.
- Everything under `synthetic/` and `feeds/facebook*.json` is **simulated** and
  must be labelled as such wherever displayed.
