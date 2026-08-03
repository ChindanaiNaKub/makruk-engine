# How to make our net stronger — research findings (ticket 04)

Primary-source-only answers to: which proven levers (architecture, data, labels, loss, distillation)
make NNUE nets beat a handcrafted classical eval, for a tiny 8x8 variant (Makruk). Sources: official
Stockfish `nnue-pytorch` repo + wikis, Stockfish engine source + release notes, Fairy-Stockfish +
`variant-nnue-pytorch` wikis, `jw1912/bullet`. Local context: our r3 net loses to classic twice
(44.2%, 37.2% Gate A); classic probe top-1 34.4%, r3 38.1%; label ceilings d0 36.9 / d6 45.9 /
d8 58.1 (local: `AGENTS.md`, `docs/strength-spec-v1.md`).

**Execution is PARKED (rig map open). Everything below is levers to pull later, nothing is to be
run now.**

## Summary

- **An NNUE beating a classical eval on the same game is already documented first-party**:
  Fairy-Stockfish's official Makruk net `makruk-a8c621e24a8c.nnue` is listed at **+248 Elo vs the
  classical eval** (fairy-stockfish.github.io nnue list, line `makruk`, 2022/09/19, author
  "belzedar_ in discord"). https://github.com/fairy-stockfish/fairy-stockfish.github.io/blob/main/nnue.markdown
  Our failure mode is therefore not "NNUE can't beat classical on makruk"; it is scale/recipe.
- The variant recipe is boring and small: Fairy self-play `generate_training_data`, **≥100M
  positions** (10x more than our corpus), **depth 2–5** labels from the *classical* eval (even less
  than our d6), iterative re-generation with the current best net (`Use NNUE value pure`), Fairy
  HalfKAv2 arch (FT 512, 8 PSQT/LS buckets). Sources: variant-nnue-pytorch wiki
  `Training-data-generation`, `NNUE-training`, `Technical-details`.
- The Stockfish recipe at master scale is the same shape: self-play, `random_multi_pv 4`, **depth 9
  "sweet spot"**, 16–18**B** positions, game results + search scores mixed via lambda
  (default λ=1.0 pure eval; canonical schedule 1.0→0.75); later retrained on Lc0-derived data.
  Sources: nnue-pytorch wiki `Training-datasets`, `Basic-training-procedure-(easy_train.py)`,
  `model/nnue.py`, `model/lambda_utils.py`.
- Our two structural deficits vs every proven recipe: **corpus size (10M vs 100M–16B)** and
  **inference speed (f32 dequantized eval, ~5x slower nps than classic)**. Our loss mix
  (`(1-LAM)*WDL_CE + LAM*eval_MSE` at LAM≈1) is *already* the SF convention, so the loss is not
  the missing lever.

## 1. Architecture — what changed since HalfKP, and gains

