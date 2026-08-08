"""Generate the simulated FACEBOOK corpus, anchored to REAL Wellington events.

This corpus stands in for Facebook deliberately. Facebook neighbourhood groups
are where most of this conversation actually happens in Wellington, and they are
the one source the prototype cannot lawfully or technically collect: a public
page returns 475KB of HTML with ZERO posts without a session, most community
groups are private, the Groups API was withdrawn in 2020, and CrowdTangle shut
down in 2024 (all verified 2026-08-08). Simulating the channel is how we test
whether the pipeline would work if that data were available — and it keeps the
coverage gap visible in the dataset rather than hidden.

Only the surface text comes from the model. Facts, labels, distortions and
independence keys stay under our control: a model asked for "realistic flood
posts" writes clean, cooperative, helpfully-geolocated text, and a detector
scored against that flatters itself.

Group names are GENERIC AND FICTIONAL on purpose (see make_facebook_feed.py).
Attributing invented posts to a real, named Facebook group would be fabricating
records about a real community — the failure mode this project exists to detect.

    export ANTHROPIC_API_KEY=sk-ant-...
    python3 data/scripts/generate_synthetic.py
    python3 data/scripts/generate_synthetic.py --dry-run   # specs only, no API
"""

import hashlib
import json
import os
import random
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

MODEL = "claude-opus-5"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "synthetic", "corpus-labelled-large.json")
DRY = "--dry-run" in sys.argv

rng = random.Random(20260808)  # deterministic: same corpus every run, scores compare

# ─── real anchor events (measured; see ../reference/events.json) ─────────────
ANCHORS = {
    "flood-2026-04-18": dict(hazard="flood", at="2026-04-18T09:25:00+12:00",
        real="Hutt River at Taita Gorge peaked 475 m3/s (31x median)",
        sensor="GW Hilltop telemetry", places=["Taita", "Lower Hutt", "Petone", "Upper Hutt"]),
    "flood-2025-10-11": dict(hazard="flood", at="2025-10-11T04:05:00+13:00",
        real="Hutt River peaked 463 m3/s", sensor="GW Hilltop telemetry",
        places=["Upper Hutt", "Silverstream", "Trentham"]),
    "flood-2026-06-26": dict(hazard="flood", at="2026-06-26T17:10:00+12:00",
        real="Hutt River peaked 346 m3/s", sensor="GW Hilltop telemetry",
        places=["Petone", "Ngauranga", "Island Bay"]),
    "quake-2026-08-02": dict(hazard="earthquake", at="2026-08-02T20:36:21+12:00",
        real="GeoNet 2026p576644 — M5.2 MMI 5, 15km NW of Porirua",
        sensor="GeoNet", places=["Porirua", "Tawa", "Johnsonville", "Karori"],
        confounder="M5.7 at Te Araroa 54 seconds earlier (2026p576643)"),
    "quake-2025-11-06": dict(hazard="earthquake", at="2025-11-06T21:09:54+13:00",
        real="GeoNet 2025p836054 — M4.9, 27km from CBD, 24,461 felt reports",
        sensor="GeoNet", places=["Karori", "Kelburn", "Te Aro", "Newtown", "Johnsonville"]),
    "quake-2026-07-31": dict(hazard="earthquake", at="2026-07-31T23:09:22+12:00",
        real="GeoNet 2026p571526 — M4.6, 8,971 felt reports", sensor="GeoNet",
        places=["Porirua", "Tawa", "Khandallah"]),
    "storm-2026-04-20": dict(hazard="storm", at="2026-04-20T06:00:00+12:00",
        real="Berhampore gauge 134.0 mm in 24h — wettest day of the year",
        sensor="GW Hilltop rainfall", places=["Berhampore", "Island Bay", "Newtown", "Brooklyn"]),
    "storm-2026-02-03": dict(hazard="storm", at="2026-02-03T14:00:00+12:00",
        real="Berhampore gauge 64.8 mm in 24h", sensor="GW Hilltop rainfall",
        places=["Miramar", "Lyall Bay", "Kilbirnie", "Seatoun"]),
}

ISSUES = ["surface_flooding", "road_closure", "power_outage", "slip",
          "structural_damage", "shaking_felt", "coastal_inundation",
          "water_supply", "tree_down", "transport_disruption"]

PLATFORMS = [
    ("Facebook — neighbourhood group (simulated)", "social"),
    ("Facebook — group comment (simulated)", "social"),
    ("Facebook — community page (simulated)", "social"),
    ("Facebook — local news page (simulated)", "news"),
]

# Cluster counts are the difficulty/volume dial. FALSE is heavy enough that a
# scorer cannot pass by calling everything real.
BANDS = {
    "HIGH":   dict(n_clusters=20, size=(5, 8), independent=(4, 6), corrob="strong"),
    "MEDIUM": dict(n_clusters=30, size=(2, 4), independent=(2, 4), corrob="weak"),
    "LOW":    dict(n_clusters=25, size=(1, 3), independent=(1, 2), corrob=None),
    "FALSE":  dict(n_clusters=25, size=(3, 6), independent=(1, 2), corrob=None),
}

