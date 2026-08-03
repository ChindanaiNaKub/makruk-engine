# Amend the five, and reconcile everything that quotes them

Type: task (AFK)
Status: resolved (2026-08-03)
Blocked by: 02, 03, 04

## Question

The last step: use the primitive on the rows it was built for, and follow the numbers out to every place they were copied.

**The five rows, and what each needs.** All ran under `--depth`, all record `movetime 100 / opponentMovetime 400`, all predate the depth field:

| row | kind | n | seed | claimed depth | proof status |
|---|---|---|---|---|---|
| `b0040` | gate-a | 192 | 7 | **5** | **proven at charting** — `DRAW/313 MAXPLY/400` reproduced exactly |
| `b0041` | control | 20 | 11 | 5 (vouches for `b0040`) | unproven — but **provably deterministic**: 9/10 colour-reversed pairs replay to the same ply |
| `b0042` | smoke | 4 | 3 | ? | unproven — `kind: smoke`, outside the default view |
| `b0043` | gate-a | 47 | 7 | **7** | **proven at charting** — `MAXPLY/400 DRAW/237` reproduced exactly |
| `b0044` | control | 20 | 13 | 7 (vouches for `b0043`) | unproven — but **provably deterministic**: 10/10 pairs replay to the same ply |

The two Gate A rows are already settled. The three others need the same two-game treatment; **`b0042`'s depth is not recorded anywhere in prose**, so its claim has to be *found* by trying candidate depths against its recorded `perGame` rather than confirmed. If no depth reproduces it, that is a finding, not a failure — say so and retract it instead.

**From [the audit](issues/01-audit-what-cannot-be-true.md):** determinism is evidence the search was *not* time-bound, not evidence of *which* depth, so b0041 and b0044 still need their re-run — but a 2-game proof at the claimed depth also has to reproduce the **pairing** (game 0 and game 1 identical), which makes a wrong depth fail two ways at once. For b0042 the candidate search has a bound: its recorded 40.8 s/game over 234 mean plies sits between b0040's depth-5 rate and b0043's depth-7 rate, so **try 6 first**. And when the amendments land, re-run `node scripts/ledger-audit.mjs` — the `clearance-condition-matches` and `control-time-symmetric` findings on these rows should disappear without being touched directly. If they do not, the overlay is caching what it should re-derive.

**Then follow the numbers out.** The ledger is the source, but it is not the only place these figures appear:

1. `node scripts/results.mjs --write-agents` — regenerates the AGENTS.md standings table. Verify `b0040` and `b0043` now read `depth 5` / `depth 7` rather than `100/400ms`.
2. **AGENTS.md prose.** The generated table is not the only thing in that file quoting these blocks; the surrounding paragraphs quote scores and conditions in running text, which is the record `results/blocks.jsonl` was built to replace and which nothing regenerates.
3. **`../makruk-redraw/map.md`** — its Notes carry an **"Open ledger debt"** paragraph estimating ~25 min and parking the work on the user. Both the estimate and the parking are now refuted. Its Decisions-so-far entry for [Is "classic beats the net" a speed artifact?](../../makruk-redraw/issues/02-is-classic-beating-the-net-a-speed-artifact.md) also describes the debt as outstanding.
4. **`../makruk-redraw/issues/02-...md`** — holds the true conditions and the verbatim commands precisely *because* the ledger could not. Once the ledger can, say so there rather than leaving two sources of the same truth.
5. **`docs/strength-spec-v1.md`** — check whether its execution log quotes any of the five.

**Resolve with** the amendments written, the standings regenerated, and every location above either corrected or confirmed clean. The answer records which rows were amended, which were retracted and why, and what `b0042` turned out to be.

**Cost:** three proof re-runs at 2 games each, plus candidate-depth search for `b0042`. The depth-7 pair is the slow one — ~70 s. Call it **under 5 minutes** total, inside the map's ceiling. No gate blocks.

**Watch:** this is the one ticket on the map that writes to the **committed** ledger. Every experiment before this point runs under `MAKURUK_LEDGER=<scratch>`; here the target is `results/blocks.jsonl` itself. Confirm the scratch redirect is *off* — and equally, that no earlier ticket left a stray smoke row in the real file. `git diff results/blocks.jsonl` before and after should show only the amendment rows appended.

---

## Resolution (2026-08-03)

**All five amended, each with a proof. 49 block rows, zero edited.** The ledger audit fell from **15
contradictions to 4**. `node scripts/ledger-selftest.mjs` 43/43; `cargo test --release` green.

