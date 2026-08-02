# Handoff — 2026-08-02, end of round 5

Read `docs/strength-spec-v1.md` "Execution log" top entry first, then this.

## State

- Branch `nnue-v1`, clean, all gates green: `cargo test --release`, mirror-perft **29/29**, `npm run test:wasm`.
- Incumbent artifact: `out/r3fixed/lam0.97/makruk-tiny-v1-4452f72612f1.bin` (unchanged).
- Round-5 candidate `out/r5d6/lam0.85/…` was **rejected** by Gate A (45.3% vs r3 over 64 games).
- New corpus `tools/data/bootstrap-d6.jsonl` (10,002,800 rows, depth-6 search labels, `label-check` r=0.882). Kept — labels are clean, the round failed on selection.

## Unfinished: a ladder re-measurement was running when the session ended

`/tmp/claude-1000/-home-prab-Documents-makruk-engine/4e208442-b420-4545-ae47-29c22357ce4c/scratchpad/ladder.log`

Five 32-game blocks with randomized openings: classic at skill 3, then r3 at skill 3 / 5 / 10 / 20.
If the file has five `score fraction:` lines it finished. If the process died, re-run:

```
FAIRY_BIN=$PWD/tools/fairy/fairy-stockfish \
MAKURUK_EVAL=net MAKURUK_WEIGHTS=$PWD/out/r3fixed/lam0.97/makruk-tiny-v1-4452f72612f1.bin \
  node scripts/match-arena.mjs --games 32 --skill 3 --movetime 100 --fairytime 100
```

**These are the first trustworthy arena numbers.** Everything earlier predates the opening-randomization fix. Record them in the spec and supersede the pre-randomization standings in AGENTS.md.

## Then: round 6, as authorized

Test whether Gate A gains convert to Gate B gains — the question the program turns on.

1. DAgger round per spec §5 with r3 as the student: `node scripts/datagen.mjs --selfplay --positions 80000 --depth 6 --label search --out tools/data/dagger-r6.jsonl`, with `MAKURUK_EVAL=net MAKURUK_WEIGHTS=<r3 bin>` in the environment so the student *is* the incumbent. Smoke 5k first for throughput.
2. Continuation train: `--resume out/r3fixed/lam0.97/last.pt --preserve <same> --replay tools/data/bootstrap-d6.jsonl`, then `-m training.export`.
3. Gate A (64 games vs r3, `OPP_WEIGHTS=<r3 bin>` + `FAIRY_BIN=$PWD/target/release/makruk-engine`) and Gate B (32 games at the rung the re-measurement puts us on).
4. Compare the two deltas. Two rounds of this either establishes a conversion ratio or shows there is none.

## Traps this session paid for — do not re-pay

1. **`env $var node …` in a zsh script does not word-split.** Three "net" blocks silently ran the classical eval. Inline prefix assignments only. match-arena now fatals on a malformed `MAKURUK_EVAL`.
2. **No opening randomization** meant N-game blocks were not N samples. Fixed; do not set `--opening-plies 0` for a gate.
3. **Max-plies games are draws, not errors.** They were being discarded — 16 of 64 in a Gate A block.
4. **Probe top-1 does not predict play.** Round 5's best-ever probe (40.0%) belonged to the rejected artifact. Read the shuffle line under it.
5. **Score an untrained reference against any new label set before training on it** — `node scripts/label-check.mjs <corpus>`. That is what caught the sign bug, and what confirmed the d6 labels.

The pattern across all five: an unexpected *negative* result was, every time, the measurement rather than the engine. Audit the harness before theorizing.
