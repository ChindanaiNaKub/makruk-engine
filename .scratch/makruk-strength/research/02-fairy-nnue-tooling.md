# Research: Fairy-Stockfish NNUE tooling for Makruk (ticket 02)

Date: 2026-08-01. Rig assumed: 16 CPU cores, RTX 3050 Laptop 4 GB (CUDA sm_86, confirmed via nvidia-smi), 15 GB RAM, 255 GB free disk.

## Summary

- **Makruk has an official, variant-aware NNUE net**: `makruk-a8c621e24a8c.nnue` (47.7 MB, +248 Elo vs fairy's classical eval), shipped both as a runtime-loadable file and as embedded Linux binaries (`fairy-stockfish-NNUE` releases). Fairy's built-in makruk enforces the real rules in datagen/self-play: `countingRule = MAKRUK_COUNTING`, `nMoveRule = 0` (`src/variant.cpp:156-174`).
- **Datagen exists and is variant-generic**: the `variant-nnue-tools` fork of Fairy-Stockfish exposes `generate_training_data` (Stockfish-learn gensfen port) with prebuilt Linux x86-64 binaries; the sister repo `variant-nnue-pytorch` trains nets from the `.bin` data (HalfKAv2 feature set, CUDA required, `serialize.py` → `.nnue`).
- **The official makruk net is 47.7 MB — 50–100× over our 0.5–1 MB budget**, and fairy's HalfKAv2 makruk architecture has a ~6.5 MB theoretical floor (king-square factorization); so the plan is **distill, don't ship**: use fairy's net/classical eval as a *teacher* to label positions, then train a custom small net for our Rust engine.
- **Mainline Fairy-Stockfish itself has NO learn/gensfen commands** — datagen lives only in the tools fork. Native Linux binaries are downloadable for everything needed; no source build strictly required (latest fairy release: `fairy_sf_14`; makruk NNUE binary: tag `makruk-a8c621e24a8c`).
- **Public makruk game data exists**: `gbtami/pychess-variants-games` — monthly pychess.org PGN dumps (bz2), 2019-07 → 2024-03, ~476 MB repo. Mixed variants per file; makruk games are filterable via PGN headers. Useful for opening-book seeds, not as strong labels.

## Findings

### Fairy's makruk + NNUE status

- `src/variant.cpp:156` (`makruk_variant()`): `countingRule = MAKRUK_COUNTING` (line 172), `nMoveRule = 0` (no 50-move rule), promotion to MET on ranks 6-8. Cambodian inherits and uses `CAMBODIAN_COUNTING` + `nnueAlias = "makruk"` (makruk nets work for it). So **fairy datagen/self-play already plays the same adjudicated game the site does** (mirror-perft validates movegen against this same codebase).
- Official net: `makruk-a8c621e24a8c.nnue`, 47,721,376 bytes (measured via HTTP content-length on raw file), +248 Elo vs classical (fairy-stockfish.github.io/nnue list, author belzedar_, 2022-09-19). Downloads:
  - raw file: `https://raw.githubusercontent.com/fairy-stockfish/Fairy-Stockfish-NNUE/master/makruk-a8c621e24a8c.nnue`
  - Google Drive: `https://drive.google.com/u/0/uc?id=1jOhdVe1VBZjBaPWO2IYR1_iscyMA0ylW&export=download`
  - embedded binary: `https://github.com/fairy-stockfish/Fairy-Stockfish-NNUE/releases/download/makruk-a8c621e24a8c/fairy-stockfish_x86-64-bmi2` (Linux; also plain/modern + Windows). Requires Fairy ≥ 14 (`nnueAlias`/HalfKAv2 era).
- **Local browser baseline check**: `../markrukthai-1/node_modules/fairy-stockfish-nnue.wasm/` is v1.1.11, total size 1.6 MB (`stockfish.wasm`) → it embeds **no** NNUE net. Our match-arena "fairy skill 20 full strength" opponent = fairy classical eval + Stockfish search. The wasm port *can* load a net at runtime (official demo does), so the site could arm fairy with the 47 MB net later — flag for the spec's baseline definition.

### Datagen tool (`variant-nnue-tools`)

- Repo: <https://github.com/fairy-stockfish/variant-nnue-tools> (Fairy-Stockfish + Stockfish `learn` branch machinery). Command is `generate_training_data` (UCI subcommand); `trainer_config <variant> <dir>` writes the trainer's `variant.h`/`variant.py` config for you.
- Prebuilt binaries (latest tag `tools-220426`, Apr 2022): `fairy-stockfish-tools_x86-64-bmi2` etc. at <https://github.com/fairy-stockfish/variant-nnue-tools/releases>. Makruk is 8x8 → the **non-`largeboard`** binary suffices. Dev builds exist as GitHub Actions artifacts.
- Canonical datagen recipe (wiki "Training data generation"): for makruk with the NNUE teacher:
  ```
  uci
  setoption name Use NNUE value pure
  setoption name EvalFile value makruk-a8c621e24a8c.nnue
  setoption name Threads value 14
  setoption name Hash value 2048
  setoption name UCI_Variant value makruk
  isready
  generate_training_data depth 2 count 100000000 random_multi_pv 4 random_multi_pv_diff 100 random_move_count 8 random_move_max_ply 20 write_min_ply 5 eval_limit 10000 set_recommended_uci_options data_format bin output_file_name makruk.bin
  quit
  ```
  (Use `Use NNUE value false` + drop `EvalFile` for the classical-teacher bootstrap path. Resumable: rerun same command to append. Optional `book startingpositions.epd` arg.)
- Output: single `.bin` file; position record = 512-bit packed sfen (custom Huffman layout, `src/tools/sfen_packer.cpp`), + move/score/result — ≈72–80 B/position → 100M positions ≈ 7–8 GB. Wiki recommends ≥100M positions for a decent net; depth 4–5 "quite good" but much slower.
- **Format is NOT binpack and NOT official-SF bin** (512-bit vs 256-bit) → readable only by `variant-nnue-pytorch`, or by a parser we write from `sfen_packer.cpp` (needed anyway if we distill into a custom net).

### Trainer (`variant-nnue-pytorch`)

- Setup: Python ≥3.9 venv, `pip install -r requirements.txt` (CUDA 11.8 torch; CUDA 12.8 variant available), then compile C++ data loader (`sh compile_data_loader.bat`); pytorch-lightning **<1.5** required (FAQ).
- Train: `python train.py --gpus 1 --threads 1 --num-workers 1 --max_epochs 10 train.bin val.bin` (1 epoch ≈ 20M positions). Convert: `python serialize.py logs/.../last.ckpt makruk.nnue`. Resume from the official net: `python serialize.py --features='HalfKAv2^' makruk-a8c621e24a8c.nnue start.pt` then `--resume-from-model`.
- Architecture: HalfKAv2^ factorized; for makruk, input features = `KING_SQUARES(64) × [64 squares × (2·6−1 piece planes)]` = **45,056 inputs**; L1=512, L2=16, L3=32 hardcoded in `model.py` (editable constants). Net size ≈ `features × (L1+8) × 2 B` → official sizing = 45,056×520×2 ≈ 46.9 MB ✓ (matches 47.7 MB file with headers/later layers).
- **Budget math for our 0.5–1 MB cap**: fairy-format floor at L1=64 ≈ 45,056×72×2 ≈ 6.5 MB — still too big. To hit 1 MB we must drop king-square factorization (e.g., plain piece-square features: 768 inputs × 264 × 2 B ≈ 0.4 MB at L1=256) → **custom tiny trainer on the same `.bin` labels** (parse via our own code) rather than shipping fairy-format nets. Fairy nets stay useful as teacher + sparring partner.
- Kaggle/Colab demo notebooks exist if the 3050 4 GB struggles (wiki links them).

### Binaries / builds

- Main fairy latest release `fairy_sf_14`: `fairy-stockfish-largeboard_x86-64` Linux binary (README front page). All variants built in by default; NNUE = runtime `EvalFile` option; nothing variant-specific needed at build time. Source build: standard `cd src && make -j profile-build ARCH=x86-64-bmi2` (wiki "Compiling Fairy-Stockfish").
- "anofox": no such fairy fork — `github.com/anofox` is an unrelated user. Real related forks: `ianfab` (author's pre-org repos), `gbtami/variant-nnue-tools` + `gbtami/variant-nnue-pytorch` (pychess author's copies, no known divergent features), `ianfab/YaneuraOu@fairy_bin` (shogi-only alternative generator).

### Public makruk games

- `gbtami/pychess-variants-games` (GitHub, ~476 MB): `pychess_db_YYYY-MM.pgn.bz2`, 2019-07 through 2024-03, all pychess variants mixed per month. Filter PGNs by variant header for makruk; pychess is the highest-traffic makruk site, so expect a six-figure game count. Casual human games of all levels → weak labels; best use = EPD opening book for the generator or sanity-check data.
- No lichess-style rated bulk API for pychess; database.pychess.org does not resolve. No other machine-readable makruk game corpus found.

## Feasible datagen options ranked

1. **NNUE-teacher self-play distillation** (best label quality; teacher is +248 Elo over the very baseline we must beat):
   - Download tools binary + official net; run recipe above with `Use NNUE pure`, depth 2, count 100–200M, Threads 14.
   - Est. throughput (no official figures — calibrate with a 10M smoke run; tool prints fens/s): ~2–8k pos/s total with NNUE teacher on 14 threads → **~1–3 days** for 150M positions. ~12 GB disk.
2. **Classical-teacher bootstrap, bigger & deeper** (no net-compat risk, fastest per position — how most community nets incl. belzedar's were made):
   - Same recipe but `Use NNUE value false`, depth 3–5, count 200M. Est. **overnight–2 days** for depth 3, longer for 5.
   - Can chain: train v1 net from classical labels, then regenerate with v1 as teacher (standard fairy community loop).
3. **Fine-tune a fairy-format net from the official makruk net** (`--resume-from-model`): only worthwhile if we later implement a fairy-`.nnue` loader in Rust — skip for the 1 MB goal.
4. **pychess human games** (`pychess-variants-games`): extract makruk PGNs → opening-book EPD seeds for option 1/2 (`book seed.epd`) — cheap diversity boost, do alongside, not instead.

Training the net afterward on this rig: RTX 3050 4 GB fits makruk's model (FT weights 45,056×520 fp32 ≈ 94 MB; +Ranger moments ≈ 0.4 GB). Community-sized runs (200M pos, ~10 epochs) are single-digit-to-low-double-digit **GPU-hours** on a 3050-class card — feasible locally; Kaggle P100 free tier is the documented fallback.

## Risks/unknowns

- **Release skew**: tools binary is Apr 2022; the makruk net is Sep 2022. If the tools release rejects `EvalFile` with ERROR, build `variant-nnue-tools` from source (same make as fairy). Unverified until first run.
- **Counting-rule fidelity**: labels inherit fairy's `MAKRUK_COUNTING` semantics. That's exactly our benchmark opponent's rules, but the *site's* authority is markrukthai `engine.ts`/`makrukRules.ts` (pieces-honor checked before mate). Any fairy↔site adjudication divergence silently ships into labels — verify a handful of counting endgame FENs through both.
- **Throughput numbers above are extrapolations**, not measurements — first milestone must be a timed 10M-position smoke run.
- **WASM baseline drift**: current in-browser fairy has no NNUE (1.6 MB pkg); if markrukthai-1 later loads `makruk-a8c621e24a8c.nnue` into fairy-wasm, the "full strength" target moves by +248 Elo. Spec should pin the baseline artifact.
- 4 GB VRAM: reduce `batch-size` below default 8192 if OOM; laptop thermals may throttle multi-hour GPU runs. pytorch-lightning `<1.5` pin conflicts with modern envs — dedicated venv required.
- Trainer only outputs fairy-format nets; a loader or custom-feature reimplementation in Rust is an implied work item for any eval side.

## Sources

- <https://github.com/fairy-stockfish/Fairy-Stockfish> (README: makruk NNUE releases pointer)
- <https://github.com/fairy-stockfish/Fairy-Stockfish/blob/master/src/variant.cpp> (makruk_variant, countingRule)
- <https://github.com/fairy-stockfish/Fairy-Stockfish-NNUE> + releases tag `makruk-a8c621e24a8c`
- <https://fairy-stockfish.github.io/nnue/> (net list: makruk +248 Elo; file size measured 47,721,376 B)
- <https://github.com/fairy-stockfish/Fairy-Stockfish/wiki/NNUE>
- <https://github.com/fairy-stockfish/variant-nnue-tools> (+ releases `tools-220426`)
- <https://github.com/fairy-stockfish/variant-nnue-pytorch> (+ wiki: Introduction, Training-data-generation, NNUE-training, Technical-details, FAQ, Step-by-Step-Guide)
- <https://github.com/gbtami/pychess-variants-games> (monthly pychess PGN dumps 2019-07→2024-03)
- Local: `../markrukthai-1/node_modules/fairy-stockfish-nnue.wasm/package.json` (v1.1.11, no embedded net); `scripts/match-arena.mjs`; `nvidia-smi` (RTX 3050 Laptop 4 GB)
