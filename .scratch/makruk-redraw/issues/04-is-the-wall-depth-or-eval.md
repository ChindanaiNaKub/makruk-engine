# Is the wall depth, or is it eval?

Type: task (AFK)
Status: resolved (2026-08-03) — the wall is EVAL
Blocked by: 01

## Question

The strength spec's execution log states the diagnosis that currently governs this whole program:

> The gap at the top of the ladder is ~5 plies against an opponent whose eval is also mature — that is not a deficit more DAgger rounds close.

It is an **inference from a depth table, not a measurement**. The table is real: fairy reaches depth 10 at every skill below 20 and only degrades *which* move it takes from that search; our classic reaches depth 8 at 100 ms and the net reaches 5. But nothing has ever tested whether closing the ply gap closes the score gap. If the diagnosis is right, this map's lever is search speed and depth. If it is wrong, the lever is eval quality and every hour spent on search pruning is wasted.

**The test is one flag.** Give the classical eval 4× movetime and leave fairy at 100 ms: `--movetime 400 --fairytime 100`. Round 4 measured +2 ply per 4× time for classic (6 → 8 at 100 ms after null-move + LMR), which puts classic at roughly **depth 10** — level with fairy's search, on an opponent whose eval is mature.

Run it at **skill 8 and skill 10**, 64 games each, against the 1× baselines that [Where does this engine actually stand on the live rungs?](01-where-the-engine-actually-stands.md) establishes for the same rungs and the same artifact. Without those baselines the delta is uninterpretable, which is why this ticket is blocked on that one.

Resolve with:

1. **The delta at each rung**, 4× vs 1×, with the SE from the observed W/L/D split — never a binomial. If skill 10 stays near 0% even at parity depth, our *eval* is the wall and search work does not get there. If it moves substantially, depth is the wall and eval work is the wrong lever.
2. **A ply-for-score exchange rate**, if there is one: roughly how many points of score one extra ply is worth at these rungs. That number is what makes the target in [Set the target](07-set-the-target.md) defensible instead of hopeful — it converts "we could plausibly get 2 more plies" into a predicted score.
3. Whether the exchange rate is the same at skill 8 and skill 10, or whether it collapses at the wall. A lever that works at 8 and dies at 10 tells you exactly where the target has to land.

**Cost:** our side spends 4× longer per move, so a 64-game block runs roughly 7–8 min instead of 3. Two blocks ≈ **15 min** foreground. That is the most expensive ticket on this map and still inside the cheap half; if it needs to be trimmed, drop skill 8 rather than skill 10 — skill 10 is where the target's ceiling is decided.

**Confound to name explicitly:** 4× movetime is not the same as 4× on the site or in the browser, and it changes the engine's time profile as well as its depth. This measures *what an extra ~2 plies buys*, not a shippable configuration. Say so in the answer so nobody later reads it as a strength claim.

---

## Resolution (2026-08-03) — the wall is EVAL. The governing diagnosis is refuted.

Classic at `--movetime 400 --fairytime 100`, which the premise check confirmed puts it at **depth 10 —
exact parity with fairy's search** (classic reaches depth 8 at 100 ms, 10 at 400 ms). Control `b0060`
auto-fired on the new movetime and passed at **50.0%**.

| rung | our depth | block | score | ±2 SE | W–L–D |
|---|---|---|---|---|---|
| skill 8 | 8 | `b0056` | 23.4% | ±7.0 | 2–36–24 +2 mp |
| skill 8 | **10** | `b0062` | **24.2%** | ±6.7 | 1–34–24 +5 mp |
| skill 10 | 8 | `b0057` | 9.4% | ±4.8 | 0–52–11 +1 mp |
| skill 10 | **10** | `b0061` | **5.5%** | ±3.7 | 0–57–6 +1 mp |

### 1. The delta at each rung

- **skill 8: +0.8 pp** (combined 2 SE ±9.7)
- **skill 10: −3.9 pp** (combined 2 SE ±6.0)

Both are indistinguishable from zero, and the skill-10 point estimate is *negative*. **Closing the
entire ply gap moved nothing.** Zero wins at skill 10 across both depths — **0 of 128 games.**

### 2. The ply-for-score exchange rate

**≈ 0 pp/ply, at both rungs.** 0.39 pp/ply at skill 8 and −1.95 pp/ply at skill 10, neither
distinguishable from zero. There is no exchange rate to hand [Set the target](07-set-the-target.md),
and that absence is itself the answer: **a target cannot be reached by buying plies.**

### 3. Does it collapse at the wall?

The question assumed the rate is positive somewhere and dies at the top. **It is ~0 at both rungs**,
so there is nothing to collapse. Search depth is not a lever at skill 8 either.

### What this refutes

The spec's execution log states the diagnosis that has governed this program:

> The gap at the top of the ladder is ~5 plies against an opponent whose eval is also mature — that is
> not a deficit more DAgger rounds close.

**The premise is wrong.** The gap is not ply-shaped. Given fairy's own depth 10, our eval scores the
same at depth 8 and at depth 10. **The wall is eval quality, and search work does not get through it.**

**This is the third independent instance of the same pattern, and they now agree:**

1. Round 4's null-move + LMR: **6W–0L–5D in self-play** against the previous binary, and **one extra
   draw** against fairy skill 10 (AGENTS.md).
2. [The accumulator](08-how-much-speed-can-the-accumulator-close.md), today: +1 ply, Gate A still
   rejects.
3. This ticket: **+2 plies to full search parity, score unchanged.**

Search improvements move self-play and do not move the ladder.

### The apparent tension with ticket 08, resolved

If plies buy nothing, why does the net's 2-ply deficit cost it 38.8% head-to-head against classic?
Because **depth compensates only where the evals are comparable.** Net and classic are close enough
that two plies decide between them; against fairy at skill 8–10 our eval is outclassed by a margin no
horizon extension reaches. Depth buys nothing where the eval is beaten.

### Confound, named as the ticket required

**4× movetime is not a shippable configuration** and is not what the browser does. It changes the
engine's time profile as well as its depth. This measures **what two extra plies buy**, not a strength
claim, and nothing here should be read as one.

### What this hands to Set the target

- **Search and speed are not the lever.** Retire them as candidates for reaching a ladder target.
- **Eval quality is the wall** — and today's other results are sobering about that too:
  [ticket 05](05-what-one-eval-term-is-worth.md) put the eval's best tuner-ranked candidate through
  Gate A at −9 Elo, and [ticket 09](09-is-the-eval-tuner-trustworthy.md) showed held-out loss does not
  predict Elo here.
- **The net has the better eval** at equal depth (ticket 02: 54.2% at depth 5, 67.0% at depth 7) —
  and cannot be made fast enough to use it (ticket 08). That makes **a smaller, faster net the only
  live lever left**, and it is a costed training ticket.
