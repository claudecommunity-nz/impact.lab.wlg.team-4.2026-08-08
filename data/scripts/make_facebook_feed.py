"""Flatten the generated Facebook content into a plain feed.

Just posts, the way they'd arrive off a social feed: who posted, into which
group, when, what they said, the engagement, and the location signal. No cluster
ids, no bands, no scoring scaffolding — that stays in the labelled files.

    python3 data/scripts/make_facebook_feed.py -> data/feeds/facebook_feed.json
"""

import json
import os
import random
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..")
OUT = os.path.join(DATA, "feeds", "facebook_feed.json")
SRC = [os.path.join(DATA, "synthetic", f)
       for f in ("corpus-labelled-large.json", "corpus-labelled.json")]

rng = random.Random(20260808)

# Fictional group names. Deliberately NOT real Wellington Facebook groups —
# attributing invented posts to a real community would be fabricating records
# about real people, which is the thing this project exists to detect.
GROUPS = [
    "Wellington Community Noticeboard", "Wellington Weather Watchers",
    "Hutt Valley Neighbours", "Porirua Community Chat",
    "Wellington Traffic & Travel", "Eastern Suburbs Neighbourhood Group",
    "Karori & Western Suburbs Community", "Wellington Emergency Preparedness Group",
    "Kāpiti & Coast Community Board", "Newtown / Berhampore Neighbours",
]
PAGES = ["Wellington Local News", "Capital Weather Updates", "Hutt Valley Live"]

# Generic placeholders, never plausible-looking real names.
FIRST = ["Resident", "Member", "Neighbour", "Local", "Community member"]

# ─── location ───────────────────────────────────────────────────────────────
# Location on a real Facebook post arrives three ways, with very different
# reliability, and often not at all:
#   check_in      explicit tag. Rare (most people don't check in) but precise —
#                 and occasionally WRONG for the incident, because people tag
#                 where they are, not what they're describing.
#   text_mention  a place named in the body. Common, but ambiguous and often a
#                 street with no suburb.
#   group_area    which group it went into. Always present, weakest signal.
# Posts with none of these must surface as "location unknown", never be
# silently dropped or guessed.
GROUP_AREA = {
    "Wellington Community Noticeboard": "Wellington",
    "Wellington Weather Watchers": "Wellington",
    "Hutt Valley Neighbours": "Hutt Valley",
    "Porirua Community Chat": "Porirua",
    "Wellington Traffic & Travel": "Wellington",
    "Eastern Suburbs Neighbourhood Group": "Eastern Suburbs",
    "Karori & Western Suburbs Community": "Karori",
    "Wellington Emergency Preparedness Group": "Wellington",
    "Kāpiti & Coast Community Board": "Kāpiti Coast",
    "Newtown / Berhampore Neighbours": "Newtown",
    "Wellington Local News": "Wellington",
    "Capital Weather Updates": "Wellington",
    "Hutt Valley Live": "Hutt Valley",
}

PLACES = [
    "Wellington", "Karori", "Kelburn", "Thorndon", "Te Aro", "Newtown",
    "Miramar", "Kilbirnie", "Island Bay", "Brooklyn", "Hataitai", "Johnsonville",
    "Khandallah", "Ngaio", "Tawa", "Porirua", "Lower Hutt", "Upper Hutt",
    "Petone", "Seatoun", "Lyall Bay", "Berhampore", "Wadestown", "Northland",
    "Eastbourne", "Wainuiomata", "Naenae", "Taita", "Ngauranga", "Silverstream",
    "Trentham", "Korokoro", "Paraparaumu",
]
AMBIGUOUS = {"Northland": "Wellington suburb OR the region 700km north",
             "Brooklyn": "Wellington suburb OR Brooklyn, Motueka",
             "Newtown": "Wellington suburb OR Newtown, Wanganui"}


