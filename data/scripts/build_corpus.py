"""Build an ANALYSABLE corpus for emerging-impact detection with confidence scoring.

The design constraint that drives everything here: a confidence score can only be
demonstrated if the corpus contains impacts at DIFFERENT confidence levels. A
dataset where every event is well-corroborated makes the score a constant.

So the corpus is organised as CLUSTERS. Each cluster is one candidate impact,
carrying ground truth for what it really is and what band a correct scorer should
land it in:

  HIGH    several INDEPENDENT originators + authoritative corroboration
  MEDIUM  several independent social reports, consistent, nothing official yet
  LOW     one or two vague reports, no corroboration
  FALSE   looks like signal, isn't — the four traps below

The four traps are drawn from real patterns measured in live Wellington data
on 2026-08-08, not invented:

  relay inflation  one NZTA feed echoed by a bot, 15 of 40 posts in #wellington
  misattribution   real shaking blamed on the wrong quake (Te Araroa vs Porirua)
  keyword decoy    an obituary matching "smoke"; a weather grumble matching "wind"
  contradiction    "crazy that we felt that" vs "practically no one felt that"

Anchor events are REAL (GeoNet ids, measured river flow). The post text is
written, not harvested — every record is marked synthetic: true.
"""

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone

# ─── real anchor events ───────────────────────────────────────────────────────
# Measured values. Sources: GeoNet WFS (GNS Science); Greater Wellington Hilltop
# telemetry, Hutt River at Taita Gorge, median flow 15.2 m3/s.
ANCHORS = {
    "quake-2026-08-02": {
        "hazard": "earthquake", "at": "2026-08-02T20:36:21+12:00",
        "real": "GeoNet 2026p576644 — M5.2, MMI 5, 15km NW of Porirua",
        "corroboration": {"source": "GeoNet", "type": "instrumental",
                          "detail": "M5.2 MMI 5 confirmed, 2026p576644", "strength": "strong"},
        "confounder": "GeoNet 2026p576643 — M5.7 MMI 6 at Te Araroa, 54 seconds earlier",
    },
    "quake-2025-11-06": {
        "hazard": "earthquake", "at": "2025-11-06T21:09:54+13:00",
        "real": "GeoNet 2025p836054 — M4.9, depth 22km, 27km from CBD",
        "corroboration": {"source": "GeoNet", "type": "instrumental",
                          "detail": "M4.9 confirmed, 2025p836054", "strength": "strong"},
    },
    "flood-2026-04-18": {
        "hazard": "flood", "at": "2026-04-18T09:25:00+12:00",
        "real": "Hilltop — Hutt River at Taita Gorge peaked 475 m3/s (~31x median)",
        "corroboration": {"source": "GW Hilltop telemetry", "type": "sensor",
                          "detail": "flow 475 m3/s, 31x median", "strength": "strong"},
    },
    "flood-2026-06-26": {
        "hazard": "flood", "at": "2026-06-26T17:10:00+12:00",
        "real": "Hilltop — Hutt River at Taita Gorge peaked 346 m3/s",
        "corroboration": {"source": "GW Hilltop telemetry", "type": "sensor",
                          "detail": "flow 346 m3/s, 23x median", "strength": "moderate"},
    },
}

# ─── media ────────────────────────────────────────────────────────────────────
# Attached media is a CONFIDENCE SIGNAL IN BOTH DIRECTIONS. A photo raises
# credibility — and is also the most common vector for false corroboration:
#
#   recycled       real photo, real flood, WRONG EVENT (last year's). The single
#                  most common misinformation pattern in real disasters.
#   wrong_place    real photo of a real incident somewhere else entirely
#   screenshot     a photo OF ANOTHER POST — relay inflation in image form
#   dark/unclear   genuine but too poor to verify anything from
#   authentic      what it claims to be
#
# `media_truth` is ground truth for scoring an image-verification step. It must
# be stripped before display, exactly like the text-level truth block.
def media(kind, mid, *, caption, verdict, note, dur=None, w=1170, h=2080):
    m = {
        "type": kind,                      # image | video
        "media_id": mid,
        "url": f"media/{mid}.{'mp4' if kind == 'video' else 'jpg'}",
        "placeholder": f"media/{mid}.svg",  # generated, safe to render
        "caption": caption,
        "width": w, "height": h,
        "exif_present": verdict == "authentic",
        "media_truth": {"verdict": verdict, "note": note},
    }
    if dur:
        m["duration_seconds"] = dur
    return m


