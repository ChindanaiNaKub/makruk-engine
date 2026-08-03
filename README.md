# makruk-engine

A Makruk (Thai chess) engine in Rust, compiled to WebAssembly for the browser.

## ✨ Highlights

- **Plays the counting rule correctly** (นับศักดิ์หมาก / นับกระดาน) — the part most chess engines skip or get
  wrong, ported line by line from [markrukthai](https://github.com/ChindanaiNaKub/markrukthai)'s rules.
- **59 KB gzipped**, against 480 KB for `fairy-stockfish.wasm`.
- **Drop-in for fairy-stockfish** over the UCI string protocol — `uci`, `position`, `go movetime`,
  `bestmove`.
- **Movegen verified against fairy-stockfish**, not against itself: perft matches exactly from the
  start position and across 29 mirrored random positions.
- **Every strength claim is a row in a committed, append-only ledger** — no number in this README was
  typed by hand.

## 🎯 Where it stands

Against native Fairy-Stockfish 14, equal time (100 ms/move each side), 64 games per rung, randomized
openings:

| fairy skill | W–L–D | score |
|---|---|---|
| 3 | 33–4–26 | **72.7%** |
| 5 | 7–20–35 | 39.8% |
| 8 | 2–36–24 | 23.4% |
| 10 | 0–52–11 | 9.4% |

It crosses 50% at about **skill 4.4**. Good enough for bots, puzzles and offline play; not a
full-strength engine, and not trying to be.

`node scripts/results.mjs` prints the live table. `--all` shows retracted blocks and why.

## 🚀 Usage

**In a browser** — deploy `pkg/web/makruk_engine.js`, `pkg/web/makruk_engine_bg.wasm` and
`js/worker.js` together, then talk to the worker:

```js
worker.postMessage("position fen rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w");
worker.postMessage("go movetime 500");   // -> "bestmove c3c4"
```

**As a native UCI binary:**

```console
$ cargo run --release
uci
position startpos
go movetime 500
bestmove c3c4
```

FEN accepts the client's letters (bia `P/p`, met `M/m`, promoted bia `F/f`). Promoting moves carry an
`m` suffix on `bestmove` (`b5b6m`), which fairy requires.

Browser floor: Chrome 91, Firefox 89, Safari 16.4 (wasm SIMD).

## 🔧 Build

```bash
npm run build        # native UCI binary
npm test             # perft, counting rules, do/undo symmetry, NNUE parity
npm run build:wasm   # wasm + glue into pkg/web and pkg/node
```

Running a strength block needs a native Fairy-Stockfish binary in `tools/fairy/` (gitignored):

```bash
FAIRY_BIN=$PWD/tools/fairy/fairy-stockfish \
  node scripts/match-arena.mjs --games 64 --skill 5 --movetime 100 --fairytime 100
```

## 📖 Further reading

| | |
|---|---|
| [**The counting rule**](docs/counting-rule.md) | Adjudication order, and why the order changes outcomes |
| [**The measurement harness**](docs/measurement-harness.md) | Six harness defects, every one of which made the engine look worse than it was |
| [**Strength spec**](docs/strength-spec-v1.md) | The target, the full execution log, every retraction |
| [**`results/blocks.jsonl`**](results/blocks.jsonl) | Every block ever played, written by the arena itself |
| [**AGENTS.md**](AGENTS.md) | Working notes: invariants, commands, hard-won gotchas |

**The NNUE experiment is parked, not deleted.** `src/nnue.rs` and `training/` implement a tiny
value-only net (768→256, INT8 QAT, ~0.2 MB) distilled from Fairy-Stockfish labels. Its eval is
genuinely **better than the classical one at equal search depth** (67.0% at depth 7) — and it runs at
half the speed, so at equal *time* it searches two plies shallower and loses (37.2%, rejected). The
pipeline works end to end; the artifact is not fast enough to use. See §0 of the spec.

## ⚠️ Limits

- No opening book.
- No repetition adjudication in the game rules, matching markrukthai. The search scores positions
  repeated from real game history as draws so the bot does not shuffle forever.
- Movetime is a soft deadline with a 5× hard cap; iteration 1 always completes.
- The transposition table has no aging — clear it between games with `ucinewgame`, which the
  markrukthai worker already does. (Measured worth ~0 within a single search: the table is 3× larger
  than the whole per-move tree.)

## 🗂 Layout

| Path | What |
|---|---|
| `src/` | Rust core: board, movegen, counting, game, eval, search, nnue, uci, wasm + CLI entry points |
| `js/worker.js` | Browser worker wrapping the wasm, speaking the fairy-stockfish protocol |
| `scripts/` | Arena, datagen, preflight, gates, results ledger, SPRT, perft mirror |
| `training/` | PyTorch training and INT8 export for the tiny net |
| `docs/` | Strength spec, counting rule, measurement harness |

## License

MIT
