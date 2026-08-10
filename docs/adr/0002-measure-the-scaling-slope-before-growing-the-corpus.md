# Measure the scaling slope before growing the corpus

Status: **accepted (2026-08-10)**. Follows [ADR 0001](0001-close-the-net-speed-gap-before-training-again.md),
whose premise was refuted the same day.

## Decision

**Stopping the net program is the default. Growing the corpus is not authorized, and
becomes authorized only by a measured scaling slope on data that already exists.**

Concretely:

1. Train the current architecture on 2.5M / 5M / 10M row subsets of
   `tools/data/bootstrap-d6.jsonl`. No datagen.
2. Measure each with a **fixed-N Gate B block at one rung** — not Gate A.
3. **Stop-bar, pre-committed: ≥ 25 Elo across 2.5M → 10M, monotone across all three
   points.** Below it, non-monotone, or unreadable ends the net program.
4. A **power calculation runs first**. If the n needed to resolve 25 Elo is
   unaffordable on this machine, the question is unmeasurable here and the program
   stops. That is an answer, not a blocker.
5. If the slope clears, the ~13-hour round moves **corpus size only** — 10M → ~100M,
   identical generator, identical d6 labels.
6. If that round's Gate A rejects, the net program **stops permanently**. Not a wider
   net, not d8 labels, not a third generator, not HalfKA features, not 200M rows.
7. An accept is not the end either: Gate A is selection, not strength. Nothing is
   claimed until the **ladder** moves.

## Why

ADR 0001's branch table said a Gate A rejection after a speed success points at the
corpus. That inference is void — the table anticipated speed *mattering*, and what
happened is that Gate A was **indifferent to speed entirely**. So "corpus next" is a
fresh decision on new evidence, and on that evidence it is the **fourth** governing
diagnosis in a program that has retired three: the wall is search, the wall is depth,
the wall is eval speed. Each had a plausible mechanism and a real correlation. Each
died on an arena block. Corpus currently has exactly that shape and no more.

Making *continuation* the thing that must be argued for is the only structural change
this program has not tried.

**Why the existence proof does not authorize the spend.** Fairy's official makruk net
is listed at +248 Elo over their classical eval, which proves an NNUE can beat a
classical eval on this game. It does not prove a **768 → 256** net can. Fairy got
there with king-indexed HalfKAv2 features, ~100× the parameters, *and* 10× the data —
three changes at once. Picking one and assuming it is the binding constraint is the
exact move that killed the last three diagnoses.

**Why a learning curve, and why on data we already have.** It measures the *scaling
slope* — the quantity the 10M → 100M bet actually rides on — for about an afternoon of
foreground arena instead of a 13-hour thermal day. A flat slope where we can see it
refutes the round before it is run.

**Why fixed-N Gate B and not Gate A.** A curve needs three *comparable* numbers. Gate A
is a selection mechanism whose SPRT stops as soon as it has a decision, at a
self-selected game count — 48 games in b0063, 78 in the block before it. Reading a
curve off three such scores is the "number copied by hand out of a block" failure the
Block definition exists to forbid.

**Where 25 Elo comes from — derived, not chosen.** r3 sits at −42 Elo against the
incumbent. 2.5M → 10M is 2 doublings; 10M → 100M is 3.3. Under the most *generous*
assumption available — gain log-linear in corpus size, how every published scaling
curve behaves before it flattens — closing 42 Elo over 3.3 doublings needs ≥ 12.7 Elo
per doubling, hence ≥ 25 Elo across the two doublings that are measurable without
datagen. Below that, even the optimistic extrapolation does not reach parity.

## Considered and rejected

- **Corpus level via deeper labels (d6 → d8).** Contradicted by the primary source: Fairy
  won at **d2–5**, *shallower* than our d6. The d8 case rests on the label ceiling
  (36.9 / 45.9 / 58.1), which is a **probe** number — and probe has been shown on this
  engine not to predict ladder position.
- **Corpus composition / switching generator.** Already pulled to its limit. The DAgger
  corpora *are* the "rebalance toward opening/middlegame" lever in its most extreme
  form (~47% opening, ~41% middlegame, **0.0%** bare-pawnless against bootstrap's 30.4%),
  and the record says they bought nothing measurable.
- **Regenerating the corpus.** Refuted by measurement: three 10M bootstrap corpora built
  on different days sit 0.006–0.026 apart, below the metric's own 0.036 noise floor. A
  fresh corpus from the same generator is the same corpus.
- **A train/val loss check as the authorization gate.** It is a fit diagnostic, so by this
  project's own record it could only ever veto, never authorize. The Gate B curve sits on
  the acceptance chain and can do both.
- **Stop the net program now, without the curve.** Genuinely on the table, and cheaper.
  Rejected only because the curve costs an afternoon and can refute the corpus lever with
  evidence rather than by analogy — but note that clauses 3 and 4 route straight back here.

## Consequences

- The pre-committed exit conditions are load-bearing and were written **before** any
  number exists, because the first three diagnoses each produced a plausible next thing
  to try at the moment they failed. An exit condition negotiated against the evidence is
  not a stop-bar.
- "Ambiguous" is not a reason to run the big round to find out. Ambiguous means stop.
- Compound changes are forbidden here. One axis moves at a time, because a compound change
  that fails says nothing about which part failed.
