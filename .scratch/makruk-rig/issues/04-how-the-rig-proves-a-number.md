# How does the rig prove a number before anyone acts on it?

Type: grilling
Status: resolved (2026-08-02)
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

**All four mechanisms are kept, but at four different frequencies — and only one is allowed to cost games.** The organising insight: the defect class that actually bit is *config/env drift*, not engine behaviour, and config drift is checkable in milliseconds. Only the expensive check is made conditional, and it fires exactly when a number is already under suspicion.

### 1. Pre-flight self-test — mandatory, every round, cost: sub-second

`scripts/preflight.mjs`, invoked as a **hard precondition inside `match-arena.mjs` and `datagen.mjs`**, not as a separate command anyone has to remember. If it fails, nothing plays and nothing generates (exit 2). Five checks:

| check | catches |
|---|---|
| `env-shape` | `MAKURUK_EVAL` not exactly `net`/`classic`; net with missing/empty weights — **defect #2, the zsh word-split, before a single game** |
| `armed-eval` | the engine armed something other than what was requested |
| `sides-differ` | both sides resolve to the same eval hash when nobody asked for that |
| `seed-determinism` | the opening PRNG is impure, or the seed never reaches it |
| `perft` | startpos perft(3) ≠ 12012 — movegen regressed |

**`armed-eval` required an engine change to be possible at all.** `nnue::mode()` resolves lazily and, on a weights-load failure, fell back to the classical eval with only an `eprintln!` — invisible to a harness driving the binary over UCI. Added `nnue::eval_id()` and a UCI `evalinfo` command that force resolution and report *what was actually armed*, so the silent fallback is now an assertion failure. Verified against the real defect:

```
$ MAKURUK_EVAL=net MAKURUK_WEIGHTS=/nope.bin ./target/release/makruk-engine <<< evalinfo
info string evalinfo classic fallback-from=/nope.bin reason=No such file or directory
```

### 2. Loud assertions on impossible states — mandatory, always-on, cost: ~zero

Fatal at the tally in `match-arena.mjs`:
- `played + errors ≠ games requested` → fatal, and the message names **which** failure it is. SHORT (a result tag fell through the classifier / the loop exited early — the score fraction is over a smaller denominator than you asked for) and OVER (a game tallied twice — the fraction is diluted) are different bugs with different fixes, and the log line has to be diagnosable without re-deriving it from raw match output.
- score fraction outside [0,1] → fatal.
- zero games produced a position → fatal.

Fatal at generation in `datagen.mjs`: corpus label correlation below r = 0.3 (see mechanism 3).

**Zero draws in ≥32 games warns, never fatals** — accepted as argued: it is suspicious but genuinely possible where one side is outclassed (skill 10 and skill 20 both read 0–32–0 on the real ladder), and a fatal that cries wolf once is a fatal you learn to ignore.

**`sides-differ` and the control block are in direct conflict, resolved with an explicit flag.** A self-play control has identical sides *by design*, so the assertion had to be opt-out — but inferring "identical hash ⇒ this must be a control" from the hash comparison itself is fragile, because accidentally running identical sides outside a control is a real bug you want caught, not silently passed. `--control` (arena) / `control: true` (API) makes the invariant mean exactly *"identical sides when nobody asked for that."*

### 3. Preconditions as gates — mandatory, hash-gated, cost: amortises to ~zero

`scripts/gate.mjs`. Each gate hashes its **inputs' contents** (not mtimes) and skips when they match a previous passing run:

| gate | inputs | wired into |
|---|---|---|
| `cargo-test` | `src/*.rs`, `tests/*.rs`, `Cargo.toml` | every arena block (`--skip-gates` warns loudly to override) |
| `mirror-perft` | `movegen.rs`, `board.rs`, `game.rs`, the script | manual / CI |
| `label-check` | the corpus file | **end of every datagen run** |

The cache keeps the last 8 passing hashes per gate rather than only the newest, so reverting an edit or flipping branches lands on a known-good hash instead of paying twice. `.gatecache.json`, gitignored.

**`label-check` moved from "prose in AGENTS.md someone must remember" to "runs automatically when the corpus is born."** That is strictly better than running it before training: a corpus that cannot clear the gate never becomes a training run at all. Verified by replaying the rounds 1–3 defect on a sign-inverted copy — `Pearson r = −0.989 → FAIL`, with the fix named in the error.

### 4. Control block — conditional, NOT every round, cost: real when it fires

The one expensive mechanism, and "every round" is the wrong frequency for it. The `OPP_WEIGHTS` bug was not caught by running controls constantly — it was caught because a non-monotone ladder looked wrong and someone investigated. Formalise *that* trigger rather than paying blind:

> **A self-play control block is mandatory when (a) a block's result deviates from the trend line by more than the SE band (~8.8 points at n=32), or (b) a new *binding mechanism* is introduced — a new env var, a new opponent type, a new config axis — or (c) it is the first block at a new rung.**

Clause (b) is deliberately *not* "a new weight." Every DAgger round produces a new weight, so gating on that collapses (4) straight back into the "always" it was designed to avoid — it would re-verify plumbing that has not changed, every round, wearing a trigger-condition costume. A control block exists to catch **plumbing** failures (the harness wiring the wrong thing into the wrong slot); a new weight flows through plumbing that already proved itself last round, whereas a new env var is untested plumbing, which is precisely what a control is for.

Clause (c) exists because clause (a) is blind by construction at a new rung — there is no trend line yet to deviate from.

**Status: NOT implemented, and blocked.** Clause (a) needs a trend line, which needs a results ledger, which is [Where do results live?](06-where-results-live.md). Split out as [Implement the conditional control-block trigger](07-control-block-trigger.md). The *capability* it depends on — running a control at all — landed here (`--control`), and an r3-vs-r3 block through the new path reads 50.0%.

### Net cost per round

Pre-flight (sub-second) + assertions (free) + hash-gated preconditions (free unless inputs changed) + control blocks (free unless a number is already suspect). The expensive check only fires when you have independent reason to distrust the number — which is precisely when distrust is warranted.

**Verified green on resolution:** `cargo test --release` all suites, mirror-perft 29/29, an r3-vs-r3 control block through the new code path, a 2k datagen smoke passing its own label gate, and all three historical defects reproduced and rejected.
