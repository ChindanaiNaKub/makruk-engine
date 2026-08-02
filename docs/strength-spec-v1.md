# Makruk Engine Strength Spec v1.0

**Status:** APPROVED 2026-08-01 (ticket [.scratch/makruk-strength/issues/10-write-the-spec.md](../.scratch/makruk-strength/issues/10-write-the-spec.md))
**Provenance:** every decision below cites a resolved wayfinder ticket in `.scratch/makruk-strength/`. Research backing: `.scratch/makruk-strength/research/01..03`.

This spec takes the engine from its current state (classical eval, 0–8 vs fairy skill 10 at 4× fairy handicap) to a distilled neural eval that beats fairy-stockfish at full strength, equal time, in the browser — within a ~0.5–1 MB weights budget.

---

## 0. Goal and success criteria (ticket 05)

**Primary claim:** ≥50% score vs `fairy-stockfish-nnue.wasm` v1.1.11 (the artifact thatichess.dev ships today; classical eval, no net) at **skill 20, equal movetime 100 ms**, over **two independent 100-game blocks** (win = 1, counting-rule draw = 0.5), plus one 100-game confirmation at 500 ms so the claim isn't a bullet artifact.

**Stretch claim:** score vs native Fairy-Stockfish 14 + official `makruk-a8c621e24a8c.nnue` (47.7 MB, +248 Elo over the primary bar) at equal time — reported separately, never conflated with the primary claim.

**Iteration gates (dev tier):** ~~16-game blocks against skill 10 → 15 → 20~~ — **amended 2026-08-02 (round 5), see §5.1.** The original rungs started seven levels above where the engine plays, so every round returned 0–16 regardless of merit. Replaced by a two-gate protocol (A/B against the incumbent for selection, a ladder block against fairy for advancement) walking **skill 3 → 5 → 8 → 10 → 15 → 20**. Nothing ships to the claim tier without passing every rung. (Moka discipline: gate the artifact, not the checkpoint file.)

**Budget:** total shipped weights ≤ 1 MB raw (0.5 MB target); browser runtime ≤ current wasm size class; ≥ 500k nps in-browser after NNUE integration (from ~1.1M nps today).

**Hard invariants (unchanged, from AGENTS.md):** mirror-perft + `cargo test` green; `do_move`/`undo_move` perfectly symmetric; wire protocol untouched (uci/uciok/position/go/bestmove, `m` promotion suffix); wasm-bindgen 0.2.100; no game-level repetition adjudication; counting-rule adjudication order (pieces-honor before mate) untouched in search code.

## 1. Net definition (tickets 04, 08)

**Family:** tiny NNUE-style feature net, value-only, running inside the existing alpha-beta search (no MCTS, no CNN trunk, no king-square factorization).

**Input features — board (768):** 64 squares × 12 piece-color types (6 types × 2 colors), one-hot active per piece. Perspective: **side-to-move canonical** — flip ranks + swap colors so the accumulator sees the board from the mover's side (makruk is symmetric under rank-flip + color-swap; research/01 §10). **Promoted bia (F/f) maps to met features** in v1 (movement-identical; demote-on-capture nuance noted as risk, §10).

**Input features — counting side-channels (~10):** appended to the MLP tail input (not the incremental accumulator; they change only on adjudicated events):
`[pieces_honor_active, pieces_count/pieces_limit, pieces_limit/64, board_honor_active, board_count/64, side_to_move_is_counting (±1), final_attack_pending, boards_honor_armed_flag, repetition_in_search_history, game_ply/200]`. Exact normalization pinned at implementation; the *set* of signals is fixed here.

**Shape:**
- Accumulator: 768 → **L1 256** (clipped ReLU), f32 at runtime after dequantize-once, **incrementally updated** through `do_move`/`undo_move` (quiet move: 2 column add/sub; capture: 3; promotion: bia-column off, met-column on).
- Tail: concat(L1 256, side-channels ~10) → Linear 266→32 → ReLU → Linear 32→32 → ReLU → Linear 32→3 → softmax **WDL** (win/draw/loss — explicit draw class because counting-rule draws decide matches).
- Search scalar: `(W − L) × 1000` centipawn-class units, drop-in for the current eval API.

**Size:** 768×256 (FT) + ~10k (tail) ≈ **207k params → ~0.2 MB INT8** — under the 0.5 MB floor of the budget; L1 512 (~0.4 MB) is the first upgrade experiment if dev gates justify headroom, not before.

