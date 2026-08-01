# makruk-engine

A small, fast Makruk (Thai chess) engine in Rust, built for the browser.

- **~48 KB on the wire** (99.8 KB wasm, gzips to ~48 KB) versus ~1.6 MB for fairy-stockfish.wasm.
- **~1.1M nodes/sec** in-browser (wasm), negamax alpha-beta with transposition table, quiescence, iterative deepening.
- **Exact Makruk rules**, including the counting rule (ตัวหมาก / ตัวกระดาน), ported line-by-line from [markrukthai](https://github.com/ChindanaiNaKub/markrukthai)'s `shared/engine.ts` + `shared/makrukRules.ts`.
- **Movegen verified against fairy-stockfish**: perft matches exactly from the start position (23 / 529 / 12012 / 273026) and across mirrored random positions (`scripts/mirror-perft.mjs`).

## Layout

| Path | What |
|---|---|
| `src/` | Rust core: `board`, `movegen`, `counting`, `game`, `eval`, `search`, `uci`, wasm bindings (`lib.rs`), native CLI (`main.rs`) |
| `js/worker.js` | Browser worker: wraps the wasm, speaks the same UCI string protocol as fairy-stockfish |
| `scripts/mirror-perft.mjs` | Live perft mirror against fairy-stockfish-nnue.wasm (needs `FAIRY_DIR`) |
| `scripts/build-wasm.mjs` | wasm-bindgen packaging for `pkg/web` and `pkg/node` |
| `scripts/smoke-wasm.mjs` | Node smoke test for the wasm build |

## Build & test

```bash
npm run build        # native binary (UCI CLI)
npm test             # 12 spec tests: perft + counting rules
npm run test:mirror  # mirror perft vs fairy-stockfish (FAIRY_DIR=<markrukthai>/node_modules)
npm run build:wasm   # wasm + glue in pkg/web (worker) and pkg/node (smoke tests)
npm run test:wasm    # node smoke test
```

Native CLI:

```bash
$ cargo run --release
uci
position startpos
go movetime 500
bestmove c3c4
```

## Using it in the markrukthai client

Deploy `pkg/web/makruk_engine.js`, `pkg/web/makruk_engine_bg.wasm`, and `js/worker.js` to
`client/public/engines/makruk/`, then point the bot worker at it:

```ts
// client/src/workers/browserEngineBotWorker.ts
const ENGINE_WORKER_URL = '/engines/makruk/worker.js';
```

The protocol is already compatible: `uci` → `uciok`, `isready` → `readyok`,
`position fen <board> <turn>`, `go movetime <ms>` → `info …` + `bestmove <uci>`.
FEN accepts the client's serialization (bia = `P/p`, met = `M/m`, promoted bia = `F/f`).
`bestmove` carries a promotion suffix on promoting moves (`b5b6m`) — fairy-compatible
and tolerated by the client's move parser.

## Rules engine semantics (the counting rule)

Faithful port of the site's adjudication order:

1. Pieces-honor immediate draw when pieces-on-board + 1 > limit (checked before mate is awarded).
2. Count increments only on the counting side's own moves.
3. Pieces honor: reaching `count == limit` arms `final_attack_pending` — the stronger side gets exactly one move; if it does not mate, draw.
4. Board honor (Sak Kradan) draws once the count passes 64.
5. Then mate, stalemate, bare-kings.

Search assumption (documented, game-level flag): a fresh Sak Kradan begins **active**
(`board_honor_auto_start = true`), i.e. the weaker side is treated as counting —
the rational-play default. Game-level code can disable it and use
`start_counting()` / `stop_counting()` like the UI does.

## Measured strength (scripts/match-arena.mjs, mine = 100 ms/move, fairy = 400 ms/move)

| fairy-stockfish skill level | Mine result |
|---|---|
| -20 | 8–0 |
| -10 | 8–0 |
| 0 | 8–0 (all converted to mate) |
| 5 | 0W / 2L / **4 counting-rule draws** (survives worse endgames via Sak Mak/Sak Kradan) |
| 10 | 0–8 |

So: a solid casual-to-intermediate bot. Notably, against stronger opponents it
frequently saves lost endgames *through the counting rule* — authentic Makruk
defensive play.

## Limits

- No opening book, no NNUE (yet — the Moka-style distillation remains the v2 idea).
- Weaker than fairy-stockfish at full strength; intended for bots, puzzles, and offline play.
- Repetition: game rules have no repetition adjudication (matches markrukthai);
  search treats positions repeated from the real game history as draws so the
  bot does not shuffle forever.
- Time control: movetime is enforced as a soft deadline (iteration 1 always
  completes) with a 5× hard cap.

## License

MIT
