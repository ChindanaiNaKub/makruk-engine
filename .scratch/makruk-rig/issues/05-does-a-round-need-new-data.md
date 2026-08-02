# Does a round need new data at all?

Type: grilling
Status: resolved (2026-08-02)
Blocked by:
Parent: map.md

## Question

`datagen.mjs` is the thermal hog and the wall-clock hog: **12 of 16 jobs by default**, 90 minutes for the 10M-row d6 corpus. It is also the one step in a round that may not be needed every time — `tools/data/bootstrap-d6.jsonl` is kept, its labels verified clean (`label-check` r = 0.882), and round 5 failed on *selection*, not on data.

Two decisions:

- **When does a round earn a new corpus?** Spec §5's DAgger protocol regenerates on-policy data per round, which is the whole point of DAgger — the student's own mistakes are the training signal. But rounds 3–5 spent most of their wall-clock on datagen and most of their *information* came from the gates. Decide the trigger: every round, every K rounds, only when the student has changed materially, or only when a diagnostic (label-check drift, a probe/play divergence) says the corpus is stale. Whatever the rule, it must be checkable without running datagen.
- **What does datagen cost under the ceiling?** Job count, `nice` level, and whether it self-throttles on temperature, per the budgets in *Pin the budgets*. Measure the throughput/°C curve at 12 / 8 / 6 / 4 jobs first — if 6 jobs is 70% of the throughput at 60% of the heat, the default is simply wrong and this is a one-line fix.

The second half is cheap and should not wait on the first.

---

## Update 2026-08-02 — the second half is answered, and the first half changed shape

[Pin the budgets](01-pin-the-budgets.md) measured the throughput/°C curve and **refuted the
hypothesis in the second bullet**. The guess was "if 6 jobs is 70% of the throughput at 60% of the
heat, the default is simply wrong." Measured: 6 jobs is **74% of the throughput for about 5% less
heat**, which is inside the ±4–5 °C noise floor. Peaks stay 84–99 °C at *every* job count. Job
count is a bad knob; the default stays at 12 and the laptop is given back with `nice 15` instead.
Datagen now announces its cost and requires consent over 5 minutes. **Nothing left to decide here.**

The first half is also **no longer a budget question**. Background work has no wall-clock ceiling —
only announce-and-consent — so "does a round earn a new corpus" is not about minutes. It is about
**label staleness**: whether `tools/data/bootstrap-d6.jsonl` still teaches the current student
anything, and what cheap diagnostic answers that without running datagen. That is the whole ticket
now, and it is the sharper question.

## Answer

**A round never earns a new corpus on freshness grounds, because a corpus cannot go stale.** Each
generator has a **fixed point**, and regeneration lands back on it. Measured 2026-08-02:

| comparison | TV distance | reading |
|---|---|---|
| same student, seeds 7 vs 11, 20 games | **0.036** | the metric's own noise floor |
| bootstrap-v1 vs v2 vs d6 — three 10M-row corpora, different days | **0.006–0.026** | *below the noise floor* |
| dagger-r1 vs dagger-r2 — different students, different days | **0.025** | *below the noise floor* |
| bootstrap-d6 vs where a student actually plays | 0.127 (net) / 0.175 (classic) | a real coverage gap |
| classic vs r3 net, same seed | 0.140 | student identity does move the states |
| **bootstrap vs DAgger** | **0.515** | the only thing that ever moved the distribution |

Three 10M-row corpora, built on three different days, are the **same distribution**. Two DAgger
corpora built from two different students are also the same distribution — a different one. So
regenerating buys nothing: *a fresh corpus from the same generator is the same corpus.* The only
lever on coverage is **switching generator**, and choosing to switch is a strength decision, not a
rig one (see *Out of scope* below).

### The rig policy

1. **Datagen is never automatic and never on the per-round critical path.** The default for every
   round is *reuse the corpus*. This is the ~60 minutes rounds 3–5 spent for no information.
2. **The trigger for regenerating is a decision to change the generator — never elapsed rounds and
   never a drift number.** "Every K rounds" is refuted outright by the table above.
3. **`scripts/corpus-drift.mjs` is the check**, and it is checkable without running datagen: a
   20-game arena block (`--dump-games`, ~90 s, foreground class) plus a byte-offset sample of the
   corpus. It answers *does the corpus cover where this student plays*, and — pointed at two
   corpora — *did anything actually change*.
4. **Thresholds are read off the measured scale, not chosen**: < 0.10 is same-generator, ≥ 0.35 is
   mode-switch scale, and the band between them means find out what changed.

### What the measurement also turned up

**The DAgger corpora contain zero deep endgames.** dagger-r1/r2 are ~47% opening, ~41% middlegame,
**0.0% bare** and **0.0% bare-pawnless**, against bootstrap's 30.4% bare-pawnless. The two modes are
near-complementary, not overlapping.

This matters because the round-2 diagnosis in `docs/strength-spec-v1.md` recommended "rebalance the
corpus toward opening/middlegame positions" as an untried lever. It was already tried: DAgger rounds
1 and 2 *are* that rebalance, in the most extreme form available, and the record says they "bought
nothing measurable." Whatever is wrong is not the phase mix alone. That is a finding **for the
parked strength map**, recorded here because this ticket is where it surfaced.

### Shipped

- `scripts/corpus-drift.mjs` — the coverage diagnostic, with the measured scale in its header so
  the thresholds are inherited as evidence rather than as numbers.
- `match-arena.mjs --dump-games <file>` — writes each game's move list. The arena's hot loop is
  untouched; the analysis replays the moves through the same oracle that adjudicated them, so the
  positions measured are exactly the ones played.

Verified: noise floor established before any threshold was set (0.036, two seeds); both verdict
modes exercised; `cargo test --release` 9/9, mirror-perft and preflight green. Three 20-game blocks
recorded to the ledger (b0032–b0034) as `--kind diag`: classic seed 7, classic seed 11, r3 net seed 7.

### Out of scope — split off, not answered

The ticket's first bullet also asked *what should a corpus contain* — every round, every K rounds,
composition, label depth. The freshness half is answered above and is a rig question. The
composition half is **strength work**: which generator, what label depth, what phase mix, whether
DAgger is the right lever at all. That belongs to the fresh map taken up after this one, and the
evidence above (the two fixed points, and the zero-endgame DAgger shape) is the handoff.

<!-- filled on resolution -->