R = "Reddit r/Wellington"
M = "mastodon.nz"
C = "Community report"
N_RNZ, N_SCOOP = "RNZ", "Wellington.Scoop"
BOT = "journeysbot (NZTA relay)"

# ─── the clusters ─────────────────────────────────────────────────────────────
# (publisher, minutes_after_event, text, media_or_None)
#
# Text is deliberately MESSY, because real public information is: no capitals,
# typos and autocorrect damage, emoji, te reo mixed in, half-finished sentences,
# ALL-CAPS, thread replies that make no sense alone, edits, and crossposts.
# Clean prose would make extraction look far easier than it is.
CLUSTERS = [
 {
  "cluster_id": "c01-taita-flood-major",
  "anchor": "flood-2026-04-18", "place": "Taita", "issue": "surface_flooding",
  "expected_band": "HIGH",
  "why": "5 distinct originators incl. two newsrooms, consistent location, sensor "
         "corroboration at 31x median flow. One attached photo is authentic.",
  "posts": [
    (R, 12, "anyone else on taita dr?? waters come up over the kerb in the last half hr, never seen it come up this fast", None),
    (R, 34, "yep confirmed bottom of taita dr is underwater. car stalled in it, driver got out ok\n\nEDIT: cops here now, theyre turning ppl around",
     media("image", "img_taita_01", caption="", verdict="authentic",
           note="Genuine, taken at the location and time claimed. EXIF intact.")),
    (C, 41, "Water across the road at the Taita end, about ankle deep and rising. Two cars turned back while I watched.", None),
    (M, 55, "taita flooding is genuinely bad this time, the awa is ROARING. stay off the low roads whānau 🌊 #wellington #huttvalley", None),
    (N_SCOOP, 88, "Flooding closes low-lying Taita streets as Hutt River peaks", None),
    (N_RNZ, 132, "Hutt Valley flooding: residents leave low-lying homes as river nears record", None),
  ],
 },
 {
  "cluster_id": "c02-petone-road-medium",
  "anchor": "flood-2026-06-26", "place": "Petone", "issue": "road_closure",
  "expected_band": "MEDIUM",
  "why": "3 independent social originators agreeing on location. No official "
         "confirmation, weak sensor support, and nobody is sure it is actually closed.",
  "posts": [
    (R, 18, "is the esplanade shut?? turned around at the roundabout, couldnt tell if that was official or just ppl avoiding it", None),
    (C, 37, "Water over the road along the Esplanade. No cones out yet but nobody is getting through.", None),
    (M, 62, "petone esplanade looking impassable rn. not sure if closed officially or ppl just being sensible #wellington", None),
  ],
 },
 {
  "cluster_id": "c03-karori-slip-low",
  "anchor": "flood-2026-04-18", "place": "Karori", "issue": "slip",
  "expected_band": "LOW",
  "why": "Single originator, hedged, no corroboration, no second report. The case "
         "that must NOT be escalated — and note the poster themselves is unsure.",
  "posts": [
    (R, 96, "think theres maybe a slip up the top of karori rd? saw a council ute n some cones but couldnt see past. might be nothing", None),
  ],
 },
 {
  "cluster_id": "c04-unlocatable-power-low",
  "anchor": "flood-2026-04-18", "place": None, "issue": "power_outage",
  "expected_band": "LOW",
  "why": "Real impact, genuinely reported, ZERO recoverable location. Must surface "
         "as 'location unknown', never be silently dropped or guessed.",
  "posts": [
    (R, 44, "powers out at my place, anyone else?", None),
    (R, 51, "same", None),
    (R, 53, "^^ same here too, bout 20 min now", None),
    (M, 78, "no power no wifi sitting in the dark. classic 🕯️", None),
  ],
 },
 {
  "cluster_id": "c05-porirua-shaking-high",
  "anchor": "quake-2026-08-02", "place": "Porirua", "issue": "shaking_felt",
  "expected_band": "HIGH",
  "why": "Multiple independent first-hand reports + instrumental confirmation. "
         "Contains a genuine contradiction ('didn't feel a thing') that must NOT "
         "collapse the score — absence of feeling is not absence of quake.",
  "posts": [
    (R, 2, "earthquake?", None),
    (R, 3, "Heard it and felt a small shake in porirua", None),
    (R, 6, "DEFINITELY felt that one up here, short sharp jolt", None),
    (R, 9, "didnt feel a thing and im right in the middle of porirua lol", None),
    (M, 14, "sharp little jolt in porirua just now. cat unimpressed 🐱 #eqnz", None),
    (C, 22, "Felt a single sharp jolt, maybe two seconds. Nothing fell over.", None),
  ],
 },
 {
  "cluster_id": "c06-misattributed-quake-FALSE",
  "anchor": "quake-2026-08-02", "place": "Wellington CBD", "issue": "shaking_felt",
  "expected_band": "FALSE",
  "why": "TRAP — misattribution. The shaking is REAL; the cause named is wrong "
         "(Te Araroa M5.7, 54s earlier, 400km+ away). Trusting the crowd's stated "
         "cause attaches this to the wrong event entirely.",
  "posts": [
    (R, 11, "Strong earthquake occurred 10 km south of Te Araroa mag 5.7 — thatll be what we all just felt geonet.org.nz/quakes/2026p576643", None),
    (R, 16, "^ yep thats the one, big one up the east cape", None),
    (M, 24, "that shake in welly was the te araroa 5.7 apparently. long way to travel!! #eqnz", None),
  ],
 },
 {
  "cluster_id": "c07-relay-inflation-FALSE",
  "anchor": "flood-2026-06-26", "place": "Ngauranga", "issue": "road_closure",
  "expected_band": "FALSE",
  "why": "TRAP — relay inflation. Six records, ONE originator (NZTA via a bot). "
         "Counting records gives 6 witnesses; counting independence_key gives 1. "
         "The most important trap in the corpus.",
  "posts": [
    (BOT, 5,  "Road Hazard: SH1 Ngauranga Gorge. Due to surface flooding, road users are advised to expect delays. Last Updated: 26 Jun 2026 5:15pm #SH1 #Wellington", None),
    (BOT, 20, "Road Hazard: SH1 Ngauranga Gorge. Due to surface flooding, road users are advised to expect delays. Last Updated: 26 Jun 2026 5:30pm #SH1 #Wellington", None),
    (BOT, 35, "Road Hazard: SH1 Ngauranga Gorge. Due to surface flooding, road users are advised to expect delays. Last Updated: 26 Jun 2026 5:45pm #SH1 #Wellington", None),
    (BOT, 50, "Road Hazard: SH1 Ngauranga Gorge. Due to surface flooding, road users are advised to expect delays. Last Updated: 26 Jun 2026 6:00pm #SH1 #Wellington", None),
    (BOT, 65, "Road Hazard: SH1 Ngauranga Gorge. Due to surface flooding, road users are advised to expect delays. Last Updated: 26 Jun 2026 6:15pm #SH1 #Wellington", None),
    (BOT, 80, "Road Hazard: SH1 Ngauranga Gorge. Due to surface flooding, road users are advised to expect delays. Last Updated: 26 Jun 2026 6:30pm #SH1 #Wellington", None),
  ],
 },
 {
  "cluster_id": "c08-keyword-decoy-FALSE",
  "anchor": "flood-2026-04-18", "place": None, "issue": None,
  "expected_band": "FALSE",
  "why": "TRAP — keyword decoy. Each trips a hazard keyword (smoke/flood/wind/"
         "power/water) while describing nothing operational. Measured false-positive "
         "pattern from the real 2026-08-08 harvest.",
  "posts": [
    (R, 25, "that smoke smell down cuba st is just the new bbq place i reckon 😂", None),
    (R, 47, "winds absolutely HOWLING again. standard welly saturday", None),
    (M, 63, "RIP to a legend of the local music scene, gone too soon. the city is flooded with tributes today 💔", None),
    (R, 91, "water pressure has been rubbish since we moved in, is that normal here??", None),
    (R, 120, "my flatmate has the power to sleep thru literally anything", None),
  ],
 },
 {
  "cluster_id": "c09-johnsonville-damage-medium",
  "anchor": "quake-2025-11-06", "place": "Johnsonville", "issue": "structural_damage",
  "expected_band": "MEDIUM",
  "why": "Two independent originators, specific consistent damage, quake "
         "instrumentally confirmed — but the DAMAGE itself is uncorroborated. "
         "Photo is genuine but too dark to verify anything from.",
  "posts": [
    (R, 31, "bricks off a chimney on broderick rd, theyve taped it off. nobody hurt afaik",
     media("image", "img_jville_01", caption="", verdict="unclear",
           note="Genuine and correctly located, but shot at night and badly "
                "underexposed. Verifies almost nothing. Raises confidence less "
                "than an analyst assumes it does.")),
    (C, 58, "Chimney damage visible on Broderick Rd, debris on the footpath. Council notified.", None),
  ],
 },
 {
  "cluster_id": "c10-ambiguous-northland-medium",
  "anchor": "flood-2026-04-18", "place": "Northland", "issue": "slip",
  "expected_band": "MEDIUM",
  "why": "TRAP — place ambiguity. 'Northland' is both a Wellington suburb and a "
         "region 700km north. Two real reports; a naive geocoder sends this to "
         "the wrong end of the country.",
  "posts": [
    (R, 40, "slip has come down in northland, roads partly blocked", None),
    (M, 71, "heads up, material across the road in northland after all this rain. take it slow", None),
  ],
 },
 # ─── media-specific traps ────────────────────────────────────────────────────
 {
  "cluster_id": "c11-recycled-photo-FALSE",
  "anchor": "flood-2026-06-26", "place": "Lower Hutt", "issue": "surface_flooding",
  "expected_band": "FALSE",
  "why": "TRAP — recycled media. THE most common real disaster misinformation "
         "pattern: a genuine photo of a genuine flood, from a DIFFERENT EVENT "
         "(April, two months earlier). Text is sincere; the poster is not lying, "
         "they are mistaken. Image verification is the only thing that catches it.",
  "posts": [
    (R, 15, "this is lower hutt right now, absolutely munted 😳",
     media("image", "img_recycled_01", caption="", verdict="recycled",
           note="REAL flood photo, REAL Lower Hutt — but from the 18 Apr 2026 "
                "event, not this one. EXIF stripped. Reverse image search would "
                "catch it; a caption-trusting pipeline will not.")),
    (R, 29, "jeez thats bad. stay safe out there", None),
    (M, 44, "sharing this from reddit, lower hutt is under water right now 😢",
     media("image", "img_recycled_01", caption="", verdict="recycled",
           note="SAME image re-shared to a second platform. Naive clustering "
                "reads this as two independent photographic witnesses. It is one "
                "image, from the wrong event, seen twice.")),
  ],
 },
 {
  "cluster_id": "c12-video-wrong-city-FALSE",
  "anchor": "flood-2026-04-18", "place": "Wellington CBD", "issue": "surface_flooding",
  "expected_band": "FALSE",
  "why": "TRAP — wrong location entirely. Real, dramatic, recent flood video "
         "from another NZ city, captioned as Wellington. High engagement makes it "
         "look like strong signal; engagement is not evidence.",
  "posts": [
    (M, 33, "WELLINGTON RIGHT NOW 😱😱 this is insane",
     media("video", "vid_wrongcity_01", caption="", verdict="wrong_place", dur=24,
           note="Genuine flood footage, but filmed in Christchurch. No Wellington "
                "landmark visible. Caption asserts a location the footage does "
                "not support.")),
    (R, 48, "is this actually welly?? doesnt look like anywhere i recognise", None),
    (R, 52, "pretty sure thats chch, ive seen this before", None),
  ],
 },
 {
  "cluster_id": "c13-screenshot-relay-FALSE",
  "anchor": "quake-2026-08-02", "place": "Porirua", "issue": "shaking_felt",
  "expected_band": "FALSE",
  "why": "TRAP — screenshot relay. A photo OF ANOTHER POST. Looks like media-backed "
         "corroboration; is actually the same claim from c05 laundered through an "
         "image. Relay inflation in visual form.",
  "posts": [
    (M, 40, "seeing reports of shaking in porirua, screenshot below",
     media("image", "img_screenshot_01", caption="", verdict="screenshot",
           note="Screenshot of the c05 Reddit thread. Contains no new information "
                "and is NOT an independent witness — it restates records already "
                "counted in c05.")),
  ],
 },
]


