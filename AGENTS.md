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

## Strength gate
`node scripts/match-arena.mjs --games 8 --skill N --movetime 100` (fairy gets 4×). Current: sweeps skill ≤0, ~even at 5 (counting-rule draws), shut out at 10.
Datagen (spec §3): `node scripts/datagen.mjs --positions N --out tools/data/<name>.jsonl` — fairy self-play labels through our oracle; ~2,900 pos/s at 12 jobs.
Training (spec §4): `training/venv/bin/python -m training.train --data tools/data/<corpus>.jsonl --out out/<run>` then `-m training.export --ckpt out/<run>/last.pt --out out/<run>` (torch in `training/venv`).

## NNUE (v1, M3+)

`src/nnue.rs` + `training/`. Native: `MAKURUK_EVAL=net MAKURUK_WEIGHTS=out/v1/<artifact>.bin` (default/classic otherwise). Browser: `WasmEngine::init_nnue(binBytes)` (worker verifies sha256 via manifest). Agreement gate: `cargo test --release` includes python-fixture parity vs `out/v1/*.bin` (skips if absent). Net eval ≈200k nps wasm (classic 1.1M).

## Strength program (wayfinder)

Active effort: "Road to fairy full-strength parity" — map + tickets at `.scratch/makruk-strength/` (local-markdown tracker). Spec: `docs/strength-spec-v1.md`. Benchmark/opponent assets (gitignored): `tools/fairy/` (native Fairy-Stockfish 14 + official makruk NNUE); match-arena supports `FAIRY_BIN`/`FAIRY_EVAL` env overrides.

## Repo relationship
Sibling repo `markrukthai-1` is the consumer; keep wire protocol compatible with `client/src/workers/browserEngineBotWorker.ts` (uci/uciok/position/go movetime/bestmove). mirror-perft.mjs points at its `node_modules` by default (`FAIRY_DIR` overrides).
