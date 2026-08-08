# The four-minute demo

Judging, 16:30. Every number below was read off the live system, not estimated.
If you change the data, re-read them before you speak — a demo about
trustworthiness cannot cite a figure it has not checked.

---

## Before you stand up

```bash
npm run dev                                       # one only — Next allows one per project
```

Then, **in this order**:

```bash
# 1. the source registry (grades come out F for everything without it)
curl -s -X POST -H 'content-type: application/json' -d '{"json":{}}' \
  http://localhost:3000/api/trpc/sources.seed

# 2. the demo story — 39 items through the real ingest, then named and projected
npm run demo:plumb -- --http
```

Open **`http://localhost:3000/board?dataset=demo`** and leave it there.

Check before you speak:

- the map shows **13 pins**, none of them stacked at 0,0;
- the biggest pin (Aro Valley) reads **14 / 21**;
- the header says **Demo**, not Live.

If any of those is wrong, re-run step 2. If the board is empty, the database was
truncated — run `npm run verify` first, then step 1, then step 2.

> **Do not run `npm run verify` after plumbing.** It truncates every table. It is
> the proof, not the demo, and it wipes the demo dataset.

**Have a second tab open** on `http://localhost:3000/board?dataset=live` in case
somebody asks to see it against the fixture set.

---

## The script

The spoken lines below run to 526 words — about four minutes flat at a
comfortable pace, which leaves no room for adjectives and just enough for the
numbers.
Timings are cumulative. If you are behind at 3:00, drop the Galaxy beat: it is
the only one that is not load-bearing.

### 0:00 — the problem, in the duty officer's words (20s)

> Council is blind for the first zero to three hours of an incident — the window
> where the biggest decisions get made. A duty officer told us *"we don't use
> social media at all… we don't trust social media"*, then described checking it
> anyway and thinking *"I'm seeing five reports versus one."*
>
> Counting corroboration by hand, with no way to defend it or record it. That is
> the gap.

### 0:20 — the board (30s)

*Point at the map.*

> Thirty-nine public items — posts, community reports, a newsroom, official
> feeds — became **thirteen candidate events**. Nothing here is presented as
> verified: every pin carries a grade and the reasons behind it.

### 0:50 — the core: witnesses, not documents (60s)

*Click the Aro Valley pin. Let the drill panel open.*

> This one has **twenty-one items** behind it. It has **fourteen witnesses**.
>
> Seven of those twenty-one are one observation. One person posted that Aro
> Street was under water; others quoted their link or re-posted the wording, and
> a news site picked it up. All seven collapsed into a single origin — and it
> tells you why.

*The panel says it under the figures — **"21 items trace back to 14 distinct
observations"** — and every echoed item in the provenance list below carries a
**SAME ORIGIN AS ANOTHER ITEM** badge. Point at those, and say the rule in your
own voice; the rule itself is not printed on screen:*

> The rule is: a repost is not a second witness. Two more items collapsed
> because they came from the same author — one prolific person cannot
> manufacture corroboration.
>
> If we printed twenty-one we would be reporting an echo as evidence, and
> "twenty-one independent reports" is precisely the sentence that makes somebody
> send a truck.

### 1:50 — who is speaking (35s)

*Point at the grade: A3.*

> Reliability comes from a registry, not from code. Fire and Emergency's media
> feed is registered A — the agency speaking about its own callouts. Their
> **scanner** feed deliberately is not: that is somebody listening to radio
> traffic and relaying what they think they heard.
>
> And because one official source in a crowd would otherwise read as a clean
> bill of health, the reason says so:

*Read verbatim:*

> *"this axis reports the best source, not the crowd — 5 of the 8 contributing
> sources are unregistered and grade F on their own."*

### 2:25 — the weak signal is still on the map (35s)

*Click any single-pin cluster — Vogeltown power outage, or Wadestown Road.*

> Nine of the thirteen are a single source. This grades **F4 — reliability
> cannot be judged, doubtful**. It is still on the map, and it still alerted.
>
*Point at the two facts sitting together: the grade chip reads F4, and
**Alert-worthy: yes**.*

