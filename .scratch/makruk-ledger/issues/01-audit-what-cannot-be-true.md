# Which rows say something that cannot be true?

Type: task (AFK)
Status: resolved (2026-08-03)
Blocked by: —

## Question

The amendment primitive is being designed from **one** defect: five rows that record `movetime 100/400` for blocks that ran `go depth N`. Designing a correction mechanism from a single example is how you get a mechanism that fixes exactly that example. Before the shape is fixed, sweep the whole ledger and produce the definitive list of rows whose recorded fields cannot all be true at once.

**What "cannot be true" means.** Not "looks odd" — internally contradictory, or contradicted by the row's own numbers. Known and suspected instances:

- **Search condition.** `depth != null` and `movetime != null` are mutually exclusive: under `--depth`, `goCmd` ignores both ms values and sends `go depth N` to both engines. Five rows (`b0040`–`b0044`) assert both by asserting movetime while having run at depth.
- **Timing arithmetic.** `gameTimeS / games` implies a per-game cost. A 192-game block claiming `100/400 ms` over ~200-ply games implies ~50 s/game; `b0040` records **10.4 s/game**, which is a fixed-depth figure. This is a *detector*, not just an observation — it flags a mis-recorded search condition without re-running anything, and it should be applied to all 49 blocks.
- **Armed vs requested eval.** `mine.eval` / `opponent.eval` against the `armed` string each side reported. A silent net→classic fallback is exactly what `armed` exists to make auditable after the fact; nothing has ever swept for it.
- **Concurrency and wall-clock.** `wallClockS` against `gameTimeS / concurrency` — a row whose wall-clock is impossible for its stated concurrency is misrecorded somewhere.
- **Meta-row integrity.** 15 meta rows: does every `retracts`/`clears` target exist? Does every clearance name a block that is `kind: control` and actually passes `controlVerdict()`? Is any block both retracted and cleared?
- **Suspect rows.** Every `suspect` entry quotes a comparison ("X% is Npp from the Y% previously measured at this exact cell"). Where the cell was pooled across search conditions, the quoted Y is an average of blocks that are not comparable — so the *reason text stored in the row* is wrong even where the suspect flag was right.

**Resolve with** a script — `scripts/ledger-audit.mjs` or equivalent — not a hand sweep, because this has to be re-runnable after every future block. It reads `results/blocks.jsonl` (honour `MAKURUK_LEDGER`), applies each check, and prints one line per violation: row id, which invariant, what the row says, what contradicts it. Exit non-zero if any violation is found, so it can later become a gate.

**The answer this ticket owes the map:**

1. The complete list of violating rows, grouped by defect class.
2. For each class: **amendable** (measurement stands, description wrong) or **retractable** (measurement itself is not to be trusted). This is the input the amendment design needs — it says which fields the primitive must be able to set.
3. Whether any violating row is *not* fixed-depth. If one is, decision 4 on the map ("proof is mandatory") has a live consequence rather than a theoretical one, and the amendment design has to say what happens to it.

**Cost:** reading and scripting only. No arena blocks, no re-runs. Thermally free.

**Watch:** the audit must not need the ledger to be correct in order to read it — a row missing a field is data, not a crash. And do not "fix" anything here; this ticket produces the list, [Amend the five and reconcile what quotes them](05-amend-the-five-and-reconcile.md) acts on it.

## Answer

**`scripts/ledger-audit.mjs`. 15 contradictions across 7 rows, 3 defect classes — and the five are not
the whole list.** Two rows outside `b0040`–`b0044` contradict themselves, and one of them is a
movetime block, so decision 4 bites for real. Exit code 1, `cargo test --release` green, no arena
blocks run.

```
$ node scripts/ledger-audit.mjs
ledger: results/blocks.jsonl — 49 blocks, 15 meta rows
...
15 contradictions across 7 rows: b0040, b0043, b0010, b0041, b0042, b0044, b0049
```

### 1. The complete list, grouped by defect class

