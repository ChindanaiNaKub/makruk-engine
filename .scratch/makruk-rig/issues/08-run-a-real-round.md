# Run a real round through the rig and show both budgets held

Type: task
Status: open
Blocked by:
Parent: map.md

## Question

The map's destination is not "the rig is built" — it is **"a real round has been run through it
showing both budgets held."** All seven design tickets are closed and every mechanism is shipped and
unit-tested, but no round has yet been driven end to end through the assembled rig. Until one has,
the destination is unreached and the numbers in the tickets are promises.

**There are untested candidates sitting in the repo,** so this needs no new training run:

| artifact | provenance |
|---|---|
| `out/r3fixed/lam0.5/makruk-tiny-v1-6d1fe23fc1ea.bin` | λ sweep, never gated |
| `out/r3fixed/lam0.85/makruk-tiny-v1-e499401b710b.bin` | λ sweep, never gated |
| `out/r3sweep/lam0.85/makruk-tiny-v1-ec79cdab4837.bin` | λ sweep, never gated |
| `out/r3sweep/lam0.97/makruk-tiny-v1-00c4094dca48.bin` | λ sweep, never gated |

`out/r3fixed/lam0.97/makruk-tiny-v1-4452f72612f1.bin` is the r3 artifact already measured, so it is
the control case rather than a candidate.

Note the incumbent is the **classical eval**, not a net — established by two decisive SPRT blocks in
[Replace fixed-size blocks with a sequential test](03-sequential-gate.md). So Gate A is
`candidate net vs classic`, and a candidate has to beat the classical eval to be accepted. On the
current evidence none of them will, and **that is a perfectly good outcome for this ticket** — the
thing being tested here is the rig, not the artifact. A clean, cheap, correctly-recorded REJECT is a
pass.

## What has to be true at the end

1. **A candidate got an accept/reject verdict**, recorded in `results/blocks.jsonl` by the arena
   itself, with a control block wherever the trigger demanded one.
2. **N held.** Gate A finished inside the 15-minute ceiling — with the actual wall-clock recorded,
   not estimated.
3. **The thermal/CPU budget held.** No `--allow-busy`, no `--budget-min`, no `--skip-gates`, no
   `--skip-control`. If any override was needed, that is a finding about the rig and it belongs in
   this ticket's answer rather than being papered over.
4. **Datagen did not run** — [Does a round need new data at all?](05-does-a-round-need-new-data.md)
   took it off the critical path, and a round that quietly regenerates anyway would mean that
   decision did not actually land in the plumbing.
5. **Every number a future session could read is in the ledger**, and `node scripts/results.mjs`
   shows the round cleanly with no suspect rows left dangling.

## What to watch for

Every mechanism on this map has been verified in isolation or on synthetic data. This is the first
time they run *together*, against a real artifact, in the order a round actually uses them — and the
one previous time two of them met for the first time (the control trigger and the hot-start gate),
they were incompatible and one of them was wrong. Expect at least one interaction that unit tests
could not have shown, and treat it as the point of the exercise rather than as a setback.

## Answer

<!-- filled on resolution -->
