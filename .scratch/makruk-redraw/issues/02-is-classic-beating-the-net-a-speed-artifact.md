# Is "classic beats the net" a speed artifact?

Type: task (AFK)
Status: resolved
Blocked by: —

## Question

The central negative result of this program has never been audited for the one confound that is sitting in plain sight.

Every net-vs-classic block ran at **equal movetime**, 100 ms a side: b0028 (net 44.2%), b0029 (classic 62.2%), b0038 (net 34.8%). At 100 ms the classical eval reaches **depth 8** and the net reaches **depth 5**, because net eval runs at ~332k nps against classic's ~885k. Those blocks therefore compare *eval quality plus eval speed* against *eval quality plus eval speed* — they do not isolate the eval. A three-ply handicap is enormous; it is roughly the size of the entire round-4 null-move + LMR gain, which was worth 6–0–5 head-to-head.

This is exactly the shape of the six harness defects that preceded it: an unexpected negative result, a plausible story told about the engine, and an unexamined measurement underneath. The method rule says audit the measurement first. It has not been applied here.

**The test needs no code.** `scripts/match-arena.mjs:43` already implements `--depth N` — `go depth N` for **both** engines, and the source comment labels it "eval A/B". It was built for exactly this.

Run Gate A at fixed equal depth, incumbent net (`out/r3fixed/lam0.97/makruk-tiny-v1-4452f72612f1.bin`, the artifact with the best Gate A history) vs classic. Sweep at least two depths — a shallow one and one at or above classic's movetime depth of 8 — because the answer can legitimately differ with depth if the net's advantage is positional and only surfaces further out.

Resolve with one of two verdicts, stated plainly:

- **The net wins at equal depth** → the NNUE program is *alive*, the recorded refutation is a speed artifact, and the lever is eval speed: the spec'd-but-never-implemented incremental accumulator plus the per-node `Vec` allocation in `nnue::net_score` (`src/nnue.rs:299`). That graduates a fog patch into a real ticket and changes the whole map.
- **Classic still wins at equal depth** → the net's eval is genuinely worse, no amount of speed work saves it, and the refutation stands on its own feet for the first time. The net program can be parked or deleted on evidence rather than on a confounded block.

**Cost:** fixed-depth games at depth 5–8 run *faster* than 100 ms movetime games — the net at depth 7 is well under 0.1 s a move. Expect **under 5 min** for the whole sweep, concurrency 6.

**Watch:** at fixed depth both engines are more deterministic than at fixed time, so opening randomization is doing more work than usual. Keep `--opening-plies 4`; if the pair variance collapses, say so rather than reading the SPRT as if it hadn't.

## Answer

**Yes. It was a speed artifact. The net's eval beats the classical eval at equal search depth, and beats it decisively from depth 6 up.** The NNUE program is alive, and the lever is eval speed.

Four points, all net vs the classical eval, same artifact (`makruk-tiny-v1-4452f72612f1.bin`), same opening randomization, concurrency 6:

| condition | block | n | W–L–D | net's score | verdict |
|---|---|---|---|---|---|
| equal **movetime** 100 ms (net ~depth 5, classic ~depth 8) | b0028 | 78 | 8–17–46 (7 mp) | **44.2%** | SPRT REJECT |
| equal **depth 5** | b0040 | 192 | 38–22–101 (31 mp) | **54.2%** | INCONCLUSIVE at the 96-pair cap |
| equal **depth 6** | b0049 | 16 | **7–0**–7 (2 mp) | **71.9%** | fixed-N |
| equal **depth 7** | b0043 | 47 | **16–0**–23 (8 mp) | **67.0%** | **SPRT ACCEPT**, 20 pairs, LLR 5.64 vs a ±2.94 boundary |

Controls all clean, and each run at its own matching depth rather than at movetime: **b0041 50.0%** (depth 5), **b0048 50.0%** (depth 6), **b0044 50.0%** (depth 7). The plumbing is symmetric at every depth tested, so the asymmetry in the Gate A blocks is the engines, not the harness.

**The sharpest single fact: across depths 6 and 7 the net went 23–0 in decisive games over 63 games.** Not one loss. The score fractions understate it because these positions draw heavily under the counting rules.

**It is not strictly monotone, and the answer should not claim it is.** Depth 6 (71.9%) sits above depth 7 (67.0%), but at n=16 against n=47 that ordering is inside noise. What the four points support is a step, not a smooth gradient: the net is *behind* when it is given three fewer plies than its opponent, level-to-marginal at equal depth 5, and decisively ahead at equal depth 6–7.

**What this does and does not establish.**

It establishes that the recorded refutation of the NNUE program measured *eval quality plus eval speed* and attributed the whole result to eval quality. Remove the speed term and the sign flips. Sixteen wins and zero losses over 47 games at depth 7 is not a marginal effect.

