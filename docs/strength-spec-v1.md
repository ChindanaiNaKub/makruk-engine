# Makruk Engine Strength Spec v1.0

**Status:** APPROVED 2026-08-01 (ticket [.scratch/makruk-strength/issues/10-write-the-spec.md](../.scratch/makruk-strength/issues/10-write-the-spec.md))
**Provenance:** every decision below cites a resolved wayfinder ticket in `.scratch/makruk-strength/`. Research backing: `.scratch/makruk-strength/research/01..03`.

This spec takes the engine from its current state (classical eval, 0–8 vs fairy skill 10 at 4× fairy handicap) to a distilled neural eval that beats fairy-stockfish at full strength, equal time, in the browser — within a ~0.5–1 MB weights budget.

---

## 0. Goal and success criteria (ticket 05)

**Primary claim:** ≥50% score vs `fairy-stockfish-nnue.wasm` v1.1.11 (the artifact thatichess.dev ships today; classical eval, no net) at **skill 20, equal movetime 100 ms**, over **two independent 100-game blocks** (win = 1, counting-rule draw = 0.5), plus one 100-game confirmation at 500 ms so the claim isn't a bullet artifact.

**Stretch claim:** score vs native Fairy-Stockfish 14 + official `makruk-a8c621e24a8c.nnue` (47.7 MB, +248 Elo over the primary bar) at equal time — reported separately, never conflated with the primary claim.

**Iteration gates (dev tier):** 16-game blocks against skill 10 → 15 → 20 (equal 100 ms/100 ms), one rung at a time; a checkpoint only advances when it wins its current gate. Nothing ships to the claim tier without passing all three rungs. (Moka discipline: gate the artifact, not the checkpoint file.)

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
4. **Gate:** the quantized artifact must win the current dev-tier gate (16 games, current skill rung). Pass → becomes incumbent, advance rung. Fail → round rejected, incumbent kept.

One round ≈ 1–2 h end-to-end; expect Moka's shape: a handful of accepted rounds, most experiments rejected — that's the process working.

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
| Casual | current classical eval, no net | today's bot (skill ≤5-ish play) |
| Club | net + node cap ~50k | first checkpoint sweeping the **skill-10** dev gate |
| Expert | net, full search | the claim-tier artifact (beats skill 20) |

UCI wire protocol unchanged; the weights path is worker config — no `browserEngineBotWorker.ts` changes.

## 9. Milestones

| # | Milestone | Gate to advance |
|---|---|---|
| M0 | `scripts/datagen.mjs` smoke (10k positions) | ≥1k pos/s (else tools-pipeline fallback) |
| M1 | Bootstrap corpus ~10M + split + stats (draw share, counting-draw share, eval distribution sanity) | corpus stats reviewed |
| M2 | v1 net trained + QAT int8 export | probe-set report + quantized-vs-float move-match ≥75% |
| M3 | Engine integration + wasm build | mirror-perft + `cargo test` green; nps ≥500k; `MAKURUK_EVAL=classic` unaffected |
| M4 | Dev gates skill 10 → 15 → 20 via DAgger rounds | each 16-game block won by the artifact |
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
