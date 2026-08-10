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
A specific evaluated thing that can play — a named net file, or the classical eval.
Artifacts are what blocks compare; a code branch is not an artifact until it is
pinned to something a block can arm.
_Avoid_: model, version, build

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
How strong the teacher that labelled the corpus was. A quality, moved only by
regenerating data with a better artifact — orthogonal to corpus size, and the axis
this project has never moved.
_Avoid_: data quality, label depth

**Probe**:
Top-1 agreement between an artifact's eval and a reference engine's. A fit
diagnostic only. It has been shown on this engine not to predict ladder position,
and artifacts are never selected on it.
_Avoid_: accuracy, validation score
