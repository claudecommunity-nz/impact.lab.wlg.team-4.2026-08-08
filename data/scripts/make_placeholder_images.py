"""Generate placeholder images for the simulated Facebook posts that carry media.

Deliberately NOT photorealistic. Fabricated disaster photos of a real city are
precisely the artefact this project exists to detect — generating convincing
ones and putting them in a public repo would be indefensible, whatever the
intent. These are flat SVG cards, stamped with their own verification verdict
and the words SIMULATED — NOT A REAL PHOTO.

The verdict is the point: a UI can render these and still demonstrate image
provenance reasoning (authentic vs recycled vs wrong-place vs screenshot)
without anyone mistaking one for evidence.

    python3 data/scripts/make_placeholder_images.py   -> data/media/facebook/
"""

import json
import os
import random
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..")
DEST = os.path.join(DATA, "media", "facebook")
FEED = os.path.join(DATA, "feeds", "facebook.json")

rng = random.Random(20260808)

# verdict -> (fill, label, what a verifier should conclude)
VERDICTS = {
    "authentic":   ("#2f6f4f", "AUTHENTIC",
                    "Taken at the place and time claimed. EXIF intact."),
    "unclear":     ("#5a5a5a", "UNCLEAR",
                    "Genuine but too dark / blurred to verify anything from."),
    "recycled":    ("#8a5a2b", "RECYCLED",
                    "Real photo of a real event — but a DIFFERENT, earlier one."),
    "wrong_place": ("#8a2b2b", "WRONG PLACE",
                    "Genuine footage, filmed somewhere else entirely."),
    "screenshot":  ("#3a4a7a", "SCREENSHOT",
                    "A photo of another post. Not an independent witness."),
}

SUBJECTS = ["water over road", "flooded car park", "slip across lane",
            "queue at tanker", "downed tree", "cordon tape", "dark street",
            "cracked wall", "storm sky", "blocked drain"]


def svg(verdict, subject, place, when, kind):
    fill, label, note = VERDICTS[verdict]
    w, h = (600, 800) if kind == "image" else (640, 360)
    wrapped = []
    line = ""
    for word in note.split():
        if len(line) + len(word) > 42:
            wrapped.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    wrapped.append(line)
    notes = "".join(
        f'<text x="{w//2}" y="{h-84+i*20}" fill="#fff" fill-opacity=".85" '
        f'font-family="monospace" font-size="13" text-anchor="middle">{t}</text>'
        for i, t in enumerate(wrapped))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
<rect width="{w}" height="{h}" fill="{fill}"/>
<rect x="14" y="14" width="{w-28}" height="{h-28}" fill="none" stroke="#fff"
      stroke-opacity=".35" stroke-width="3" stroke-dasharray="10 8"/>
<text x="{w//2}" y="{h//2-56}" fill="#fff" font-family="monospace" font-size="15"
      text-anchor="middle" fill-opacity=".8">{kind.upper()} PLACEHOLDER</text>
<text x="{w//2}" y="{h//2-20}" fill="#fff" font-family="monospace" font-size="21"
      text-anchor="middle">{subject}</text>
<text x="{w//2}" y="{h//2+12}" fill="#fff" font-family="monospace" font-size="16"
      text-anchor="middle" fill-opacity=".85">{place} · {when}</text>
<text x="{w//2}" y="{h//2+56}" fill="#fff" font-family="monospace" font-size="22"
      text-anchor="middle" font-weight="bold">{label}</text>
{notes}
<text x="{w//2}" y="{h-28}" fill="#fff" font-family="monospace" font-size="14"
      text-anchor="middle" font-weight="bold">SIMULATED — NOT A REAL PHOTO</text>
</svg>'''


def main():
    os.makedirs(DEST, exist_ok=True)
    d = json.load(open(FEED))
    posts = d["posts"]

    made = 0
    for p in posts:
        if not p.get("has_media"):
            continue
        # a post that shares an image of somewhere else is the wrong-place case;
        # everything else gets a verdict weighted toward authentic.
        verdict = rng.choices(
            list(VERDICTS),
            weights=[52, 16, 12, 10, 10],
        )[0]
        kind = "video" if verdict == "wrong_place" and rng.random() < 0.4 else "image"
        place = (p["location"].get("best_guess") or "location not given")
        when = (p.get("posted_at") or "")[:10]
        subject = rng.choice(SUBJECTS)
        name = f"{p['id']}.svg"
        open(os.path.join(DEST, name), "w").write(
            svg(verdict, subject, place, when, kind))
        p["media"] = [{
            "type": kind,
            "file": f"../media/facebook/{name}",
            "verdict": verdict,
            "verdict_note": VERDICTS[verdict][2],
            "exif_present": verdict == "authentic",
        }]
        made += 1

    json.dump(d, open(FEED, "w"), indent=1)

    from collections import Counter
    verdicts = Counter(p["media"][0]["verdict"] for p in posts if p.get("media"))
    print(f"{made} placeholder images -> {DEST}")
    print("verdicts:", dict(verdicts))
    print(f"feed updated with media objects -> {FEED}")


if __name__ == "__main__":
    main()
