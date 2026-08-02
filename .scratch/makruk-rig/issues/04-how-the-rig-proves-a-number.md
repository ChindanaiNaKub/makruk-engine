# How does the rig prove a number before anyone acts on it?

Type: grilling
Status: open
Blocked by:
Parent: map.md

## Question

Five harness defects surfaced on 2026-08-02 alone. Every single one made the engine look **worse** than it was, and several were found only after rounds of eval and search work had already been interpreted against them:

| defect | what it corrupted | how it was eventually caught |
|---|---|---|
| datagen inverted the eval sign on 47% of rows | the entire bootstrap corpus | `label-check.mjs`, written afterwards |
| `env $var node …` didn't word-split in zsh | three "net" blocks measured the classical eval | a non-monotone ladder looked wrong |
| max-plies games scored as errors | 16 of 64 games silently dropped per Gate A block | reading the harness |
| no opening randomization | an N-game block was not N samples | a 6–0 smoke contradicting a 34.4% block |
| mirror-perft promotion regex | movegen validation | — |

The pattern is not "we write buggy scripts." It is that **a corrupt number is indistinguishable from a real negative result**, and the project's default reaction to a negative result was to theorize about the engine. What is the standing mechanism that catches defect #6?

Candidate mechanisms, to be argued and chosen among — not all of them, and each one costs time on every round:

- **Mandatory control block.** The r3-vs-r3 run that came back 1–1–8 is what proved `OPP_WEIGHTS` was actually reaching the opponent; a silently-ignored variable would have shown r3 beating classic. Should a self-play control precede *every* gate, and what result range aborts the run?
- **Loud assertions on impossible states.** `match-arena` now fatals on a malformed `MAKURUK_EVAL`. What else is assertable — score fractions outside plausible bounds, a block where both sides played the same eval, a corpus whose label correlation is near zero, zero draws in 32 games?
- **Preconditions as gates, not habits.** `label-check.mjs` before training, `cargo test` + mirror-perft before any arena block. Today these are prose in `AGENTS.md`. Should they be enforced by the scripts themselves?
- **A pre-flight self-test.** One command that checks the rig end-to-end (both evals load, both sides differ, oracle agrees with fairy, seeds reproduce) before an evening is spent.

Decide which are **mandatory**, where each is enforced, and what the cost per round is — the whole point of this map is that the answer has to fit inside budget N.

## Answer

<!-- filled on resolution -->
