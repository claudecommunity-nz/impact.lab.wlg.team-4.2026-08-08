"""Write every source out as a plain post feed.

One flat list of posts per platform, in the shape a social record actually has:
who posted it, where, when, what it says, whether it carries media, and what
location signal (if any) can be read off it.

No clusters, no ground-truth blocks, no scoring scaffolding — a consumer reads
`posts` and nothing else.

    python3 data/scripts/make_feeds.py
      -> data/feeds/reddit.json     (real)
      -> data/feeds/news.json       (real)
      -> data/feeds/mastodon.json   (real)
      -> data/feeds/facebook.json   (simulated; built by make_facebook_feed.py)
"""

import json
import os
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..")
FEEDS = os.path.join(DATA, "feeds")

PLACES = [
    "Wellington", "Karori", "Kelburn", "Thorndon", "Te Aro", "Newtown",
    "Miramar", "Kilbirnie", "Island Bay", "Brooklyn", "Hataitai", "Johnsonville",
    "Khandallah", "Ngaio", "Tawa", "Porirua", "Lower Hutt", "Upper Hutt",
    "Petone", "Seatoun", "Lyall Bay", "Berhampore", "Wadestown", "Northland",
    "Eastbourne", "Wainuiomata", "Naenae", "Taita", "Ngauranga", "Silverstream",
    "Trentham", "Korokoro", "Paraparaumu", "Alicetown", "Pauatahanui",
]
# Same string, different places. A geocoder taking the first hit sends these
# to the wrong end of the country.
AMBIGUOUS = {"Northland", "Brooklyn", "Newtown"}


def location_from_text(text, title=""):
    """Real posts here carry no geotag — the only signal is what the text names."""
    body = f"{title or ''} {text or ''}"
    found = list(dict.fromkeys(p for p in PLACES if p.lower() in body.lower()))
    return {
        "check_in": None,                 # not available from these sources
        "places_in_text": found,
        "best_guess": found[0] if found else None,
        "signal": "text_mention" if found else "none",
        "is_locatable": bool(found),
        "ambiguous_names": [p for p in found if p in AMBIGUOUS] or None,
    }


def write(name, posts, source_note, simulated=False):
    os.makedirs(FEEDS, exist_ok=True)
    posts.sort(key=lambda p: p.get("posted_at") or "")
    payload = {
        "generated_at": datetime.now().astimezone().isoformat(),
        "platform": name,
        "source": source_note,
        "simulated": simulated,
        "count": len(posts),
        "posts": posts,
    }
    if simulated:
        payload["warning"] = ("SIMULATED posts. Label as simulated wherever "
                              "displayed. Group and page names are fictional.")
    json.dump(payload, open(os.path.join(FEEDS, f"{name}.json"), "w"), indent=1)
    loc = sum(1 for p in posts if p["location"]["is_locatable"])
    print(f"  {name:<10} {len(posts):>5} posts   {loc:>5} locatable  -> feeds/{name}.json")


def load(path):
    p = os.path.join(DATA, path)
    return json.load(open(p)) if os.path.exists(p) else None


def main():
    print("writing feeds:")

    # ── reddit (real) — every pull, de-duped ────────────────────────────────
    posts, seen, i = [], set(), 0
    for path in ("raw/reddit/reddit_corpus_deep.json",
                 "raw/reddit/reddit_corpus_api.json",
                 "raw/reddit/wellington_posts.json"):
        d = load(path)
        rows = d if isinstance(d, list) else (d or {}).get("records", [])
        for x in rows:
            url = x.get("url")
            key = url or (x.get("title"), (x.get("text") or "")[:60])
            if key in seen:
                continue
            seen.add(key)
            text = x.get("text") or ""
            posts.append({
                "id": f"rd_{i:06d}",
                "platform": "reddit",
                "subreddit": (x.get("publisher") or "").replace("Reddit ", "") or "r/wellington",
                "post_type": "comment" if x.get("is_comment") else "post",
                "author_display": None,        # not published; repo is public
                "posted_at": x.get("published_at"),
                "title": x.get("title") or None,
                "text": text,
                "url": url,
                "score": x.get("score"),
                "matched_term": x.get("matched_term"),
                "location": location_from_text(text, x.get("title")),
                "has_media": False,
            })
            i += 1
    write("reddit", posts, "Real Reddit content via the NZ Reddit Corpus API "
                           "(25 NZ subreddits, 2016-2026) plus direct RSS.")

    # ── news + official feeds (real) ────────────────────────────────────────
    d = load("raw/news/mixed_feeds_corpus.json") or {}
    posts, i = [], 0
    for x in d.get("records", []):
        text = x.get("text") or ""
        posts.append({
            "id": f"nw_{i:05d}",
            "platform": "news",
            "publisher": x.get("publisher"),
            "tier": x.get("tier"),
            "post_type": "article",
            "posted_at": x.get("published_at"),
            "title": x.get("title") or None,
            "text": text,
            "url": x.get("url"),
            "location": location_from_text(text, x.get("title")),
            "has_media": False,
        })
        i += 1
    write("news", posts, "Real RSS/Atom from RNZ, Stuff, NZ Herald, "
                         "Wellington.Scoop, The Spinoff, Newsroom, interest.co.nz, "
                         "plus MetService CAP, NEMA and GeoNet.")

    # ── mastodon (real) ─────────────────────────────────────────────────────
    d = load("raw/mastodon/mastodon_posts.json") or []
    posts, i = [], 0
    for x in d:
        text = x.get("text") or ""
        posts.append({
            "id": f"ms_{i:05d}",
            "platform": "mastodon",
            "instance": (x.get("source") or "").split(":")[-1].split("#")[0],
            "post_type": "post",
            "author_display": x.get("author"),
            "posted_at": x.get("published_at"),
            "text": text,
            "url": x.get("url"),
            "engagement": x.get("engagement"),
            "media": x.get("media") or None,
            "has_media": bool(x.get("media")),
            "location": location_from_text(text),
        })
        i += 1
    write("mastodon", posts, "Real posts from mastodon.nz, toot.kiwi and "
                             "cloudisland.nz across 10 hazard hashtags.")

    # ── facebook (simulated) — already flat, just relocate ──────────────────
    d = load("facebook_feed.json") or load("feeds/facebook_feed.json")
    if d:
        write("facebook", d.get("posts", []),
              "SIMULATED Facebook community-group posts. No Facebook data was "
              "collected — public pages return no posts without a session, "
              "groups are private, the Groups API closed in 2020 and "
              "CrowdTangle in 2024.", simulated=True)


if __name__ == "__main__":
    main()
