# What is one classical-eval improvement actually worth?

Type: grilling → execution (HITL to choose, AFK to measure)
Status: resolved (2026-08-03) — counting multipliers, REJECTED
Blocked by: 03 (resolved), 04 (open — NOT BINDING for this path, see below)

## Question

`src/eval.rs` is **5.1 KB**. It contains material by piece kind, a center-bonus table, a king-safety table, and a counting term. No mobility, no bia structure, no promotion-race term, no phase interpolation, no tempo. Its constants have never been tuned — they were written by hand and never touched again.

That eval is the **strongest artifact in this repository**. It beats six neural nets produced across five DAgger rounds and three corpora. The program spent its entire budget replacing it and none improving it.

**Pick one improvement and measure what it buys.** The point is not to finish the eval — it is to convert "the classical eval probably has headroom" into a number, so [Set the target](07-set-the-target.md) can be grounded in a demonstrated Elo delta rather than an argument. One term, measured honestly, is worth more to this map than five terms shipped on faith.

Decide, with [What are the missing search and eval techniques actually worth?](03-what-the-missing-techniques-are-worth.md) in hand:

1. **Which single change**, by expected Elo per nps cost. Every eval term is paid for in search depth — a term that costs 10% nps costs roughly a third of a ply, and [Is the wall depth, or is it eval?](04-is-the-wall-depth-or-eval.md) will have priced a ply by then. A term must clear its own speed cost, and the answer must show that arithmetic rather than assume it.
2. **Texel tuning versus a new term.** Tuning the existing constants against the 10M-row corpus in `tools/data/` is a logistic fit over a linear eval — minutes of CPU, no GPU, no lockout — and it is the only lever here that improves *every* existing term at once. If the research ticket says tuning is worth more than any new term, do that instead; it is also the cheaper experiment. **Confirm the corpus labels are usable for this** before committing: they were generated to train a WDL net, and a texel fit wants game outcomes, so check the label schema rather than assuming.

   **Three constraints the research ticket added to this option, and one it made conditional.** *Split the job* — positional terms tune well on `bootstrap-v2`, piece values do not, because near-balanced material makes them unidentifiable (hgm/jdart; the unconstrained fit separated met from promoted bia by 21× despite them sharing a match arm). *Lower loss is not Elo* — Zurichess measured **−28 Elo despite a lower MSE**, iCE −20 to −24, both because the optimiser zeroes small true terms; held-out loss is exactly the evidence that failed for them, so nothing ships without Gate A. And *if you choose this path*, [Is the eval tuner a trustworthy instrument?](09-is-the-eval-tuner-trustworthy.md) must close first — it is the falsification test on the instrument, it is on the frontier now, and it costs minutes. Not a formal blocker, because a different choice here (the counting-gate term) does not need the tuner at all.

3. **The strongest non-tuner candidate is now the counting-gate term.** `counting_term()` (`src/eval.rs:130`) returns 0 while `game.counting` is `None`, so the eval is blind to a count *approaching*. Measured on this repo's corpus with material edge and piece count held fixed: at a 400–700 cp edge with 4–8 pieces the stronger side scores **92.3%** while any unpromoted bia remains and **62.0%** once they are gone — a **30-point swing** with no chess analogue, and top of the makruk-measured rows at ~20 Elo/h. Makruk-Stockfish's shape is the template: it *scales* the win score by remaining count rather than adding a fixed offset, and scaling is the right form here for the same reason.
4. **What "worth it" means.** Measure through Gate A against the frozen classic baseline — the rig's SPRT, ~2 min, full resolution. Report the fixed-N effect size separately if the size matters, because an SPRT point estimate is biased away from its stopping boundary.

Close when the change is in `src/eval.rs` with `cargo test --release` + mirror-perft green, its Gate A block is in `results/blocks.jsonl`, and the answer states the measured Elo delta and the nps cost that paid for it — **including if the delta is zero or negative.** A null result here is a real finding: it would say the classical eval is closer to its ceiling than its 150 lines suggest, and that is directly load-bearing for the target.

**Cost:** implementation is a session's work; measurement is ~2 min of arena. Texel tuning adds minutes of CPU, not hours. Nothing here approaches the 20-minute lockout limit.

**Out of bounds:** if the chosen path turns out to need a training sweep or new datagen, stop and raise a costed ticket instead. That is the map's standing rule, not a judgment call.


---

## Why ticket 04 is not binding for the path taken (2026-08-03)

04 blocks this ticket for one stated reason, in item 1: a new term is paid for in search depth, so
*"a term that costs 10% nps costs roughly a third of a ply, and [04] will have priced a ply by then."*
The blocker exists so the nps arithmetic can be done.

**The chosen change has no nps cost to clear.** It rewrites the constants inside the existing
`KING_SAFETY` table — the same table, the same lookup, the same arithmetic, executed the same number
of times. There is no speed cost, so there is no ply to price, so 04 contributes nothing to the
decision. The blocker binds a *new term*; it is vacuous for a *constant change*.

Item 2's conditional blocker is satisfied: [Is the eval tuner a trustworthy
instrument?](09-is-the-eval-tuner-trustworthy.md) closed first, as required.

Recorded rather than silently ignored. If this reads as scope creep, overrule it — but then the
correct next step is to run [01](01-where-the-engine-actually-stands.md) and 04 first, which costs
~10-12 min of lockout before any eval work can start.

## The hypothesis, from ticket 09

