# Where do results live so a future session can't read a retracted number?

Type: grilling
Status: resolved (2026-08-02)
Blocked by:
Parent: map.md

## Question

The user's stated pain, verbatim: outdated markdown conflicting with new updates, and hours lost to numbers that were wrong. That is not only a harness problem — it is a **record** problem, and the record is currently three incompatible things at once:

- **`AGENTS.md`** (~9 KB of running prose) mixes operational instructions, current measurements, superseded measurements, and explicit retractions in the same paragraphs. An agent reading it fresh has to parse which numbers are live. It has already been edited three times in one day to retract or supersede a figure in place.
- **`docs/strength-spec-v1.md`** carries an append-only execution log now ~270 lines deep, written as narrative, with `**RETRACTED**` blocks inline. Excellent as history, unusable as a lookup.
- **Raw logs** — the ladder that decided today's direction lived in a `/tmp` scratchpad belonging to a dead session, and would have been lost on reboot.

Decide the shape of the record:

- **Is there a single machine-readable results ledger** (one row per block: artifact, opponent, skill, games, W/L/D, max-plies, seed, movetime, harness commit, timestamp) that the arena *writes itself*, so a result cannot be transcribed wrong or lost in `/tmp`? What is the minimum row that makes a block reproducible and comparable?
- **What does `AGENTS.md` keep?** Argument for: it is what an agent loads first, so the operational one-liners and the traps belong there. Argument against: every measurement in it is a copy that can go stale. Where is the line?
- **What retires a superseded number?** Today the convention is to leave it in place with a caveat ("pre-randomization, suspect"), which is why the file keeps growing and why a hurried read picks up the wrong figure. Deletion loses the provenance the spec's execution log exists to hold. Decide the rule and where each half lives.
- **Where does an in-flight run write?** Not a session-scoped `/tmp` directory. Decide the location and whether it is gitignored.

## Answer

**Three records, three distinct jobs, and the numbers live in exactly one of them.**

| record | job | holds numbers? |
|---|---|---|
| `results/blocks.jsonl` | **lookup** — every block ever played | **yes, the only one** |
| `docs/strength-spec-v1.md` execution log | **narrative history** — what we believed, when, and why it changed | prose only, as history |
| `AGENTS.md` | **operating instructions** — commands, traps, invariants, current identities | only in a *generated* block |

### The ledger: `results/blocks.jsonl`, append-only and committed

`scripts/results.mjs`. **The arena writes its own row** at the end of every block, so nothing transcribes a number and nothing can transcribe it wrong. Committed, not gitignored — the ladder that redirected this whole project lived in a `/tmp` scratchpad belonging to a dead session and would have vanished on reboot.

Row schema, chosen so a block is both reproducible and *auditable*: `id`, `ts`, `kind` (gate-a / gate-b / control, inferred by default so a block is never misfiled through forgetfulness), both sides' `{engine, eval, weights, armed}`, `games`, `movetime`, `opponentMovetime`, `openingPlies`, `seed`, `w/l/d/maxPlies/errors`, `score`, `perGame` summaries, plus `engineCommit` and `engineDirty`.

**`armed` is the field that earns its place.** It stores what each side's engine *reported it actually armed* (via the new UCI `evalinfo`), not what was requested. Preflight already catches a mismatch at run time; recording it means a block stays auditable months later — you can ask "did this row really measure a net?" without rerunning it. That question could not be answered about any block played before today.

### Retraction: nothing is ever edited or deleted

**A retraction is a new row** referencing the retracted one, carrying a mandatory reason (`results.mjs` refuses a reason-less retraction — "a retraction without a reason is how numbers become mysteries"). The default view hides retracted blocks; `--all` shows them *with the reason*.

This is the direct fix for the failure mode. The old convention was to leave a superseded number in place with a caveat, which is why `AGENTS.md` kept growing and why a hurried read picked up the wrong figure. Deleting instead would lose the provenance the spec log exists to hold. Append-only ledger + filtered view gets both: history preserved, lookup clean, and **no stale number can survive in the place people actually read.**

### `AGENTS.md` keeps instructions, not measurements

Its standings are now a **generated block** between markers, rewritten by `node scripts/results.mjs --write-agents`. A stale table becomes a mechanical fix rather than a hand-edit someone forgets. What stays hand-written is what is genuinely instruction rather than measurement: the traps, the invariants, and the current *identities* (which artifact is incumbent, which rung is live) — facts that do not have error bars.

Two hand-copied figures were removed in the process, including one citing a now-retracted 70.3%.

### Backfill, and a caught mistake worth recording

The five randomized-ladder blocks went in exactly as measured (b0001–b0005). The two round-5 Gate A blocks went in and were **immediately retracted** with the pre-randomization reason, so the ledger carries the retraction rationale rather than the map alone.

**On the first backfill attempt the Gate A W–L–D splits were fabricated to hit the known percentages** — 72.7% and 44.5% came out against the recorded 70.3% and 45.3%, because only the score fractions were ever written down and a plausible-looking split was reconstructed to fit. That is precisely the failure this ledger exists to prevent, caught only because the arithmetic did not land on the target. The ledger was rebuilt with `w/l/d = null` for those rows, rendered as `—`, and `results.mjs` never reconstructs a split from a score fraction. **A missing number must stay visibly missing.**

### In-flight runs

A block writes its row when it completes; a killed run records nothing, which is correct — a partial block is not a result. Per-game detail (`tag`, `plies`) rides inside the row, so there is no separate log file to lose and no session-scoped path involved.

**Unblocks** [Implement the conditional control-block trigger](07-control-block-trigger.md): the trend line clause (a) now has something to compute a trend from.
