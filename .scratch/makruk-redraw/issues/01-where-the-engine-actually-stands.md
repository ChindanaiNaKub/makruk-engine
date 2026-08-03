# Where does this engine actually stand on the live rungs?

Type: task (AFK)
Status: open
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
