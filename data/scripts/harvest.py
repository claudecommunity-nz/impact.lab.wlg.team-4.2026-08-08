"""Harvest live public feeds — news, official alerts, social — into one file.

Every source is normalised to the same record shape so the analysis layer never
has to know where a record came from. Provenance is carried per record and
never flattened away: `tier` says how much weight a record may carry, and no
social record is ever presented as fact.

Author handles are pseudonymised because this repo is public.

    python3 data/scripts/harvest.py -> data/raw/news/mixed_feeds_corpus.json
"""

import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

UA = "wcc-impact-lab/0.1 (Wellington Impact Lab hackathon prototype; non-commercial)"
TIMEOUT = 20
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "raw", "news", "mixed_feeds_corpus.json")
KEEP_AUTHORS = "--keep-authors" in sys.argv

# tier drives how the analysis layer may use a record:
#   social   — unverified public claim. A signal to investigate, never fact.
#   news     — editorially filtered, still secondary.
#   official — authoritative issuer (GeoNet, MetService, NEMA).
#
# Parse by SHAPE, not by URL: Stuff and The Spinoff both serve Atom from paths
# that look like RSS. Getting this wrong returns "ok, 0 records" silently.
SOURCES = [
    ("reddit-wellington", "social", "Reddit r/Wellington", "atom",
     "https://www.reddit.com/r/wellington/new/.rss?limit=50"),
    ("mastodon-nz-local", "social", "mastodon.nz", "mastodon",
     "https://mastodon.nz/api/v1/timelines/public?local=true&limit=40"),
    ("mastodon-tag-wellington", "social", "mastodon.nz", "mastodon",
     "https://mastodon.nz/api/v1/timelines/tag/wellington?limit=40"),
    ("rnz-national", "news", "RNZ", "rss", "https://www.rnz.co.nz/rss/national.xml"),
    # Feed list cross-checked against the `nz-news` skill
    # (github.com/thecolab-ai/.skills). Its rnz te-ao-maori feed is dead —
    # returns "This feed is no longer available" — so it is not included.
    ("rnz-news", "news", "RNZ", "rss", "https://www.rnz.co.nz/rss/news.xml"),
    ("the-spinoff", "news", "The Spinoff", "atom", "https://thespinoff.co.nz/feed"),
    ("newsroom", "news", "Newsroom", "rss", "https://www.newsroom.co.nz/rss"),
    ("interest-nz", "news", "interest.co.nz", "rss", "https://www.interest.co.nz/rss"),
    ("wellington-scoop", "news", "Wellington.Scoop", "rss",
     "https://wellington.scoop.co.nz/?feed=rss2"),
    ("nzherald-nz", "news", "NZ Herald", "rss",
     "https://www.nzherald.co.nz/arc/outboundfeeds/rss/section/nz/?outputType=xml"),
    ("stuff-national", "news", "Stuff", "atom", "https://www.stuff.co.nz/rss"),
    ("metservice-cap", "official", "MetService", "rss",
     "https://alerts.metservice.com/cap/rss"),
    # The documented NEMA root returns a pointer JSON; /rss/pwp is the feed.
    ("nema-emergency-mobile-alerts", "official", "NEMA", "rss",
     "https://alerthub.civildefence.govt.nz/rss/pwp"),
    ("geonet-quakes", "official", "GeoNet", "geonet-quake",
     "https://api.geonet.org.nz/quake?MMI=3"),
    ("geonet-felt-reports", "official", "GeoNet", "geonet-intensity",
     "https://api.geonet.org.nz/intensity?type=reported"),
]

WELLINGTON = (174.62, -41.36, 174.94, -41.14)

PLACE_TERMS = [
    "wellington", "te whanganui-a-tara", "welly", "wgtn", "karori", "kelburn",
    "thorndon", "te aro", "newtown", "miramar", "kilbirnie", "island bay",
    "brooklyn", "hataitai", "oriental bay", "mount victoria", "aro valley",
    "berhampore", "johnsonville", "khandallah", "ngaio", "tawa", "churton park",
    "porirua", "lower hutt", "upper hutt", "petone", "seatoun", "strathmore",
    "owhiro bay", "makara", "wadestown", "northland", "lyall bay", "rongotai",
    "hutt valley", "eastbourne", "wainuiomata", "naenae", "taita", "cbd",
]

