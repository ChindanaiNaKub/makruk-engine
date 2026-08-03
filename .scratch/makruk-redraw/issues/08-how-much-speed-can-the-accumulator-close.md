# How much of the net's speed deficit can the accumulator close?

Type: task (AFK)
Status: open
Blocked by: —

## Question

[Is "classic beats the net" a speed artifact?](02-is-classic-beating-the-net-a-speed-artifact.md) established that the net's eval **beats** the classical eval at equal search depth — 54.2% at depth 5, 67.0% with a 16–0 decisive record at depth 7, both against clean 50.0% controls. The program's central refutation was measuring eval speed and calling it eval quality.

That converts the whole map into one arithmetic question. At 100 ms the net reaches **depth 5** and classic reaches **depth 8**, because the net runs at **332k nps** against classic's **885k** — a **2.7×** deficit. Close enough of that gap and the net plays at classic's depth, where it is measurably stronger. Fail to close it and the net's better eval stays unreachable in real play.

**The work, both of it specified in the spec and neither implemented.** Spec §7 calls for an accumulator updated incrementally through `do_move`/`undo_move` (quiet move: 2 column add/sub; capture: 3; promotion: bia-column off, met-column on). Instead, `nnue::net_score` (`src/nnue.rs:299`) calls `encode(game)` on **every node**, which allocates a fresh `Vec` and re-sums all ~32 active feature columns of the 768→256 feature transformer from scratch.

**An estimate to check before writing code, because it decides whether this is worth a session.** Per-node arithmetic splits roughly in half:

- Feature transformer, re-summed from scratch: ~32 active columns × 256 ≈ **8,200 accumulate ops**.
- Tail, irreducible: 266×32 + 32×32 + 32×3 ≈ **9,600 MAC**.

Incremental updates replace the FT re-sum with 2–3 column operations (~512–768 ops), cutting ~93% of the FT half and ~45% of total arithmetic — about **1.8×** on arithmetic alone. The per-node heap allocation is *not* in that estimate and may be the larger win, since it runs on every node in the hot path. So 2.7× is plausibly reachable but not obviously so, and the tail sets a hard floor: **the net can never be faster than ~2× its current tail-only cost**, no matter how good the accumulator is. Confirm this arithmetic against the actual code before committing a session to it.

Resolve with:

1. **Measured nps and depth-at-100 ms**, before and after, for the net. This is the number the whole map now turns on. If it does not reach classic's depth 8, say what depth it does reach.
2. **Gate A at equal movetime** — the shipping condition, the one that was failing at 44.2%. Fixed-depth wins do not ship; this is the block that says whether the speed work converted the eval advantage into a real one. Run it as a proper SPRT against the frozen classic baseline.
3. **The residual, if any.** If the net lands between depth 5 and depth 8, interpolate against [Is the wall depth, or is it eval?](04-is-the-wall-depth-or-eval.md)'s ply exchange rate to say how much of the gap is left and whether anything cheap closes it (SIMD, f32→i16 accumulator, smaller L1).

**Correctness — this is the one ticket on the map that can silently corrupt play.** An accumulator that drifts out of sync with the board produces a wrong eval that no test currently catches, and the record already contains six defects that made the engine look worse than it was. Extend the existing `do_move`/`undo_move` roundtrip test with an **accumulator-consistency check** — after any move sequence and its undo, the incrementally-maintained accumulator must equal a fresh `encode()` of the same position, exactly. `cargo test --release` + mirror-perft green is necessary but **not sufficient** here; neither touches the accumulator.

**Cost:** implementation is a session's work. Measurement is an nps probe plus one Gate A block, ~2 min. Thermally free — no datagen, no training.

**Watch:** `nnue::eval_id()` and UCI `evalinfo` exist precisely so a silent net→classic fallback is visible to the harness. Confirm the block actually played the net; a speed change that accidentally trips the fallback would look like a triumphant nps result.
