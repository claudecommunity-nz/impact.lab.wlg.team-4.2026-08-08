"""Recover Wellington weather-warning history from what people said about it.

MetService keeps no public warning archive and the Internet Archive never
crawled the Wellington alerts (see pull_metservice_history.py — 159 snapshots,
13 warnings, all South Island road snow). So the direct record is gone.

The indirect record is not. When MetService issues an orange or red warning for
Wellington, people post about it, and the NZ Reddit Corpus has ten years of that.
These are MENTIONS, not the warnings themselves — no polygon, no official onset
or expiry — but they date the events, which is what a timeline needs.

Cross-check the dates against rainfall_events.json (measured gauge data) and a
mention on the same day as a gauge spike is a warning you can be confident was
issued, without the CAP document.

    export REDDIT_CORPUS_KEY=...
    python3 data/scripts/pull_warning_mentions.py
      -> data/raw/weather/warning_mentions.json
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

BASE = "https://responding-bull-weapon-friendship.trycloudflare.com"
KEY = os.environ.get("REDDIT_CORPUS_KEY", "")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "raw", "weather", "warning_mentions.json")
RAIN = os.path.join(HERE, "..", "raw", "weather", "rainfall_events.json")
YEARS = range(2016, 2027)

QUERIES = [
    "metservice warning", "metservice watch", "heavy rain warning",
    "heavy rain watch", "severe weather warning", "severe gale",
    "orange warning", "red warning", "strong wind watch", "strong wind warning",
    "severe thunderstorm", "weather warning wellington", "state of emergency",
    "road snowfall warning", "heavy swell warning",
]

WGTN = ["wellington", "welly", "wgtn", "porirua", "lower hutt", "upper hutt",
        "petone", "kapiti", "kāpiti", "wairarapa", "hutt valley", "karori",
        "island bay", "newtown", "miramar", "johnsonville", "tawa"]

# Warning colours MetService actually uses, for classifying the mention.
LEVELS = {"red warning": "red", "orange warning": "orange",
          "watch": "watch", "warning": "warning"}


def api(**params):
    qs = urllib.parse.urlencode([(k, v) for k, v in params.items() if v not in (None, "")])
    req = urllib.request.Request(f"{BASE}/v1/search?{qs}",
                                 headers={"X-API-Key": KEY, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=35) as r:
            return json.loads(r.read())
    except Exception:
        return {}


def main():
    if not KEY:
        sys.exit("set REDDIT_CORPUS_KEY")

    jobs = [(q, y) for q in QUERIES for y in YEARS]
    print(f"{len(jobs)} queries ({len(QUERIES)} phrasings x {len(YEARS)} years)")

    def run(job):
        q, year = job
        d = api(q=q, limit=100, kind="all", sort="new",
                start=f"{year}-01-01", end=f"{year}-12-31")
        out = []
        for x in d.get("items", []):
            body = f"{x.get('title') or ''} {x.get('text') or ''}".lower()
            sub = (x.get("subreddit") or "").lower()
            if sub == "wellington" or any(p in body for p in WGTN):
                x["_query"] = q
                out.append(x)
        return out

    found, seen = [], set()
    with ThreadPoolExecutor(max_workers=6) as pool:
        for batch in pool.map(run, jobs):
            for x in batch:
                k = x.get("permalink")
                if k and k not in seen:
                    seen.add(k)
                    found.append(x)

    # measured rainfall days, to cross-check mentions against
    rain_days = set()
    if os.path.exists(RAIN):
        for e in json.load(open(RAIN)).get("events", []):
            rain_days.add(e["date"])

    records = []
    for x in found:
        body = f"{x.get('title') or ''} {x.get('text') or ''}".lower()
        level = next((v for k, v in LEVELS.items() if k in body), None)
        day = (x.get("created_at") or "")[:10]
        records.append({
            "mentioned_at": x.get("created_at"),
            "date": day,
            "subreddit": x.get("subreddit"),
            "is_comment": x.get("kind") == "comment",
            "text": (x.get("title") or "") + (" — " if x.get("title") else "") + (x.get("text") or ""),
            "url": x.get("permalink"),
            "warning_level_mentioned": level,
            "matched_phrase": x.get("_query"),
            # a mention on a day the gauges also spiked is strong evidence
            "same_day_as_measured_rainfall": day in rain_days,
        })
    records.sort(key=lambda r: r["mentioned_at"] or "")

    by_day = Counter(r["date"] for r in records)
    # days with several independent mentions are very likely real warning days
    likely = sorted([d for d, n in by_day.items() if n >= 3])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "NZ Reddit Corpus API — public mentions of weather warnings",
        "what_this_is": "MENTIONS of warnings, not the warnings themselves. No "
                        "polygons, no official onset/expiry. MetService keeps no "
                        "public archive and the Internet Archive never captured the "
                        "Wellington alerts, so this is the surviving evidence that a "
                        "warning was in force on a given day.",
        "count": len(records),
        "likely_warning_days": likely,
        "mentions": records,
    }, open(OUT, "w"), indent=1)

    print(f"\n{len(records)} warning mentions -> {OUT}")
    print("  levels:", dict(Counter(r["warning_level_mentioned"] for r in records if r["warning_level_mentioned"])))
    print(f"  days with 3+ mentions: {len(likely)}")
    print("  mentions on a measured-rainfall day:",
          sum(1 for r in records if r["same_day_as_measured_rainfall"]))
    print("  busiest days:", dict(by_day.most_common(8)))


if __name__ == "__main__":
    main()
