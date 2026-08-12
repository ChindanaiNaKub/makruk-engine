# Makruk Engine

A Makruk (Thai chess) engine whose every strength claim is a measured, append-only
record rather than an assertion. This glossary fixes the words that measurement
uses, because three of them have already been misread in ways that cost days.

## Language

### Measuring strength

**Rung**:
One fairy-stockfish skill level used as an opponent, at equal time. Only skill 5, 8
and 10 are rungs — skill 3 no longer discriminates between artifacts, and 10, 15
and 20 are one indistinguishable wall.
_Avoid_: level, difficulty, tier

**Ladder**:
The ordered set of rungs, and an artifact's score at each. The ladder is the only
measure of strength that counts; self-play results are not on it.
_Avoid_: benchmark, leaderboard

**Crossover skill**:
The rung at which an artifact would score 50%, interpolated from the ladder. The
single number that answers "how strong is it".
_Avoid_: rating, Elo, strength score

**Block**:
One batch of games played under a single fixed configuration, recorded as one
append-only row. A block is the atom of evidence — never a subset of one, never a
number copied out of one by hand.
_Avoid_: run, match, batch, session

**Control block**:
A block whose two sides are deliberately identical, so its expected score is 0.5 by
construction. It proves the rig, not an artifact, and never appears in the standings.
_Avoid_: baseline, sanity run

**Artifact**:
The pair **(eval, engineId)** — what was evaluating, *and* which engine build did the
searching. Redefined 2026-08-10: the old definition was the eval alone, which made a
search change invisible to the record even though it changes how the thing plays. A
search change **mints a new artifact**, and its ladder scores may not be compared with
an older engineId's. A code branch is not an artifact until it is pinned to something
a block can arm.
_Avoid_: model, version, build

**Engine id**:
The half of an artifact that is not the eval — the pinned engine build (commit) whose
search produced the moves. Two blocks share an artifact only if both halves match.
_Avoid_: build number, revision (as a strength claim)

**Lever**:
One named, single-axis change proposed as the cause of the strength gap, held against
a pre-committed stop-bar that can retire it. The unit this program produces is a
**retired** lever, not a strength number.
_Avoid_: idea, improvement, optimization

### Deciding

**Gate A**:
The head-to-head sequential test (SPRT) between a candidate artifact and the
incumbent. A *selection* mechanism, never a target — passing it says the candidate
beat the incumbent, not that the engine got stronger.
_Avoid_: the gate, the benchmark, the goal

**Gate B**:
The fixed-N block against fairy at the current rung. Fixed-N on purpose, because it
is a ladder measurement that must stay comparable across rungs.
_Avoid_: the ladder test

**Incumbent**:
The artifact a candidate must beat to replace it. Currently the classical eval, not
a net.
_Avoid_: baseline, current best, champion

**Stop-bar**:
A pass threshold written down before the measurement that produces it, whose
function is to bind future decisions rather than describe present ones. Missing a
stop-bar ends a line of work; it does not license escalation.
_Avoid_: target, goal, threshold

### Training

**Corpus size**:
How many labelled positions exist. A quantity.
_Avoid_: dataset size, data volume

**Corpus level**:
How strong the teacher that labelled the corpus was. A quality, orthogonal to corpus
size. Its artifact half is **already at its ceiling** — the teacher is Fairy armed
with the official makruk net, the strongest makruk artifact that exists, so there is
no better artifact to regenerate with. The only live knob is the teacher's *search
depth*, which is a different thing and should be said as such.
_Avoid_: data quality, label depth

**Scaling slope**:
Strength gained per doubling of corpus size, measured on the ladder. The quantity a
decision to grow the corpus is betting on, and therefore the one that has to be
measured before the corpus grows rather than after.
_Avoid_: data scaling, learning curve (as a strength claim — a loss curve is a fit
diagnostic and is not this)

**Probe**:
Top-1 agreement between an artifact's eval and a reference engine's. A fit
diagnostic only. It has been shown on this engine not to predict ladder position,
and artifacts are never selected on it.
_Avoid_: accuracy, validation score
