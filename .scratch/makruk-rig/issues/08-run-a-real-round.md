# Run a real round through the rig and show both budgets held

Type: task
Status: resolved (2026-08-02)
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

**A candidate was rejected in 121 seconds, and nothing had to be overridden.**

Candidate: `out/r3fixed/lam0.85/makruk-tiny-v1-e499401b710b.bin` — the best *untested* artifact by the
project's own documented criterion (select on evalR2: 0.932, probe top-1 35.6%, against classic's
34.4% reference). Gate A ran it head-to-head against the classical incumbent at equal 100/100 ms.

```
SPRT[0, 30] α=0.05 β=0.05 — 20 pairs (40 games), score 35.0% (−108 Elo), LLR −4.16 in [−2.94, 2.94]
  REJECT — no improvement of the tested size; the incumbent stands.
```

Recorded as **b0038**: 46 games (the six already in flight when the boundary was crossed finished and
were counted), 34.8%, `decision: accept-h0`.

### The five conditions

| # | condition | result |
|---|---|---|
| 1 | a verdict, arena-recorded, control where demanded | **REJECT**, row b0038 written by the arena; no control demanded, correctly |
| 2 | N held | **121 s against the 15 min ceiling** — 7.4× margin, recorded not estimated |
| 3 | budget held, no overrides | no `--allow-busy`, `--budget-min`, `--skip-gates`, `--skip-control` |
| 4 | datagen did not run | corpus mtime 12:54, round ran at 22:39 — untouched |
| 5 | ledger clean, no dangling suspects | `grep -c '"suspect"'` = 0; default view clean |

### The prediction, stated before the run, held

**No control block fired.** The clause-(b) fingerprint matched b0028 (net vs classic, 100/100 ms,
concurrency 6, SPRT) and clause (c) found the rung already played, so the trigger stayed silent —
which is the designed behaviour: **a new weight is a new experiment, not new plumbing.** The ledger
shows b0037 → b0038 consecutive with no control inserted. Had one fired, the fingerprint would have
been too sensitive and every candidate would have dragged 80 s of control behind it.

### What the run showed about the mechanisms

- **`minPairs` earned its place.** At 10 pairs the LLR was already −2.97, past the −2.94 boundary.
  The minimum held it for another 10 pairs, at which point it was −4.16 — far past. The guard cost
  ~20 games (~50 s) and converted an early signal that *could* have been a fluke into one that
  plainly was not. Note the corollary: a clearly-bad candidate is bounded below by `minPairs`, not
  by the evidence, so ~40 games is the floor on any Gate A.
- **The draw structure is exactly what the SE work assumed.** 28 draws in 46 games (61%), nearly all
  `counting_rule`. This is the same regime that made the binomial band wrong in ticket 07, showing
  up in a real gate rather than a control.
- **Thermals matched the corrected model, not the original one.** 66 °C start → 92 °C mean → 99 °C
  peak. The retired 80 °C hot-start gate would have refused this round outright had it been run
  back-to-back with anything.

### Nothing new broke

Ticket 07 warned to expect an interaction that unit tests could not show, since that is what
happened the previous time two mechanisms met. This time nothing did: preflight, hash-gated
`cargo-test`, the budget announcement, the contention gate, the trigger, SPRT stopping, the ledger
write and the thermal record all ran in sequence on a real artifact and none of them fought.

### On the result itself

The candidate lost decisively, which is the expected outcome and irrelevant to this ticket — the rig
was under test, not the artifact. It is however a fourth independent confirmation of the finding
already recorded in [Replace fixed-size blocks with a sequential test](03-sequential-gate.md): **the
NNUE program still has no artifact that beats the classical eval**, now including the best untested
arm of the λ sweep. That belongs to the redrawn strength map, not here.