def build_location(text, group, rng):
    body = text.lower()
    in_text = list(dict.fromkeys(p for p in PLACES if p.lower() in body))

    roll = rng.random()
    check_in = None
    if roll < 0.15 and in_text:
        check_in = in_text[0]                 # tagged where the incident is
    elif roll < 0.19:
        check_in = rng.choice(PLACES)         # tagged where the POSTER is

    conflict = bool(check_in and in_text and check_in not in in_text)
    if check_in:
        signal, best = "check_in", check_in
    elif in_text:
        signal, best = "text_mention", in_text[0]
    else:
        signal, best = "none", None

    return {
        "check_in": check_in,
        "places_in_text": in_text,
        "group_area": GROUP_AREA.get(group),
        "best_guess": best,
        "signal": signal,
        "is_locatable": best is not None,
        "check_in_conflicts_with_text": conflict,
        "ambiguous_names": [p for p in in_text if p in AMBIGUOUS] or None,
    }


def handle(i):
    return f"{FIRST[i % len(FIRST)]} {chr(65 + (i % 26))}."


def engagement(text, is_news):
    """Alarm and questions get more traction than notices."""
    base = 3 + len(text) // 60
    if any(w in text.lower() for w in ("anyone", "does anyone", "?", "heads up", "psa")):
        base += rng.randint(4, 22)
    if is_news:
        base += rng.randint(5, 30)
    likes = max(0, base + rng.randint(-3, 18))
    return {"reactions": likes,
            "comments": max(0, int(likes * rng.uniform(0.15, 0.9))),
            "shares": max(0, int(likes * rng.uniform(0.0, 0.35)))}


def main():
    posts, i = [], 0
    for path in SRC:
        if not os.path.exists(path):
            print(f"  (skip) {os.path.basename(path)}")
            continue
        for r in json.load(open(path)).get("records", []):
            pub = r.get("publisher") or ""
            text = (r.get("text") or "").strip()
            if not text:
                continue
            is_news = "news" in pub.lower() or r.get("simulated_tier") == "news"
            surface, name = ("page", rng.choice(PAGES)) if is_news else ("group", rng.choice(GROUPS))
            posts.append({
                "id": f"fb_{i:05d}", "platform": "facebook",
                "surface": surface, "group_or_page": name,
                "post_type": ("comment" if "comment" in pub.lower()
                              else "share" if "repost" in pub.lower() else "post"),
                "author_display": "Local news page" if is_news else handle(i),
                "posted_at": r.get("published_at"),
                "text": text,
                "location": build_location(text, name, rng),
                "has_media": bool(r.get("has_media")),
                "engagement": engagement(text, is_news),
                "simulated": True,
            })
            i += 1

    posts.sort(key=lambda p: p["posted_at"] or "")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({
        "generated_at": datetime.now().astimezone().isoformat(),
        "simulated": True,
        "warning": "SIMULATED Facebook posts. No Facebook data was collected — "
                   "public pages return no posts without a session, community "
                   "groups are private, the Groups API closed in 2020 and "
                   "CrowdTangle in 2024. Group and page names are fictional. "
                   "Label these as simulated wherever they are displayed.",
        "count": len(posts), "posts": posts,
    }, open(OUT, "w"), indent=1)

    from collections import Counter
    loc = Counter(p["location"]["signal"] for p in posts)
    n_unloc = sum(1 for p in posts if not p["location"]["is_locatable"])
    print(f"{len(posts)} posts -> {OUT}")
    print("  types:", dict(Counter(p["post_type"] for p in posts)))
    print("  location signal:", dict(loc))
    print(f"  NOT locatable: {n_unloc} ({n_unloc/max(len(posts),1)*100:.0f}%)")
    print("  check-in conflicts with text:",
          sum(1 for p in posts if p["location"]["check_in_conflicts_with_text"]))
    print("  ambiguous place names:", sum(1 for p in posts if p["location"]["ambiguous_names"]))


if __name__ == "__main__":
    main()
