"""Deep pull of Wellington hazard content from the NZ Reddit Corpus API.

This is the collector behind feeds/reddit.json (4,664 posts and comments,
2016-2026) — the largest real dataset in this repo.

⚠️ THE BASE URL IS AN EPHEMERAL CLOUDFLARE TUNNEL AND WILL STOP RESOLVING.
   If it is dead, point BASE at wherever the NZ Reddit Corpus API now lives.
   The API shape below is what to expect:
     GET /v1/stats                     posts/comments/subreddits/earliest/latest
     GET /v1/subreddits                {"items": [{subreddit, posts, comments}]}
     GET /v1/search                    q, kind(all|posts|comments), subreddit[],
                                       start, end, limit(<=100), sort
     GET /v1/timeseries                q, bucket(month), -> {"items":[{bucket,...}]}
   Auth is an X-API-Key header.

Why time-slicing: `limit` caps at 100, so a bare term returns the 100 newest
matches out of ten years. Running the same term once per year gives each slice
its own 100 — 87 terms x 11 years = 957 queries, and the API is not rate limited.

Two server-side bugs in that API, both worked around here:
  - the `subreddit` filter 500s (ClickHouse: unknown identifier `subreddit_name`)
    -> filter client-side on the `subreddit` field every record carries
  - /v1/thread/{id} 404s for every id search returns
    -> no thread expansion; comments come from search directly

    export REDDIT_CORPUS_KEY=...
    python3 data/scripts/pull_reddit_deep.py
      -> data/raw/reddit/reddit_corpus_deep.json
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

BASE = os.environ.get("REDDIT_CORPUS_URL",
                      "https://responding-bull-weapon-friendship.trycloudflare.com")
KEY = os.environ.get("REDDIT_CORPUS_KEY", "")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "raw", "reddit", "reddit_corpus_deep.json")
LIMIT = 100                       # hard cap; 422 above this
YEARS = list(range(2016, 2027))   # corpus spans 2016-08 to 2026-08

WGTN_SUBS = {"wellington"}
NATIONAL_SUBS = {"newzealand", "casualnz"}

PLACES = [
    "wellington", "welly", "wgtn", "karori", "kelburn", "thorndon", "te aro",
    "newtown", "miramar", "kilbirnie", "island bay", "brooklyn", "hataitai",
    "johnsonville", "khandallah", "ngaio", "tawa", "porirua", "lower hutt",
    "upper hutt", "petone", "seatoun", "lyall bay", "berhampore", "wadestown",
    "eastbourne", "wainuiomata", "naenae", "taita", "ngauranga", "silverstream",
    "trentham", "korokoro", "paraparaumu", "kapiti", "hutt valley", "pauatahanui",
    "haywards", "ngaio gorge", "aro valley", "mt vic", "mount victoria",
]

TERMS = [
    "earthquake", "quake", "shaking", "aftershock", "tsunami",
    "flooding", "flooded", "surface flooding", "slip", "landslide",
    "storm", "gale", "wind damage", "power outage", "power cut", "no power",
    "road closed", "road closure", "evacuation", "evacuated", "civil defence",
    "water main", "burst pipe", "boil water", "king tide", "swell", "sandbags",
    "state of emergency", "cordon", "tree down", "trees down", "debris",
    "landslip", "washout", "sewage", "stormwater", "wremo",
]

# Place+hazard pairs surface Wellington content that a bare term buries under
# national noise (r/newzealand is 5x the size of r/wellington).
PAIRS = [f"{p} {h}"
         for p in ("wellington", "petone", "karori", "porirua", "lower hutt",
                   "upper hutt", "island bay", "newtown", "johnsonville", "tawa")
         for h in ("flooding", "earthquake", "slip", "storm", "power")]


def api(path, **params):
    qs = urllib.parse.urlencode([(k, v) for k, v in params.items() if v not in (None, "")])
    req = urllib.request.Request(f"{BASE}{path}?{qs}",
                                 headers={"X-API-Key": KEY, "Accept": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503, 504):
                time.sleep(2 * (attempt + 1))
                continue
            return {}
        except Exception:
            time.sleep(1)
    return {}


def keep(item):
    """r/wellington, or a national sub where the text names a Wellington place."""
    sub = (item.get("subreddit") or "").lower()
    if sub in WGTN_SUBS:
        return True
    if sub in NATIONAL_SUBS:
        body = f"{item.get('title') or ''} {item.get('text') or ''}".lower()
        return any(p in body for p in PLACES)
    return False


def main():
    if not KEY:
        sys.exit("set REDDIT_CORPUS_KEY")

    jobs = [(q, y) for q in TERMS + PAIRS for y in YEARS]
    print(f"{len(jobs)} queries ({len(TERMS) + len(PAIRS)} terms x {len(YEARS)} years)")

    found, seen = [], set()

    def run(job):
        q, year = job
        d = api("/v1/search", q=q, limit=LIMIT, kind="all", sort="new",
                start=f"{year}-01-01", end=f"{year}-12-31")
        out = []
        for x in d.get("items", []):
            if keep(x):
                x["_query"], x["_year"] = q, year
                out.append(x)
        return out

    done = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        for batch in pool.map(run, jobs):
            done += 1
            for x in batch:
                k = x.get("permalink") or (x.get("kind"), x.get("id"))
                if k not in seen:
                    seen.add(k)
                    found.append(x)
            if done % 100 == 0:
                print(f"  {done}/{len(jobs)} queries — {len(found)} unique kept")

    records = []
    for x in found:
        body = f"{x.get('title') or ''} {x.get('text') or ''}".lower()
        records.append({
            "source_id": f"reddit-corpus:{x.get('subreddit')}",
            "publisher": f"Reddit r/{x.get('subreddit')}",
            "tier": "social",
            "url": x.get("permalink"),
            "published_at": x.get("created_at"),
            "title": x.get("title") or None,
            "text": x.get("text") or None,
            "author": None,                 # API returns none; repo is public
            "is_comment": x.get("kind") == "comment",
            "score": x.get("score"),
            "matched_term": x.get("_query"),
            "hint_places": sorted({p for p in PLACES if p in body}),
            "hint_impacts": sorted({t for t in TERMS if t in body}),
        })
    records.sort(key=lambda r: r["published_at"] or "")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "NZ Reddit Corpus API — deep time-sliced pull, 2016-2026",
        "queries_run": len(jobs),
        "records": records,
    }, open(OUT, "w"), indent=1)

    from collections import Counter
    yr = Counter((r["published_at"] or "")[:4] for r in records)
    print(f"\n{len(records)} unique records -> {OUT}")
    print("  comments:", sum(1 for r in records if r["is_comment"]))
    print("  subreddits:", dict(Counter(r["publisher"] for r in records)))
    print("  place+impact:", sum(1 for r in records if r["hint_places"] and r["hint_impacts"]))
    print("  by year:", dict(sorted(yr.items())))


if __name__ == "__main__":
    main()
