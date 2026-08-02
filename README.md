# makruk-engine

A Makruk (Thai chess) engine in Rust, compiled to WebAssembly for the browser.

It plays the full rules including the counting rule (นับศักดิ์หมาก / นับกระดาน), which
most general chess engines get wrong or skip. It ships in 59 KB gzipped, against
480 KB for fairy-stockfish.wasm.

Built as the bot backend for [markrukthai](https://github.com/ChindanaiNaKub/markrukthai).

## Where it stands

Measured against native Fairy-Stockfish 14 at equal time (100 ms per move each
side), 64 games per block with randomized openings:

| our eval | fairy skill | W–L–D | score |
|---|---|---|---|
| classical | 3 | 33–4–26 | **72.7%** |
| NNUE (r3) | 3 | 41–13–7 | 71.9% |
| NNUE (r3) | 5 | 14–34–9 | 34.4% |
| NNUE (r3) | 8 | 5–49–9 | 15.6% |
| NNUE (r3) | 10 | 0–64–0 | 0.0% |
| NNUE (r3) | 20 | 0–64–0 | 0.0% |

The classical eval beats the neural one head-to-head (62.5% over 40 games, SPRT
accept at α=0.05), so the classical rows are the engine's real strength and the
NNUE rungs are a lower bound for it. Classical has not yet been measured above
skill 3.

Every block ever played is in [`results/blocks.jsonl`](results/blocks.jsonl),
written by the arena itself. `node scripts/results.mjs` prints the current table;
`--all` shows retracted blocks and why they were retracted.

Fairy's Skill Level does not reduce its search depth, which cost a day to work
out. At `movetime 100` from the start position it reaches depth 10 at skill 3, 5,
8, 10 and 15, and depth 12 at skill 20. Skill only degrades which move it picks
out of that search. So the ladder measures move quality, and the jump from skill 8
to skill 10 is where the noise stops covering a five-ply search deficit.

## The counting rule

This is the part that makes it Makruk rather than chess, and the part a generic
engine cannot borrow. The adjudication order is ported line by line from
markrukthai's `shared/engine.ts` and `shared/makrukRules.ts`, because the order
changes outcomes:

1. Pieces-honor immediate draw when pieces-on-board + 1 > limit. Checked **before**
   mate is awarded, so a mate delivered one move too late is a draw.
2. The count increments only on the counting side's own moves.
3. Reaching `count == limit` arms `final_attack_pending`. The stronger side gets
   exactly one move; no mate means draw.
4. Board honor (Sak Kradan) draws once the count passes 64.
5. Then mate, stalemate, bare kings.

Search-side, a fresh Sak Kradan begins active (`board_honor_auto_start = true`),
treating the weaker side as counting, which is the rational-play default.
Game-level code can turn this off and drive `start_counting()` / `stop_counting()`
the way the UI does.

Movegen is verified against fairy-stockfish rather than against itself. Perft
matches exactly from the start position (23 / 529 / 12012 / 273026) and across 29
mirrored random positions (`scripts/mirror-perft.mjs`).

## The measurement harness

Roughly half this repository measures the engine rather than being it. That rig
exists because six harness defects surfaced in two days. Every one of them made
the engine look *worse* than it was, which meant each corrupt number was
indistinguishable from a genuine negative result and got theorized about instead
of audited.

The defects, for anyone who wants to avoid them:

| defect | effect |
|---|---|
| datagen inverted the eval sign on 47% of rows | poisoned the whole training corpus |
| `env $var node …` does not word-split in zsh | three "net" blocks silently measured the classical eval |
| max-plies games scored as errors | silently dropped 16 of 64 games per block |
| no opening randomization | an N-game block was never N independent samples |
| transposition table carried across games | worth 17.6 points, 4.0σ |
| `FAIRY_BIN.includes("makruk-engine")` | the repo folder is *named* makruk-engine, so every path matched |

The transposition-table one is the instructive case. `src/search.rs` replaces
entries on depth alone with no generation counter, so after one game the table
fills with high-depth entries that no shallower store can evict, and every later
game in a block runs with a dead TT. The probe validates the key, so entries were
never wrong, only un-evictable. Measured at n=128: 67.6% with the table cleared
per game against 50.0% carried. Fixing it inverted the project's central claim
about whether the neural eval beat the classical one.

What the rig does about it now:

- **`scripts/preflight.mjs`** runs as a hard precondition inside the arena and the
  data generator, not as a command you have to remember. Sub-second. It checks env
  shape, that the engine armed the eval you asked for, that the two sides actually
  differ, that seeds reproduce, and that perft(3) is still 12012. Failure means
  nothing plays.
- **`scripts/gate.mjs`** hash-gates the expensive checks (`cargo test`,
  mirror-perft, corpus label correlation) on their inputs' contents, so you pay
  once per real change instead of once per run.
- **`scripts/results.mjs`** keeps an append-only ledger. Rows are never edited or
  deleted; a retraction is a new row carrying a mandatory reason. Retracted numbers
  stop showing up in the default view without the reasoning being lost.
- **`scripts/sprt.mjs`** replaced a fixed 64-game gate that, at the measured
  per-game standard deviation of 0.42, had a 17% false-positive and 50%
  false-negative rate. The sequential test runs on colour-reversed game pairs
  (measured 0.66–0.79× the trinomial standard deviation) and Monte-Carlos at
  3.6% / 3.9% realised error, deciding a clearly-better candidate in about 54 games.
- **`scripts/thermal-sweep.mjs`** measures what a run costs the laptop, after
  discovering that a single 75-second arm has a ±4–5 °C noise floor.

Games run concurrently (`--concurrency`, default 6), measured at 5.4–5.9× over the
old serial loop.

## The NNUE experiment

`src/nnue.rs` and `training/` implement a tiny value-only net (768→256 accumulator,
counting-rule side channels, WDL head, INT8 QAT export, ~0.2 MB) distilled from
Fairy-Stockfish labels over five DAgger rounds.

It does not beat the classical eval. Two SPRT blocks in both directions say so:
44.2% for the net against classical, 62.5% for classical against the net. The
earlier result claiming the opposite was measured with the dead transposition
table, which handicapped the classical eval (searching to depth 8) far more than
the net (depth 5).

The code stays because the pipeline works end to end and the negative result is
worth having written down. The spec, every round, and every retraction live in
[`docs/strength-spec-v1.md`](docs/strength-spec-v1.md).

## Build and test

```bash
npm run build        # native UCI binary
npm test             # 14 tests: perft, counting rules, do/undo symmetry, NNUE parity
npm run test:mirror  # perft mirror vs fairy-stockfish (needs FAIRY_DIR)
npm run build:wasm   # wasm + glue into pkg/web and pkg/node
npm run test:wasm    # node smoke test
```

Native CLI:

```console
$ cargo run --release
uci
position startpos
go movetime 500
bestmove c3c4
```

Running a strength block needs a native Fairy-Stockfish binary in `tools/fairy/`
(gitignored):

```bash
FAIRY_BIN=$PWD/tools/fairy/fairy-stockfish \
  node scripts/match-arena.mjs --games 64 --skill 3 --movetime 100 --fairytime 100
```

## Using it in a browser

Deploy `pkg/web/makruk_engine.js`, `pkg/web/makruk_engine_bg.wasm` and
`js/worker.js` together, then point a worker at them. The wire protocol matches
fairy-stockfish closely enough to be a drop-in for markrukthai's bot worker:
`uci` → `uciok`, `isready` → `readyok`, `position fen <board> <turn>`,
`go movetime <ms>` → `info …` + `bestmove <uci>`.

FEN accepts the client's serialization (bia `P/p`, met `M/m`, promoted bia `F/f`).
Promoting moves carry a suffix on `bestmove` (`b5b6m`), which fairy requires and
the client's parser tolerates.

`.cargo/config.toml` enables `simd128` for wasm32, which rustc leaves off by
default. It buys 43.7% more nodes per second on the neural eval for 2 KB, and
search results stay bit-identical at fixed depth. Browser floor: Chrome 91,
Firefox 89, Safari 16.4.

## Layout

| Path | What |
|---|---|
| `src/` | Rust core: `board`, `movegen`, `counting`, `game`, `eval`, `search`, `nnue`, `uci`, wasm bindings (`lib.rs`), native CLI (`main.rs`) |
| `js/worker.js` | Browser worker wrapping the wasm, speaking the fairy-stockfish string protocol |
| `scripts/` | Arena, data generation, preflight, gates, results ledger, SPRT, perft mirror |
| `training/` | PyTorch training and INT8 export for the tiny net |
| `docs/strength-spec-v1.md` | The strength spec and the full execution log, retractions included |
| `results/blocks.jsonl` | Every block ever played |

## Limits

- No opening book.
- Loses to Fairy-Stockfish above skill 8. Aimed at bots, puzzles and offline play,
  not at competing with a full-strength engine.
- Game rules have no repetition adjudication, matching markrukthai. The search
  scores positions repeated from real game history as draws so the bot does not
  shuffle forever.
- Movetime is a soft deadline with a 5× hard cap; iteration 1 always completes.
- The transposition table has no aging. Clear it between games with `ucinewgame`,
  which the markrukthai worker already does.

## License

MIT