The shipped `KING_SAFETY` table rewards the king for sitting on its back-rank corners (20/15/10/5,
zero everywhere else). The constrained tuner drives those constants **negative** — `king10` 10 →
**−41**, `king20` 20 → **−47**, `king15` 15 → −13, bootstrap widths 6-7 — i.e. it wants the sign
reversed. In a game where a large share of positions are counting endgames, a centralised king
plausibly *is* better, and makruk has no long-range attackers to punish it.

**Ticket 09's own verdict constrains how this may be used:** held-out loss prices the change, it does
not decide it. Zurichess measured **−28 Elo at a lower MSE**. Gate A decides.

---

## Resolution (2026-08-03) — REJECTED, and the null is the finding

**The counting multipliers are not an improvement. Gate A at equal time: 48.8% (−9 Elo), LLR −9.38,
REJECT at 20 pairs, against a clean 50.0% control.** The incumbent stands and `src/eval.rs` is
reverted — the rebuilt binary reproduces the incumbent bit-exactly, `sha256:47e34aad57c2`.

| block | kind | conditions | result |
|---|---|---|---|
| `b0053` | control | 100/100 ms | **50.0%** — clean |
| `b0054` | gate-a | 100/100 ms | **48.8% (−9 Elo)**, LLR −9.38, REJECT |

The change was two constants — `remaining * 3 → * 6` and `* 1 → * 3`. **nps cost: zero, provably.**
Same instruction, different immediate; no term added, no branch added, no table grown. The ticket
demanded that arithmetic be shown rather than assumed, and here it is trivial.

Do not quote −9 Elo as an effect size: an SPRT stops when it is ahead, so the point estimate is
biased away from its boundary. What is established is that the change is **not a +30 Elo improvement
and its sign is negative.**

### The finding: lower held-out loss is not Elo, demonstrated on THIS engine

This is worth more than the change would have been.

The constrained tuner said these two constants were the **best-evidenced candidate in the entire
eval**: −0.82% held-out loss from two parameters, more than any other pair, five times the
king-safety table's four constants, on a by-game split, from an instrument validated against the real
engine at 373/400 exact. **Gate A rejected it.**

[Ticket 09](09-is-the-eval-tuner-trustworthy.md) warned about exactly this and cited Zurichess
(−28 Elo at a lower MSE) and iCE (−20 to −24). Those were borrowed numbers. **This is a first-party
instance, on this engine, on this corpus** — and it lands on the single strongest signal the tuner
produced. The rule is no longer inherited; it is measured here.

**Consequence for the tuner:** it is not disqualified — ticket 09's verdict was already "prices terms,
does not decide them", and this is that verdict being load-bearing rather than decorative. But its
ranking of candidates is now known to be a *weak* predictor of Elo at the top end, not just at the
margins. Anything it proposes still needs Gate A, and a −0.82% held-out gain is not evidence of
strength.

### King safety, the path this ticket was opened on, died for free

Before spending any machine time, the tuner was run with only the four king-safety constants free:

| group | params | held-out |
|---|---|---|
| material | 4 | −3.05% |
| **counting** | 2 | **−0.82%** |
| centre | 3 | −0.35% |
| **king safety** | 4 | **−0.16%** |
| pawn advance | 2 | −0.12% |
| knight centre | 3 | −0.11% |

Fifth of six, and worse than the number: the isolated table (`king5` +25, `king10` −28, `king15` +3,
`king20` 0) is a **scramble, not the sign reversal the joint fit suggested**, and it disagrees with
the joint fit's own values (−41/−47). Those four parameters are not independently identified. The
hypothesis cost zero machine time to kill, which is the decomposition earning its keep.

Material carries 75% of the joint gain and is unshippable for the reason ticket 09 established — the
material/positional split is collinear and arbitrary.

### Three rig gaps, one root cause: "the opponent is fairy"

**Every Gate A in this ledger's history is net-vs-classic — differentiated by EVAL. Nothing had ever
been measured by BUILD**, so none of this had been exercised. A Gate A on an `src/` change needs two
binaries, and the rig could not express one:

1. **`oppIsOurs` was `FAIRY_BIN === OUR_ENGINE`**, so a second build was recorded as *fairy* — and the
   block-schema guard correctly refused the row on `kind-matches-opponent`. Added **`OPP_BIN`**.
2. **`sideIdentity` ignored the binary**, so two builds both playing classic looked identical to
   preflight and it refused a legitimate block. Now includes the binary hash.
3. **`FAIRYTIME` defaulted to `MOVETIME * 4`.** The 4× rule handicaps *us* against fairy and is
   deliberate for ladder work; against our own build it is a silent 4× clock advantage to the
   incumbent. **This cost a whole block** — `b0051`, retracted: 46.7%, −26 Elo, measuring a time
   handicap and nothing else. The rig already knew better in one place: the auto-control spawn forces
   equal time explicitly, which is why `b0050` came out a clean 100/100 while the main block did not.

Two guards fired correctly along the way and are worth recording as working rather than as obstacles:
the schema refused the mislabelled row, and `control-same-binary` — narrowed here from
`selfplay-same-binary`, whose "opponent=ours means one file" assumption `OPP_BIN` legitimately expired.

### What this says about the target

Ticket 05 stated in advance that a null is load-bearing: *"it would say the classical eval is closer
to its ceiling than its 150 lines suggest."* One data point does not establish that — but the
strongest tuner-ranked candidate in the eval returned negative, and the second (king safety) died on
free evidence. [Set the target](07-set-the-target.md) should not assume the classical eval has cheap
headroom until something actually clears Gate A.
