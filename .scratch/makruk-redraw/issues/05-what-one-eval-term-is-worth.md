# What is one classical-eval improvement actually worth?

Type: grilling → execution (HITL to choose, AFK to measure)
Status: open
Blocked by: 03, 04

## Question

`src/eval.rs` is **5.1 KB**. It contains material by piece kind, a center-bonus table, a king-safety table, and a counting term. No mobility, no bia structure, no promotion-race term, no phase interpolation, no tempo. Its constants have never been tuned — they were written by hand and never touched again.

That eval is the **strongest artifact in this repository**. It beats six neural nets produced across five DAgger rounds and three corpora. The program spent its entire budget replacing it and none improving it.

**Pick one improvement and measure what it buys.** The point is not to finish the eval — it is to convert "the classical eval probably has headroom" into a number, so [Set the target](07-set-the-target.md) can be grounded in a demonstrated Elo delta rather than an argument. One term, measured honestly, is worth more to this map than five terms shipped on faith.

Decide, with [What are the missing search and eval techniques actually worth?](03-what-the-missing-techniques-are-worth.md) in hand:

1. **Which single change**, by expected Elo per nps cost. Every eval term is paid for in search depth — a term that costs 10% nps costs roughly a third of a ply, and [Is the wall depth, or is it eval?](04-is-the-wall-depth-or-eval.md) will have priced a ply by then. A term must clear its own speed cost, and the answer must show that arithmetic rather than assume it.
2. **Texel tuning versus a new term.** Tuning the existing constants against the 10M-row corpus in `tools/data/` is a logistic fit over a linear eval — minutes of CPU, no GPU, no lockout — and it is the only lever here that improves *every* existing term at once. If the research ticket says tuning is worth more than any new term, do that instead; it is also the cheaper experiment. **Confirm the corpus labels are usable for this** before committing: they were generated to train a WDL net, and a texel fit wants game outcomes, so check the label schema rather than assuming.
3. **What "worth it" means.** Measure through Gate A against the frozen classic baseline — the rig's SPRT, ~2 min, full resolution. Report the fixed-N effect size separately if the size matters, because an SPRT point estimate is biased away from its stopping boundary.

Close when the change is in `src/eval.rs` with `cargo test --release` + mirror-perft green, its Gate A block is in `results/blocks.jsonl`, and the answer states the measured Elo delta and the nps cost that paid for it — **including if the delta is zero or negative.** A null result here is a real finding: it would say the classical eval is closer to its ceiling than its 150 lines suggest, and that is directly load-bearing for the target.

**Cost:** implementation is a session's work; measurement is ~2 min of arena. Texel tuning adds minutes of CPU, not hours. Nothing here approaches the 20-minute lockout limit.

**Out of bounds:** if the chosen path turns out to need a training sweep or new datagen, stop and raise a costed ticket instead. That is the map's standing rule, not a judgment call.