| class | rows | invariants that fire | verdict |
|---|---|---|---|
| **Search condition** | b0040, b0041, b0042, b0043, b0044 | `timing-arithmetic` (5), `movetime-is-not-reproducible` (2), `clearance-condition-matches` (2), `control-time-symmetric` (2) | **amendable** |
| **Identity** | b0010 | `kind-matches-opponent` | **retractable — and already retracted** |
| **Suspect reason** | b0040, b0043, b0049 | `suspect-reason-comparable` | **neither** — see below |

The five hold. **No sixth mis-recorded search condition exists**, and the audit says so on evidence
rather than on the absence of a hunch: 31 of the 36 blocks that carry every field the timing detector
needs land inside the band, and the calibration table is printed on every `--verbose` run.

### 2. What each class needs from the amendment primitive

**Search condition — amendable, and it needs exactly three fields.** `depth` (set), `movetime` and
`opponentMovetime` (null). All three are "how the block was run"; none is an outcome. That is the
whole `set` vocabulary this defect requires, and it is a straight instance of map decision 3 — nothing
new for [The amendment record](02-the-amendment-record.md) to invent.

Two of the four invariants in this class are **consequences, not separate defects**, and amending the
three fields clears both without extra machinery:

- `control-time-symmetric` on b0041/b0044 — identical engines with one side on 4× the clock. Null the
  ms values and the asymmetry is gone. Worth noticing on its own terms: **the instruction
  `results.mjs` prints when a block goes suspect** (`match-arena.mjs --control --games 20 --kind
  control`) takes the default `--movetime 100`, and `FAIRYTIME` defaults to `MOVETIME * 4` — so a
  control run by following the printed instruction is asymmetric *by construction*. `runControlBlock()`
  passes `--fairytime` equal to `--movetime` and is unaffected; only the hand-run path is exposed.
- `clearance-condition-matches` on b0040←b0041 and b0043←b0044 — flagged because the clearing control
  is *provably* fixed-depth while the block it vouches for claims movetime. Amend both sides to the
  same depth and the pair matches again. **This is a live constraint on the amendment's overlay: a
  meta row's validity is derived from fields an amendment can change, so `readBlocks` must re-derive
  it after the overlay, never before.**

**Identity — retractable, and it is the live consequence the ticket asked about.** `b0010` records
`kind: gate-b` with `opponent.engine: "ours"`; gate-b *is* the fairy ladder (`match-arena.mjs:465`), so
the two cannot both be true. Its retraction reason says the opponent was really native
fairy-stockfish — the `FAIRY_BIN.includes("makruk-engine")` bug. **b0010 is a movetime block**
(100/100, 32 games), so it can never be reproduced, so under decision 4 it can never be amended. It
stays retracted.

And that answers question 3 with a sharper edge than expected. The retraction reason on b0010 (and on
b0012, b0013, retracted for the identical cause) reads:

> *"The games themselves were correct — the real binary was spawned — and the scores stand."*

**Three sound measurements were thrown out of the record because retraction was the only tool
available.** They are the amendment primitive's second customer, they are unprovable, and decision 4
therefore refuses them. That is not a defect in decision 4 — it is the rule working — but it means
[The amendment record](02-the-amendment-record.md)'s awkward-case list (#4, "can an amendment amend a
retracted row?") is answering a question about three real rows, not a hypothetical. The precise
question it inherits: **is there a class of amendment whose claim is not a re-runnable measurement?**
b0010's claim is about *identity*, and no re-run can establish it; only a per-side engine hash could
have, which is [Pin the engine that played the block](03-pin-the-engine-that-played.md)'s business.

**Suspect reason — neither amendable nor retractable, and the primitive should not grow to reach it.**
All three suspect reasons quote a mean pooled across search conditions:

```
b0049  "71.9% is 16.7pp from the 55.1% previously measured at this exact cell"
       "this exact cell" is b0028 (100/100ms), b0040 (100/400ms), b0043 (100/400ms)
       while this block claims depth 6
```

