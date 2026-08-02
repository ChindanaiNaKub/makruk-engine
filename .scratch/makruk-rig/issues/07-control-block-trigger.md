# Implement the conditional control-block trigger

Type: task
Status: resolved (2026-08-02)
Blocked by:
Parent: map.md

## Question

[How does the rig prove a number before anyone acts on it?](04-how-the-rig-proves-a-number.md) settled *when* a self-play control block is mandatory:

> (a) a block's result deviates from the trend line by more than the SE band (~8.8 points at n=32), or (b) a new **binding mechanism** is introduced — a new env var, a new opponent type, a new config axis (explicitly **not** a new weight) — or (c) it is the first block at a new rung.

Mechanisms 1–3 of that ticket shipped. This one could not, because clause (a) needed a trend line and there was no machine-readable record of past blocks to compute one from.

**That blocker is now gone.** [Where do results live?](06-where-results-live.md) shipped `results/blocks.jsonl` — append-only, committed, written by the arena itself, and backfilled with the five randomized-ladder blocks plus two retracted Gate A rows. Read it with `readBlocks()` from `scripts/results.mjs`. The control capability itself also exists: `match-arena.mjs --control` runs identical sides with the `sides-differ` assertion opted out.

Note when building clause (b): the ledger already stores each side's `armed` string and the full env-relevant identity per row, so "a previously-unseen binding combination" is computable from the ledger rather than needing new bookkeeping.

To implement once the ledger exists:

- **Compute the trend line.** From what — the same artifact's prior blocks at the same rung, or a fitted ladder across rungs? The SE band is ~8.8 points at n=32; [Replace fixed-size blocks with a sequential test](03-sequential-gate.md) has landed, so blocks now have *varying* n and the band must be computed per block rather than assumed.
- **Detect clause (b) mechanically.** "A new binding mechanism" is a human-legible idea; the rig needs a checkable version. Candidate: hash the *set of env var names* and the opponent-engine identity that a block ran under, and treat a previously-unseen combination as new plumbing — which correctly ignores a new *value* for `MAKURUK_WEIGHTS` while catching a first-ever `OPP_WEIGHTS`.
  - **`concurrency` is a named clause-(b) mechanism**, established by [Pin the budgets](01-pin-the-budgets.md): engines at fixed movetime search fewer nodes when they contend, and the whole ladder was calibrated at concurrency 6, so a block run at a different value is measuring a different opponent. It is already a ledger field, so this clause is a lookup. `movetime` and `opponentMovetime` belong in the same family for the same reason.
- **Detect clause (c).** First block at a rung is a ledger lookup, trivial once the ledger exists.
- **Decide what firing means.** Does the rig run the control automatically and refuse to record the suspect block until the control passes, or does it print a demand and stop? Automatic costs a block of wall-clock without being asked; a demand can be ignored, which is how prose-in-AGENTS.md failed.
- **Decide the control's own pass condition.** r3-vs-r3 came back 1–1–8 and 50.0% in two separate runs; what band around 50% counts as "the plumbing is fine" at a given n?

## Answer

**Each clause becomes the kind of check that *when it is computable* allows.** That one observation
answered four of the five open questions.

| clause | knowable | so it is | what firing means |
|---|---|---|---|
| (b) new binding mechanism | before any game | **precondition** | run a control first, refuse if it fails |
| (c) first block at a rung | before any game | **precondition** | same |
| (a) deviation from trend | only after | **postcondition** | record the block, mark it **suspect** |

### The trend line is ladder monotonicity, not a fit