FALSE_KINDS = ["relay_inflation", "keyword_decoy", "misattribution",
               "recycled_media", "wrong_place_media", "screenshot_relay"]

DECOY_BRIEF = (
    "Write posts that CONTAIN a hazard keyword (flood/smoke/power/water/wind/shaking) "
    "but describe something completely mundane and non-emergency — a landlord dispute, "
    "a BBQ smell, a sports result, a pun, ordinary bad weather grumbling. They must be "
    "genuinely misleading to a keyword filter but obviously not an incident to a human."
)


def call_model(client, brief, n):
    """Surface text only. The model tags each post's register so publishers are
    assigned to matching text — round-robining a flat list put social-register
    text under a newsroom byline, an obvious tell on a projector."""
    schema = {
        "type": "object",
        "properties": {"posts": {"type": "array", "items": {
            "type": "object",
            "properties": {"register": {"type": "string", "enum": ["social", "news"]},
                           "text": {"type": "string"}},
            "required": ["register", "text"], "additionalProperties": False}}},
        "required": ["posts"], "additionalProperties": False,
    }
    n_news = 1 if n >= 4 else 0   # newsrooms are slower and rarer than the crowd
    resp = client.messages.create(
        model=MODEL, max_tokens=8000,
        output_config={"effort": "medium", "format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content":
                   f"{brief}\n\nThese are posts in a WELLINGTON FACEBOOK COMMUNITY "
                   f"GROUP — a neighbourhood group or local noticeboard, not Reddit "
                   f"and not Twitter.\n\n"
                   f"Write exactly {n} posts: {n - n_news} with register "
                   f"\"social\" and {n_news} with register \"news\".\n"
                   f"- social: how people post in a local Facebook group. Warmer and "
                   f"chattier than Reddit; mostly complete sentences but with typos and "
                   f"missing apostrophes, the occasional ALL-CAPS word or !!!, emoji, "
                   f"te reo Māori mixed in. Some are replies that make no sense alone. "
                   f"Some cite a neighbour or family member rather than seeing it "
                   f"first-hand. Vary length hard — some 4 words, some 60.\n"
                   f"  OPENERS MUST VARY. Do not start more than one post in this batch "
                   f"the same way. Across the batch use a mix of: a bare statement of "
                   f"what they can see; a question; 'PSA'; 'UPDATE:'; a complaint; a "
                   f"reply agreeing or correcting someone; a photo caption of 3-5 words; "
                   f"someone relaying what a family member told them; a thank-you or "
                   f"offer of help. At most ONE post may open with 'Does anyone know' "
                   f"and at most ONE with 'Just a heads up'.\n"
                   f"- news: a local news outlet's Facebook page post — a headline-style "
                   f"line plus one factual sentence attributing claims to residents. "
                   f"Never first person, never slang.\n"
                   f"Do NOT name any real person, real Facebook group, or real page. "
                   f"Never invent casualties."}],
    )
    text = next(b.text for b in resp.content if b.type == "text")
    return json.loads(text)["posts"][:n]


def build_specs():
    specs = []
    for band, cfg in BANDS.items():
        for _ in range(cfg["n_clusters"]):
            anchor_id = rng.choice(list(ANCHORS))
            a = ANCHORS[anchor_id]
            place = rng.choice(a["places"])
            size = rng.randint(*cfg["size"])
            specs.append(dict(
                cluster_id=f"g{len(specs)+1:03d}-{band.lower()}-{place.lower().replace(' ','')}",
                band=band, anchor=anchor_id, place=place, issue=rng.choice(ISSUES),
                size=size, independent=min(cfg["independent"][1], size),
                corrob=cfg["corrob"],
                false_kind=rng.choice(FALSE_KINDS) if band == "FALSE" else None))
    return specs


def brief_for(spec):
    a = ANCHORS[spec["anchor"]]
    kind = spec["issue"].replace("_", " ")
    fk = spec["false_kind"]
    if fk == "keyword_decoy":
        return DECOY_BRIEF
    if fk == "misattribution":
        return (f"Real {a['hazard']} shaking/impact was felt in Wellington. Write posts where "
                f"people confidently blame the WRONG cause — {a.get('confounder', 'an unrelated event elsewhere')}. "
                f"They are sincere and specific, just wrong about what caused it.")
    if fk == "relay_inflation":
        # On Facebook this is copy-paste, not a bot: one official bulletin
        # re-posted into several groups. Looks like many witnesses; is one source.
        return (f"An official road/traffic bulletin about {kind} at {spec['place']} has "
                f"been copy-pasted around local Facebook groups. Write the original "
                f"bulletin in flat official phrasing, then several re-posts of the SAME "
                f"bulletin by different community members — some paste it verbatim, some "
                f"add 'sharing from the council page' or 'copied from another group', one "
                f"trims it slightly. The underlying facts never change.")
    if fk in ("recycled_media", "wrong_place_media", "screenshot_relay"):
        return (f"Write posts sharing a photo/video of {kind}, captioned as if it is "
                f"{spec['place']} right now. Some commenters should express doubt that the "
                f"image is really from here or really from today.")
    return (f"A real {a['hazard']} is affecting Wellington, New Zealand. "
            f"Incident: {kind} at {spec['place']}. Write first-hand public posts from people "
            f"nearby — uncertain, partial, as it is happening. Not a press release.")