TIERS = {R: "social", M: "social", C: "social", BOT: "social",
         N_RNZ: "news", N_SCOOP: "news"}

# ─── source reliability register ──────────────────────────────────────────────
# What the UI shows next to each post. These are PROPERTIES OF THE CHANNEL, not
# of the individual claim — a reliable channel still carries false claims, and
# that distinction is the honest version of "source reliability".
SOURCE_RELIABILITY = {
    R: {"tier": "social", "reliability": "low", "editorial_control": "none",
        "identity_verified": False, "is_relay": False, "typical_latency_min": 5,
        "note": "Fast and hyperlocal. Unverified first-person claims; strong on "
                "'something is happening', weak on what and exactly where."},
    M: {"tier": "social", "reliability": "low", "editorial_control": "none",
        "identity_verified": False, "is_relay": False, "typical_latency_min": 10,
        "note": "As Reddit, smaller volume. Watch for bot relays inflating counts."},
    C: {"tier": "social", "reliability": "medium", "editorial_control": "none",
        "identity_verified": False, "is_relay": False, "typical_latency_min": 15,
        "note": "Structured community report — usually more specific about "
                "location than open social, still unverified."},
    BOT: {"tier": "social", "reliability": "medium", "editorial_control": "automated",
          "identity_verified": True, "is_relay": True, "typical_latency_min": 5,
          "note": "RELAY. Restates NZTA Journeys. Content is authoritative but "
                  "this is NOT an independent witness — never count it as one."},
    N_SCOOP: {"tier": "news", "reliability": "medium-high", "editorial_control": "editorial",
              "identity_verified": True, "is_relay": False, "typical_latency_min": 60,
              "note": "Hyperlocal newsroom. Names streets. Slower than social."},
    N_RNZ: {"tier": "news", "reliability": "high", "editorial_control": "editorial",
            "identity_verified": True, "is_relay": False, "typical_latency_min": 120,
            "note": "National newsroom, attributes claims. Slowest; by the time "
                    "RNZ runs it, it is rarely still 'emerging'."},
}

