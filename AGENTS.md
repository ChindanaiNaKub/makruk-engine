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
- Startpos perft: 23 / 529 / 12012 / 273026. Any movegen change must keep mirror + tests green.
- `do_move`/`undo_move` must be perfectly symmetric (zobrist + counting roundtrip test).
- Search: no panics on stop; `bestmove (none)` only when game is over.
- Classic worker deploy: target `no-modules`, files sit beside `js/worker.js`.

## Repo relationship
Sibling repo `markrukthai-1` is the consumer; keep wire protocol compatible with `client/src/workers/browserEngineBotWorker.ts` (uci/uciok/position/go movetime/bestmove). mirror-perft.mjs points at its `node_modules` by default (`FAIRY_DIR` overrides).