The quoted numbers are **exactly reproducible** from the live ledger — the audit checks this
separately (`suspect-reason-reproducible`, zero findings), so the stored text is a faithful record of
what `postChecks` computed. The defect is in the trigger's cell definition, which the map already
ruled **out of scope**. By map decision 3 an amendment corrects *how a block was run*; a suspect
reason is a derived judgment, not a run condition, so it is outside the primitive's remit by the
settled rules and no allowlist debate is needed. Recommendation for
[Amend the five](05-amend-the-five-and-reconcile.md): **leave the text, let the audit keep flagging
it.** A re-runnable check is a better annotation than an edited judgment.

### 3. Two invariants the ticket asked for that came back clean — one of them meaninglessly

**Concurrency vs wall-clock: clean.** No block claims to have finished faster than
`gameTimeS / concurrency`. b0040 is the tightest at 337 s against a 334 s floor.

**Armed vs requested eval: clean, and the check is structurally unfalsifiable.** Zero mismatches over
42 rows carrying `armed` — but `armed` cannot detect the defect class it looks like it covers.
`preflight.mjs:74` produces it by spawning **our own binary** under the *believed* env and reading
`evalinfo`; the arena then records it. Both fields therefore derive from the same belief, checked
against a probe of the same binary. On b0010 that belief was wrong — the opponent was fairy — and
`armed` dutifully recorded `"classic"`, corroborating the error instead of contradicting it. It also
never covers a fairy opponent at all, since `sides` only gains an opponent entry when `oppIsOurs`.

**Direct input to [Pin the engine that played the block](03-pin-the-engine-that-played.md):** hashing
the binary *actually spawned for each side* would have caught b0010 the moment it was written —
opponent hash = fairy, `opponent.engine` = "ours", contradiction in the row. `armed` could not, and no
extension of it can, because it is not a report from the process that played.

### 4. The two detectors, and why there are two

The ticket proposed timing arithmetic. It works, and it is not sufficient alone — so the audit carries
a second, threshold-free detector and the five rows are convicted by agreement rather than by a
constant.

**Timing arithmetic** (`timing-arithmetic`). At fixed movetime a move costs its budget, and — the
part that makes it a detector — **contention does not change that**: engines at fixed movetime search
fewer nodes when they contend, they do not take longer (rig ticket 01). So `gameTimeS` over
`plies × (mine+opp)/2` is tight across the whole ledger. Measured:

| | ratio |
|---|---|
| 31 blocks that pass | **0.796 – 0.942** |
| b0040 | 0.179 |
| b0041 | 0.396 |
| b0042 | 0.707 |
| b0043 | **1.042** |
| b0044 | 1.375 |

Note **b0043 is above the band, not below** — depth 7 is *slower* than the movetime it claims. A
one-sided "too fast to be real" check would have missed it.

The band is `0.75–0.99`, each edge at the **midpoint of the gap** between the passing population and
the nearest row it convicts: 0.75 between b0029 (0.796) and b0042 (0.707), 0.99 between b0033 (0.942)
and b0043 (1.042). The ceiling was first set at 0.95 and moved after reading the calibration table —
0.95 sat **0.008** above the highest passing block and 0.092 below the nearest conviction, so an
honest block running slightly long would have been convicted while the flagged one had margin to
spare. Nothing anchors the upper edge to a mechanism (the honest population runs *under* 1.0 because
engines return a little under budget), so centring is all there is to go on. **~0.05 of margin either
side is not much, and it is empirical, not derived** — which is why the report prints the passing
span on every `--verbose` run. A block landing outside the band by a hair should recalibrate these
constants, not be convicted by them.

**Paired determinism** (`movetime-is-not-reproducible`). No threshold at all. With `--opening-plies 4`,
games 2k and 2k+1 are the same opening with colours reversed; when both sides run the same engine and
eval and the search is fixed-depth, the pair is the same game mirrored. At fixed movetime it cannot
be — jitter is precisely why 44 of this ledger's blocks can never be proven by re-running them.

