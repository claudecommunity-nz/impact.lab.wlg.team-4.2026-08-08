"""Download the real media attachments referenced by the Mastodon feed.

These are real images and video from real public posts. They are NOT ours:
each belongs to whoever posted it, under whatever licence they chose. So the
download directory is gitignored by default — fetch locally for the demo, do
not commit other people's photos into a public repo.

Run it and the feed gains a `media_local` path per attachment; skip it and the
feed still works off the remote URLs.

    python3 data/scripts/fetch_media.py            # -> data/media/mastodon/
    python3 data/scripts/fetch_media.py --limit 40
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..")
DEST = os.path.join(DATA, "media", "mastodon")
FEED = os.path.join(DATA, "feeds", "mastodon.json")
UA = "wcc-impact-lab/0.1 (Wellington Impact Lab hackathon prototype)"

LIMIT = None
if "--limit" in sys.argv:
    LIMIT = int(sys.argv[sys.argv.index("--limit") + 1])


def ext_of(url):
    tail = url.rsplit("/", 1)[-1].split("?")[0]
    e = tail.rsplit(".", 1)[-1].lower() if "." in tail else ""
    return e if e in ("jpg", "jpeg", "png", "gif", "webp", "mp4", "mov") else "bin"


def fetch(job):
    idx, post_id, url = job
    name = f"{post_id}_{idx}.{ext_of(url)}"
    path = os.path.join(DEST, name)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return url, name, "cached"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
        if not body:
            return url, None, "empty"
        with open(path, "wb") as f:
            f.write(body)
        return url, name, f"{len(body)//1024}KB"
    except urllib.error.HTTPError as e:
        return url, None, f"HTTP {e.code}"
    except Exception as e:
        return url, None, type(e).__name__


def main():
    os.makedirs(DEST, exist_ok=True)
    d = json.load(open(FEED))
    posts = d["posts"]

    jobs = []
    for p in posts:
        for i, url in enumerate(p.get("media") or []):
            jobs.append((i, p["id"], url))
    if LIMIT:
        jobs = jobs[:LIMIT]
    print(f"{len(jobs)} attachments to fetch -> {DEST}")

    results = {}
    ok = fail = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for url, name, status in pool.map(fetch, jobs):
            if name:
                results[url] = name
                ok += 1
            else:
                fail += 1
            if (ok + fail) % 40 == 0:
                print(f"  {ok + fail}/{len(jobs)}  ok={ok} failed={fail}")

    # write local paths back into the feed
    for p in posts:
        urls = p.get("media") or []
        local = [results.get(u) for u in urls]
        if any(local):
            p["media_local"] = [f"../media/mastodon/{n}" if n else None for n in local]
    json.dump(d, open(FEED, "w"), indent=1)

    total = sum(os.path.getsize(os.path.join(DEST, f)) for f in os.listdir(DEST))
    print(f"\n{ok} downloaded, {fail} failed  ({total // 1024 // 1024} MB)")
    print(f"feed updated with media_local paths -> {FEED}")


if __name__ == "__main__":
    main()