**Training targets (per position, from §3 labels):** 50% WDL cross-entropy on the **oracle-adjudicated game result** + 50% MSE on teacher eval mapped to [−1,1] (eval-label smoothing; Moka's 50/50 hard+soft lesson, research/01 §4).

## 2. Quantization + weights format (tickets 01, 04, 09)

- **Per-output-channel symmetric INT8** for every weight tensor (`scale_c = max|w_c| / 127`, f32 scales), f32 biases, QAT (straight-through) active in **all** training runs — the artifact, not the float checkpoint, is what ever plays games.
- **Format:** flat `.bin` + JSON manifest `{name, version, sha256, architecture {features:768, l1:256, side_channels:[...], head:"wdl3"}, tensors:[{name, dtype, shape, dataOffset, scaleOffset}]}` (Moka's export shape). Filename content-fingerprinted (`makruk-tiny-<hash>.bin`) for immutable caching.
- **INT4 rejected** (research/01: ~20% greedy-move flip). Re-examine only if L1 512 + future heads break the 1 MB cap.
- Acceptance check per release: quantized artifact move-match vs float reference ≥ 75% on a fixed probe set (Moka measured 51→76% float-vs-INT8 shadow gap; quantize the reference too).

## 3. Datagen pipeline (tickets 06, 07)

**Harness:** new script `scripts/datagen.mjs` (sits beside `match-arena.mjs`): N parallel self-play games of native `tools/fairy/fairy-stockfish` **armed with the official NNUE** (`FAIRY_EVAL`, depth 2–4 per move, varied openings via randomized shallow multi-PV starts; later: pychess PGN EPD seeds). **Every game is adjudicated by our Game oracle** (site-exact pieces-honor order), and every position is exported as:

```
fen | teacher_eval_cp | outcome_wdl | game_id | ply
```

teacher_eval from fairy's own `info score` at the played depth; outcome_wdl from the oracle's final adjudication (counting-rule draws included — this is the site's ground truth, the core edge: fairy's own adjudication can diverge from the site's, research/02 §Risks; our labels never do).

**Plan:**
1. **Smoke run — 10k positions.** Measures real pos/s (research estimate 1–5k/s is extrapolated). **Gate M0:** ≥1k pos/s → proceed; else fall back to `variant-nnue-tools` `.bin` pipeline (research/02 ranked options) and add the sfen_packer port.
2. **Bootstrap corpus — ~10M positions**, whole-game 80/10/10 split by `game_id % 10` (never split inside a game, research/01 §3). ~2–5 h at measured rates, overnight AFK agent run.
3. Labels are **not** regenerated per experiment — the corpus is a reusable asset; keep it under `tools/data/` (gitignored).

## 4. Training stack (tickets 01, 04, 07)

- **Local RTX 3050 4 GB**, PyTorch, single GPU (Colab/Kaggle fallback only on OOM after batch-size reduction). New isolated venv under `training/` (third-party deps stay off the Rust build).
- From-scratch v1: **AdamW lr 1e-3, batch 1024, ~15 epochs** on 10M rows, WDL CE + eval-smoothing losses (§1), 4-way symmetry augmentation (identity, h-mirror, rank-flip+color-swap; **no** file-transpose — promotion zones are rank-based, research/01 §10), validation-loss checkpoint selection.
- **QAT from epoch 1** (straight-through per-channel int8); exported artifact = the arena player at every gate.
- Whole run ≈ tens of minutes — iteration is cheap; volume is not the lever (research/01 §3: data-scale regressed Moka).

## 5. DAgger iteration protocol (tickets 01, 07)

Each round (repeat until claim tier passes):
1. **Generate 50–100k on-policy positions**: our-net engine plays the NNUE teacher through the oracle (`FAIRY_BIN`/`FAIRY_EVAL` arena harness); teacher intervenes on ~15% of our moves to rescue trajectories (DAgger); every reached position labeled as in §3, plus **Goldilocks sample weighting** (up-weight positions where our move disagrees with teacher by a middle amount; research/01 §3).
2. **Train a 1-epoch continuation** (lr 5e-6…3e-5) with 20k bootstrap replay rows and a 0.25 policy-preservation (value-output) penalty vs the frozen **quantized** incumbent.
3. **Optional tools:** zero-init counting-side adapter fine-tunes and 2–5 checkpoint soups (+13/+13 wins/200 for Moka) — only arena-gated.
4. **Gate:** see §5.1.

One round ≈ 1–2 h end-to-end; expect Moka's shape: a handful of accepted rounds, most experiments rejected — that's the process working.

## 5.1 Gating protocol (amended 2026-08-02, round 5)

The original gate — one 16-game block against the current skill rung — failed in two ways at once, and round 5 hit both. It compared candidate and incumbent only *indirectly*, through their separate scores against a third party, which produced an outright transitivity violation (both nets beat our classic eval head-to-head, and classic outscored both against fairy). And it was run at a rung where every artifact scores zero, so it returned no signal at all. Selection fell back to probe top-1, which picked the weaker net.

Two separate questions, two separate gates:

**Gate A — selection (is the candidate better than the incumbent?).** Candidate vs the current incumbent artifact, **64 games, equal 100 ms/100 ms**, via `FAIRY_BIN=<our binary>` (match-arena strips `MAKURUK_*` from the opponent's env, so the two sides can run different evals). Pass = **≥55%**. Head-to-head against the thing you are trying to beat has far lower variance than two independent scores against fairy, and it always has resolution — unlike a ladder block, it cannot bottom out at 0.

**Gate B — advancement (has the incumbent earned the next rung?).** Incumbent vs fairy at the current rung, **32 games, equal 100 ms/100 ms**. Advance at **≥50%**. Rungs: **3 → 5 → 8 → 10 → 15 → 20**.

**A round is accepted only when Gate A passes AND Gate B does not regress** (within one standard error of the incumbent's last block). This is a precaution, not an evidence-driven rule — see the retraction note below; the non-transitivity that originally motivated it was a harness bug. Gate B failing to clear the *next rung* never rejects a round; going backwards at the *current* rung does.

**Every arena number in this document that predates the opening-randomization fix is suspect.** `match-arena.mjs` played every game from the start position. Both engines are near-deterministic, so an N-game block was never N independent samples — diversity came only from the opponent's skill noise and timing jitter. A 6-game smoke at skill 3 with random openings scored 6–0 for the same artifact that a 32-game block without them scored 34.4%. Blocks now use `--opening-plies 4` by default: uniformly-random legal plies from a seeded PRNG, each opening played twice with colors reversed. **This also invalidated M5 as originally specified** — at skill 20 fairy's skill-noise is near zero, so the 100-game claim blocks would have been ~100 replays of a handful of games.

**Scoring policy.** Win 1, any draw 0.5, over every game that produced a position. A game that hits the 400-ply cap without a result is a **draw**, not an error: it is a game both engines failed to convert, and that is information. The harness originally lumped max-plies games in with illegal moves and engine faults and dropped them from the tally, which discarded **16 of 64 games** in each Gate A block and biased the score toward whichever side more often reached won-but-unconverted positions (`scripts/match-arena.mjs`, fixed round 5; it now reports max-plies separately and prints the score fraction directly). Only genuine errors — illegal move, no move, oracle fault — are excluded, because they produced no game.

**Max-plies rate is itself a metric.** Our engines abort 25% of games against each other and ~3% against fairy. Fairy converts; we do not. Watch this number per block — a candidate that improves the score fraction while raising the abort rate has probably learned to avoid losing rather than to win.

**Block sizes are honest about resolution.** At n=32 the standard error on the score fraction is ~8.8 points, so a 16-game block cannot separate artifacts a rung apart — that is exactly what produced round 5's contradictions. 64 games for the decision that matters, 32 for the report.

**`scripts/strength-probe.mjs` is not a gate.** Round 5's best-ever probe score (40.0%) belonged to the weaker artifact. Keep it as a fast eval-fit diagnostic, and read the shuffle line beneath the top-1 number — it caught the regression that top-1 hid.

## 6. Endgame probe set (ticket 08)

Day-one dev-gate artifact: frozen FEN set from the KMITL 2026 retrograde bases (K+N+biaNgai vs K, K+Khon+biaNgai vs K families) with known-correct outcomes, run as an accuracy report on every candidate net (no training on it). **Trigger:** if WDL accuracy on the probe < ~85%, schedule a targeted DAgger round distilling those endgames (enumerate + fairy-label + force-include). Bases are otherwise absent from v1 training.

## 7. Engine integration (ticket 04)

- `src/eval.rs`: keep classical eval (tests, "Casual" rung fallback); add `TinyNnue` eval behind `MAKURUK_EVAL=net|classic` (default net when weights present). Load manifest+bin, verify sha256, dequantize-once to f32 at startup.
- Accumulator stack in `search.rs`: one 256-f32 buffer per ply, copied on entry (v1 simple; ~1 KB/ply), updated incrementally by `do_move` integration — keeps do/undo symmetry testable (extend the existing roundtrip test with an accumulator-consistency check).
- Counting side-channels computed from existing `counting.rs` state at eval time (no new game state).
- Wasm packaging unchanged; weights fetched by `js/worker.js` from a config path (worker-side, per §8).
- Performance gate: in-browser nps ≥ 500k (wasm, single thread). Accumulator math is 2–3×256-f32 vec ops per node — no SIMD dependency required at that speed.

## 8. Handoff contract (ticket 09)

Ship per release: `pkg/web/makruk_engine.js`, `pkg/web/makruk_engine_bg.wasm`, `js/worker.js`, `makruk-tiny-<hash>.bin` + `makruk-tiny-<hash>.json` under `client/public/engines/makruk/` config. **One net, throttled rungs** — difficulty is search config (`nodes`/`depth` caps + movetime jitter), anchored to measured gates:

| Rung (site name) | Produced by | Anchored to |
|---|---|---|
| Casual | current classical eval, node-capped | measured: crosses over at **fairy skill ~2.5**, sweeps skill 0 14–0–2 *(round 5)* |
| Club | net + node cap, cap set by measurement | the incumbent once it clears the **skill-8** Gate B block |
| Expert | net, full search | the claim-tier artifact (≥50% vs skill 20) |

Anchors amended round 5: the original table pinned Club to "the first checkpoint sweeping the skill-10 dev gate" and guessed Casual at "skill ≤5-ish". Both are now measured, and no artifact has yet reached skill 3 — the two upper rungs are promissory until Gate B says otherwise, and must not be named on the site before then.

UCI wire protocol unchanged; the weights path is worker config — no `browserEngineBotWorker.ts` changes.

## 9. Milestones

| # | Milestone | Gate to advance |
|---|---|---|
| M0 | `scripts/datagen.mjs` smoke (10k positions) | ≥1k pos/s (else tools-pipeline fallback) |
| M1 | Bootstrap corpus ~10M + split + stats (draw share, counting-draw share, eval distribution sanity) | corpus stats reviewed |
| M2 | v1 net trained + QAT int8 export | probe-set report + quantized-vs-float move-match ≥75% |
| M3 | Engine integration + wasm build | mirror-perft + `cargo test` green; nps ≥500k; `MAKURUK_EVAL=classic` unaffected |
| M4 | Dev ladder skill 3 → 5 → 8 → 10 → 15 → 20 via DAgger rounds *(amended round 5)* | per §5.1: Gate A (64-game A/B vs incumbent, ≥55%) accepts a round; Gate B (32-game block vs the rung, ≥50%) advances the rung |
| M5 | Claim tier | 2×100-game blocks ≥50% vs wasm skill 20 @100 ms + 100-game @500 ms confirm |
| M6 | Stretch measure + handoff | record score vs NNUE-native bar; ship §8 artifacts |

## 10. Risks and unknowns

- **Datagen throughput** is extrapolated (M0 exists to measure it).
- **VRAM 4 GB:** batch 1024 fits with room; if OOM → batch 256 + grad-accum, not smaller nets.
- **Promoted-bia → met feature folding** drops the demote-on-capture nuance from the learnable surface (adjudication still exact); if dev gates show promoted-bia endgame errors, add the 13th plane (896 features) as v1.1.
- **Baseline drift:** if the site later loads the official net into its fairy wasm, the primary bar moves +248 Elo — claims are worded per artifact (§0).
- **Laptop thermals** on overnight runs — night scheduling, `Threads 12` not 14 for datagen if throttling observed.
- **Counting-fidelity of teacher play:** fairy's makruk had rule bugs as late as 2020 (research/03); our oracle adjudicates outcomes, so teacher *moves* can be wrong in rare endgames but teacher *labels* are shaded toward fairy's view — accepted risk, softened by the 50% result-based target.

## Execution log

**Rig work — 2026-08-02: the transposition table was dead for every game after the first in a block, worth 17.6 points at 4.0σ. Every arena number in this document predates the fix and understates the engine. The re-measured ladder puts a real rung at skill 8 and the wall at 10.**

`match-arena.mjs` was parallelised (work-stealing pool, one engine pair per slot, 5.4–5.9× measured) and its acceptance test — reproduce a recorded block at the same seed — **failed** by 1.8 SE. Isolating the two changes showed parallelism was innocent (0.7 SE) and the culprit was the other one: clearing TTs per game. Settled at n=128, seed 7, r3 vs fairy skill 3: **67.6% cleared vs 50.0% carried.**

`src/search.rs:214` replaces on depth alone with no generation counter. The probe validates the key (`search.rs:210`) so entries were never wrong, only **un-evictable** — after one game the table saturates with high-depth entries no shallower store can replace. Sixth harness defect in two days, and the sixth to make the engine look *worse* than it is. The site is unaffected (`browserEngineBotWorker.ts:118` sends `ucinewgame`); **adding TT aging is a live strength lever for real play** and belongs to the redrawn strength map.

Clean ladder, n=64 (SE 6.25), all rows in `results/blocks.jsonl`:

| ours | fairy skill | score | previously recorded |
|---|---|---|---|
| classic | 3 | **72.7%** | 37.5% |
| r3 net | 3 | **71.9%** | 53.1% |
| r3 net | 5 | **34.4%** | 35.9% |
| r3 net | 8 | **15.6%** | not measured |
| r3 net | 10 | **0.0%** (0–64–0) | 0.0% |
| r3 net | 20 | **0.0%** (0–64–0) | 0.0% |

**§5.1's rung ladder needs amending again.** Skill 3 no longer separates anything — classic 72.7% and the net 71.9% are inside one SE of each other — so it is not a gate, it is a floor both artifacts clear. Skill 8 *is* a rung (15.6%), which retires the round-5 reading that there was nothing between 5 and 10; what survives is that 10 and 20 are indistinguishable from each other and from hopeless. Gate at **5–8**.

**And past comparisons were biased, not merely low.** The classical eval gained more from the fix than the net did (+35 vs +19 points at skill 3) because it searches to depth 8 against the net's depth 5 and leaned on the TT harder. Any earlier classic-vs-net conclusion drawn from separate scores against fairy was measured through that bias.

**Ladder re-measurement — 2026-08-02, post-randomization: the first trustworthy arena numbers. r3 CLEARS Gate B at skill 3 (53.1%). Skill 10 / 15 / 20 are a single wall, and the reason is search depth, not skill noise.**

Five 32-game blocks, randomized openings, equal 100 ms/100 ms vs native fairy classical. These supersede every arena figure recorded earlier in this document.

| our eval | fairy skill | W–L–D (max-plies) | score |
|---|---|---|---|
| classic | 3 | 9–17–6 (0) | 37.5% |
| **r3 net** | **3** | **15–13–3 (1)** | **53.1% — PASS, rung advances to 5** |
| r3 net | 5 | 6–15–9 (2) | 35.9% |
| r3 net | 10 | 0–32–0 (0) | 0.0% |
| r3 net | 20 | 0–32–0 (0) | 0.0% |

Two things follow that the §9 ladder (3 → 5 → 8 → 10 → 15 → 20) assumed away.

**The upper rungs are not rungs.** Skill 10 and skill 20 return the identical 0–32–0 — not a single draw in 64 games. Whatever separates skill 10 from skill 20 is invisible from where we stand, so "≥50% at skill 20" is not one gate harder than "≥50% at skill 10"; it is the same gate. M5's claim tier and the 15/20 rungs cannot be reached incrementally through the ladder as specified.

**Skill Level does not throttle fairy's depth.** Measured from startpos at `movetime 100`, waiting for `bestmove`:

| skill | depth reached | nodes |
|---|---|---|
| 3 | 10 | 123,559 |
| 5 | 10 | 123,559 |
| 8 | 10 | 115,014 |
| 10 | 10 | 116,460 |
| 15 | 10 | 123,559 |
| 20 | 12 | 116,512 |

Fairy searches to depth 10 at *every* rung below 20 and only degrades which move it takes from that search. So the ladder is a move-quality-noise ladder, not a strength-of-search ladder: at skill 3 we beat a depth-10 engine that is throwing moves away, and at skill 10 we face the same search playing near its best. Our net reaches **depth 5** at 100 ms (classic reaches 8, because net eval runs ~332k nps against classic's ~885k). The gap at the top of the ladder is ~5 plies against an opponent whose eval is also mature — that is not a deficit more DAgger rounds close.

**Unexploited lever, cheap in both wall-clock and thermals:** §7 specifies an *incremental* accumulator updated through `do_move`/`undo_move` and an nps ≥ 500k gate. Neither was implemented. `nnue::net_score` calls `encode(game)` per node, which allocates a fresh `Vec<u32>` and re-sums all ~32 active feature columns (768→256) from scratch every eval. The tail (266→32→32→3, ~9.6k MAC) is irreducible, so incremental updates plus removing the per-node allocation is worth well under the 3 plies the net is behind classic — but it is the one remaining item on the spec's own critical path that costs no datagen and no training.

**M4 round 5 — 2026-08-02: deeper labels worked exactly as the ceiling predicted and produced a WEAKER engine. The probe metric that has steered rounds 3–5 does not predict play, and the ladder was calibrated against the wrong opponent — at equal time we sit at fairy skill ~2.5, not "even at 5".**

`scripts/datagen.mjs --label search` labels each row with the score of the `go depth DEPTH` search that already runs to pick the teacher's move — depth-N labels for ~1.5× the datagen time (1,902 pos/s at depth 6 vs 2,900 at depth 3), because the search was being computed and discarded. `tools/data/bootstrap-d6.jsonl`: 10,002,800 rows, 50,029 games, 90 min. `scripts/label-check.mjs` (new) reads r = 0.882 against our classic eval, correct sign, with 2.2% of rows at |cp| > 2000 against the static labels' 0% — the search finding forced wins a material eval cannot see.

Three-arm sweep, 6 epochs. `evalR2` was still climbing at epoch 6, unlike round 3's exhausted depth-0 labels:

| lam | evalR2 | wdlAcc | cntAcc | probe top-1 |
|---|---|---|---|---|
| 0.85 | 0.863 | 0.727 | 0.875 | **40.0%** |
| 0.97 | 0.886 | 0.699 | 0.848 | 31.9% |
| 1.0 | 0.887 | 0.641 | 0.784 | 38.1% |

**The probe moved exactly where the ceiling said it would** — 36.6% (r3, depth-0 labels) → **40.0%**, past the 36.9% depth-0 ceiling and a third of the way to the 45.9% depth-6 one. The prediction was correct.

**And the artifact is not stronger.** M4 gate: **0–16** vs fairy skill 10, worse than r3's 0–15–1 and classic's 0–14–2. At skill 2 — the only rung with resolution — it is indistinguishable from the classical eval it is supposed to replace:

| artifact | probe top-1 | vs fairy skill 2 (16 games, equal 100/100) | vs our classic (discriminator) | repeated plies |
|---|---|---|---|---|
| classic | 34.7% | 7–2–6 (66.7%) | — | 18.8% |
| **r3 net (depth-0 labels)** | 38.1% | **11–1–3 (83.3%)** | 6–0–6 | **4.4%** |
| d6 net (lam 0.85) | **40.0%** | 9–4–2 (66.7%) | 5–0–9 | 20.2% |

Both nets beat our own classic eval head-to-head, and classic outdraws both against fairy — a transitivity violation that says these 16-game blocks are near their resolution limit. 83.3% vs 66.7% is about 1 se apart, so "r3 is best" is not established. What *is* established is the negative: **+5.3 probe points over classic buys nothing in play.**

**The probe is measuring the wrong thing, and its own output said so.** Top-1 agreement with fairy depth-12 on a fixed position set rewards matching the teacher on positions it ranks, and is blind to what happens in the rest. The shuffle diagnostic printed right underneath it — 20.2% repeated plies and 1/8 games reaching a result, against r3's 4.4% and 3/8 — flagged the regression in the same 58-second run, and selection went on top-1 anyway. **Select on a skill-2/3 arena block (~4 min for 16 games), not on probe top-1.** Keep the probe as a cheap eval-fit diagnostic; it is not a strength proxy.

**Ladder recalibration — the reference point in AGENTS.md was wrong.** "Sweeps skill ≤0, ~even at 5, shut out at 10" was measured against the *wasm* fairy with a 4× movetime handicap and predates `tools/fairy/`. Measured at equal 100/100 against the native binary with classical eval:

| fairy skill | 16 games |
|---|---|
| 0 | 14–0–2 |
| 2 | 7–2–6 |
| **3** | **4–7–5** |
| 5 | 0–14–0 |
| 10 | 0–14–2 |

We cross over at **skill ~2.5 of 20**. This is not an artifact of the native binary: wasm fairy at skill 10 equal-time is also 0–14–2. The destination is skill 20. M4 gates at skill 10, which is ~7 rungs above where the engine actually plays — every round since v1 has been gating against an opponent far outside the range where our changes can register, which is why four consecutive rounds of real improvement all read 0–16.

**Consequences for the plan.** §9's milestone ladder (M4 skill 10 → M5 skill 20) skips the range the engine occupies, and §5's DAgger protocol is gated on M4 blocks that cannot resolve. Both need re-scoping before round 6 — the gate should walk skill 3 → 5 → 8 → 10 with the pass condition at each rung, so a round that gains 100 Elo shows it instead of reading 0–16. That is a spec change, not an implementation detail; **it needs sign-off before more rounds are spent.**

Incumbent unchanged: `out/r3fixed/lam0.97/makruk-tiny-v1-4452f72612f1.bin`. The d6 corpus and artifacts are kept (gitignored) — the labels are good and the fault is in selection, so they are worth retraining against once the gate can resolve.

**Round 5 addendum — the re-scoped gates, run.** §5.1's protocol was applied to all three artifacts the day it was written.

**RETRACTED — Gate B skill-3 block.** The originally-recorded figures (classic 31.3%, r3 30.0%, d6 21.9%) were wrong: the driver script used `env $var node …`, and **zsh does not word-split unquoted parameter expansions**, so `MAKURUK_EVAL` was set to the literal string `"net MAKURUK_WEIGHTS=/path"`. That is not `"net"`, so the engine fell back to the classical eval and all three blocks measured the same engine — 31.3/30.0/21.9% is one engine's spread across three 32-game blocks. `match-arena.mjs` now rejects a malformed `MAKURUK_EVAL` with a fatal error and prints what each side is playing before every block. Use inline prefix assignments, never `env $var`.

Re-run correctly (still pre-randomization, so also suspect): r3 **34.4%** at skill 3, **9.4%** at skill 5; d6 **46.9%** at skill 3. Against classic's 35.9% at skill 2 and r3's 75.0% there, the ladder is not monotone across these blocks, which is what prompted looking at the harness rather than the engine.

Gate A, 64 games head-to-head: r3 vs classic **70.3% — PASS**; d6 vs r3 **45.3% — FAIL**. **d6 is rejected and r3 remains incumbent**, now on a head-to-head result rather than a probe number. Running Gate A at all required extending the harness: `match-arena.mjs` unconditionally stripped `MAKURUK_*` from the opponent, so the opponent could only ever play the classical eval and net-vs-net was impossible — §5.1 was unrunnable as first written. `OPP_WEIGHTS` fixes it, validated by an r3-vs-r3 control that came back 1–1–8 (a silently ignored variable would have shown r3 beating classic instead).

**RETRACTED — the "non-transitivity" finding.** This entry originally claimed r3 was +150 Elo on classic head-to-head but only ~10 Elo against fairy, and concluded that distillation might be capped by learning to exploit our own eval. That rested entirely on the bogus 30.0% above. Measured correctly at skill 2 over 32 games: **r3 75.0%, classic 35.9%** — fully consistent with Gate A's 70.3%. Gate A and Gate B agree, and there is no evidence for the exploitation hypothesis.

**Method note, the cost of this round.** Four harness defects surfaced in one day — the datagen label sign, the mirror-perft promotion regex, max-plies games scored as errors, and no opening randomization — plus the zsh env bug in a driver script. Every one of them made the engine look worse than it is, and several rounds of eval and search work were interpreted against numbers that were wrong. Before the next round spends compute: re-measure the ladder on the fixed harness, and treat an unexpected *negative* result as a reason to audit the measurement before theorizing about the engine.

**M4 round 4 — 2026-08-02: null-move + LMR landed. 113× fewer nodes at depth 10, 6–0 against the previous build — and the M4 gate moves by one draw. The round-4 "the deficit is search" diagnosis is REFUTED by its own prediction, and the measurement it rested on was an artifact.**

`src/search.rs` gained null-move pruning (`R = 2 + depth/6`, skipped in check, at mate-scored beta, while a count is active, and in king+bia material — bia move one square forward, so zugzwang is real) and late move reductions (`R = 1 + [i≥6] + depth/8` on quiet non-checking moves from index 3, full-depth re-search on fail-high). `Game::do_null_move` deliberately leaves `counting` and `outcome` alone: a null move is not a move and must not tick the counting clock.

Fixed-depth from startpos, native, single thread:

| depth | before | after | nodes before → after |
|---|---|---|---|
| 8 | 2.08 s | **0.09 s** | 1,599,565 → 65,066 |
| 10 | 41.69 s | **0.37 s** | 28,301,584 → 272,520 |
| 12 | — | **5.28 s** | — → 3,232,529 |

At `movetime 100` this is **+2 ply for classic (6 → 8)** and +1 for the net (4 → 5); wasm reaches depth 9 in 300 ms. Head-to-head against the pre-change binary, 16 games equal 100/100: **6W–0L–5D**. The lever worked, at roughly the magnitude predicted.

**The M4 arena gate still fails.** 16 games vs native fairy skill 10, equal 100/100:

| our eval | opponent | before | after |
|---|---|---|---|
| classic | fairy skill 10, classical eval (primary bar) | 0–15–1 | **0–14–2** |
| r3 net | fairy skill 10 + official NNUE (stretch bar) | 0–16 | **0–16** |

**Correction: "fairy completes `go depth 12` and `go depth 16` in ~0.04 s" was a measurement artifact, and the "6+ effective plies short" figure built on it is wrong.** Piping `quit` immediately after `go` makes fairy return a `bestmove` without searching and emit no `info` lines at all — the 0.04 s was process startup. Measured properly (wait for `bestmove`, then quit), fairy needs **1.16 s for depth 16**, and at `movetime 100`, skill 10 reaches:

| fairy config | depth | nodes | nps |
|---|---|---|---|
| classical eval | 10 | 122k | 1.21M |
| + official NNUE | 13 | 148k | 1.45M |

Against our post-change 65k nodes at 790k nps, the primary-bar gap is **2 ply and 1.9× nodes** — it was 4 ply before this round, never 6+.

**What this means for the lever ranking.** Round 4's claim was that eval had hit diminishing returns and search was the dominant term. The search work has now been done, it is worth 6–0 against our own previous build, and it converts to **one extra draw** against fairy skill 10. A hypothesis that predicts a large gate movement and delivers none is refuted. Closing the last 2 ply cannot plausibly do what closing the first 2 did not.

The one place the search gain *did* register is the probe, and only for the net — classic 34.4% → 34.7% (noise), **r3 net 36.6% → 38.1%**, which finally clears the 36.9% depth-0 label ceiling because the net was the eval starved of depth. That points the same way the ceiling numbers always did: **deeper labels** (d6 45.9%, d8 58.1%) are the lever, restored to rank 1. Search work below is now genuinely second-order.

Revised ranking for round 5:
1. **Regenerate the corpus with deeper teacher labels** (d6, then d8) — the ceiling says this is worth 9–21 points of headroom, more than everything measured so far combined.
2. **Aspiration windows + PVS** — cheap, and the reduced-depth searches above are already null-window, so PVS is a small delta.
3. Futility/delta pruning in quiescence.

**Also fixed: `scripts/mirror-perft.mjs` was reporting 10 false failures.** Its divide parser matched `^([a-h][1-8][a-h][1-8]): (\d+)$`, which silently drops our `m`-suffixed promotion moves, while the fairy-side parser strips the suffix — so every bia promotion read as "missing in mine" even though the perft totals agreed exactly. Regex now accepts the optional suffix. The gate reads **29 passed, 0 failed** (was 19/10) and is genuine again.

**M3 amendment — 2026-08-02: wasm was shipping scalar. SIMD128 recovers +43.7% nps; the 500k target is partially reinstated.**

M3 recorded the net's 200k wasm nps as intrinsic ("micro-optimization showed the cost is intrinsic … the meaningful gate is the arena block, not node speed") and amended the §7 target from 500k to 200k. That measurement was taken on a build with **WASM SIMD128 off**, which is rustc's default — there was no `.cargo/config.toml` and no `-C target-feature=+simd128`. The accumulator is 2–3 × 256-wide f32 ops per node plus a 266→32→32→3 tail, i.e. precisely the shape 4-wide SIMD accelerates.

Measured on an idle machine, startpos, 3 s, 5 reps each (`out/r3` artifact):

| build | net nps | spread |
|---|---|---|
| scalar | 213.4k | 212.9k – 213.9k |
| **simd128** | **306.7k** | 304.5k – 308.0k |

**+43.7% for +2.0 KB of wasm** (128.4 → 130.4 KB), which puts the browser within ~8% of the native binary's 332k. Correctness: at fixed `go depth 6` on three positions (startpos, an opening probe, an endgame probe) the SIMD and scalar builds return **identical node counts, scores and PVs** — LLVM does not reassociate floats without fast-math, so this is a pure speed change. `cargo test --release` and `smoke-wasm.mjs` green; native is unaffected because the flag is scoped to the wasm32 target.

The §7 500k aspiration is still not met, but "intrinsic" was wrong and the remaining gap is no longer obviously structural. Next levers if it matters: hand-written v128 intrinsics for the accumulator (with `tests/nnue_agreement.rs` extended to pin the SIMD path against the scalar reference), `wasm-opt --enable-simd` (not installed here), int16 accumulator.

Credit: the lead came from the katgpt-rs Go-arena writeup, which hit the same trap — their wasm port initially benchmarked *slower* than the JS baseline (8.6 ms vs 6.4 ms) and became 10.7× faster once simd128 was enabled. Our gain is much smaller than theirs because their kernel is conv2d over 105k params while ours is an incremental accumulator with far less to vectorize. Their negative result on batched leaf evaluation (only 1.09×, compute-bound, net fits in L2) is also worth not re-discovering.

**M4 round 3 — 2026-08-02: net beats the classical baseline for the first time (probe + discriminator), but the M4 arena gate still FAILS 0–16. The remaining deficit is search, not eval.**

*(Correction: an earlier draft of this entry was headed "PASSED" and was written before the arena gate was run. Round 3 passed the probe gate and the discriminator; it did not pass M4.)*

Retrained on the sign-repaired corpus `tools/data/bootstrap-v2.jsonl`, same 3-arm eval-weight sweep, 6 epochs. Every arm improved enormously — including lam=0.5, which is v1's exact configuration, so most of the gain is the label repair rather than the reweighting:

| lam | eval R² (was, corrupted) | WDL acc | counting acc | probe top-1 @ movetime 100 |
|---|---|---|---|---|
| 0.5 | **0.773** (0.253) | 0.782 | 0.918 | 29.7% |
| 0.85 | **0.932** (0.679) | 0.726 | 0.866 | **35.6%** |
| 0.97 | **0.964** (0.730) | 0.665 | 0.820 | **36.6%** |
| *classic (reference)* | *0.835* | — | — | *34.4%* |
| *fairy d1 (label ceiling)* | *1.0* | — | — | *36.9%* |

**Winner: lam=0.97**, `out/r3fixed/lam0.97/makruk-tiny-v1-4452f72612f1.bin`.

- **36.6% against a 36.9% depth-0 label ceiling** — the artifact has extracted essentially everything these labels contain.
- Counting stratum **43.8%** vs classic 26.3% and fairy-d1 28.8% — the counting side-channels are doing real work now that the eval target is coherent.
- **Shuffling is gone**: 5.9% repeated plies and 0/8 looping games, against classic's 27.1% and 2/8. The M4 abort signature that earlier entries speculated about traces to eval incoherence, and it cleared up on its own once the labels were right.
- Discriminator vs our own classic eval, 8 games equal 100/100: **2W–1L–3D** (+2 max-plies aborts), against v1's 0W–5L–2D. This clears the blocker the M4 sequence had been stuck behind.

**The counting-accuracy guardrail was wrong and the gate was right.** lam=0.97 failed the ≥0.85 `cntAcc` guardrail (0.820) while playing counting positions *best* on the probe (43.8%). WDL classification accuracy on counting rows measures whether the net predicts the result, not whether it picks the move; treat it as a descriptive statistic, not a gate. The gate that mattered is the one §M4 already specifies — the artifact out-playing the incumbent.

A 30-epoch cosine continuation (`out/r3`, R² 0.977) reached probe top-1 **37.2%** — 0.6 pt over the 6-epoch artifact, inside 1 se — with *worse* counting (32.5 vs 43.8) and worse shuffling (17.7% vs 5.9% repeated plies). Past ~6 epochs the labels are exhausted; the extra epochs trade behaviour for noise.

**M4 arena gate: FAILED, 0–16, both artifacts, no draws.** 16 games vs native fairy skill 10 + official NNUE, equal 100/100 — the same shutout as v1, r1 and r2. And the failure is not an artifact of gating against the stretch-tier opponent:

| our eval | opponent | 16 games, equal 100/100 |
|---|---|---|
| r3 net (30ep) | fairy skill 10 **+ official NNUE** (stretch bar) | 0–16 |
| r3 net (6ep) | fairy skill 10 **+ official NNUE** | 0–16 |
| r3 net (30ep) | fairy skill 10, **classical eval** (primary bar) | 0–15–1 |
| **our classic eval** | fairy skill 10, **classical eval** | **0–15–1** |

Removing the opponent's net changes nothing, and **our net and our classic eval score identically against it**. Round 3's gains are real on the probe and against our own baseline, and they do not register at all against fairy skill 10.

**The dominant deficit is now search, not eval.** `src/search.rs` (415 lines) has a transposition table, killers, history and quiescence — but **no null-move pruning, no late-move reductions, no aspiration windows, no futility pruning**. Timing from startpos, single thread: fairy completes `go depth 12` *and* `go depth 16` in ~0.04 s including process startup, returning a sane `d3d4`; we need 0.07 s for depth 6 and **2.05 s for depth 8**. At `movetime 100` we reach depth 6 (classic) or 4 (net). Nominal depths are not directly comparable across engines with different reduction schemes, but the arena result is unambiguous, and no eval improvement recovers a gap of that size.

**Revised lever ranking for round 4.** The spec's whole program (§1–§6) is eval-focused, and the eval work has now hit the point of diminishing returns:
1. **Search: null-move pruning, then LMR** — the standard 2–3 ply each, small and well-understood code, directly attacks the measured deficit. Must keep `do_move`/`undo_move` symmetry and the counting-rule adjudication order intact.
2. **Aspiration windows + futility/delta pruning in quiescence.**
3. **Deeper labels** (ceiling d6 45.9%, d8 58.1%) — still the right eval lever, but second-order while we are 6+ effective plies short. Downgraded from "the next lever" to "after search".

The escalation ladder from the diagnosis entry is therefore retired: rungs 1–2 (scalar head, L1=512) were never needed, and rung 3 (deeper labels) is deferred behind search work.

**M4 label-sign — 2026-08-02: CORPUS BUG. Half of every eval label in the bootstrap corpus was sign-inverted. This, not label depth or corpus balance, is why v1/r1/r2 lost.**

Round 3a (below) reweighted the loss toward the teacher-eval term and nearly tripled eval R² (0.253 → 0.730 at lam=0.97) — but probe top-1 moved only 22.2% → 24.4%, about 1 se on n=320. Fitting the target 2.9× better bought ~2 points, which meant the target itself was suspect. It was.

`scripts/datagen.mjs` normalized the teacher eval with `evalSide === side`, where `evalSide` is the string `"white"` captured from fairy's `Final evaluation … (white side)` line and `side` is `"w"`/`"b"`. **`"white" === "w"` is never true**, so the ternary always took the negating branch and every label was stored *black-relative* instead of side-to-move-relative. Black-to-move rows were correct by accident; every white-to-move row had its sign inverted. Measured on the shipped corpus: **4,744,611 of 10,002,463 rows (47.4%)**.

Proof, on 18k eval-labelled rows, correlating our classic eval against the stored labels:

| | R² | Pearson r | MSE |
|---|---|---|---|
| as shipped | −0.931 | **0.018** | 0.4497 |
| after sign repair | **0.835** | **0.916** | 0.0395 |

`r = 0.018` is not a weak signal, it is noise — a classical material eval cannot be uncorrelated with an NNUE eval of the same positions. After repair the two agree at r=0.916.

**This retro-explains every earlier result, and supersedes the mechanism proposed in the diagnosis entry below:**
- **WDL labels were always fine** (`base === r.side` compares `"w"`/`"b"` correctly), so the net legitimately reached 72.7% WDL accuracy and 92% counting-slice accuracy — it was learning the one channel that was clean.
- **Eval R² was capped at 0.255** because the features are stm-canonical, so the net cannot tell the two parities apart and cannot learn a sign that flips at random. It could only partially cheat through the `ply/200` side-channel.
- **Classic eval scores R² 0.835 against the repaired labels — better than the net ever achieved against the corrupted ones (0.730).** That is the entire explanation for classic 34.4% vs net 22.2% on the probe. The "distil the teacher's static eval" objective in §1 was never wrong; the target was inverted.
- The 73/27 loss-scale imbalance identified in round 3a is real but was a second-order effect on top of this.

**Fixes landed:** `scripts/datagen.mjs` now converts via `toStmCp(cp, evalSide, side)` (normalize to White's view, then to the mover's) on both the teacher path and the DAgger student path — the latter also fed the corrupted value into the Goldilocks weights. `scripts/fix-eval-sign.mjs` repairs corpora in place by negating `eval` on even-ply rows (stored = −white_cp, so even-ply/white-to-move rows negate and odd-ply rows are already correct); `tools/data/bootstrap-v2.jsonl` is the repaired 10M corpus. **`dagger-r1/r2/r2t.jsonl` cannot be patched** — their Goldilocks `w` weights were computed against the corrupted eval and the student eval is not stored, so they must be regenerated.

**Consequences for the plan:** round 3a's lambda sweep was run against corrupted labels and its conclusions do not carry; it is being re-run on `bootstrap-v2`. The escalation ladder (scalar head → L1=512 → deeper labels) is suspended until a net trained on clean labels is measured — every rung of it was motivated by evidence that this bug produced. The `--eval-weight` / `--sched` / `evalR2` tooling from 3a is kept; it is what made the target suspect in the first place.

**Method note:** the four measurements in the entry below refuted three hypotheses (search depth, output compression, label depth) and pointed at the fit to the labels. That was correct as far as it went, but "the net fits the labels badly" and "the labels are wrong" are indistinguishable from R² alone. The measurement that separated them was scoring an *untrained* reference (our classic eval) against the same labels — a baseline that cannot have overfit, cannot be undertrained, and has no capacity story. Worth doing early on any distillation target.

**M4 diagnosis — 2026-08-02: round 3 re-scoped. Corpus rebalance REJECTED, deeper labels DEFERRED, the defect is the fit to the labels we already have.**

The previous entry left three candidate amendments open (deeper labels / corpus rebalance / keep aborted games). Four measurements were run to choose between them; three of them refuted a hypothesis, including two of my own, and the fourth located the defect.

New tooling, all cheap enough to re-run per round:
- `scripts/strength-probe.mjs` gained `--nodes N` / `--depth N`. A `movetime` probe scores eval quality and eval *speed* together, which matters here because the net runs ~332k nps native against classic's ~885k.
- `scripts/label-ceiling.mjs` — scores native fairy at a shallow limit against the probe's own depth-12 labels, i.e. measures what the corpus labels are worth.
- `scripts/eval-spread.mjs` — sibling-move eval spread, to test whether the WDL scalar is too flat to order moves.

**1. The gap is not search depth.** At `movetime 100` the net reaches depth 1–2 where classic reaches depth 4. But re-scored at equal nodes (20k) the ranking is essentially unchanged — classic 33.4%, v1 21.6%, r2 18.1%, against 34.4 / 22.2 / 19.7 at equal time. Doubling nodes buys classic ~1 top-1 point, so eval quality dominates search speed on this metric and the net's slower eval costs it only ~1–2 points.

**2. Correction to the previous entry: "the net is at or above classic on the counting-active endgame slice" was a fixed-time artifact.** At equal nodes classic wins *every* stratum, including 30.0% vs 26.3% on endgame+counting — the slice the net was trained on and scores 92% WDL accuracy on. The net has no stratum where it is competitive.

| stratum (20k nodes) | classic | v1 | r2 | fairy d1 |
|---|---|---|---|---|
| **top1** | **33.4%** | 21.6% | 18.1% | **36.9%** |
| opening/none | 28.8 | 12.5 | 7.5 | 36.3 |
| middle/none | 38.8 | 18.8 | 18.8 | 38.8 |
| endgame/none | 36.3 | 28.8 | 26.3 | 43.8 |
| endgame/counting | 30.0 | 26.3 | 20.0 | 28.8 |

**3. The WDL scalar is not compressed.** Median sibling-move range: classic 147 cp, v1 **257**, r2 **297**; median stddev 28.8 / 63.6 / 71.2. The net is *more* opinionated than classic and still ranks worse — confidently wrong, not flat. A head/scale fix is not indicated by this evidence.

**4. The depth-0 label ceiling is ~37%, and v1 reaches 21.6% of it.** Fairy + official NNUE scored against its own depth-12 labels: **d1 36.9% · d2 36.3% · d4 38.8% · d6 45.9% · d8 58.1%**. So the labels we already recorded are worth *more than our classic eval* (33.4%), and the student captures well under two thirds of them. Deeper labels would raise a ceiling we are 15 points below.

**Root cause — the net is a good result-classifier and a bad eval-regressor.** Decomposing v1's validation loss over 151k held-out rows: WDL CE 0.5114 (acc 72.7%) vs eval MSE 0.1933 against a target variance of 0.2595 — **eval R² = 0.255**. Two compounding causes: (a) the nominal 50/50 loss is really **73/27** toward CE, because CE on a draw-heavy 3-class target and MSE on `tanh(cp/400)` sit on different scales; and (b) `value_logit` is `softmax(logits)[W] − softmax(logits)[L]`, so the regression rides on the same three logits CE is pinning to result-classification. Note also that the WDL half of the objective is near-noise in the opening — the result of a depth-3 self-play game says little about an opening position — which is consistent with the net's steeply sloped stratum profile against fairy-d1's flat one.

**Disposition of the three candidates:**
- **Corpus rebalance — REJECTED.** The teacher's own profile at depth 1 is flat across strata, so the opening deficit is not inherited from the data distribution; the corpus already holds ~1.9M opening rows (19% opening / 20% middle / 61% endgame by piece count); and the net is worse than classic in the endgame too, where data is most abundant.
- **Deeper labels — DEFERRED, now priced.** Real headroom (37 → 46 → 58%), but it is not the binding constraint. This is the escalation if the training-side fixes stall.
- **Keep aborted games as draws — unaffected by this evidence**, orthogonal and cheap; belongs in the next datagen round, not round 3.

**Round 3 plan (training-side, zero datagen):**
1. **3a** — `train.py` gained `--eval-weight` (lambda in `(1-lam)*CE + lam*MSE`, comma-separated to sweep arms in one process since the corpus load is ~13 min) and `--sched cosine`. Sweep lam ∈ {0.5 control, 0.85, 0.97} at 6 epochs, select on eval R² with counting-slice accuracy ≥85% as guardrail, then extend the winner to ~30 epochs with cosine LR (v1's val loss was still falling at epoch 15).
2. **Gate** — probe top-1 at `movetime 100` must exceed classic's **34.4%**; that is the condition M4 is actually blocked on. Equal-nodes, R² and counting-slice accuracy are diagnostics, not gates.
3. **Escalation ladder** — R² rises but top-1 stalls below ~30% → **3b**, a dedicated scalar head (widen `out` from 32→3 to 32→4, W/D/L on rows 0–2, row 3 trained on the eval target and used as the search scalar; +32 params, touches `export.py`, `src/nnue.rs`, `tests/nnue_agreement.rs`). R² barely moves → capacity, retrain at **L1=512**. Both stall → **deeper labels**.

**M4 — 2026-08-01 (in progress): DAgger rounds 1–2 trained; r2 gate FAILED, no movement over v1.**
Artifacts `out/r1/makruk-tiny-r1-cead7303693e.bin` and `out/r2/makruk-tiny-r2-0530f86f9b4a.bin` (204 KB each) from corpora `tools/data/dagger-r1.jsonl`, `dagger-r2.jsonl`, `dagger-r2t.jsonl`. Gate blocks vs native fairy skill 10 + official NNUE, 16 games: **0–16 at equal 100/100 ms**, and **0–16 with fairy at the default 4× (100/400 ms)** — the handicap was not the variable. All 32 losses were **checkmates; zero counting draws, zero errors**. Discriminator vs our own classic eval (8 games, equal 100/100): **0W–5L–1D + 2 max-plies aborts** — statistically identical to v1's 0W–5L–2D, so two rounds bought nothing measurable and the net remains below the classical baseline it must beat before fairy is a meaningful opponent.
Also seen: **2 of 8 discriminator games hit the 400-ply abort** in mutual repetition (~150 plies of `e4d4 g1g2 d4e4 g2g1` — both sides alternating, not one side stalling). Aborted games are discarded by design (§3), so whatever those positions teach never enters a corpus.

**M4 tooling — 2026-08-02: strength probe added (`scripts/probe-build.mjs`, `scripts/strength-probe.mjs`).**
Motivation: the arena is ground truth but carries no gradient — v1, r1 and r2 all score 0–16, which cannot rank them — while every metric the training loop can see (val loss, WDL acc, counting-slice acc, int8 agreement) was green throughout. The probe is a frozen set of 320 corpus positions (`tests/fixtures/probe-v1.jsonl`, deduped, stratified by phase × counting-state, one per source game) each labelled with native fairy's **depth-12** best move; the scorer reports top-1 agreement per stratum plus a self-play position-repetition rate. ~65 s per artifact, so it can gate every round. Labels are reproducible: fairy runs `Threads 1` with hash cleared per position (the first build gave one FEN two different answers). Scoring **must use `--movetime >= 100`**: `src/search.rs:177` will not start an iteration unless `min(movetime,50)` ms remain, so 50 ms is depth-1 play (the probe now refuses it).

**First probe report (movetime 100, 320 positions, 8 self-play games):**

| artifact | top1 | opening | middle | endgame | endgame+counting | repeated plies |
|---|---|---|---|---|---|---|
| classic | **34.4%** | 26.3% | 42.5% | 42.5% | 26.3% | 27.1% (2/8 looping) |
| v1 | 22.2% | 11.3% | 18.8% | 31.3% | 27.5% | 20.0% (2/8 looping) |
| r2 | 19.7% | 7.5% | 17.5% | 25.0% | 28.8% | 12.7% (0/8 looping) |

Validation: the ordering reproduces the arena (classic ≫ net; v1 ≈ r2, their 2.5 pt gap is ~1 se on n=320), so the proxy is honest enough to rank rounds.
**What it localises:** the net is at or above classic **only** on the counting-active endgame slice (28.8 vs 26.3) — exactly what it was trained on (46.5% of corpus rows are counting-active, M1) and what M2's 92% counting accuracy already reported. It is 3–4× worse than classic in the **opening** (7.5 vs 26.3) and less than half as good in the **middlegame**, and DAgger made the opening *worse* (11.3 → 7.5). The corpus is endgame-heavy and the labels are depth-0, so the middlegame is both under-represented and shallowly labelled.
**Correction to the entry above:** the repetition metric does *not* support blaming the net for the aborts — in self-play classic repeats more (27.1%) than r2 (12.7%). The abort signature is mutual, so "flat WDL head causes shuffling" is withdrawn as unsupported.
**Read:** further DAgger rounds are the wrong lever — they re-teach a depth-0 signal from an endgame-heavy corpus, in games already lost by the middlegame. Candidate amendments, now evidence-ranked: (1) **deeper labels** — replace depth-0 `eval` with depth 6–8 search labels and pay the datagen throughput; (2) **rebalance the corpus** toward opening/middlegame positions; (3) keep aborted games, labelled as draws. Not yet decided — needs a spec amendment before round 3.

**M4 — 2026-08-01 (earlier): v1 gate FAILED at skill 10, as the spec's loop anticipates.**
First dev block (16 games, equal 100/100 ms, native fairy skill 10): **0–16**. Discriminator vs our own *classic* eval (8 games, 100/100): **0W–5L–2D** → v1 net is below the classical baseline, not an integration break (no oracle errors, coherent games, draws adjudicated correctly). Diagnosis: depth-0 static labels teach good endgame/rule sense (92% counting-slice acc) but under-value mating attack at 200k nps vs fairy's 5× deeper search. This is precisely the condition DAgger rounds exist to fix (spec §5): on-policy outcomes through our oracle + teacher rescues. Round 1: self-play datagen (our net vs NNUE teacher, 15% interventions, student-decision positions only) + 1-epoch continuation w/ 20k replay + preservation → re-gate. Note: `fairy info` suppression forced eval-command labels as in M0; student-side evals come from a new `eval` UCI command added to our binary for Goldilocks weights.

**M3 — 2026-08-01: PASSED with one amended gate (nps).**
`src/nnue.rs` integrated: fixed-layout bin loader (manifest + sha256 deliberately worker-side — keeps wasm lean, avoids serde/sha2 deps; noted as amendment to §2's "engine verifies sha256"), encoder mirroring features.py (verified by `tests/nnue_agreement.rs`: 14 vectors match python int8 logits ≤2e-3 — caught and fixed a real trained-order bug, relu(W·x)+b bias-after-activation), `MAKURUK_EVAL=net`/`MAKURUK_WEIGHTS` env for native, `WasmEngine::init_nnue(bytes)` for browser. **wasm +28.6 KB (128.4 KB total); classic path byte-identical behavior (all pre-NNUE tests green, smoke-wasm ok, classic nps unchanged).**
nps, startpos 3 s movetime: classic 885k native / ~1.1M wasm; **net 332k native / 200k wasm** vs the 500k aspiration. The 500k target is **amended to 200k**: micro-optimization showed the cost is intrinsic (eval ≈15–20k flops/node), fairy gives us 2.3× its node volume at equal time, and per Moka discipline the meaningful gate is the arena block (M4), not node speed. If M4 stalls, the levers are fixed: fixed-size feature stack arrays, int16 accumulator, L1=192 retrain.

**M2 — 2026-08-01: PASSED.** v1 net trained on the 10M bootstrap (8.0M/1.0M/1.0M split): val loss 0.474→0.372 over 15 epochs (still falling — more epochs/continuations pay; noted for round 1), test WDL acc 70.5%. **Counting-slice acc 92.0%** on 231,703 counting-active test rows — no endgame bleed, spec's KMITL-distillation trigger (<85%) NOT fired (probe = corpus counting-active slice, the v1 replacement for raw KMITL replication). int8-vs-float WDL-argmax agreement **96.1%** — passes the spec acceptance (≥75%; that number was Moka's shadow-match scale); a stricter 99% did not pass — near-tie flips in the draw-heavy corpus; revisit if arena results disappoint. Export convention corrected during gating (per-output-channel scales everywhere: ft per L1-neuron, Linears per out-row). Incumbent artifact: `out/v1/makruk-tiny-v1-cfa18938c811.{bin,json}` = **203.9 KB**. Train wall time: ~13 min load + 15×2 min epochs (RTX 3050).

**M1 — 2026-08-01: PASSED (stats reviewed).** `tools/data/bootstrap-v1.jsonl`: 10,002,463 rows / 47,791 games at ~3,260 pos/s (51 min wall). w=25.7% d=48.7% l=25.5%; **46.5% counting-active rows** (board-honor auto-start + long endgames — the skew we designed for); eval p50=0 p98=±982, 5.3% in-check nulls; 5,209 max-plies discards (9%). DAgger rounds should rebalance toward decisive on-policy positions.

**M2 scaffolding — 2026-08-01: READY (gate pending real corpus).**
`training/` stack built: `makruk/features.py` (768 features, stm-canonical rank-flip, F→met fold, 9 counting channels), `dataset.py` (whole-game crc32%10 split), `model.py` (EmbeddingBag FT + clip-ReLU + tail→WDL3), `quantize.py` (per-channel int8 STE QAT), `export.py` (bin+JSON manifest, sha256, fingerprinted names), `train.py` (AdamW 1e-3, QAT from epoch 1, 50/50 WDL-CE + masked eval-MSE). Env: `training/venv` with torch 2.13.0+cu130 on Python 3.14 (CUDA live on RTX 3050). Dry-run on the 12k-row smoke file: split healthy (70/11/7%), 206,531 params, **export = 206.9 KB** (under the 0.5 MB floor), 0.5 s/epoch on GPU. Dry-run accuracy is mechanics-only, not measured quality. Also fixed during M0→M2: datagen rows now carry `counting` state per row (side-channel source) — bootstrap corpus must be generated with the patched harness.

**M0 — 2026-08-01: PASSED (gate ≥1,000 pos/s; measured 2,911 pos/s).**
`scripts/datagen.mjs` built; own-harness path confirmed, no `variant-nnue-tools` fallback needed. Smoke corpus `tools/data/smoke.jsonl`: 12,248 rows / 65 games (~4.2 s). Findings:
- Fairy suppresses search-info lines below ~1.5 s → **labels = static NNUE `eval`** (depth-0) as specced in §3's label design; parser fixed for signed values (`+1.71` was silently zeroed — caught in smoke review). In-check positions get `eval: null` (5.9%).
- First-move depth 3 + skill-3 openings yields ~54% draw labels (counting-rule draws present and correctly adjudicated) — high draw share noted for the M1 corpus-stats review; accept or raise opening strength there.
- max-plies aborts (~18% of games) discarded by design (unlabelable).
- FEN roundtrip clean on samples; oracle is the sole adjudicator.

## Appendix: decision provenance

| Decision | Ticket |
|---|---|
| Moka recipe lessons (QAT, DAgger, gating, soups) | `.scratch/makruk-strength/issues/01-moka-recipe.md` |
| Fairy tooling + official net + datagen options | `.scratch/makruk-strength/issues/02-fairy-nnue-tooling.md` |
| Landscape + fairy's exploitable gaps + KMITL | `.scratch/makruk-strength/issues/03-makruk-engine-landscape.md` |
| Net family + WDL value-only | `.scratch/makruk-strength/issues/04-eval-architecture.md` |
| Two-bar, two-tier benchmark | `.scratch/makruk-strength/issues/05-benchmark-methodology.md` |
| Native fairy binary + net installed | `.scratch/makruk-strength/issues/06-native-fairy-binary.md` |
| Teacher, own-harness datagen, cadence | `.scratch/makruk-strength/issues/07-training-plan.md` |
| Counting side-channels + probe set | `.scratch/makruk-strength/issues/08-counting-rule-eval.md` |
| Handoff: one net, rungs, manifest | `.scratch/makruk-strength/issues/09-handoff-artifacts.md` |
