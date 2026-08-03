# Where does this engine actually stand on the live rungs?

Type: task (AFK)
Status: resolved (2026-08-03)
Blocked by: —

## Question

The strongest artifact in this repo has no ladder. `results/blocks.jsonl` records the classical eval at **skill 3 only** (b0021, 72.7%, n=64) plus one 16-game block against skill 4 *armed with the official NNUE* (b0037, 43.8% — the stretch bar, and n=16 gives an SE near 12 points). Every other rung on the clean ladder — 5, 8, 10, 20 — was measured with the **r3 net**, which two SPRT blocks in both directions have since established is the *weaker* artifact.

So the yardstick this map just chose (fairy skill 5–10) has never been applied to the engine the map is actually about. A target cannot be set relative to a baseline that does not exist.

**Measure it.** Classic vs native fairy classical eval at **skill 5, 8 and 10**, 64 games each, equal 100 ms / 100 ms, randomized openings (`--opening-plies 4`), recorded to `results/blocks.jsonl` by the arena itself.

Resolve with:

1. Where classic actually crosses 50%, and how far below it sits at each live rung.
2. How much of the net's recorded ladder was an artifact of testing the weaker artifact — i.e. does classic move skill 8 meaningfully off 15.6%, and does it put a dent in skill 10's 0–64–0?
3. Whether skill 10 is still a wall for the *stronger* artifact, or whether the wall was partly the net's.
4. A note on b0037: classic taking 43.8% off a **NNUE-armed** fairy at skill 4 sits oddly against the net's 34.4% at skill 5 vs *classical* fairy. Either the stretch bar is closer than the +248 Elo estimate implies, or n=16 is just noise. Say which, without spending another block on it unless the ladder makes it matter.

**Cost:** three 64-game blocks at concurrency 6 ≈ **10–12 min** foreground, brief and hot (~97 °C peak, never niced — movetime-bound engines starve into a corrupt result). Well inside the map's cheap half. The control-block trigger will fire preconditions automatically for first-block-at-a-rung; let it.

**Do not** interpret a rung against the net's number for the same rung without saying so — those blocks are a different artifact, not a baseline.

---

## Resolution (2026-08-03)

**The strongest artifact now has a ladder.** Three 64-game blocks, classic vs **native** fairy with its
classical eval, equal 100/100 ms, `--opening-plies 4`: `b0055`, `b0056`, `b0057`. ~11 min of arena.
No block tripped the trigger — the ladder is monotone and every rung and fingerprint was already
known, so no control was owed.

| rung | n | W–L–D | classic | ±2 SE |
|---|---|---|---|---|
| 3 (`b0021`, earlier) | 64 | 33–4–26 | 72.7% | ±7.7 |
| **5** (`b0055`) | 64 | 7–20–35 | **39.8%** | ±7.9 |
| **8** (`b0056`) | 64 | 2–36–24 | **23.4%** | ±7.0 |
| **10** (`b0057`) | 64 | 0–52–11 | **9.4%** | ±4.8 |

### 1. Where classic crosses 50%

**Nowhere on the live rungs. It crosses at about skill 4.4**, between 72.7% at skill 3 and 39.8% at
skill 5 — i.e. *below* the entire 5–10 window this map chose as its yardstick.

At the nearest live rung, skill 5, classic is **10.2 points short of even.** That is the number
[Set the target](07-set-the-target.md) has to work with, and it is the first time it has existed.

### 2. How much of the net's ladder was an artifact of testing the weaker artifact

Classic is ahead at every rung, and **the gap widens as the opponent gets harder**: +0.8 at skill 3,
+5.4 at 5, +7.8 at 8, +9.4 at 10.

**Stated honestly: at skill 5 and 8 those gaps sit inside the ±2 SE bands individually** (±7.9 and
±7.0 against gaps of 5.4 and 7.8), so neither rung alone separates the artifacts. What carries weight
is that the sign is consistent across all four rungs and that **skill 10 is unambiguous** — 9.4% ±4.8
against 0.0% ±0.5 is not a noise story.

### 3. Skill 10 is NOT a wall for the stronger artifact

This is the finding that changes the map. The net returned **0–64–0** at skill 10 and again at 20 —
the observation that made "skill 10, 15 and 20 are one indistinguishable wall" and killed the old
target. **Classic scores 9.4% there: 0 wins, but 11 draws where the net had none.**

So the wall was **partly the net's**. Skill 10 is a real rung for this engine — hard, and clearly
worse than skill 8, but not the flat zero it looked like. Whether skill 20 is also softer for classic
is untested and deliberately not spent on: 9.4% at skill 10 gives no reason to expect anything
survivable at 20.

### 4. The b0037 stretch bar: noise, and do not read it

`b0037` — classic taking **43.8%** off fairy skill 4 *armed with the official NNUE* — sits oddly
against classic's 39.8% at skill 5 vs classical fairy, since the official net is estimated at +248
Elo and should make skill 4+net far harder than skill 5 without it.

**It is noise.** n=16 gives **±17.9 pp**, a band running from 26% to 62%. It cannot distinguish "the
stretch bar is closer than the estimate implies" from "sixteen games." The ticket asked which,
without spending another block: **the latter, and the row should not be used as evidence for
anything.** If the ladder ever makes the NNUE-armed rung matter, it needs n=64 like the rest.

### What this hands forward

- **The target's arithmetic is now concrete**: reaching 50% at skill 5 — the *cheapest* live rung —
  needs about **+10 points of score** from the classical eval.
- **Read alongside [ticket 05](05-what-one-eval-term-is-worth.md), which resolved the same day**: the
  eval's strongest tuner-ranked candidate returned **−9 Elo at Gate A**, and its second died on free
  evidence. Nothing cheap has yet been shown to move this ladder.
- **Unblocks [Is the wall depth, or is it eval?](04-is-the-wall-depth-or-eval.md)**, which now has a
  real baseline at three rungs to price a ply against.