The ledger holds **exactly one block per (artifact, rung) cell** — there is no repeated measurement
to fit a line through, so "deviates from the trend line" had to mean something else. It means the
ladder must not go *up* as the opponent gets harder. That is not a substitute for the intended
check, it is the *original* one: a non-monotone ladder is precisely how the zsh `env $var` defect
was caught (ticket 04's table, row 2). Where a cell *has* been measured twice, the direct comparison
runs as well.

### The SE band is computed from the observed W/L/D split, never assumed

Control b0027 came back **18–17–70** — 58% draws — whose per-game score sd is **0.29**, not the 0.50
a p=0.5 binomial assumes. Assuming binomial makes the band ~1.7× too wide *on that block* and
**2.4× too wide** on a typical high-draw one, which would pass a control that is actually broken.
Makruk's draw structure makes this a real error, not a rounding one. Measured bands, for scale:

- b0009, 16 games, sd 0.416 → ±20.8pp (small n, honestly wide)
- b0027, 120 games, sd 0.290 → ±5.3pp
- b0036, 20 games, sd 0.139 → ±6.2pp — the auto-control this ticket shipped

### Firing is automatic, and ticket 01 is why that is now allowed

The ticket framed this as a dilemma: *automatic costs a block of wall-clock without being asked; a
demand can be ignored, which is how prose-in-`AGENTS.md` failed.* The second horn is fatal and the
first is no longer true — [Pin the budgets](01-pin-the-budgets.md) made **every** run announce its
cost before it spawns anything, so nothing is unasked-for any more. A 20-game control is ~80 s.
So: automatic, announced, and `--skip-control` warns loudly the way `--skip-gates` does.

The control runs as a **fresh child process**, not inline. A control that shared the parent's setup
could not detect a fault *in* that setup, which is the entire thing it exists to check.

### The suspect flag is load-bearing, which is the whole point

A postcondition cannot un-play a block, and the ledger is append-only, so a suspect block is
**recorded** — it is real data — and then **held out of the default view and out of the generated
`AGENTS.md` standings** until a control clears it. That mirrors the retraction machinery ticket 06
built. Clearing requires naming a control block, and `clearSuspect` **verifies it** rather than
trusting it: wrong kind, failing band, non-suspect target and double-clear are all refused. "I ran a
control" is exactly the sort of claim that decays into nobody having run one.

### Shipped

- `scripts/control-trigger.mjs` — `fingerprint` (the binding-mechanism key: plumbing only, never the
  weights), `preChecks`, `postChecks`, `controlVerdict`, `observedSd`.
- `results.mjs` — `suspect` rows, `clearance` rows, `clearSuspect` with four guards, suspect
  exclusion from the default view and from the generated standings, readable refusals.
- `match-arena.mjs` — preconditions before the budget check with an auto-run control child process;
  clause (a) evaluated into the row before it is appended; `--skip-control`.

Verified: all four clause behaviours replayed against real ledger data (real monotone ladder stays
silent; a synthetic 71%-at-skill-8 fires with the right message; a synthetic repeat-cell swing
fires; an exact config repeat stays silent while a never-seen rung fires both (b) and (c)); both real
control blocks pass their own band; the full suspect → refuse-bad-clearance → clear → rejoin cycle
integration-tested on a scratch ledger (`MAKURUK_LEDGER`); end-to-end on a genuinely new rung
(classic vs fairy skill 4) which triggered (b)+(c), auto-ran control **b0036 at 52.5% PASS**, and
recorded **b0037 at 43.8%**. `cargo test --release` 9/9, mirror-perft and preflight green.

### It found a real bug in ticket 01 on its first run

The first back-to-back run this rig has ever done — control, then the block it was clearing —
was **refused by ticket 01's own 80 °C hot-start gate at 91 °C**. That gate rejects the normal case:
every arena block runs at 88–89 °C mean, so it would refuse Gate A → Gate B in any ordinary round.
Corrected to a CPU-contention gate; the full reasoning is in
[Pin the budgets](01-pin-the-budgets.md)'s amendment. Worth noting as a rig outcome, not just a bug
fix: the instrumentation shipped one ticket earlier caught a wrong decision from that same ticket,
within the hour, on the first run that could have exposed it.
