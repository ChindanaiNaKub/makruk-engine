# The measurement harness

Roughly half this repository measures the engine rather than being it. This document is why, and what
the rig does about it. Moved out of the README on 2026-08-03 — it is worth keeping and it is not an
elevator pitch.

## Why there is a rig at all

Six harness defects surfaced in two days. **Every one of them made the engine look *worse* than it
was**, which meant each corrupt number was indistinguishable from a genuine negative result and got
theorized about instead of audited.

| defect | effect |
|---|---|
| datagen inverted the eval sign on 47% of rows | poisoned the whole training corpus |
| `env $var node …` does not word-split in zsh | three "net" blocks silently measured the classical eval |
| max-plies games scored as errors | silently dropped 16 of 64 games per block |
| no opening randomization | an N-game block was never N independent samples |
| transposition table carried across games | worth 17.6 points, 4.0σ |
| `FAIRY_BIN.includes("makruk-engine")` | the repo folder is *named* makruk-engine, so every path matched |

The zsh one recurred on 2026-08-03 and produced a fake 2× speedup that survived several minutes of
belief. **Four mismeasurements from one defect.** Use inline prefix assignments, never `env $var`.

**The transposition-table one is the instructive case.** `src/search.rs` replaces entries on depth
alone with no generation counter, so after one game the table fills with high-depth entries that no
shallower store can evict, and every later game in a block runs with a dead TT. The probe validates
the key, so entries were never wrong, only un-evictable. Measured at n=128: **67.6% with the table
cleared per game against 50.0% carried.** Fixing it inverted the project's central claim about whether
the neural eval beat the classical one.

## The rule that came out of it

**An unexpected negative result is a reason to audit the measurement before theorizing about the
engine.** Seven for seven, at time of writing.

## What the rig does

- **`scripts/preflight.mjs`** — a hard precondition inside the arena and the data generator, not a
  command you have to remember. Sub-second. Checks env shape, that the engine armed the eval you asked
  for, that the two sides actually differ, that seeds reproduce, and that perft(3) is still 12012.
  Failure means nothing plays.
- **`scripts/gate.mjs`** — hash-gates the expensive checks (`cargo test`, mirror-perft, corpus label
  correlation, ledger audit) on their inputs' contents, so you pay once per real change instead of
  once per run.
- **`scripts/results.mjs`** — an append-only ledger. Rows are never edited or deleted. A **retraction**
  is a new row carrying a mandatory reason; an **amendment** is a new row saying *the number stands,
  the description lied*, and it refuses to land without a reproduction proof.
- **`scripts/ledger-audit.mjs`** — 15 invariants over the whole record, two severities
  (CONTRADICTION exits non-zero, INCOMPLETE never does), gated against a ratcheting baseline so it
  fails only on something new.
- **`scripts/sprt.mjs`** — replaced a fixed 64-game gate that, at the measured per-game standard
  deviation of 0.42, had a **17% false-positive and 50% false-negative rate**. The sequential test runs
  on colour-reversed game pairs and Monte-Carlos at 3.6% / 3.9% realised error, deciding a
  clearly-better candidate in about 54 games.
- **`scripts/control-trigger.mjs`** — a self-play control block is mandatory on a trigger, and the rig
  runs it for you rather than printing a demand.
- **`scripts/thermal-sweep.mjs`** — measures what a run costs the laptop, after discovering that a
  single 75-second arm has a ±4–5 °C noise floor.

Games run concurrently (`--concurrency`, pinned at 6), measured at 5.4–5.9× over the old serial loop.

## Things measured here that are worth knowing

- **A fixed-depth block reproduces bit-exactly** from its recorded seed. Movetime blocks never do —
  timing jitter — which is why an amendment can only correct a fixed-depth row.
- **A corpus cannot go stale.** Three 10M-row corpora generated on different days sit within 0.026
  total-variation of each other, below the 0.036 noise floor of the measure. Only switching *generator*
  moves anything.
- **Never quote an SPRT point estimate as an effect size.** It stops when ahead, so it is biased away
  from the boundary. Use a fixed-N block to size an effect.
- **Held-out loss does not predict Elo here.** The eval tuner's best-ranked candidate improved held-out
  loss more than any other pair of constants and measured −9 Elo at Gate A.
- **Fairy's Skill Level does not reduce its search depth.** At `movetime 100` it reaches depth 10 at
  skill 3, 5, 8, 10 and 15, and depth 12 at skill 20. Skill only degrades which move it picks out of
  that search, so the ladder measures move quality.

Every block ever played is in [`results/blocks.jsonl`](../results/blocks.jsonl), written by the arena
itself. The full execution log, retractions included, is in
[`strength-spec-v1.md`](strength-spec-v1.md).