IMPACT_TERMS = [
    "flood", "flooding", "slip", "landslide", "surface flooding", "road closed",
    "closure", "closed", "power cut", "power out", "outage", "no power",
    "blackout", "water main", "burst", "no water", "boil water", "evacuat",
    "cordon", "storm", "gale", "wind", "damage", "debris", "tree down",
    "quake", "earthquake", "shake", "jolt", "tsunami", "swell", "king tide",
    "inundat", "sewage", "fire", "smoke", "crash", "cancelled", "disruption",
    "stranded", "rescue",
]


def _get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, application/rss+xml, application/atom+xml, */*",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def _strip_html(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def _iso(s):
    if not s:
        return None
    s = s.strip()
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z",
                "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z",
                "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ"):
        try:
            dt = datetime.strptime(s.replace("Z", "+0000") if fmt.endswith("%z") else s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except ValueError:
            continue
    return s


def _author(handle):
    """Public handles are still personal identifiers, and this repo is public."""
    if not handle:
        return None
    return handle if KEEP_AUTHORS else "anon:" + hashlib.sha256(handle.encode()).hexdigest()[:12]


# Accounts that REPUBLISH someone else's feed. Corroboration must never count a
# relay as an independent witness: journeysbot was 15 of 40 posts in the live
# #wellington tag, all restating one NZTA feed.
RELAYS = {"journeysbot@g2s.mountainmoss.nz": "NZTA Journeys"}


def record(src, *, external_id, url, published_at, title, text, author=None, extra=None):
    src_id, tier, publisher, _kind, _url = src
    body = f"{title or ''} {text or ''}".lower()
    origin = RELAYS.get(author or "")
    return {
        "id": hashlib.sha256(f"{src_id}:{external_id}".encode()).hexdigest()[:16],
        "source_id": src_id,
        "tier": tier,
        "publisher": publisher,
        "url": url,
        "published_at": published_at,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "title": title,
        "text": text,
        "author": _author(author),
        "relayed_from": origin,
        # what counts as ONE witness — corroboration counts these, not records
        "independence_key": f"origin:{origin}" if origin else f"publisher:{publisher}",
        "content_fingerprint": hashlib.sha256(
            re.sub(r"[^a-z ]", "", body)[:200].encode()).hexdigest()[:12],
        # cheap triage hints, NOT a classification — the AI step decides
        "hint_places": sorted({t for t in PLACE_TERMS if t in body}),
        "hint_impacts": sorted({t for t in IMPACT_TERMS if t in body}),
        **(extra or {}),
    }


def parse_rss(src, raw):
    root = ET.fromstring(raw)
    out = []
    for item in root.iter("item"):
        def g(tag):
            el = item.find(tag)
            return (el.text or "") if el is not None else ""
        link = g("link")
        out.append(record(src, external_id=g("guid") or link, url=link,
                          published_at=_iso(g("pubDate")),
                          title=_strip_html(g("title")),
                          text=_strip_html(g("description"))))
    return out


def parse_atom(src, raw):
    ns = {"a": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(raw)
    out = []
    for e in root.findall("a:entry", ns):
        def g(tag):
            el = e.find(f"a:{tag}", ns)
            return (el.text or "") if el is not None else ""
        link_el = e.find("a:link", ns)
        link = link_el.get("href") if link_el is not None else ""
        author_el = e.find("a:author/a:name", ns)
        out.append(record(src, external_id=g("id") or link, url=link,
                          published_at=_iso(g("updated") or g("published")),
                          title=_strip_html(g("title")),
                          text=_strip_html(g("content") or g("summary")),
                          author=author_el.text if author_el is not None else None))
    return out


def parse_mastodon(src, raw):
    out = []
    for p in json.loads(raw):
        out.append(record(src, external_id=p["uri"], url=p.get("url") or p["uri"],
                          published_at=_iso(p["created_at"]), title=None,
                          text=_strip_html(p.get("content", "")),
                          author=(p.get("account") or {}).get("acct"),
                          extra={"engagement": {
                              "replies": p.get("replies_count", 0),
                              "reblogs": p.get("reblogs_count", 0),
                              "favourites": p.get("favourites_count", 0)},
                              "media": [m.get("url") for m in (p.get("media_attachments") or [])]}))
    return out


def parse_geonet_quake(src, raw):
    out = []
    for f in json.loads(raw)["features"]:
        p, c = f["properties"], f["geometry"]["coordinates"]
        out.append(record(src, external_id=p["publicID"],
                          url=f"https://www.geonet.org.nz/earthquake/{p['publicID']}",
                          published_at=_iso(p["time"]),
                          title=f"M{p['magnitude']:.1f} earthquake, {p['locality']}",
                          text=f"MMI {p['mmi']}, depth {p['depth']:.0f} km, quality {p['quality']}",
                          extra={"lng": c[0], "lat": c[1],
                                 "magnitude": p["magnitude"], "mmi": p["mmi"]}))
    return out


def parse_geonet_intensity(src, raw):
    """Crowd-sourced felt reports — numeric only, GeoNet publishes no text."""
    out = []
    for f in json.loads(raw).get("features", []):
        p, c = f["properties"], f["geometry"]["coordinates"]
        out.append(record(src, external_id=f"felt:{c[0]},{c[1]}:{p.get('mmi')}",
                          url="https://www.geonet.org.nz/earthquake/report",
                          published_at=None,
                          title=f"Felt report cluster, MMI {p.get('mmi')}",
                          text=f"{p.get('count', 0)} public reports",
                          extra={"lng": c[0], "lat": c[1], "mmi": p.get("mmi"),
                                 "report_count": p.get("count")}))
    return out


PARSERS = {"rss": parse_rss, "atom": parse_atom, "mastodon": parse_mastodon,
           "geonet-quake": parse_geonet_quake, "geonet-intensity": parse_geonet_intensity}


def main():
    corpus, report = [], []
    for src in SOURCES:
        src_id, tier, _pub, kind, url = src
        t0 = time.time()
        try:
            rows = PARSERS[kind](src, _get(url))
            corpus.extend(rows)
            hits = sum(1 for r in rows if r["hint_places"] and r["hint_impacts"])
            report.append((src_id, tier, "ok", len(rows), hits, f"{time.time()-t0:.1f}s"))
        except urllib.error.HTTPError as e:
            report.append((src_id, tier, f"HTTP {e.code}", 0, 0, f"{time.time()-t0:.1f}s"))
        except Exception as e:
            report.append((src_id, tier, type(e).__name__, 0, 0, f"{time.time()-t0:.1f}s"))
        time.sleep(1.5)   # reddit 429s after ~3 rapid requests; be a good citizen

    print(f"{'source':<32} {'tier':<9} {'status':<10} {'recs':>5} {'wgtn+impact':>12} {'t':>6}")
    print("-" * 80)
    for r in report:
        print(f"{r[0]:<32} {r[1]:<9} {r[2]:<10} {r[3]:>5} {r[4]:>12} {r[5]:>6}")
    # "ok" with 0 records usually means the feed shape is wrong (RSS vs Atom)
    for r in report:
        if r[2] == "ok" and r[3] == 0:
            print(f"  ! {r[0]} returned 0 records — check RSS vs Atom")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bbox_wellington": WELLINGTON,
        "authors_pseudonymised": not KEEP_AUTHORS,
        "sources": [{"id": r[0], "tier": r[1], "status": r[2], "records": r[3]} for r in report],
        "records": corpus,
    }, open(OUT, "w"), indent=1)
    print(f"\n{len(corpus)} records -> {OUT}")


if __name__ == "__main__":
    main()