> Those two are computed separately, and that is the design. In hour zero there
> are no independent origins yet, so the first report of anything grades badly —
> and a grade threshold would go silent in exactly the hour Council is most
> blind. So we ask a different question: is there somewhere to send someone, and
> is anything authoritative saying it did not happen?
>
> The alert carries its own weakness in writing. We never hide a weak signal —
> we label it.

### 3:00 — the same signals, arranged by meaning (25s)

*Switch the view toggle to Galaxy.*

> Same events, arranged by what was said rather than where — for spotting that
> two things reported in different suburbs are the same problem.

*Switch back to Map before you finish.*

### 3:25 — close on what the machine cannot say (35s)

> Two grades here are unreachable, both deliberately.
>
> **Credibility 2**, "probably true", needs an authoritative layer to agree. We
> have not wired the river gauges, so nothing reaches it — and every reason says
> *"no applicable layer — nothing has confirmed or denied this"* rather than
> implying agreement.
>
> **Credibility 1**, "confirmed", is unreachable by design: the grading module
> throws rather than write it. Confirmation is a human's word.
>
> The machine's job ends at *this is worth someone looking at, and here is
> exactly why* — the thing Council said it could not do by hand.

> **If the drill panel gains a collapse-reasons list before 16:30** (asked of
> present-builder, not committed as of writing), the 0:50 beat gets sharper:
> read the reason verbatim off the screen instead of narrating it — *"quotes
> social.example.nz/aro_local/status/1188455 — a repost is not a second
> witness."* Check the panel before you rely on it. Everything else in the
> script is on screen today; this is the one line that is not.

---

## If something breaks

| What | Do this |
|---|---|
| Galaxy view stutters or renders black | Stay on Map. Say "the geographic view is the one that matters operationally" and move on. It is a 3D canvas; it is not the argument. |
| A pin will not open | Click a different one. The Aro Valley cluster is the only *scripted* one — Kelburn AWS (4/4) also shows a collapse-free multi-source event. |
| Board is empty | The database was truncated. `npm run demo:plumb -- --http` takes about 20 seconds. Keep talking about the problem statement while it runs. |
| Grades all read F | The registry was not seeded. Run the `sources.seed` curl above, then re-plumb. |
| Someone asks for the live picture | Second tab: `?dataset=live` — 26 items, 4 clusters, from `scripts/fixtures.json`. |
| Asked to prove it | `npm run proof:grading` — 56 assertions, no database, under a second. `npm run verify` — 66 end to end, but it truncates, so only after the demo. |

---

## Limits — say these before you are asked

Volunteering these is the demo. The problem statement is explicitly about making
limitations visible, and a system that hides its own would fail its own test.

- **This is synthetic data.** Every item in the demo dataset is authored and
  flagged `synthetic` in the API, carried through to every provenance entry. The
  dataset switch says "Demo" for the same reason. We are demonstrating the
  reasoning, not claiming a real incident.
- **No live collectors.** Items arrive by drop-folder or by POST. Anyone's
  collector can send us anything today (INTEGRATION.md); we did not build
  scrapers, and Reddit/RNZ ingestion is not wired.
- **Embeddings are a lexical stub** unless `AI_GATEWAY_API_KEY` is set. Grouping
  is by shared words rather than meaning, so "inundation" will not match
  "flooding". Origin fingerprinting is unaffected — it requires shared *wording*
  to collapse anything, deliberately, so two witnesses describing one event in
  different words stay two witnesses.
- **No hazard cross-check.** No river gauge or susceptibility layer is consulted.
  Recorded honestly everywhere as `no_applicable_layer`.
- **Hazard-planning data, not an operational source.** In an emergency, 111.

### The question a sharp judge will ask

Somebody will click **"dam_failure — Karori Road"** and find a rumour that the
Karori reservoir has been breached sitting in the same cluster as a Greater
Wellington gauge reading saying the stream is at 0.42 m, within normal range —
graded A3, "possibly true". **That is a real limitation and you should say so
plainly:**

> Good catch. The gauge is in there as a third *origin*, not as a *contradiction*
> — because the cross-check is not wired. The rule for it is built and tested:
> evidence contradicted by telemetry grades 5, "improbable", and does not raise
> an alert. What is missing is the lookup between a claim and the layer that
> could refute it. That is the first thing we would build next, and it is the
> difference between counting sources and actually checking them.

Do not claim the system caught the rumour. It did not.
