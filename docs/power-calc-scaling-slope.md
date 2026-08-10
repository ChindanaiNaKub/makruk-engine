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

---

# The training budget is part of the measurement, not a detail

**Added 2026-08-10 after the first three arms trained.** How long each arm trains changes
what the curve measures, and there is no neutral default. This has to be decided before
the arena spends 4.4 h, because the arena cannot detect the error afterwards.

Three candidate designs, and what each one biases:

| design | what it does | which way it biases the slope |
|---|---|---|
| **Equal epochs** | 10M arm gets 4× the gradient steps of the 2.5M arm | **Up.** The slope absorbs a training-compute effect and reads as a corpus effect — biased toward *authorizing* the 13-hour round. |
| **Equal steps** | all arms get ~46,700 steps | **Down.** The big arm is starved: at 6 epochs the 10M arm's val loss was still falling steeply (0.1189 and dropping), while the 2.5M arm had flattened (0.0892 → 0.0868). Biased toward *killing* the corpus lever. |
| **To convergence** | each arm trained until val loss stops improving, best-val checkpoint selected | **Neutral, and it is the question actually being asked** — what is the best artifact obtainable from N rows, not what is obtainable from N rows under an arbitrary step budget. |

**Equal steps was run first and is discarded.** Its arms are kept on disk under
`out/slope-*` but are not the curve; the curve is `out/slopeC-*`, trained to convergence
with 40 / 32 / 24 epochs and `train.py`'s existing best-val checkpoint selection.

**The equal-steps fit numbers must not be read as the curve, in either direction.** They
run backwards — test acc 0.811 / 0.753 / 0.728 for 2.5M / 5M / 10M — which looks like a
sensational refutation of the corpus lever and is nothing of the kind: it is the starvation
artifact above. It is also **fit**, and fit is a probe-class diagnostic that this engine has
already shown does not predict ladder position. The stop-bar is Elo on a Gate B block.
Nothing about the corpus lever is decided until those blocks run.