# ─── per-cluster corroboration ────────────────────────────────────────────────
# CRITICAL: corroboration attaches to the CLAIM, not the anchor event. A real
# flood does not corroborate an unrelated chimney, and it certainly does not
# corroborate a joke about a flatmate. Inheriting it from the anchor scored pure
# noise as "strong" — the bug this table replaces.
CLUSTER_CORROBORATION = {
    "c01-taita-flood-major": {"source": "GW Hilltop telemetry", "type": "sensor",
        "detail": "Hutt River at Taita Gorge 475 m3/s, 31x median — flooding physically consistent",
        "strength": "strong"},
    "c02-petone-road-medium": {"source": "GW Hilltop telemetry", "type": "sensor",
        "detail": "Elevated flow (346 m3/s) makes flooding plausible; the CLOSURE itself is unconfirmed",
        "strength": "weak"},
    "c03-karori-slip-low": None,
    "c04-unlocatable-power-low": None,
    "c05-porirua-shaking-high": {"source": "GeoNet", "type": "instrumental",
        "detail": "M5.2 MMI 5 confirmed at 15km NW of Porirua (2026p576644)",
        "strength": "strong"},
    "c06-misattributed-quake-FALSE": {"source": "GeoNet", "type": "instrumental",
        "detail": "Shaking IS confirmed — but by 2026p576644 (Porirua M5.2), NOT the "
                  "Te Araroa event these posts name. Corroborates the impact, refutes the cause",
        "strength": "contradicts-stated-cause"},
    "c07-relay-inflation-FALSE": {"source": "NZTA Journeys", "type": "official-relay",
        "detail": "Single authoritative origin. Real hazard, but 6 records = 1 witness",
        "strength": "single-origin"},
    "c08-keyword-decoy-FALSE": None,
    "c09-johnsonville-damage-medium": {"source": "GeoNet", "type": "instrumental",
        "detail": "Quake confirmed (M4.9, 2025p836054). The chimney DAMAGE is uncorroborated",
        "strength": "partial"},
    "c10-ambiguous-northland-medium": {"source": "GW Hilltop telemetry", "type": "sensor",
        "detail": "Heavy rain consistent with slips; cannot disambiguate Northland suburb vs region",
        "strength": "weak"},
    "c11-recycled-photo-FALSE": {"source": "image provenance", "type": "media-forensic",
        "detail": "Photo matches the 18 Apr 2026 event, not this one. EXIF stripped. "
                  "Same image appears on two platforms — one image, not two witnesses",
        "strength": "refuted-by-media"},
    "c12-video-wrong-city-FALSE": {"source": "image provenance", "type": "media-forensic",
        "detail": "Footage is genuine but filmed in Christchurch; no Wellington landmark "
                  "visible. Two commenters independently dispute the location",
        "strength": "refuted-by-media"},
    "c13-screenshot-relay-FALSE": {"source": "image provenance", "type": "media-forensic",
        "detail": "Screenshot of the c05 thread. Restates records already counted; "
                  "contributes zero independent evidence",
        "strength": "single-origin"},
}


