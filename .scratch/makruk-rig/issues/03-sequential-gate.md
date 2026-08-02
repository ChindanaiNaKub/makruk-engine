# Replace fixed-size blocks with a sequential test

Type: grilling
Status: open
Blocked by: 01-pin-the-budgets.md
Parent: map.md

## Question

Spec §5.1 spends **96 games per round** — Gate A at a fixed 64, Gate B at a fixed 32 — regardless of how obvious the answer is. A candidate that is plainly worse and one that is a coin flip cost exactly the same. Sequential testing stops as soon as the evidence is conclusive, and in engine development that typically means 2–5× fewer games for the same confidence.

**This is a deliberate revisit.** The predecessor map's benchmark ticket rejected SPRT for the dev tier on "proxy-baseline ambiguity + tooling lift, revisit later". The ambiguity half is now resolved — Gate A is head-to-head against the incumbent, which is exactly the clean two-engine comparison SPRT wants. The tooling-lift half is the real question this ticket has to answer.

Decide:

- **Hypothesis bounds.** H0/H1 in Elo, and α/β. Fishtest-style `elo0=0, elo1=5` assumes thousands of games; this rig's budget N is minutes. What bounds make a decision affordable *and* meaningful given the size of the changes being tested (round 3→5 moved play by rungs, not by 5 Elo)?
- **Trinomial or pentanomial.** Games here are already played in colour-reversed pairs on a shared opening, which is precisely the structure pentanomial (game-pair) scoring exploits to cut variance. Taking it means the stopping rule consumes pairs, not games.
- **Makruk's draw structure.** Counting-rule draws are frequent and are scored 0.5, and ~25% of our-engine-vs-our-engine games hit the 400-ply cap. A very high draw rate changes the variance the test assumes. Check the actual W/D/L split of a recorded block before picking a model.
- **Caps and the no-decision case.** Minimum games before stopping (guards against an early fluke), maximum before giving up, and what "no decision at the cap" means for accepting a round — today's rule is a hard ≥55% on Gate A.
- **Build or borrow.** `cutechess-cli` implements this and speaks UCI, but our arena exists because games must be adjudicated by *our* oracle for site-exact counting-rule behaviour. Decide whether the stopping rule goes into `match-arena.mjs` (~50 lines of LLR math, keeps the oracle) or whether cutechess is worth the adjudication mismatch.
- **Comparability.** Every recorded block so far is a fixed-N score fraction. Decide whether past numbers are re-expressible, or simply superseded — and record that in whatever *Where do results live?* lands on.

## Answer

<!-- filled on resolution -->
