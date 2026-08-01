# AGENTS

Rust Makruk engine. Sole rule authority: markrukthai `shared/engine.ts` + `shared/makrukRules.ts` — port faithfully, adjudication order matters (pieces-honor immediate draw is checked BEFORE mate).

## Commands
- Build native: `cargo build --release`
- Test: `cargo test --release` (must stay green)
- Mirror gate vs fairy: `FAIRY_DIR=../markrukthai-1/node_modules node scripts/mirror-perft.mjs`
- WASM: `npm run build:wasm` then `npm run test:wasm`

## Invariants
- wasm-bindgen pinned **0.2.100** with js-sys 0.3.77 (CLI/schema must match exactly — check before bumping).
- FEN accepts client letters: bia `P/p`, met `M/m`, promoted bia `F/f` (also tolerates fairy's `B/b`).
- `bestmove`/PV promotion moves MUST carry the `m` suffix (fairy rejects bare endpoints); internal `Move` stays 4-char.
- Startpos perft: 23 / 529 / 12012 / 273026. Any movegen change must keep mirror + tests green.
- `do_move`/`undo_move` must be perfectly symmetric (zobrist + counting roundtrip test).
- Search: no panics on stop; `bestmove (none)` only on game over; soft deadline never fires before iteration 1 (5× hard cap exists).
- Search-side repetition: nodes repeating `game.position_history` score 0 — do NOT add game-level repetition adjudication (site has none).
- Classic worker deploy: target `no-modules`, files sit beside `js/worker.js`.
- **`.cargo/config.toml` sets `-C target-feature=+simd128` for wasm32** (rustc defaults it OFF). Worth +43.7% net nps (213k → 307k) for +2 KB; search results are bit-identical (same nodes/score/PV at fixed depth). Do not drop it — the M3 "nps cost is intrinsic" note was measured on a scalar build. Browser floor: Chrome 91+, Firefox 89+, Safari 16.4+.

## Strength gate
`node scripts/match-arena.mjs --games 8 --skill N --movetime 100` (fairy gets 4×). Current: sweeps skill ≤0, ~even at 5 (counting-rule draws), shut out at 10.
Fast proxy gate: `node scripts/strength-probe.mjs --movetime 100` (add `MAKURUK_EVAL=net MAKURUK_WEIGHTS=...` for a net) — top-1 vs fairy depth-12 labels on `tests/fixtures/probe-v1.jsonl`, ~65 s. **movetime must be ≥100** (`src/search.rs:177` makes 50 ms depth-1). Rebuild the set with `scripts/probe-build.mjs`. Baselines: classic 34.4%, v1 22.2%, r2 19.7%.
`--nodes N` / `--depth N` equalize search effort instead: net eval runs ~332k nps vs classic ~885k, so a movetime probe scores eval quality and eval speed together. **Gate on movetime** (that is how it plays); use `--nodes 20000` to diagnose. At equal nodes: classic 33.4%, v1 21.6%, r2 18.1%.
Round-3 incumbent (`out/r3fixed/lam0.97/`, trained on the sign-repaired corpus): **36.6%** — beats classic and sits at the 36.9% depth-0 label ceiling. Discriminator vs classic 2W–1L–3D.
Diagnostics (see the M4 diagnosis entry in the spec): `node scripts/label-ceiling.mjs --depth 1` with `FAIRY_BIN`/`FAIRY_EVAL` — what the corpus's depth-0 labels are worth (36.9%; d6 45.9%, d8 58.1%). `node scripts/eval-spread.mjs` — sibling-move eval spread, i.e. whether the eval can order moves at all.
Datagen (spec §3): `node scripts/datagen.mjs --positions N --out tools/data/<name>.jsonl` — fairy self-play labels through our oracle; ~2,900 pos/s at 12 jobs. Teacher eval is White-relative (`Final evaluation … (white side)`) and every stored label is side-to-move relative — convert with `toStmCp`, never by comparing `evalSide` to `side` (that bug inverted 47% of the bootstrap corpus; see the M4 label-sign spec entry). Corpora predating 2026-08-02 need `node scripts/fix-eval-sign.mjs <in> <out>`; `dagger-r*.jsonl` must be regenerated instead (their Goldilocks weights are unpatchable).
Training (spec §4): `training/venv/bin/python -m training.train --data tools/data/<corpus>.jsonl --out out/<run>` then `-m training.export --ckpt out/<run>/last.pt --out out/<run>` (torch in `training/venv`).
`--eval-weight LAM` sets the loss mix `(1-LAM)*WDL_CE + LAM*eval_MSE`; comma-separated values sweep arms in one process (the 8M-row corpus loads once, ~13 min). `--sched cosine` for long runs. Per-epoch `evalR2` is the diagnostic that matters — v1 shipped at 0.255, which is why it lost.

## NNUE (v1, M3+)

`src/nnue.rs` + `training/`. Native: `MAKURUK_EVAL=net MAKURUK_WEIGHTS=out/v1/<artifact>.bin` (default/classic otherwise). Browser: `WasmEngine::init_nnue(binBytes)` (worker verifies sha256 via manifest). Agreement gate: `cargo test --release` includes python-fixture parity vs `out/v1/*.bin` (skips if absent). Net eval ≈200k nps wasm (classic 1.1M).

## Strength program (wayfinder)

Active effort: "Road to fairy full-strength parity" — map + tickets at `.scratch/makruk-strength/` (local-markdown tracker). Spec: `docs/strength-spec-v1.md`. Benchmark/opponent assets (gitignored): `tools/fairy/` (native Fairy-Stockfish 14 + official makruk NNUE); match-arena supports `FAIRY_BIN`/`FAIRY_EVAL` env overrides.

## Repo relationship
Sibling repo `markrukthai-1` is the consumer; keep wire protocol compatible with `client/src/workers/browserEngineBotWorker.ts` (uci/uciok/position/go movetime/bestmove). mirror-perft.mjs points at its `node_modules` by default (`FAIRY_DIR` overrides).