def build():
    records, clusters = [], []
    for cl in CLUSTERS:
        a = ANCHORS[cl["anchor"]]
        t0 = datetime.fromisoformat(a["at"])
        ids = []
        for pub, mins, text, med in cl["posts"]:
            when = t0 + timedelta(minutes=mins)
            relayed = "NZTA Journeys" if pub == BOT else None
            rid = "syn_" + hashlib.sha256(
                f"{cl['cluster_id']}:{text}".encode()).hexdigest()[:12]
            ids.append(rid)
            records.append({
                "id": rid,
                "source_id": pub.lower().replace(" ", "-").replace("/", "-"),
                "tier": "synthetic",
                "simulated_tier": TIERS[pub],
                "publisher": pub,
                "url": None,
                "published_at": when.isoformat(),
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "title": None,
                "text": text,
                "author": None,
                "synthetic": True,
                "relayed_from": relayed,
                # what counts as ONE witness — the key corroboration input
                "independence_key": (f"origin:{relayed}" if relayed
                                     else f"publisher:{pub}"),
                "content_fingerprint": hashlib.sha256(
                    re.sub(r"[^a-z]", "", text.lower())[:120].encode()).hexdigest()[:12],
                "media": med,
                "has_media": med is not None,
                "truth": {
                    "cluster_id": cl["cluster_id"],
                    "media_verdict": (med or {}).get("media_truth", {}).get("verdict"),
                    "event_id": cl["anchor"],
                    "true_place": cl["place"],
                    "true_issue_type": cl["issue"],
                    "is_true_signal": cl["expected_band"] != "FALSE",
                    "locatable": cl["place"] is not None,
                },
            })

        indep = len({r["independence_key"] for r in records if r["id"] in ids})
        clusters.append({
            "cluster_id": cl["cluster_id"],
            "anchor_event": cl["anchor"],
            "anchor_is_real": a["real"],
            "hazard": a["hazard"],
            "true_place": cl["place"],
            "true_issue_type": cl["issue"],
            "expected_band": cl["expected_band"],
            "why": cl["why"],
            "record_count": len(ids),
            "independent_originators": indep,
            # per-CLAIM, not inherited from the anchor event
            "authoritative_corroboration": CLUSTER_CORROBORATION[cl["cluster_id"]],
            "confounder": a.get("confounder"),
            "record_ids": ids,
        })

    records.sort(key=lambda r: r["published_at"])
    return records, clusters


