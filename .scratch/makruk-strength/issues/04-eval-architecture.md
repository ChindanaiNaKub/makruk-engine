# Which eval architecture does the spec lock?

Type: grilling
Status: resolved
Blocked by: 01, 02
Parent: map.md

## Question

Decide the core eval architecture the spec commits to, using the Moka-recipe and fairy-tooling research: NNUE-style (small halfKP/variant feature net trained on fairy-scored self-play), Moka-style distilled conv net (tiny, policy+value from a fairy teacher), or hybrid/classical fallback. Must fit ~0.5–1 MB weights, train on RTX 3050 4 GB + 16 cores, integrate with existing alpha-beta search, and plausibly carry the ladder to full-strength fairy. Output feeds the training-plan ticket and the final spec.

## Answer

Locked by grilling (2026-08-01):

1. **Net family: tiny NNUE-style feature net inside the existing alpha-beta search.** Piece-square features (~768 inputs: 64 squares × 6 piece types × 2 colors, perspective-encoded) → L1 256–512 → small MLP tail. **No king-square factorization** — that's the term that floors fairy-format makruk nets at ~6.5 MB; dropping it puts the net at ~0.4–1 MB in INT8 (research/02). Accumulator updates incrementally through `do_move`/`undo_move`, matching the repo's symmetry invariant and keeping ~1M nps search speed.
2. **Heads: value-only, 3-way WDL output** (win/draw/loss — draws are game-deciding under the counting rule, so explicit WDL calibration matters). Move ordering stays classical (TT move, MVV-LVA, killers/history) for v1.
3. **Training shape: distillation from fairy labels** (variant-nnue-tools `.bin` data, NNUE-teacher or classical-teacher bootstrap — teacher choice belongs to ticket 07), with Moka-discipline iteration on top: on-policy DAgger rounds, per-channel INT8 QAT with quantized artifact as the arena player, whole-game splits, gated 100-game confirm blocks.
4. Rejected: fairy-format NNUE (≥6.5 MB, over budget), Moka-style CNN+PUCT (Moka's own ceiling was 47% vs a weak teacher; CPU-browser MCTS can't fight fairy's alpha-beta at equal time), CNN/MLP leaf eval (nps collapse).

Inputs/conditioning for the counting rule are deferred to ticket 08; exact L1 sizing + quantization manifest to the spec session.
