# Close the net's speed gap before training again

Status: **premise refuted by measurement (2026-08-10)** — the speed work was done,
it worked, and Gate A did not move. Kept rather than deleted: the reasoning below is
what a future reader will otherwise reconstruct from the same evidence and believe.
Read the refutation at the bottom first.

## Decision

The next strength work on this engine is **making the net's eval fast enough to use**,
not making it more accurate. No new corpus and no new training round runs until the
net evaluates at parity-ish speed with the classical eval.

## Why

The net's eval is already better than the classical eval *at equal depth* — 67.0% at
depth 7. It loses at equal time only because it is ~2.3× slower, so it searches to
depth 5 where classic reaches depth 8. Every accuracy lever (bigger corpus, deeper
labels, on-policy regeneration) improves a quantity that is not the binding
constraint, and would be spent on an inference path too slow to convert it. Speed is
the constraint; accuracy is not.

## What the first measurement changed

The diagnosis in `.scratch/makruk-strength/research/04-how-to-make-our-net-stronger.md`
was that the deficit came from dequantizing int8 weights to f32 at load — the fix
being an integer inference path, as Stockfish, Fairy and bullet all use.

**That was wrong, and a 35-minute measurement caught it.** The deficit was in
`wdl_from_acc`, which computed each dot product as a single running f32 accumulator.
f32 addition is not associative, so the compiler could not reorder the chain, and all
8,480 MACs of fc1 ran strictly serially at one multiply-add per cycle. Splitting into
8 partial sums — pure safe scalar Rust — recovered **+14.5%** and moved the gap from
2.32× to 1.88×.

The consequence for the plan: the remaining 1.88× is still ~99% fc1, and **scalar
arithmetic cannot close it**, integer or otherwise. A scalar i32 multiply-accumulate
and a scalar f32 one both retire at ~1/cycle. Integer only wins through *lane count* —
16–32 i8 lanes against 4 f32 — so the integer path is worth taking, but only together
with SIMD. An earlier decision to build the integer core scalar-only was made before
this measurement and is superseded by it.

## Consequences

- Work proceeds under a stated stop-bar, and the stop-bar is the point: if the integer
  + SIMD path does not close the gap, the net program **stops**. It does not escalate
  into a wider net, a bigger corpus, or a third backend.
- The acceptance chain is nps → Gate A → ladder, in that order, cheapest first. An nps
  win that does not appear on the ladder is not a strength gain — this engine has three
  independent instances of search improvements moving self-play and never moving the
  ladder.
- A ~10-hour datagen round becomes justified only in one specific outcome: the gap
  closes and Gate A still rejects. Then, and only then, the corpus is the constraint.

## Considered and rejected

- **Port Fairy's official makruk net** (`makruk-a8c621e24a8c.nnue`, +248 Elo over their
  classical eval). Fastest route to real strength, but 49 MB and native-only, which
  ends the browser product this engine exists to be.
- **Halve L1 from 256 to 128.** Halves fc1 directly, but costs a retrain and gambles
  the one thing worth protecting — an eval that already wins at equal depth.
- **Pursue search improvements.** Retired by measurement, three times over.

## Refutation (2026-08-10, same day, block b0063)

The speed work landed and did what it promised. Gate A did not care.

| | r3 net, f32 eval | r3 net, integer eval |
|---|---|---|
| depth @ movetime 100 | 5 | **7** |
| nps | 351k | **483k** |
| gap vs classic | 2.32x | **1.66x** |
| Gate A vs classic | 44.2% (−46 Elo), 78 games | **44.0% (−42 Elo), 48 games** |

Two extra plies of search moved the head-to-head by 0.2 points, which is noise.

**What was wrong with the reasoning.** The premise rested on the net's eval scoring
67.0% against classic *at equal depth*, and inferred that the net loses only because
it is denied that depth. Give it the depth and it should win. It got two of the three
missing plies and won nothing. So either the equal-depth advantage does not survive at
the depths that decide games, or depth was never the mechanism by which the net was
losing. Either way the diagnosis was wrong, and it was wrong in the same shape as the
two before it.

**This is the third governing diagnosis this program has retired by measurement:**
"the wall is search" (three independent instances of search gains not moving the
ladder), "the wall is depth" (classic at full search parity scores the same, ~0 pp/ply),
and now "the wall is eval speed". The pattern is not that each guess was unreasonable —
each had real evidence behind it. It is that a plausible mechanism plus a real
correlation has, three times, failed to survive an arena block. **Nothing here should be
believed about this engine until a block says so.**

**What survives.** The integer inference path is kept on its own merits: +37% nps,
+2 ply, exact accumulator round-tripping through do/undo where f32 drifted, and no
change to the 143.1 KB wasm artifact. It makes the net cheaper wherever the net is
used. It is simply not a strength lever.

**What is now open.** The pre-committed branch table said a Gate A rejection after a
speed success points at the corpus. That inference is weaker than it looked: the table
anticipated speed mattering and the corpus being the remaining gap, whereas what
happened is that Gate A was indifferent to speed entirely. Deciding "corpus next"
versus "stop the net program" is a fresh decision on the new evidence, not a lookup.
