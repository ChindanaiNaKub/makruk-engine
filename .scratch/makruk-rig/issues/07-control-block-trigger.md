# Implement the conditional control-block trigger

Type: task
Status: open — **unblocked 2026-08-02**
Blocked by:
Parent: map.md

## Question

[How does the rig prove a number before anyone acts on it?](04-how-the-rig-proves-a-number.md) settled *when* a self-play control block is mandatory:

> (a) a block's result deviates from the trend line by more than the SE band (~8.8 points at n=32), or (b) a new **binding mechanism** is introduced — a new env var, a new opponent type, a new config axis (explicitly **not** a new weight) — or (c) it is the first block at a new rung.

Mechanisms 1–3 of that ticket shipped. This one could not, because clause (a) needed a trend line and there was no machine-readable record of past blocks to compute one from.

**That blocker is now gone.** [Where do results live?](06-where-results-live.md) shipped `results/blocks.jsonl` — append-only, committed, written by the arena itself, and backfilled with the five randomized-ladder blocks plus two retracted Gate A rows. Read it with `readBlocks()` from `scripts/results.mjs`. The control capability itself also exists: `match-arena.mjs --control` runs identical sides with the `sides-differ` assertion opted out.

Note when building clause (b): the ledger already stores each side's `armed` string and the full env-relevant identity per row, so "a previously-unseen binding combination" is computable from the ledger rather than needing new bookkeeping.

To implement once the ledger exists:

- **Compute the trend line.** From what — the same artifact's prior blocks at the same rung, or a fitted ladder across rungs? The SE band is ~8.8 points at n=32; [Replace fixed-size blocks with a sequential test](03-sequential-gate.md) has landed, so blocks now have *varying* n and the band must be computed per block rather than assumed.
- **Detect clause (b) mechanically.** "A new binding mechanism" is a human-legible idea; the rig needs a checkable version. Candidate: hash the *set of env var names* and the opponent-engine identity that a block ran under, and treat a previously-unseen combination as new plumbing — which correctly ignores a new *value* for `MAKURUK_WEIGHTS` while catching a first-ever `OPP_WEIGHTS`.
  - **`concurrency` is a named clause-(b) mechanism**, established by [Pin the budgets](01-pin-the-budgets.md): engines at fixed movetime search fewer nodes when they contend, and the whole ladder was calibrated at concurrency 6, so a block run at a different value is measuring a different opponent. It is already a ledger field, so this clause is a lookup. `movetime` and `opponentMovetime` belong in the same family for the same reason.
- **Detect clause (c).** First block at a rung is a ledger lookup, trivial once the ledger exists.
- **Decide what firing means.** Does the rig run the control automatically and refuse to record the suspect block until the control passes, or does it print a demand and stop? Automatic costs a block of wall-clock without being asked; a demand can be ignored, which is how prose-in-AGENTS.md failed.
- **Decide the control's own pass condition.** r3-vs-r3 came back 1–1–8 and 50.0% in two separate runs; what band around 50% counts as "the plumbing is fine" at a given n?

## Answer

<!-- filled on resolution -->
