# Eliminate levers against a frozen list

Status: **accepted (2026-08-10)**. Sits **above** [ADR 0002](0002-measure-the-scaling-slope-before-growing-the-corpus.md);
it does not amend it. The scaling-slope curve still runs, its stop-bar still binds, and
ADR 0002 clauses 3 and 4 still route to "stop the net program."

## Decision

**The deliverable of this round is retired hypotheses, not a strength number.** A moved
crossover skill is an aspiration, explicitly not a commitment.

**The list is frozen now, in triage order, and no lever may be added to it:**

1. Scaling-slope curve (ADR 0002)
2. LMR
3. Aspiration windows + iterative-deepening reuse
4. SEE ordering in quiescence
5. Counting-rule play *(amended 2026-08-10, before any lever ran — see below)*

**Bound: 2026-09-10.** A lever not reached by that date is **killed unrun**. Not deferred,
not carried into a next round — killed, and recorded as killed.

**Scope.** Net, search, counting-rule play. Explicitly **out, held in reserve**: time
management, net architecture (HalfKA, a wider net), classical eval terms.

### Amendment, 2026-08-10 — slot 5 swapped before any lever ran

Slot 5 was *classical eval terms*; it is now *counting-rule play*, and *classical eval
terms* takes the reserve slot counting-rule play vacated. **This is an exact inversion of
the scope line as first written, and it was authorized by the user, not drifted into.**

The goal as framed left two flags explicitly undecided — whether slot 5 deserved to exist
given its weak prior, and whether counting-rule play belonged in reserve at all. Both were
put back to the user with the alternatives costed (swap / keep as frozen / drop to four
slots), and the user chose the swap before any lever ran. The frozen-list rule is not
weakened by this: the list was frozen against *additions*, the count is unchanged at five,
and the swap is recorded here rather than made silently.

The two flags turned out to be the same flag.

Levers 2, 3 and 4 are all **search** changes, and "the wall is search" is already a retired
diagnosis — round 4's null-move + LMR went 6–0 in self-play and bought **one extra draw**
on the ladder. So four of five slots sat inside a family the record has killed. That is a
weak list: if it comes back empty, it will be hard to tell a real null result from a list
that never left the exhausted neighbourhood.

Counting-rule play is the one candidate outside that family. It is where a chess-derived
engine most plausibly bleeds on makruk, it has **never been measured**, and the ladder
blocks are full of the symptom — `b0055` is 35 draws in 62 games, and the engine aborts
~25% of self-play games on the ply cap while fairy converts. Whether those draws are
positions we failed to win is exactly the untested question.

**This amendment is legitimate only because it is pre-execution.** No lever has run and no
number exists. Once lever 1's first block lands, the list is frozen against amendment of
any kind, including this kind.

**Vocabulary.** An artifact is now **(eval, engineId)** — see CONTEXT.md. Levers 2–4 are
search changes, so each **mints a new artifact**, and each gets its own ladder block
(~12 min).

### Stop-bars, two tiers

**Per lever — Gate A SPRT, elo0 = 0, elo1 = 30.**
- accept-H1 → **land** the lever.
- accept-H0 → **kill** the lever. Do not iterate on it, do not tune it, do not retry it
  with a different constant.
- The lever's ladder block is **recorded, not gated**. It measures; it does not decide.

**Goal-level — one ladder block on the accumulated stack at the date.**
- Success = crossover moved **≥ 1 full rung**: 4.5 → ≥ 5.5, i.e. skill-5 score ≥ ~50%.

**Failure clause, pre-committed.** If the crossover has not moved after **4–5 landed
Gate A passes**, the goal has **failed**, and the conclusion is not "try harder levers."
It is that **Gate A on this rig does not track ladder strength** — a fifth retired
diagnosis, and the most valuable thing this round could produce.

## Starting numbers

Incumbent ladder, equal 100 ms, n = 64: skill 5 → **39.8%**, skill 8 → **23.4%**,
skill 10 → **9.4%**. Crossover ≈ **4.5**.

## Why

Four governing diagnoses have now been retired — the wall is search, the wall is depth,
the wall is eval speed, and (pending ADR 0002) the wall is corpus. Each died on an arena
block after a plausible mechanism and a real correlation. The pattern is not that the
wrong lever keeps getting picked; it is that levers were picked **one at a time, in
response to the last failure**, so the list could always grow by one more idea and the
program could never end.

Freezing the list and dating it is the structural change: the list can only shrink. Every
outcome — landed, killed, killed-unrun — reduces it.

**Why the failure clause matters more than the levers.** Gate A has passed changes that
the ladder did not notice (round 4's null-move + LMR, the accumulator). If four or five
more Gate A passes stack up and the crossover still sits at 4.5, the honest reading is
that the selection mechanism is measuring something that is not strength on this rig.
That conclusion is worth more than any single lever, and it is only reachable if it is
written down *before* the passes accumulate.

**Why per-lever kill and no iteration.** Iterating on a rejected lever is how a frozen
list unfreezes in practice — "LMR failed, but LMR with a different reduction formula is a
different lever" is the move that has to be forbidden by name.

## Considered and rejected

- **A crossover target as the commitment.** Rejected: it makes the deliverable a number
  the program has failed to move four times, and it licenses escalation when the number
  does not move. The retired-hypothesis framing cannot fail to produce output.
- **Adding levers as they surface.** The whole mechanism. An open list has no end state.
- **Classical eval terms as a lever.** Held in reserve. Weak prior *and* a known failure
  mode: the tuner's best-ranked candidate measured **−9 Elo** at Gate A (`b0054`), and
  held-out loss is already shown not to predict Elo on this engine. It lost its slot to
  counting-rule play in the amendment above.
- **Dropping slot 5 entirely, running a list of four.** Considered. Rejected because it
  would leave every remaining lever inside the search family, which is the specific
  weakness the amendment exists to fix.

## Consequences

- **This ADR contains a clause that can retire Gate A.** If the failure clause fires, the
  project's selection mechanism is the thing that has been refuted, and no further lever
  may be selected on Gate A until a replacement is specified.
- Ladder blocks are now indexed by artifact **including engineId**. Scores measured under
  different engine builds are not comparable and must not be placed in one column.
- A killed lever stays killed past this round's end. Reopening one requires a new ADR that
  says what evidence changed.
- "Killed unrun" is a real outcome and is recorded as such, so the date is a cost with
  teeth rather than a soft deadline.
