# Replace fixed-size blocks with a sequential test

Type: grilling
Status: resolved (2026-08-02)
Blocked by:
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

**SPRT on the pentanomial, for Gate A only, built in-house. And on its first two real runs it overturned the NNUE program's central claim.**

### First: what the old gate actually was

"Accept at ≥55% over a fixed 64 games", with the per-game standard deviation measured from real blocks (sd = 0.42):

| | rate |
|---|---|
| false positive — accept an **equal** candidate | **17%** |
| false negative — reject a true **55%** candidate | **50%** |

It accepted a coin-flip candidate one time in six and missed a genuine improvement half the time. Round 5's transitivity contradictions were not bad luck; they were the gate operating as designed. That is the thing being replaced, and it reframes the exercise — this is not primarily a saving, it is a gate that works.

### Trinomial or pentanomial — measured, not assumed

Games are already played in colour-reversed pairs on a shared opening, so opening bias cancels *within* the pair. Measured across every recorded n≥64 block:

| block | opponent | trinomial sd | pentanomial sd | ratio |
|---|---|---|---|---|
| b0012 | fairy skill 3 | 0.4283 | 0.3264 | 0.762 |
| b0013 | fairy skill 3 | 0.4162 | 0.3212 | 0.772 |
| b0021 | fairy skill 3 | 0.3077 | 0.2140 | 0.696 |
| b0022 | fairy skill 3 | 0.4070 | 0.2675 | 0.657 |
| b0023 | fairy skill 5 | 0.4070 | 0.3029 | 0.744 |
| b0024 | fairy skill 8 | 0.3070 | 0.2439 | 0.794 |

Ratio 0.66–0.79 → variance ratio ≈ 0.52. **Pairs alone roughly halve the games needed**, before sequencing contributes anything. Pentanomial it is; the stopping rule consumes pairs, not games.

### Bounds

**H0 = 0 Elo, H1 = 30 Elo, α = β = 0.05.** Chosen against this project's actual round deltas (r3 over classic was once thought ~+150 Elo; d6 under r3 ~−33 Elo), not against fishtest's [0, 5], which assumes tens of thousands of games and is unaffordable here. Wald bounds ±log(0.95/0.05) = ±2.944 on

`LLR = n (s1 − s0) (2μ̂ − s0 − s1) / (2 var)`

— the exact log-likelihood ratio for N(μ, var) with variance estimated from the observed pairs, floored at 1e-4 so a one-sided block (0–64–0 happens at skill 10 and 20) stays finite.

### Caps, and the no-decision rule

**min 20 pairs** — guards an early fluke *and* an unstable early variance estimate; it earned its keep immediately, blocking a spurious −3.21 crossing at 10 pairs in the first validation run. **max 400 pairs** (800 games) — a budget decision, not a statistical one.

**Hitting the cap without crossing a bound is NOT acceptance.** The incumbent holds unless the candidate proves itself; "we could not tell" is not "it is better". A selection gate has to fail closed.

### Verified, not asserted

`scripts/sprt-selftest.mjs` Monte-Carlos 2000 blocks per scenario against the measured 25% draw rate:

| true strength | wrong call | median games | p90 |
|---|---|---|---|
| equal (0 Elo) → should reject | **3.6%** | 424 | 800 |
| worse (−30 Elo) → should reject | 0.1% | 174 | 320 |
| at H1 (+30 Elo) → should accept | **3.9%** | 442 | 800 |
| clearly better (+150 Elo) → should accept | 0.0% | **54** | 86 |

A clearly-better candidate decides in **fewer games than the old fixed 64**, with error rates 5–13× better. Only genuinely borderline candidates cost more — which is when they should.

### Build, not borrow

Built in-house (~60 lines of LLR math). `cutechess-cli` implements SPRT and speaks UCI, but this arena exists because games must be adjudicated by *our* oracle for site-exact counting-rule behaviour, and cutechess cannot do makruk counting. The adjudication mismatch would cost more than the code.

### Gate A only

**Gate B stays fixed-N.** It is a ladder *measurement* that has to stay comparable across rungs and gets reported as the ladder position; Gate A is a pure accept/reject, which is what a sequential test is for. This also resolves the comparability question: Gate B rows stay directly comparable to every past block, and Gate A rows carry an `sprt` object (bounds, LLR, decision, pairs) alongside the W/L/D the ledger already stores.

### Caveat that must travel with the numbers

**An SPRT point estimate is biased away from the stopping boundary** — you stop when you are ahead. The two validation runs give −46 and +89 Elo for what is one comparison. Use a fixed-N block to measure an effect *size*; use the SPRT to make a *decision*.

### What it found on its first two runs

| test | n | score | verdict |
|---|---|---|---|
| r3 net vs our classic | 78 | 44.2% (−46 Elo) | **REJECT** |
| our classic vs r3 net | 40 | 62.5% (+89 Elo) | **ACCEPT** |

**The classical eval is stronger than the net.** The retracted pre-TT-fix Gate A had this exactly backwards — r3 "beat" classic 70.3% — because the dead transposition table handicapped classic, which searches to depth 8, far more than the net at depth 5. Consistent with the clean ladder, where classic scores 72.7% at fairy skill 3 against the net's 71.9%.

**The NNUE program currently has no artifact that beats the classical eval.** Five rounds of selection ran against a corrupted baseline. That is a finding for the redrawn strength map, not for this one — but the incumbent designation in AGENTS.md is corrected, and it took 40 games and two minutes to establish.

A control run alongside these read **50.4% (+3 Elo) over 120 games** for r3 against itself, which is the evidence that the harness itself is unbiased.
