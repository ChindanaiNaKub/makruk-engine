# Who validates the validator?

Type: build
Status: open
Blocked by: [Two engines agree or it does not ship](08-referee-consensus.md)
Parent: map.md

## Question

The pipeline now contains three engines, five gate types, and one way for a bad puzzle to reach players: a systematic error nobody thought to check. This ticket builds the checks on the checks — the rig's own medicine applied to puzzles:

1. **Append-only verdict ledger.** Every candidate gets a row written by the tooling: `{candidateId, verdict, checks:{legal, prover?, sweep?, referee}, engines:{maker, referee}, configs, timestamps}`. Rows are never edited; a reversal is a new row with a reason — the blocks.jsonl doctrine, because the failure mode it prevents (a stale figure surviving in prose) applies to puzzle verdicts identically. A tiny viewer subcommand beats a spreadsheet.
2. **Blind hold-out solving.** Periodically sample K near-ship puzzles and solve them from fresh processes with both engines *and* a held-back config (different movetime/depth). Agreement rate below a pinned threshold fails the batch closed — the label-check r ≥ 0.3 analogue. Solving from fresh processes matters: a validator that graded its own homework through a warm TT is the dead-TT defect wearing a puzzle costume.
3. **Trend metrics as defect alarms.** Track quarantine rate, DISPROVEN rate, referee-disagreement rate over batches. Sudden shifts are pipeline defects until proven otherwise — the method rule. A quarantine rate collapsing toward zero is *bad news* (the filters went soft), not a victory.
4. **Editorial spot-check checklist.** Human review sample size, what the reviewer checks (solution uniqueness on the board, hint quality, theme tags, difficulty feel), and the sign-off recorded in the ledger row. Machine consensus earns *consideration*; a human still owns the ship flip — same split as Gate A deciding vs the standings informing.

## Acceptance

- Ledger exists, tooling writes it, viewer renders it; hand-editing is detectable (schema validation at write time, like block-schema.mjs).
- One hold-out round executed end-to-end including at least one deliberately corrupted puzzle planted in the sample — the plant must be caught; if it isn't, the thresholds were decoration and get retuned before anything ships.
- Metrics dashboard/query answers "has the pipeline gotten softer this month?" in one command.
- A short runbook: what a maintainer does weekly, and what automatically blocks shipping when they don't.
