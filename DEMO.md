# The four-minute demo

Judging, 16:30. Every number below was read off the live system, not estimated.
If you change the data, re-read them before you speak — a demo about
trustworthiness cannot cite a figure it has not checked.

---

## Before you stand up

```bash
npm run dev                                       # one only — Next allows one per project
```

Then **THE CANONICAL REBUILD**, in this order. It is the only blessed sequence;
anything else is improvisation on the one thing we cannot re-derive live.

```bash
npm run seed:reset                  # wipe everything, re-seed the source registry
npm run signals:load                # the real collected signals (data/signals/latest.json)
npm run demo:plumb -- --http        # the authored story, with its capture clock
node scripts/drain-and-peek.mjs     # embed → cluster → name → project, then print
```

`seed:reset` re-seeds the registry itself, so there is no separate seed step —
and if the dev server is down it fails loudly rather than leaving you an empty
registry, which would grade every cluster F and look exactly like a working
board making a defensible judgement.

> ## The iron rule
>
> **Do not run `npm run verify` after the canonical rebuild.** It truncates every
> table. It is the proof, not the demo, and running it has cost this team its
> board state three times today — once silently, wiping 130 collected real
> signals that nobody noticed were gone until a re-load reported "created 130,
> deduped 0". Prove it BEFORE you rebuild, never after.

Open **`http://localhost:3000/board`** and leave it there. There is no dataset
parameter any more and no Live/Demo switch — **one board, one feed**. A stale
`?dataset=demo` link in anyone's history is silently ignored, so if somebody
hands you a URL, retype it.

**Open it and WAIT 40 SECONDS before judging it.** A cold `/board` in dev takes
about 35 seconds to fully paint, and an empty canvas at 20 seconds looks exactly
like a broken build. This has already caused one false alarm today. Open the tab
well before you are called up.

Check before you speak:

- the map shows **74 pins**, none of them stacked at 0,0;
- **flooding — Aro Valley** reads **9 / 16** and carries a **SYN** badge;
- most pins have **no** SYN badge — only 14 of the 74 carry authored content.

If any of those is wrong, run the canonical rebuild again. It is idempotent and
takes about two minutes.

> **Do not run `npm run verify` after plumbing.** It truncates every table. It is
> the proof, not the demo, and it wipes the demo dataset.

**The SYN badge matters and you should point at it unprompted.** Real collected
signals and authored demo items now sit in the same feed, because that is what
an operator's day actually looks like. Nothing hides which is which: `synthetic`
rides every provenance entry, and the badge is on the pin.

---

## The script

The spoken lines below run to 552 words — about four minutes flat at a
comfortable pace, which leaves no room for adjectives and just enough for the
numbers.
Timings are cumulative. If you are behind at 3:00, drop the Galaxy beat: it is
the only one that is not load-bearing.

### 0:00 — the problem, in the duty officer's words (20s)

> Council is blind for the first zero to three hours of an incident — when the
> biggest decisions get made. A duty officer told us *"we don't use social media
> at all… we don't trust social media"*, then described checking it anyway and
> thinking *"I'm seeing five reports versus one."* Counting corroboration by
> hand, with no way to defend it. That is the gap.

### 0:20 — the board (30s)

*Point at the map.*

> A hundred and sixty-nine public items — posts, fault reports, newsrooms,
> official feeds, instrument readings — became **seventy-four candidate
> events**. Nothing is presented as verified: every pin carries a grade and its
> reasons, and anything authored for this demo is badged SYN. Most are not.

### 0:50 — the core: witnesses, not documents (60s)

*Click **flooding — Aro Valley**. Let the drill panel open.*

> This one has **sixteen items** behind it. It has **nine witnesses**.
>
> Seven of those items are a single observation. One person posted that Aro
> Street was under water; others quoted their link or re-posted the wording, and
> a news site picked it up. All seven collapsed into one origin — and it tells
> you why.

*Scroll to **WHY THESE WERE COUNTED ONCE**. It lists only the collapsed
origins — on this cluster, exactly two rows. Read the first line of the first
row off the screen, word for word:*

> *"quotes social.example.nz/aro_local/status/1188455 — a repost is not a
> second witness."*

> If we printed sixteen we would be reporting an echo as evidence — and "sixteen
> independent reports" is exactly the sentence that makes somebody send a truck.
>
> And this is not a trick that only works on our own writing: the biggest
> cluster on this board is thirty-five real collected posts, and five of those
> are one observation too.

### 1:50 — who is speaking (35s)

*Point at the grade: A3.*

> Reliability comes from a registry. Fire and Emergency's media feed is
> registered A — the agency speaking about its own callouts. A **radio log**
> deliberately is not: that is somebody listening to emergency traffic and
> relaying what they think they heard. Same event, different standing.
>
> And because one official source in a crowd would read as a clean bill of
> health, the reason says so:

