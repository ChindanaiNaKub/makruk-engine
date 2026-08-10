# Close the net's speed gap before training again

Status: accepted (2026-08-10)

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