| block | claims | pairs replaying to the same ply |
|---|---|---|
| b0041 | 100/400 ms | **9 / 10** |
| b0044 | 100/400 ms | **10 / 10** |
| b0048 | depth 6 (honest) | 10 / 10 |
| b0009, b0027, b0035, b0036, b0039 (honest movetime controls) | 100/100 ms | 0/8, 1/60, 0/10, 2/10, 0/10 |

b0040 and b0043 additionally carry `clearance-condition-matches`, which convicts them through their
own clearing controls. So: **b0040, b0041, b0043, b0044 are each flagged by two independent
detectors. b0042 rests on the timing ratio alone** (0.707 against a 0.796 floor) — it is a 4-game
smoke, nothing quotes it, and its true depth is unknown from the record, so amending it needs a
candidate search (depth 5? 6? 7?) rather than a single re-run. Cheapest of the five to prove, least
important to.

### 5. Things the sweep turned up that are not this ticket's

- **`b0009` does not fail its control band — the map's fog patch has the premise wrong.** It scores
  40.6% over 16 games and **passes** `controlVerdict()`, because its 3–6–4 split gives sd 0.416 and a
  **±20.8pp** band. The real finding is upstream of "a failed control is live": *control blocks appear
  in the generated standings at all.* `results.mjs`'s `NOISE_KINDS` is `{smoke, diag}` while
  `control-trigger.mjs`'s is `{smoke, diag, control}` — two files disagreeing about what counts as a
  result. That is a record question, it is now sharp, and it graduates to
  [Should a control block appear in the standings?](06-controls-in-the-standings.md).
- **`observedSd` drops max-plies games, widening every control band by up to 45%.** It computes over
  `w + l + d` while the score is computed over `w + l + d + maxPlies`, so the least-dispersed
  observations are discarded and n shrinks. b0048: ±14.9pp shipped vs ±10.3pp including them; b0041:
  ±13.5 vs ±10.3. **No verdict on today's ledger flips**, so it has cost nothing yet — but it biases
  every control toward "the plumbing is fine". This is control-trigger *behaviour*, not the ledger
  *record*, so it lands in the map's **Out of scope** beside clause (a)'s cell, by the same boundary.
  Flagged loudly because `ledger-audit.mjs` calls `controlVerdict()` and therefore inherits the bias.
- **Backfilled rows need no amendment route.** b0006/b0007 record no W/L/D; b0001–b0007 record no
  `perGame`, `concurrency`, `wallClockS`, `gameTimeS`, `armed`; b0008 lacks the timing three. The
  audit files all 42 as **INCOMPLETE, not contradictory** — incompleteness is honest, it is already
  rendered `—`, and an amendment that supplies a never-measured number is fabrication, not correction.
  That fog patch is answered and closed.

### 6. What was built

`scripts/ledger-audit.mjs` — 15 invariants in 6 families (arithmetic, search condition, identity,
meta-row integrity, suspect reasons, completeness). Reads `MAKURUK_LEDGER` if set. Two severities:
CONTRADICTION exits 1, INCOMPLETE never does. `--verbose` prints the timing calibration and every
control's band; `--json` for a future gate.

**Verified against a deliberately broken scratch ledger** (unparseable line, dangling retraction,
double retraction, block both retracted and cleared, clearance naming a non-control, unknown meta
type `amendment`, depth+movetime together, wrong tally, impossible wall-clock, out-of-vocabulary SPRT
decision): all 22 fire, nothing crashes, and the ticket's Watch holds — **a malformed line is a
finding and a missing field is a skip.**

The unknown-meta-type check is not idle. `readBlocks` filters on a two-element `META_TYPES` set
(`results.mjs:65`), so the amendment row [ticket 02](02-the-amendment-record.md) is about to introduce
**will be read as a block** until that set grows — and `nextId()` counts the same way
(`results.mjs:99`), so the next real block would silently skip an id. Two one-line changes, both easy
to forget, both caught by `node scripts/ledger-audit.mjs`.