Lineage (dates + commits from nnue-pytorch `docs/nnue.md` "Historical Stockfish evaluation network
architectures", lines 2993–3154; https://github.com/official-stockfish/nnue-pytorch/blob/master/docs/nnue.md):

| arch | dates | change | commit |
|---|---|---|---|
| SFNNv1 | 2020-08 | "Stockfish 12 arch": HalfKP 41024→(256)x2→32→32→1 | `84f3e86` |
| SFNNv2 | 2021-05 | | `e8d64af` |
| SFNNv3 | 2021-08 | HalfKAv2_hm | `d61d385` |
| SFNNv4 | 2022-02 | (SF15: "fourth generation NNUE", 1024 L1) | `cb9c259` |
| SFNNv5 | 2022-05 | | `c079acc` |
| SFNNv6 | 2023-05 | L1 1024→1536 | `c1fff71` |
| SFNNv7 | 2023-07 | L1→2048 | `9155321` |
| SFNNv8 | 2023-09 | L1→2560 | `782c322`/`70ba9de` |
| SFNNv9 | 2024-04 | L1→3072 | `0716b84` |
| SFNNv10 | 2025-11 | **FullThreats inputs**, L1 back to 1024, FT quant scale 255 | `8e5392d` |
| SFNNv16 | 2026-07 | PP_3Wide pair features | `f4bcd40` |

Mechanisms and claimed effects (nnue.md lines 2865–2992):

- **HalfKAv2**: merges the two king planes (768→704 features per king square, ~8% smaller FT)
  (lines 2865–2867).
- **HalfKAv2_hm**: king-side horizontal mirroring halves input features; "Stockfish uses this
  feature set since early August 2021 to support large feature transformers" (lines 2869–2873).
- **PSQT slice + 8 output buckets ("layer stacks")**: extra FT column(s) used as direct PSQT
  output; bucket discriminator `(piece_count-1)/4`, 8 PSQT + 8 sub-net buckets (lines 2897–2990;
  this is SFNNv5-era and still in master: `PSQTBuckets=8; LayerStacks=8`,
  `src/nnue/nnue_architecture.h` master, fetched 2026-08-03). Trainer trick: evaluate all buckets
  and select, `model/model.py:100–104`, `model/modules/layer_stacks.py`.
- **Master today**: `FullThreats` + `PP_3Wide` threat/pair features with HalfKAv2_hm PSQT, L1 1024,
  L2/L3 32, `SqrClippedReLU` layers (`src/nnue/nnue_architecture.h`). Threats are an add-on
  carrying "many minor corrections", i8-quantized for bandwidth (+5% x86, +10% ARM speed)
  (nnue.md lines 2875–2895).

Measured release-level gains (release notes are the primary source; per-change net gains land as
fishtest-linked tests inside each):

- SF15 vs SF14: **+36 Elo**, "4th generation NNUE" — https://github.com/official-stockfish/Stockfish/releases/tag/sf_15
- SF16 vs SF15: **+50 Elo**, SFNNv6 `c1fff71` + sparsity inference `38e6166` + net compression
  `a46087e` — https://github.com/official-stockfish/Stockfish/releases/tag/sf_16
- SF16.1 vs SF16: **+27 Elo**, SFNNv8, **Dual NNUE** (small net for easy positions, commit
  `584d9ef`), HCE removed (`af110e0`) — https://github.com/official-stockfish/Stockfish/releases/tag/sf_16.1
- SF17 vs SF16: **+46 Elo** — https://github.com/official-stockfish/Stockfish/releases/tag/sf_17

Counterweight (first-party): bullet's docs warn SF architectures "require **significant** effort,
amounts of data, and/or training time/complexity to actually gain elo … an engine may actually
*lose* elo with an SF architecture vs a much simpler one"; Alexandria 7.0.0 is `(768->1536)x2->1x8`
"— that is *no* input buckets and only a single hidden layer" — and sits 6th on CCRL Blitz 1CPU.
https://github.com/jw1912/bullet/blob/main/docs/1-basics.md ("Beginner Traps").

**Portable to Makruk (8x8, 6 piece types)**: everything "post-FT" is portable and small — PSQT
slice, piece-count output buckets, L1 512–1024, SCReLU, factorizer, dual-net. King-relative
HalfKAv2 is exactly what Fairy ships for makruk (see §4) but costs a 45,056-feature FT
(≈ 64·64·11 · (L1+8) · 2B/file) — fine native, hostile to wasm. FullThreats/PP_3Wide are *not*
portable (attack-set semantics are variant-specific; huge feature count). hm-mirroring halves the
FT but its legality depends on variant symmetry (makruk's K/M right-of-king setup is not
file-mirror invariant); Fairy did not use hm for variants.

## 2. Training data — how Stockfish labels today

- Stockfish keeps a `tools` branch with the training-data generator; self-play games, positions
  collected with their evaluations. vondele's last big run: `generate_training_data depth 9 count
  18000000000 random_multi_pv 4 random_multi_pv_diff 100 … book noob_3moves.epd`, Threads 250 —
  a **16B-position** dataset. https://github.com/official-stockfish/nnue-pytorch/wiki/Training-datasets
  (branch: https://github.com/official-stockfish/Stockfish/tree/tools).
  "depth 9 still seems to be the sweet spot" (same page, Good datasets).
- Fixed-*nodes* data (`nodes5000pv2_UHO.binpack`, 5000 nodes/move) is "at least on par" and best
  with UHO books (same page).
- **Lc0-derived rescored data beats SF self-play data**: "Datasets produced in this way are of
  higher quality … generally end up producing better networks" (same page; rescorer:
  https://github.com/Tilps/lc0/tree/rescore_tb). SF17 release: Leela "continues to provide open
  data which is essential for training our NNUE networks".
- **Curriculum order matters**: "best to first train a network with datasets generated with
  Stockfish (depth 9, nodes 5000), and then retrain … using various Lc0-derived datasets"; and
  "high quality datasets … achieve better results when used to retrain a network trained on lower
  quality datasets … than when training on the high quality datasets from zero".
  https://github.com/official-stockfish/nnue-pytorch/wiki/Basic-training-procedure-(train.py) ("Restarting from an existing model").
- **Quality/learnability tension, stated up front**: "Datasets with more 'positional' evaluations
  might be better … Better evaluations don't always give better results, as it's a tradeoff between
  quality and learnability." (Training-datasets, "What makes a good dataset").
- Filters in the loader: smart fen-skipping removes samples where bestmove is a capture; wld
  fen-skipping drops eval/result-inconsistent samples; `--random-fen-skipping 3`.
  https://github.com/official-stockfish/nnue-pytorch/wiki/Basic-training-procedure-(train.py) ("Additional parameters").
- Fairy/variant datagen (the recipe the makruk net came from): `generate_training_data depth 2
  count 10000000 random_multi_pv 4 random_multi_pv_diff 100 … eval_limit 10000` with **`Use NNUE
  value false`** (classical eval) for a first net; "Usually at least **100M positions** should be
  used … Depths **4-5** usually already give quite good results"; for later rounds, use the current
  best net `Use NNUE value pure` — i.e., a documented **self-distillation/regeneration loop**.
  https://github.com/fairy-stockfish/variant-nnue-pytorch/wiki/Training-data-generation
  Bucketing scale check: our whole corpus (~10M bootstrap + repaired DAgger) is ~10x below the
  stated 100M variant floor, ~1000x below SF master's 16B.

## 3. Loss / target mixing — what lambda actually does

- Current code (nnue-pytorch `model/nnue.py:39–70`): both the net output and the search score are
  mapped to a win-probability with the win-rate model (`sigmoid((x-offset)/scaling)`, defaults
  offset 270, scaling 340 in / 380 out — `model/config.py` `LossParams`). Then
  `pt = pf*λ + outcome*(1-λ)` — interpolation of **targets before** the loss; loss =
  `|pt - qf|^pow_exp`, `pow_exp` default **2.5**. (Docs describe the same and note exponent 2.6
  worked: `docs/nnue.md:847–891`.)
- `lambda` semantics: **1.0 = pure search-score targets, 0.0 = pure game results**
  (`model/lambda_utils.py:9–14`, `model/config.py` `LambdaConfig` docstring; variant trainer
  `train.py:29` same default 1.0). Schedule: linear interpolation between `--start-lambda` and
  `--end-lambda` over steps, with optional cyclic cosine and per-sample/batch jitter
  (`model/lambda_utils.py:22–84`).
- Canonical values: easy_train master invocation uses `--start-lambda=1.0 --end-lambda=0.75`
  (i.e. end ≈ 75% eval / 25% outcome). https://github.com/official-stockfish/nnue-pytorch/wiki/Basic-training-procedure-(easy_train.py)
- bullet's community recipe blends targets the other way round: `target = wdl*result +
  (1-wdl)*sigmoid(score/400)`, example default `wdl = 0.75` (result-heavy), loss sigmoid+MSE,
  SCALE 400. https://github.com/jw1912/bullet/blob/main/examples/simple.rs
- QAT is the default: `use_fake_act_quantization: bool = True`, `use_fake_weight_quantization: bool
  = True` (`model/config.py` `NNUELightningConfig`); weights are clipped to quantization-safe
  ranges each step (`model/model.py:41–71`, ±1.98 etc. in `docs/nnue.md:2157–2232`).
- **Mapping to ours**: makruk-engine `--eval-weight LAM` with `(1-LAM)*WDL_CE + LAM*eval_MSE`
  (`training/train.py:77–88`) has **the same semantics as nnue-pytorch λ** (weight on eval), and
  our corpus rows already carry **oracle-adjudicated game outcomes** (`scripts/datagen.mjs` header:
  `{fen,eval,wdl,game,ply}`, wdl = final outcome from STM) — so our lam0.97 ≈ SF's λ≈0.97. SF's
  default is *also* eval-only (λ=1.0) with an outcome mix added over the course of training. Conclusion:
  the loss knob is not why our nets lose; an SF-style 1.0→0.75 schedule is a cheap honorable-mention
  tweak, not a fix.

## 4. Fairy/variant specifics

- Arch (Fairy engine master `src/nnue/nnue_architecture.h:35–40`): `HalfKAv2Variants`, FT dims
  **512**, `PSQTBuckets=8`, `LayerStacks=8`. Generalized input formula (variant trainer wiki
  `Technical-details`):
  `INPUT_FEATURES = KING_SQUARES * [RANKS*FILES*(2*PIECE_TYPES-1) + drops]`, with KING_SQUARES=1
  for king-less variants and palace-mapped counts for Xiangqi/Janggi. File-size lower bound:
  `SQUARES*KING_SQUARES*PIECE_TYPES*2080` bytes (int16 FT, 520 = 512+8 PSQT per feature row).
- Makruk instantiation: KING_SQUARES=64, PIECE_TYPES=6 → 64·64·11 = 45,056 features →
  ≈ 64·64·6·2080 B ≈ **49 MB** net, `(45056 -> 512)x2 + 8 PSQT -> [32->32->1]x8`. This matches the
  shipped artifact `makruk-a8c621e24a8c.nnue` (+248 vs classical),
  https://github.com/fairy-stockfish/fairy-stockfish.github.io/blob/main/nnue.markdown.
- Training provenance: no first-party training log/corpus is published for the makruk net itself;
  the documented path (variant wiki `NNUE-training`, `Training-data-generation`, `Step-by-Step-Guide`)
  is: classical-eval self-play data at depth 2–5, ≥100M positions, train with
  `variant-nnue-pytorch/train.py` (default `--lambda=1.0`, epoch = 20M positions), then regenerate
  data with the best net so far (`Use NNUE value pure`) and repeat. Strength deltas of candidate
  nets are validated by playing games against the previous best (variantfishtest).
- Fairy nets inside the engine are incremental int16 accumulators, exactly as in Stockfish — the
  eval is not recomputed from scratch per node.

## 5. Distillation & label depth — what the sources say

- "depth 9 still seems to be the sweet spot" for Stockfish self-play labels (nnue-pytorch wiki
  Training-datasets). For variants: "A higher depth generally should be better, but also takes much
  longer … Depths 4-5 usually already give quite good results" (variant wiki Training-data-generation).
- The compensating axis is explicitly **quantity + diversity**, not depth: `random_multi_pv 4`,
  `random_multi_pv_diff 100`, books; overshoot-quality caveat: "Better evaluations don't always
  give better results … tradeoff between quality and learnability" (Training-datasets).
- The strongest publicly documented data quality jump is **not deeper search labels but
  Lc0-rescored data** (policy+value-network labels + endgame rescoring). (Training-datasets.)
- Selection metric caution (applies to our probe-top-1 story): validation loss "depends on the
  dataset … In these cases it is necessary to **play the games** with the networks being produced"
  (Basic-training-procedure-(train.py), "What to expect"); easy_train's testing loop plays each
  candidate net against the baseline engine with ordo ranking. Nobody in the proven pipelines
  selects nets on top-1 agreement with a teacher.
- Reading for our numbers (d0 36.9 → d8 58.1 top-1 vs fairy d12): the ceiling measures *how well a
  net can mimic fairy*, not *how well it plays vs classic*. First-party practice says: spend the
  same label budget as 10–30x more positions at depth 2–5, regenerated on-policy with the current
  best net, and select by games.

## 6. Inference cost — keeping accuracy while shrinking eval

- Canonical CPU quantization scheme (nnue.md lines 957–1005): int16 FT accumulators (ClippedReLU to
  int8), int8 weights w/ int32 accumulation in hidden layers, FT weights*127, hidden weights*64,
  weight clipping in the trainer; output `s_O` scaling. Our `src/nnue.rs` dequantizes everything to
  f32 at load and runs the forward pass in f32 (`table: Vec<f32>`, `Accumulator { v: [[f32; L1]; 2] }`)
  — ~5x nps penalty vs classic measured locally.
- bullet's reference export format + inference example: int16 everything, `QA=255, QB=64`, SCReLU
  in i16, 64-byte-aligned accumulators, full scalar fallback loop shown.
  https://github.com/jw1912/bullet/blob/main/examples/simple.rs (EXAMPLE INFERENCE section), and
  https://github.com/jw1912/bullet/blob/main/docs/4-saved-networks.md.
- bullet input layers also ship: `Chess768`, `ChessBucketsMirrored` (king input bucketing),
  factorized feature sets — `crates/bullet_lib/src/game/inputs/{chess768.rs,chess_buckets.rs,factorised.rs}`.
- Feature **factorizer** (train on virtuals, coalesce at export) — nnue.md lines 761–822 ("Real
  effect of the factorizer"); bullet `factorised.rs`.
- Activate SCReLU: used in SF master (`Layers::SqrClippedReLU`, `src/nnue/nnue_architecture.h`) and
  is bullet's example default — better accuracy at the same L1 (enables either a stronger net or a
  smaller/faster one).
- **Dual networks** (SF16.1 `584d9ef`): a small net for "easily decided" positions is an official
  pattern for clawing back nps without donating accuracy — directly relevant to us (e.g. classic
  eval for decided positions, net for balanced ones, or small-net/big-net).
- Local corroboration: research 01 (moka) — INT8 + QAT measured lossless at 105k params;
  `.scratch/makruk-strength/research/01-moka-recipe.md` §2.

## 7. Levers for makruk-engine, ranked

(What to change in OUR stack; cost class on this machine; strongest citation. PARKED — all future.)

1. **Corpus scale + on-policy regeneration loop (the Fairy recipe verbatim).** Datagen ≥100M rows
   fairy self-play with `Use NNUE value false` classical eval at depth 4–5 (we own fairy + our
   oracle); then regenerate with the best net armed (`Use NNUE value pure`) and retrain; repeat
   2–3 rounds. Fixes our 10x data deficit and the DAgger zero-deep-endgame hole (seed books of
   late-game FENs via the generator's `book` arg). Cost: datagen-run scale (days on this box,
   ~2,900 pos/s at 12 jobs ⇒ 100M ≈ 10 h + training). Citation:
   https://github.com/fairy-stockfish/variant-nnue-pytorch/wiki/Training-data-generation ("at least
   100M positions … Depths 4-5 … use [the current best net] in training data generation").
2. **Integer (int16/int8) QAT inference + SIMD accumulator.** Switch `src/nnue.rs` eval from f32
   dequantized to int16 accumulator → int8 hidden with per-nnue.md scaling, trained with fake-quant
   STE. Recovers the ~5x nps gap (net depth 5 → parity with classic at movetime 100), which is
   itself a strength lever at fixed movetime. Cost: days (engine + export + training flag). Citation:
   https://github.com/official-stockfish/nnue-pytorch/blob/master/docs/nnue.md#stockfish-quantization-scheme
   (lines 957–1005) + `model/config.py` (`use_fake_*_quantization=True`).
3. **Curriculum: classical-labeled bootstrap, then search-labeled retrain (d4–d5) of that same net.**
   Two-stage training documented to beat training from scratch on high-quality data alone. We
   already have `--label search`; retrain the r3 weights instead of restarting. Cost: one datagen
   run + one training run. Citation:
   https://github.com/official-stockfish/nnue-pytorch/wiki/Basic-training-procedure-(train.py)
   ("It is known that … better results when used to retrain a network trained on lower quality datasets").
4. **Arch bump within the proven shape: L1 256→512, +PSQT slice, +8 piece-count output buckets,
   SCReLU.** Keep 768 king-less inputs (data-thrifty per bullet's warning); all additions are
   parameter-cheap (buckets ×8 only on [32→32→1]) and directly address our missing endgame coverage
   (piece-count buckets specialize the bare-king/counting phase). Cost: day(s) of training+export
   format churn. Citation: nnue.md lines 2897–2992 (PSQT + layer stacks), bullet `examples/simple.rs`
   (`screlu`), and the counterweight https://github.com/jw1912/bullet/blob/main/docs/1-basics.md.
5. **SF-style λ schedule 1.0→0.75 + more epochs/runs with play-based selection.** Free knob; our
   corpus already stores true outcomes for the (1-λ) term. Runs are noisy ("at least one run from a
   set of 4 … relatively good quality"), so gate each candidate by arena, not by R². Cost: hours
   per arm + gate blocks. Citations: `model/lambda_utils.py`, easy_train wiki, train.py wiki
   "What to expect".
6. **(Possible shortcut) Port/parse the official `makruk-a8c621e24a8c.nnue` (Fairy HalfKAv2, 49 MB)
   as our incumbent engine net** — it is +248 over classical on Fairy's own core; native-only
   (too big for wasm). Cost: day(s) of format/accumulator port. Citation:
   https://github.com/fairy-stockfish/fairy-stockfish.github.io/blob/main/nnue.markdown and Fairy
   `src/nnue/nnue_architecture.h`.
7. **Dual-net fallback / speed hybrid** (classic eval on decided|large|eval| positions, net
   elsewhere). Cheap stop-gap while the net is slower. Cost: hours. Citation: SF16.1 release notes,
   Dual NNUE commit `584d9ef`.
8. **HalfKA(king-relative) feature set** (Fairy's actual input set). Skip unless levers 1–4 stall:
   it multiplies FT size ~59x (45056 features) and needs Fairy-scale data to pay off — bullet's
   beginner-trap warning applies at our corpus scale. Citation: variant wiki `Technical-details`;
   bullet `1-basics.md` "Massive input featureset".

## Contradictions of current repo beliefs

- AGENTS.md: "**The NNUE program has no artifact that beats the classical eval**" — true for our
  nets, but first-party Fairy data shows a variant NNUE **+248 Elo over classical** on the same
  game; the deficit is training-data scale + recipe, not an intrinsic NNUE ceiling.
- "Depth-8 labels give a 58.1% top-1 ceiling" framing suggests deeper labels are the lever; the
  only first-party label-depth statement for variants says depth **4–5** "quite good" and the SF
  sweet spot is **9** — against corpora of 100M–16B positions. Quantity ≫ label depth at our scale.
- "Net eval ~5x slower nps is intrinsic" — it is implementation-intrinsic (f32, dequantized at
  load), not NNUE-intrinsic: SF/Fairy/bullet nets are int16/int8 with STE training; the fix is
  quantization, which also *enables* the L1 bump.
- "Corpus cannot go stale" (AGENTS) is consistent with sources for fixed corpora, but the Fairy
  loop explicitly *regenerates* data with the current best net each round — corpus *level* (teacher
  strength) is what we haven't been moving.
- Our loss mix is already the SF convention (eval-dominated, results stored and mixable); the
  probe/R² metrics we gate on are not the selection metric used anywhere upstream (they all select
  by playing games — echoing AGENTS "Do NOT select artifacts on probe top-1", now with sources).

## 8. How sure are we — honest confidence per lever (added 2026-08-03)

Percentages below are **judgment, not measurement**. No one can guarantee a training round wins;
what can be pinned down is *which steps are plumbing and which are gambles*.

- **~90%: a trained net CAN beat a handmade makruk eval.** Verified 2026-08-03 against the source:
  `nnue.markdown` lists `makruk-a8c621e24a8c.nnue` at **+248 Elo vs classical** (2022/09/19,
  author belzedar_). Residual doubt: that number was measured by the net's author, not audited,
  and it beats *Fairy's* classical eval — not proven against *ours*.
- **~85%: lever 2 (integer QAT) works, and it is plumbing, not a bet.** Float→int inference is
  mechanical; every upstream pipeline does it; result is verifiable locally in minutes via nps.
  If it fails we know the same day, not after a week-long training run.
- **~50%: one full training round (levers 1+3) produces a Gate-A-beating net.** Honest coin flip.
  The levers are documented, but our pipeline has lost twice already and the single published
  success used Fairy's own trainer, not our PyTorch stack.
- **The dominant risk is this repo, not NNUE.** We have shipped three silent-result bugs
  (label-sign inversion, dead TT, zsh `env` eval bug). Execution risk explains the old failures
  better than "the idea is wrong."
- **Anti-waste ordering: cheap-certain first, gamble in stages.** Lever 2 first (~1–2 days eng,
  minutes to verify) → pilot corpus ~30M rows (**~3 h datagen** at the measured 2,897 pos/s,
  12 jobs) hard-gated → only scale to the ~100M / **~10 h** run if the pilot moves numbers.
  Pilot failure costs half a day of laptop time, not a round.
