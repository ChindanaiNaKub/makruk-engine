# Is the wall depth, or is it eval?

Type: task (AFK)
Status: open
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
