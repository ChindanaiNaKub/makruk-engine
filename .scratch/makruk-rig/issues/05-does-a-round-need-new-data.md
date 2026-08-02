# Does a round need new data at all?

Type: grilling
Status: open — **unblocked 2026-08-02**
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

<!-- filled on resolution -->