def main():
    specs = build_specs()
    print(f"{len(specs)} cluster specs")
    if DRY:
        for s in specs[:10]:
            print(" ", s["cluster_id"], s["band"], s["place"], s["issue"], s["false_kind"] or "")
        return

    import anthropic
    client = anthropic.Anthropic()

    def gen(spec):
        try:
            return spec, call_model(client, brief_for(spec), spec["size"])
        except Exception as e:
            print(f"  {spec['cluster_id']}: {type(e).__name__} {str(e)[:70]}")
            return spec, []

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(gen, specs))

    records, clusters = [], []
    social_pubs = [p for p in PLATFORMS if p[1] == "social"]
    news_pubs = [p for p in PLATFORMS if p[1] == "news"]

    for spec, texts in results:
        if not texts:
            continue
        a = ANCHORS[spec["anchor"]]
        t0 = datetime.fromisoformat(a["at"])
        ids, keys = [], []
        for i, post in enumerate(texts):
            text, register = post["text"], post["register"]
            if spec["false_kind"] == "relay_inflation":
                pub, tier = "Facebook — group repost (simulated)", "social"
                indep, relayed = "origin:official bulletin", "official road/traffic bulletin"
            else:
                pool_ = news_pubs if register == "news" else social_pubs
                pub, tier = pool_[i % len(pool_)]
                # cap distinct originators at the spec's independence count
                indep, relayed = f"publisher:{pub}#{i % spec['independent']}", None
            when = t0 + timedelta(minutes=(i / max(len(texts) - 1, 1)) ** 0.5 * 180)
            rid = "syn_" + hashlib.sha256(f"{spec['cluster_id']}{i}{text}".encode()).hexdigest()[:12]
            ids.append(rid)
            keys.append(indep)
            records.append({
                "id": rid, "source_id": pub.lower().replace(" ", "-"),
                "publisher": pub, "tier": "synthetic", "simulated_tier": tier,
                "synthetic": True, "url": None, "published_at": when.isoformat(),
                "title": None, "text": text, "author": None,
                "relayed_from": relayed, "independence_key": indep,
                "content_fingerprint": hashlib.sha256(
                    re.sub(r"[^a-z]", "", text.lower())[:120].encode()).hexdigest()[:12],
                "has_media": spec["false_kind"] in ("recycled_media", "wrong_place_media",
                                                    "screenshot_relay"),
                "truth": {
                    "cluster_id": spec["cluster_id"],
                    "event_id": None if spec["false_kind"] == "keyword_decoy" else spec["anchor"],
                    "true_place": None if spec["false_kind"] == "keyword_decoy" else spec["place"],
                    "true_issue_type": None if spec["false_kind"] == "keyword_decoy" else spec["issue"],
                    "is_true_signal": spec["band"] != "FALSE",
                    "false_kind": spec["false_kind"],
                    "media_verdict": {"recycled_media": "recycled",
                                      "wrong_place_media": "wrong_place",
                                      "screenshot_relay": "screenshot"}.get(spec["false_kind"]),
                },
            })

        corrob = None
        if spec["corrob"]:
            corrob = {"source": a["sensor"], "type": "sensor/instrumental",
                      "detail": a["real"], "strength": spec["corrob"]}
        clusters.append({
            "cluster_id": spec["cluster_id"], "anchor_event": spec["anchor"],
            "anchor_is_real": a["real"], "hazard": a["hazard"],
            "true_place": spec["place"], "true_issue_type": spec["issue"],
            "expected_band": spec["band"], "false_kind": spec["false_kind"],
            "record_count": len(ids), "independent_originators": len(set(keys)),
            "authoritative_corroboration": corrob,
            "confounder": a.get("confounder"), "record_ids": ids,
        })

    from collections import Counter
    print(f"\n{len(records)} records across {len(clusters)} clusters")
    print("band mix:", dict(Counter(c["expected_band"] for c in clusters)))
    print("false kinds:", dict(Counter(c["false_kind"] for c in clusters if c["false_kind"])))
    print("records in FALSE clusters:",
          sum(c["record_count"] for c in clusters if c["expected_band"] == "FALSE"))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "synthetic": True, "model": MODEL,
        "channel": "Facebook community groups (SIMULATED — no Facebook data was collected)",
        "warning": "SYNTHETIC CONTENT anchored to REAL events. Post text is generated, "
                   "not harvested. Must be labelled as simulated wherever displayed. "
                   "Anchor events, GeoNet ids and telemetry values are real.",
        "scoring_note": "Confidence must be driven by independent_originators (NOT "
                        "record_count), authoritative_corroboration, location specificity "
                        "and internal consistency. Relay clusters exist to punish "
                        "record-counting.",
        "clusters": clusters, "records": records,
    }, open(OUT, "w"), indent=1)
    print(f"\n-> {OUT}")


if __name__ == "__main__":
    main()
