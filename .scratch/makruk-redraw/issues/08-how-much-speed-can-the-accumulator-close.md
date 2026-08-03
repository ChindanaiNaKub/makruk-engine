# How much of the net's speed deficit can the accumulator close?

Type: task (AFK)
Status: claimed (2026-08-03)
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

---

## Pre-implementation findings (2026-08-03) — the ticket asked for this before committing a session

**The arithmetic is confirmed against the real code, and the answer is: build it, but it lands short.
The accumulator reaches 89% of parity, not 100%, and the residual needs retraining.** No code beyond
one small change; no arena time.

### Measured baseline, with the net genuinely armed

| | nps @1000 ms | depth @1000 ms | depth @100 ms |
|---|---|---|---|
| classic | **720,896** | 10 | 7 |
| net (r3) | **347,812** | 9 | 5 |

**2.07× deficit**, not the 2.7× carried in AGENTS.md and this ticket. Worth correcting: the target
was overstated by 30%.

### The arithmetic, against actual dims (`L1=256, L2=32, L3=32, N_CHANNELS=9`)

| stage | ops | reducible? |
|---|---|---|
| FT re-sum, 32 pieces × 256 | **8,192** | yes — accumulator cuts to ~512–768 |
| fc1, 32 × 265 | **8,480** | **no** |
| fc2, 32 × 32 | 1,024 | **no** |
| out, 3 × 32 | 96 | **no** |
| **irreducible tail** | **9,600** | |
| **per node** | **17,792** | |

The ticket's estimate was right to within rounding (it said ~8,200 and ~9,600).

- **Accumulator ceiling: 17,792 / 9,600 = 1.85×** → ~645k nps.
- **Needed for parity: 2.07×** → 721k nps.
- **It reaches 89% of the way and stops.** The tail is a hard floor and no accumulator crosses it.

### The per-node allocation is worth ~0 — the ticket's guess is refuted

The ticket suspected the per-node heap allocation "may be the larger win, since it runs on every node
in the hot path." **It is not.** `encode_into` (added here) writes feature indices into a caller-owned
`[u32; 32]` and removes the allocation entirely:

| | nps |
|---|---|
| per-node `Vec` | 346,772 |
| allocation removed | **347,812** |

**+0.3%, inside noise.** Node counts are identical (348,160) and the PV is unchanged, so the change is
behaviour-preserving — it is kept because the accumulator needs a non-allocating path anyway, not
because it bought anything.

### The residual, and why it is not cheap

**fc1 alone is 8,480 of the 9,600-op tail — 88% of everything the accumulator cannot touch.** Its
input width is `L1 + N_CHANNELS = 265`, so the only lever on it is **a smaller L1**, which cuts the FT
*and* fc1 together. That means a different network shape and therefore **retraining — a costed
training ticket under this map's standing rule**, not something this ticket may do.

SIMD and f32→i16 are the other candidates named; `.cargo/config.toml` already sets `+simd128` for
wasm32 but native builds get no explicit vectorisation directive, so there may be headroom there that
costs no retraining. Unmeasured.

### A defect worth recording: I produced a fake 2× speedup and nearly believed it

Mid-measurement the net appeared to jump to 714k nps and depth 8 at 100 ms — parity with classic,
from removing one allocation. It was false. **The shell here is zsh, and I used `env $E …` with an
unquoted parameter**, so `MAKURUK_EVAL` became the single string `"net MAKURUK_WEIGHTS=/path"`, which
is not `"net"` — every "net" run was actually **classic**.

This is the exact defect AGENTS.md warns about in bold, which previously cost this project three
mismeasured blocks. It is now four. **What caught it was this ticket's own Watch** — compare the
search output, not `evalinfo`, because `evalinfo` reports what `mode()` resolved and stays truthful
while `net_score` is never called. The tell was net and classic returning byte-identical PV and score.

`eval` (the UCI command) is **not** a usable probe for which eval is armed — it returns the same value
under both on every binary tested, including pre-change ones. Use a search and compare the PV.

### Recommendation

**Build the accumulator.** 1.85× is the largest speed lever available without retraining, and ticket
02 established the net is measurably stronger at equal depth — so converting speed into depth is the
whole thesis. But go in knowing it lands at ~645k against classic's 721k, and that Gate A at equal
movetime may still fail on the last 11%.

**Do not expect it to be sufficient.** If Gate A fails after the accumulator, the next lever is L1,
and that is a training ticket with its own costed decision.