It does **not** establish that the net wins as shipped. Fixed depth is not a playable condition — real games are time-limited, and at 100 ms the net still only reaches depth 5 against classic's 8. What the map now owns is a different and much sharper question: **how much of the net's 2.7× nps deficit (332k vs 885k) can actually be recovered?** That is [How much of the net's speed deficit can the accumulator close?](08-how-much-speed-can-the-accumulator-close.md), which this answer graduates out of the fog.

**Numbers not to over-read.**

- The **+117 Elo** on the depth-7 block is an early-stopped SPRT estimate, biased away from the boundary it crossed. It sizes nothing. The 16–0 decisive record and the LLR are the load-bearing parts.
- The **44.2%** baseline is *also* an early-stopped SPRT (REJECT), so it is biased low. Any arithmetic of the form "3 plies of classic ≈ 10 points" built on the b0028→b0040 gap is soft in both directions. A fixed-N block would be needed to size the ply exchange rate properly — which is [Is the wall depth, or is it eval?](04-is-the-wall-depth-or-eval.md)'s job, not this one's.
- The **depth-5 margin is small** (54.2%, inconclusive at 192 games). The strong claim lives at depth 7, and the trend across the three points is what carries it, not any single block.

**An observation for a later ticket, not a conclusion.** The depth-7 games are long and counting-heavy — many run 220–330 plies and end in `counting_rule` draws, and net-vs-net at depth 7 produced 10 max-plies out of 20. The net carries ~10 counting side-channels into its tail (spec §1); classic has a single hand-written counting term. Whether the net's edge is *general* or is concentrated in long counting endgames is untested and would change what the lever is. Worth a ticket once the speed question resolves.

## Harness changes made while resolving this

The first fixed-depth block this project has ever run recorded **neither** the depth nor an honest movetime, because `--depth` predated the ledger. Under `--depth`, `goCmd` ignores both ms values entirely and sends `go depth N` to both engines — but the row stored `movetime: 100, opponentMovetime: 400`, which renders as *"the opponent had 4× the time and we still won."* Flattering, and false. Fixed:

- **`scripts/match-arena.mjs`** — records `depth`, and nulls `movetime`/`opponentMovetime` when depth governs. Patched at **both** construction sites: the `identity` object the trigger fingerprints and the `appendBlock` row are built independently from the same globals, and had already drifted. The second site is why the first patch appeared to do nothing (b0044 still recorded `100/400ms`).
- **`scripts/results.mjs`** — `table()` gained a `conditions` column, so a fixed-depth block can never again be read as a movetime block in the CLI view or the generated AGENTS.md standings.
- **`scripts/control-trigger.mjs`** — `depth` added to `fingerprint()`. **This touches the control-block trigger, which this map's Out of scope assigns to the rig map's successor.** Declared rather than done quietly: without it, a `--depth` block and a movetime block share a fingerprint, so clause (b) stayed silent on a genuinely new binding mechanism and clause (a) fired by comparing a depth-5 block against a movetime block — the right alarm for the wrong reason. It is a completeness fix to a mechanism that was demonstrably blind, not a redesign, but the user should overrule it if they disagree.

**Verified:** `b0045` (post-patch smoke) records `depth 3`.

**Ledger debt — PAID 2026-08-03 by [Amend the five](../../makruk-ledger/issues/05-amend-the-five-and-reconcile.md).** Five rows — **b0040, b0041, b0042, b0043, b0044** — were recorded before the fix and all read `100/400ms` with no depth. All five now read their true condition, each carrying a proof that the claimed depth reproduces the recorded games: **b0040 and b0041 depth 5; b0042, b0043 and b0044 depth 7.**

Three things this ticket got wrong, corrected by the record rather than argued with:

- **The ~25 min estimate was an order of magnitude too high**, and the "therefore the user's call" that followed from it was moot. A fixed-depth block replays bit-exactly, so a row is settled by 2–4 games. The whole repair cost ~10 min.
- **Re-running was never the right instrument.** These are sound measurements with wrong descriptions; a re-run replaces the number. The ledger gained an **amendment** — a meta-row overlaid at read time — so the rows were never edited and never retracted.
- **b0042's depth was recorded nowhere at all** and had to be found by sweeping candidates against its recorded games. The obvious bracket (its s/game sits between b0040's and b0043's, so "try 6") was **wrong** — per-game cost scales with a block's concurrency, and b0042 ran 4 games at concurrency 4 against b0043's 47 at 6. It is depth 7.

**This section is no longer the source of the true conditions — `results/blocks.jsonl` is.** The commands below stay as history.

## Verbatim commands

```sh
W="$PWD/out/r3fixed/lam0.97/makruk-tiny-v1-4452f72612f1.bin"
E="$PWD/target/release/makruk-engine"

# Gate A at fixed depth (b0040 = depth 5, b0043 = depth 7)
MAKURUK_EVAL=net MAKURUK_WEIGHTS="$W" FAIRY_BIN="$E" \
  node scripts/match-arena.mjs --sprt --depth 5 --seed 7

# Controls at the matching depth (b0041, b0044)
MAKURUK_EVAL=net MAKURUK_WEIGHTS="$W" FAIRY_BIN="$E" OPP_WEIGHTS="$W" \
  node scripts/match-arena.mjs --control --games 20 --kind control --depth 5 --seed 11
```
