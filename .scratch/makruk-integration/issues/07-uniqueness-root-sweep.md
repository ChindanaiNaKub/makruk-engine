# Uniqueness is a root sweep, not a MultiPV gap

Type: build
Status: open
Blocked by: —
Parent: map.md

## Question

A tactical puzzle is only good if its solution is *the* move. The site's schema already encodes this instinct — `verification.multiPvGap`, `verification.onlyMoveChainLength`, and the quarantine rule that an ambiguous generated puzzle cannot ship (`shared/puzzleValidation.ts:140–149`) — but MultiPV top-2 gaps can miss a third quiet alternative, and our engine has no MultiPV anyway. The rigorous version is cheaper than it sounds: **search every legal root move at a fixed budget and compare**.

1. **The sweep.** For each legal root move: make it, search to pinned depth/nodes, unmake. Depth 10 costs ~0.37 s / 272k nodes native from startpos, so a 30-move position sweeps in ~11 s background-class — thousands of candidates overnight without touching foreground budgets.
2. **Accept gates, all pinned in one table.** Solution move holds ≥ WIN_THRESHOLD (mate found, or ≥ +300 stm-cp sustained); every alternative ≤ FAIL_THRESHOLD; gap ≥ GAP_MIN between best and second-best. Candidates failing any gate are rejected *with the numbers attached* — a near-miss that might pass at deeper budget is data for the next sweep, not noise.
3. **Chain length, honestly computed.** `onlyMoveChainLength` = number of consecutive plies along the principal line where the side to move still has exactly one non-losing reply under the same gates — each verified by its own mini-sweep, not assumed from PV length.
4. **Emit site-shaped metadata.** Output carries `multiPvGap` (best − second), `onlyMoveChainLength`, solution move, and the sweep config, so drafts drop into `generatedPuzzleCandidates`/importQueue without translation loss.

## Constraints

- Reuses the same engine identity/hash conventions as the prover ([Prove mate puzzles instead of scoring them](06-mate-prover.md)) so ledger rows compose.
- Sweep results are stm-relative by construction; record which side the puzzle is FOR.
- Budget knobs live in one config object next to the thresholds — future retuning changes one file, and old verdicts stay valid because their row records the config used.

## Acceptance

- Script sweeps a real batch from [Mine puzzle candidates](05-blunder-miner.md); acceptance/rejection distribution reported; ~10 accepted puzzles manually spot-checked on the board.
- At least one known-ambiguous doctored position correctly rejected (negative test).
- Metadata validated against the site's `puzzleValidation.ts` expectations — ideally by running their `validate:puzzles` over bridged drafts and staying green.