*Read verbatim:*

> *"this axis reports the best source, not the crowd — 5 of the 7 contributing
> sources are unregistered and grade F on their own."*

### 2:25 — the weak signal is still on the map (35s)

*Click a single-pin cluster. **Vogeltown power outage** is the one to use — its
alert carries the uncorroborated line word for word.*

> Fifty of the seventy-four are a single source. This grades **F4 — reliability
> cannot be judged, doubtful**. It is still on the map, and it still alerted.
>
*Point at the two facts sitting together: the grade chip reads F4, and
**Alert-worthy: yes**.*

> Those two are computed separately, and that is the design. In hour zero there
> are no independent origins yet, so the first report of anything grades badly,
> and a grade threshold would go silent in exactly the hour Council is most
> blind. So we ask a different question: is there somewhere to send someone, and
> is anything saying it did not happen?

*Then **WHY IT IS WORTH SOMEONE'S ATTENTION**, and read the amber line:*

> *"WEAK EVIDENCE: one independent origin behind 1 item — this is
> uncorroborated, and grades F4."*

> We never hide a weak signal. We label it.

### 3:00 — the same signals, arranged by meaning (25s)

*Switch the view toggle to Galaxy.*

> The same events, arranged by what was said rather than where — for spotting
> that two things reported in different suburbs are one problem.

*Switch back to Map before you finish.*

### 3:25 — close on what the machine cannot say (35s)

> Two grades here are unreachable, both deliberately.
>
> **Credibility 2**, "probably true", needs an authoritative layer to agree. We
> have not wired the river gauges, so nothing reaches it — every reason says
> *"no applicable layer — nothing has confirmed or denied this"* rather than
> implying agreement.
>
> **Credibility 1**, "confirmed", is unreachable by design: the grading module
> throws rather than write it. Confirmation is a human's word.
>
> The machine's job ends at *this is worth someone looking at, and here is
> exactly why* — the thing Council said it could not do by hand.

> **Every quoted line above is on screen** — checked in the running board, not
> read off the API. The two you read verbatim live in the drill panel sections
> **WHY THESE WERE COUNTED ONCE** and **WHY IT IS WORTH SOMEONE'S ATTENTION**.
> If either section is missing when you open the panel, the board is running an
> older build: narrate the line instead of reading it, and carry on.

---

## If something breaks

| What | Do this |
|---|---|
| Galaxy view stutters or renders black | Stay on Map. Say "the geographic view is the one that matters operationally" and move on. It is a 3D canvas; it is not the argument. |
| A pin will not open | Click a different one. Aro Valley is the only *scripted* pin — Kelburn AWS (4/4) and Karori Road (3/3) both open on rich multi-source clusters. |
| Board is empty | The database was truncated. `npm run demo:plumb -- --http` takes about 20 seconds. Keep talking about the problem statement while it runs. |
| Grades all read F | The registry was not seeded. Run the `sources.seed` curl above, then re-plumb. |
| Asked "is any of this real?" | Most of it. 60 of the 74 pins carry no authored content at all. Open any pin: `synthetic` is on every provenance entry and SYN is on the pin. Aro Valley is authored end to end; the 35-item Queens Drive cluster is almost entirely real. |
| Asked to prove it | `npm run proof:grading` — 56 assertions, no database, under a second. `npm run verify` — 66 end to end, but it truncates, so only after the demo. |

---

## Limits — say these before you are asked

Volunteering these is the demo. The problem statement is explicitly about making
limitations visible, and a system that hides its own would fail its own test.

- **The feed is part real, part authored, and the board says which.** Real
  collected signals and items written for this demo sit in one feed, because
  that is what an operator's day looks like. Every authored item carries
  `synthetic` on every provenance entry and puts a **SYN** badge on its pin.
  Only **14 of the 74** pins carry any authored content; the Aro Valley cluster
  is authored end to end. Say this before anyone asks: the storm is a
  demonstration, the collection and the reasoning are not.
- **The storm itself did not happen.** Wellington is not flooding this
  afternoon. The reasoning is real; the weather is not.
- **Embeddings are a lexical stub** unless `AI_GATEWAY_API_KEY` is set. Grouping
  is by shared words rather than meaning, so "inundation" will not match
  "flooding". Origin fingerprinting is unaffected — it requires shared *wording*
  to collapse anything, deliberately, so two witnesses describing one event in
  different words stay two witnesses.
- **No hazard cross-check.** No river gauge or susceptibility layer is consulted.
  Recorded honestly everywhere as `no_applicable_layer`.
- **Hazard-planning data, not an operational source.** In an emergency, 111.

### The question a sharp judge will ask

Somebody will click **"infrastructure — Karori Road"** and find a rumour that
the Karori reservoir has been breached sitting in the same cluster as a Greater
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
