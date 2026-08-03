# What is one search improvement actually worth?

Type: grilling → execution (HITL to choose, AFK to measure)
Status: open
Blocked by: 03, 04

## Question

Round 4 landed null-move pruning and LMR and got **113× fewer nodes at depth 10** and +2 ply at 100 ms, worth 6–0–5 head-to-head against the previous build. That is the largest measured gain in this project's history, and it came from search, cost no datagen, and took one session.

The obvious question — what else is like that — has never been asked. `src/search.rs` currently has a transposition table, quiescence, MVV-LVA ordering, killers, history, null-move and LMR. It does not have TT aging, aspiration windows, PVS, SEE, futility pruning, or check extensions.

**Pick one and measure what it buys**, on the same terms as [What is one classical-eval improvement actually worth?](05-what-one-eval-term-is-worth.md): the goal is a demonstrated number for [Set the target](07-set-the-target.md), not a finished search.

Decide, with [What are the missing search and eval techniques actually worth?](03-what-the-missing-techniques-are-worth.md) in hand:

1. **Which single change.** The record's own nomination is **TT aging** — `search.rs:214` replaces on depth alone with no generation counter, so entries become un-evictable and the table saturates. The rig map's execution log calls it "a live strength lever for real play" and it has never been tested. It is a small, contained change. But the research ticket may price aspiration windows or PVS higher; take the evidence over the nomination.
2. **What the win is denominated in.** Node reduction is not Elo. Round 4's 113× node cut bought +2 ply and the M4 gate moved by exactly one draw — a spectacular engineering number that barely moved the score. Report **plies at 100 ms** and **Gate A score**, and treat node counts as diagnosis, not result.
3. **Whether the ply gain lands where the target needs it.** [Is the wall depth, or is it eval?](04-is-the-wall-depth-or-eval.md) will have measured what a ply is worth at skill 8 and 10, and whether that exchange rate survives at the wall. A search change that buys a ply where plies are worthless is a null result; say so plainly.

Close when the change is in `src/search.rs` with `cargo test --release` + mirror-perft green, its Gate A block is in `results/blocks.jsonl`, and the answer states plies gained at 100 ms and the measured score delta — **including if it is zero.**

**Correctness trap specific to this engine:** makruk zugzwang is real (bia move one square forward), the counting rules mean a null move must never tick the counting clock — `Game::do_null_move` deliberately leaves `counting` and `outcome` alone — and `do_move`/`undo_move` must stay perfectly symmetric. Any pruning or extension change must preserve all three. Mirror-perft is the guard; it is not optional.

**Cost:** implementation is a session; measurement is ~2 min of arena plus a fixed-depth timing run. Nothing approaches the lockout limit.
