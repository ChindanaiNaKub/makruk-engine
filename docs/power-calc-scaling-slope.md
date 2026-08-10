# Power calculation — the scaling-slope curve

**ADR 0002 clause 4 runs first.** If the n needed to resolve 25 Elo is unaffordable on
this machine, the question is unmeasurable here and the net program stops. This is that
calculation. Computed 2026-08-10, before any training.

## Verdict

**Affordable, marginally. ~1,600 games per point, ~4.4 h of foreground arena at ~100 °C
peak for all three points.** That is inside ADR 0002's own stated budget ("about an
afternoon of foreground arena"), so clause 4 does not fire. It is *not* comfortably
inside it, and the thermal cost is real: the machine is unusable for the duration.

## Inputs, all measured — none assumed

Per-game standard deviation, computed from the four real Gate B blocks at 100/100 ms
(win 1 / draw 0.5 / loss 0), not the 0.42 quoted in the spec (that figure is Gate A
net-vs-net and does not apply here):

| block | rung | n | score | per-game sd | wall s/game | peak °C |
|---|---|---|---|---|---|---|
| `b0021` | skill 3 | 63 | 0.730 | 0.306 | 2.59 | — |
| `b0055` | skill 5 | 62 | 0.395 | **0.313** | 3.40 | 100 |
| `b0056` | skill 8 | 62 | 0.226 | 0.279 | 2.90 | 99 |
| `b0057` | skill 10 | 63 | 0.087 | 0.190 | 2.51 | 97 |

Conservative sd = **0.313** (the largest, at skill 5). Wall-clock = **3.30 s/game** at
concurrency 6 (`b0055`: 211 s wall for 64 games).

sd falls as the score falls, so the cheap-looking high rungs are cheap only because they
have no resolution. Skill 5 is both the widest and the right rung.

## The arithmetic

25 Elo is not a fixed number of percentage points — it depends where on the curve you
sit. At the operating point (a net ~42 Elo below classic's 39.8%, so p ≈ 0.30–0.35 at
skill 5), **25 Elo ≈ 3.1–3.3 pp**.

n per block, two-sided α = 0.05, power 0.80, comparing the two endpoint blocks
(2.5M vs 10M):

| operating point | Δ for 25 Elo | n / block | 3 blocks, wall-clock |
|---|---|---|---|
| p = 0.25 | 2.79 pp | 1,969 | 5.4 h |
| **p = 0.30** | **3.11 pp** | **1,593** | **4.4 h** |
| p = 0.35 | 3.34 pp | 1,378 | 3.8 h |
| p = 0.40 | 3.50 pp | 1,256 | 3.4 h |

**Plan on the 4.4 h row.** Quoting the cheapest row would be assuming the answer.

**A paired-openings credit is available but is not banked here.** Blocks run the same
seeded openings, each played twice with colours reversed, so the two endpoint blocks are
positively correlated and the variance of their difference is below the independent
figure — plausibly halving n to ~800/point and the total to ~2.2 h. The correlation has
never been measured on this rig, so the plan uses the independent number and treats any
saving as a refund, not a budget.

## What this does not buy

n = 1,593 resolves **25 Elo between the endpoints at 80% power**. It does not resolve the
*middle* point against either endpoint — the monotonicity half of the stop-bar is read at
much lower confidence than the magnitude half. A non-monotone reading at this n is weak
evidence and, per ADR 0002 clause 3, still ends the net program: ambiguous means stop.
That asymmetry is deliberate and is the stop-bar working as written.