def main():
    records, clusters = build()
    from collections import Counter
    bands = Counter(c["expected_band"] for c in clusters)

    print(f"{len(records)} records across {len(clusters)} clusters\n")
    print(f"{'cluster':<32}{'band':<8}{'recs':>5}{'indep':>7}  corroboration")
    print("-" * 88)
    for c in clusters:
        corr = (c["authoritative_corroboration"] or {}).get("strength", "none")
        print(f"{c['cluster_id']:<32}{c['expected_band']:<8}"
              f"{c['record_count']:>5}{c['independent_originators']:>7}  {corr}")
    print(f"\nband mix: {dict(bands)}")
    print(f"records in FALSE clusters: "
          f"{sum(c['record_count'] for c in clusters if c['expected_band']=='FALSE')}"
          f" / {len(records)}")

    json.dump({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "synthetic": True,
        "warning": "SYNTHETIC CONTENT anchored to REAL events. Post text is written, "
                   "not harvested. Must be labelled as simulated wherever displayed. "
                   "Anchor events, GeoNet ids and telemetry values are real.",
        "scoring_note": "Confidence should be driven by independent_originators (NOT "
                        "record_count), authoritative_corroboration, location "
                        "specificity, and internal consistency. Cluster c07 exists "
                        "specifically to punish record-counting.",
        "source_reliability": SOURCE_RELIABILITY,
        "clusters": clusters,
        "records": records,
    }, open("corpus-labelled.json", "w"), indent=1)
    print("\n-> corpus-labelled.json")


if __name__ == "__main__":
    main()
