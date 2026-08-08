"""Reconstruct a year of MetService weather warnings from the Wayback Machine.

MetService publishes CAP alerts live at alerts.metservice.com and keeps NO
public archive — the feed shows only what is currently active (3 alerts on
2026-08-08, none for Wellington). So historical warnings have to be recovered
from snapshots the Internet Archive took of that feed and of the individual
alert documents behind it.

This is inherently incomplete: the archive crawls when it crawls, so short-lived
warnings between snapshots were never captured. Treat the output as a SAMPLE of
last year's warnings, not the full record — the counts below say how many
snapshots existed, so the gap is visible rather than implied.

    python3 data/scripts/pull_metservice_history.py
      -> data/raw/weather/metservice_warnings_history.json
"""

import gzip
import json
import os
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "raw", "weather", "metservice_warnings_history.json")
UA = "wcc-impact-lab/0.1 (Wellington Impact Lab hackathon prototype)"
CDX = ("http://web.archive.org/cdx/search/cdx?url={}&from=20250801&to=20260810"
       "&output=json&limit=5000&filter=statuscode:200&collapse=digest")

# Wellington region, for flagging which warnings are locally relevant.
WGTN_TERMS = [
    "wellington", "kapiti", "kāpiti", "wairarapa", "tararua", "horowhenua",
    "hutt", "porirua", "marlborough sounds", "cook strait",
]


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
    except Exception:
        return ""
    # Wayback's `id_` raw mode replays the ORIGINAL response bytes, so a page
    # archived gzipped comes back gzipped whatever Accept-Encoding we send.
    if body[:2] == b"\x1f\x8b":
        try:
            body = gzip.decompress(body)
        except Exception:
            return ""
    return body.decode("utf8", "ignore")


def cdx(pattern):
    raw = get(CDX.format(urllib.parse.quote(pattern, safe="")), timeout=60)
    try:
        rows = json.loads(raw)
    except Exception:
        return []
    return rows[1:] if rows else []


def field(xml, tag):
    m = re.search(rf"<{tag}>(.*?)</{tag}>", xml, re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else None


def parse_cap(xml, snapshot_ts, url):
    """CAP alert -> one record per <info> block."""
    out = []
    identifier = field(xml, "identifier")
    sent = field(xml, "sent")
    for info in re.findall(r"<info>(.*?)</info>", xml, re.S):
        area = field(info, "areaDesc") or ""
        headline = field(info, "headline")
        poly = re.search(r"<polygon>(.*?)</polygon>", info, re.S)
        rec = {
            "identifier": identifier,
            "sent": sent,
            "snapshot": f"{snapshot_ts[:4]}-{snapshot_ts[4:6]}-{snapshot_ts[6:8]}",
            "event": field(info, "event"),
            "headline": headline,
            "severity": field(info, "severity"),
            "urgency": field(info, "urgency"),
            "certainty": field(info, "certainty"),
            "onset": field(info, "onset"),
            "expires": field(info, "expires"),
            "area": area,
            "description": field(info, "description"),
            "instruction": field(info, "instruction"),
            "polygon_points": len(poly.group(1).split()) if poly else 0,
            "wellington_relevant": any(t in area.lower() for t in WGTN_TERMS),
            "source_url": url,
        }
        if rec["event"] or rec["headline"]:
            out.append(rec)
    return out


def main():
    print("finding archived CAP documents...")
    rows = cdx("alerts.metservice.com/cap*")
    print(f"  {len(rows)} archived snapshots under alerts.metservice.com/cap*")

    # alert documents carry ?id=; the bare feed is the rss/atom index
    alerts = [(r[1], r[2]) for r in rows if "alert" in r[2].lower()]
    feeds = [(r[1], r[2]) for r in rows if "alert" not in r[2].lower()]
    print(f"  {len(alerts)} alert documents, {len(feeds)} feed snapshots")

    jobs = alerts + feeds

    def fetch(job):
        ts, original = job
        url = f"http://web.archive.org/web/{ts}id_/{original}"
        xml = get(url)
        if not xml or "<alert" not in xml:
            # a feed snapshot: pull the alert links out and follow them
            ids = re.findall(r"alerts\.metservice\.com/cap/alert\?id=([^\s<&\"]+)", xml or "")
            found = []
            for aid in ids[:8]:
                a = get(f"http://web.archive.org/web/{ts}id_/"
                        f"https://alerts.metservice.com/cap/alert?id={aid}")
                if a and "<alert" in a:
                    found += parse_cap(a, ts, f"cap/alert?id={aid}")
            return found
        return parse_cap(xml, ts, original)

    records, done = [], 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        for batch in pool.map(fetch, jobs):
            records.extend(batch)
            done += 1
            if done % 40 == 0:
                print(f"  {done}/{len(jobs)} fetched — {len(records)} warnings")

    # de-dupe: same identifier + area + onset is the same warning re-snapshotted
    seen, uniq = set(), []
    for r in records:
        k = (r["identifier"], r["area"], r["onset"])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    uniq.sort(key=lambda r: r["onset"] or r["sent"] or "")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "MetService CAP alerts, recovered from Internet Archive snapshots",
        "coverage_warning": "INCOMPLETE BY CONSTRUCTION. MetService keeps no public "
                            "archive; this is only what the Internet Archive happened "
                            "to crawl. Warnings issued and expired between snapshots "
                            "are absent. Do not read gaps as quiet weather.",
        "snapshots_examined": len(jobs),
        "count": len(uniq),
        "warnings": uniq,
    }, open(OUT, "w"), indent=1)

    from collections import Counter
    print(f"\n{len(uniq)} unique warnings (from {len(records)} parsed) -> {OUT}")
    if uniq:
        print("  events:", dict(Counter(r["event"] for r in uniq).most_common(8)))
        print("  severity:", dict(Counter(r["severity"] for r in uniq)))
        print("  Wellington-relevant:", sum(1 for r in uniq if r["wellington_relevant"]))
        print("  with polygons:", sum(1 for r in uniq if r["polygon_points"]))


if __name__ == "__main__":
    main()
