# Mine puzzle candidates from games we already have

Type: build
Status: open
Blocked by: —
Parent: map.md

## Question

Puzzle quality starts with candidate supply, and the supply already exists: arena `--dump-games` JSONL (`{game, tag, result, plies, mineColor, moves}`, `match-arena.mjs:828`) replays through the rules oracle, and datagen corpora carry `{fen, eval, wdl, counting, side}` rows at ~2,900 pos/s generation rate. Build the scanner that turns those into puzzle candidates:

1. **Swing detection.** Flag plies where the mover's position collapses — large stm-eval drop between consecutive positions, or WDL flip in the corpus labels. Thresholds pinned in one place with the noise floor stated (corpus fixed points sit ~0.03 apart, so sub-0.05 swings are measurement noise, not blunders).
2. **Counting-aware filtering.** A "collapse" caused by the count running out is adjudication, not error — the oracle's outcome tags (`draw counting_rule` etc.) separate them. This filter is exactly what makes mined candidates native to makruk rather than reskinned chess puzzles.
3. **Provenance or nothing.** Every candidate row carries its source (`gameFile/gameIdx/ply/result/tag`), mirroring the site's existing draft style ("Real-Game Discovery (selfplay-0001 @ ply 14)"). A candidate that cannot say where it came from cannot be audited later.
4. **Output shape.** JSONL candidates `{fen, sideToMove, seedEval, provenance}` consumed by [Uniqueness is a root sweep](07-uniqueness-root-sweep.md) and [Two engines agree or it does not ship](08-referee-consensus.md); plus a bridge spec for the site's `generate:puzzle-candidates` queue so both repos speak the same candidate.

## Constraints

- Background class: `nice 15`, announce cost, consent over 5 min.
- Replay legality through the oracle (`position ... moves ...` + `d`) — never trust dump files to be internally consistent; they record engine moves, and engines err.
- Dedup: identical FENs across sources collapse into one candidate with merged provenance list.

## Acceptance

- `scripts/puzzle-mine.mjs` runs over an existing dump + corpus and produces a deduplicated candidate file with a summary (candidates/source, swing distribution, counting-filtered fraction).
- Spot-check: 10 random candidates manually replayed — all legal, all genuinely "side to move just got handed something".
- Throughput measured and announced (rows/s), so batch size expectations are grounded before the validators run.