| row | claimed | proof | outcome |
|---|---|---|---|
| `b0040` | depth 5 | 2 games, seed 7 — `DRAW/313 MAXPLY/400` | amended |
| `b0041` | depth 5 | **4** games, seed 11 — `DRAW/327 DRAW/327 FAIRY/106 MINE/106` | amended |
| `b0042` | **depth 7** | 2 games, seed 3 — `DRAW/393 DRAW/215` | amended, depth **found** |
| `b0043` | depth 7 | 2 games, seed 7 — `MAXPLY/400 DRAW/237` | amended |
| `b0044` | depth 7 | **4** games, seed 13 — `MAXPLY/400 MAXPLY/400 DRAW/286 DRAW/286` | amended |

**The auto-widening earned its place on its first real use.** b0041 and b0044 both open with two
identical ply counts, so a 2-game proof would have "matched" any run that also stalled the same way.
Both widened to 4 — and the extra pair is the strongest evidence in the table: `FAIRY/106 MINE/106`
and `DRAW/286 DRAW/286` are colour-reversed pairs replaying mirrored, which a wrong depth cannot fake.

### b0042: the depth was not 6, and the reasoning that said 6 was wrong

This ticket predicted depth 6 by bracketing — b0042's 40.8 s/game sits between b0040's 10.4 (depth 5)
and b0043's 65.9 (depth 7). **Depth 6 failed the proof outright** (`FAIRY/136` against the row's
`DRAW/393` — not a near miss). A sweep settled it: **4 and 5 diverge on game 0; 7 reproduces
`DRAW/393 DRAW/215` exactly.**

The bracket was wrong because **per-game cost scales with a block's concurrency, and these blocks did
not share one**: b0042 ran 4 games at concurrency 4, b0043 ran 47 at 6, so b0043's games contend more
and cost more wall-clock at the same depth. Any future attempt to infer a search condition from
`gameTimeS / games` has to divide out concurrency first.

**A second wrong theory, recorded because it was tested and refuted.** b0042's timing ratio is 0.707
against an honest movetime band of 0.75–0.99 — a 6% miss where b0040's fixed-depth figure misses by
~5× — and the audit's own comment says the 0.75 floor was placed *to convict b0042*. That made
"b0042 was a movetime block after all, and the band edge is drawn too tight" a live hypothesis, which
would have meant retracting nothing and loosening the detector. The replay refuted it: b0042 is
fixed-depth at 7, and the timing band is fine. **Threshold-drawn-to-fit is a real smell and it was
the wrong call here** — which is the argument for a primitive that verifies rather than reasons.

### The prediction this ticket made about the overlay held

Re-running `node scripts/ledger-audit.mjs` after the amendments: **11 of the 15 baseline
contradictions stopped firing**, including `clearance-condition-matches` on b0040/b0043 and
`control-time-symmetric` on b0041/b0044 — **none of which were touched directly.** They are
consequences of the search condition, and the overlay re-derives them instead of caching. Had they
survived, the overlay would have been caching what it should re-derive.

**The 4 that remain are all known and all parked:** `b0010:kind-matches-opponent` (permanent — a
movetime row that contradicts itself, unprovable, retracted) and `suspect-reason-comparable` on
b0040/b0043/b0049, which the map's Out of scope assigns to clause (a)'s cell, not to the record.
`results/audit-baseline.json` ratcheted 15 → 4.

### Following the numbers out

1. **`node scripts/results.mjs --write-agents`** — the standings now read `depth 5` / `depth 7`, and
   the `amended` marker stacks beside `cleared by b0041`. Done.
2. **AGENTS.md prose** — swept for the five ids and for `100/400`: **no running text quoted these
   blocks' conditions.** The only `100/400ms` left in the file is `b0037`, a genuine movetime block.
   Nothing to fix, which is the generated table doing its job.
3. **`../makruk-redraw/map.md`** — the "Open ledger debt" Note is now "PAID", and the
   Decisions-so-far entry no longer describes the debt as outstanding.
4. **`../makruk-redraw/issues/02-...`** — the "Ledger debt, outstanding" section now records the three
   things it got wrong (the ~25 min estimate, "re-running" as the instrument, and depth 6), and says
   plainly that **`results/blocks.jsonl` is the source of these conditions, not that ticket.** The
   verbatim commands stay as history.

### One small gap, named rather than fixed

`--all` does not show b0042's amendment, because `--all` still filters `NOISE_KINDS` and b0042 is a
smoke. `node scripts/results.mjs --kind smoke` shows it correctly. Consistent with how smokes have
always been hidden, so it is left alone — but it means "show me every correction in the record" is
two commands, not one.
