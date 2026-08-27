# What is the wasm engine worth at site movetimes?

Type: task (measured; the grilling label was inherited from charting)
Status: in progress — measurements ~80% done 2026-08-26/27; blocked before finishing by a shim-identity defect (see *State when handed off*). Handed off 2026-08-27.
Blocked by: —
Parent: map.md

## Question

The site's browser-engine tiers (8–12) hand fairy `go movetime` budgets of **850 / 1200 / 1600 / 2100 / 2400 ms** (`client/src/lib/browserEngineBot.ts`). Tiers 1–7 are served by the JS heuristic bot (`shared/botEngine.ts`, per-level `maxDepth/maxNodes/maxMs/noise/blunderRate`, personas in `shared/botPersonas.ts`). Before anything replaces anything, both incumbents need a number, measured under the rig's rules:

1. **Ours vs the fairy rungs at site movetimes.** Native-vs-native as proxy (identical `src/uci.rs` code path; wasm fidelity is `smoke-wasm.mjs`'s job, and the simd128 result was bit-identical to scalar). Blocks at 850/1200/2400 ms minimum against fairy skill rungs already anchored in the ledger (skill 3 ≈ 72%, skill 5 ≈ 34%, skill 8 ≈ 15%). Fixed-N Gate-B-style blocks are fine — these are *measurements*, not accept/reject decisions — but every block goes through the arena unchanged: concurrency pinned at 6, no nice, ledger rows written by the tool.
2. **Ours vs the heuristic bot.** The honest baseline for tiers 1–7 is not fairy — it is the scripted bot currently serving those tiers. Wrap `getBotMoveForLevel` in a ~50-line UCI stdio shim in the site repo and feed it to the arena through the `FAIRY_BIN` slot (the arena already treats that slot as "any UCI opponent"). Caveats to record: the shim ignores `movetime` by design (its own `maxMs` governs), and the arena's sides-differ preflight must see two genuinely different engines.
3. **What rating anchor does each of our throttled configs earn?** Once [Make the strong engine weak on purpose](02-make-it-weak-on-purpose.md) defines the level caps, each capped config gets its own small block so `shared/botEstimatedElo.ts` labels become claims with evidence instead of vibes. The existing ladder gives the mapping scaffolding: our unthrottled engine sits between fairy skill 5 and 8 at equal time.

## Constraints

- Foreground class. Five cells × n=32 ≈ 25 min serial at the measured ~14.5 s/game — fits inside one sitting; trim cells before touching concurrency.
  **This arithmetic was wrong by ~10×.** 14.5 s/game is the 100 ms-movetime rate; arena game time scales with the clock (measured: a 20-game self-play control costs ~17 min at 850 ms, and the estimator `estimateBlockS` is calibrated at 100 ms so its "worst case" numbers are floors, not ceilings, at site clocks — finding recorded for the rig). The plan was re-staged cheap-first under the same acceptance: n=32 at 850 ms, n=16 above, skill 3 @ 850 trimmed (the bracket already exists).
- The wasm-vs-native gap is assumed negligible for placement purposes but *stated*, not hidden: record it as a caveat on every derived label until someone measures wasm directly.
- Do not let this ticket drift into "improve the engine" — a number is the deliverable, even when the number is unflattering.

## What was measured (2026-08-26/27, all arena-recorded, controls passing)

**Ladder anchors — ours (classic eval, native) vs fairy at equal time:**

| block | opponent | clock | n | score | prior at 100 ms |
|---|---|---|---|---|---|
| b0066 | fairy skill 5 | 850/850 | 32 | **53.1%** (9–7–12, 4 mp) | 39.8% (b0055) |
| b0067 | fairy skill 8 | 850/850 | 32 | **29.7%** (2–15–13, 2 mp) | 23.4% (b0056) |

Reading: at real site budgets the engine moves UP the ladder — from clearly-below-skill-5 at 100 ms to essentially **at skill 5** at 850 ms; skill 8 still clearly above us. Bracket for interpolation: skills 5 and 8.

**Vs the incumbent heuristic bot (tiers 1–7 baseline), ours at 850 ms:**

| block | opponent | n | score |
|---|---|---|---|
| b0069 | site-heuristic-bot-l7 (the strongest JS persona, rated 1520) | 32 | **95.3%** (29–0–3) |
| b0072 | site-heuristic-bot-l4 (rated 980) | 32 | **98.4%** (31–0–1) |

**Controls** (auto-run, all PASS): b0065 55.0% @850, b0068 50.0% @850, b0070 52.5% @850, b0071 47.5% @850.

## State when handed off

**Remaining arena work to satisfy acceptance** ("rows at ≥3 site movetimes", "≥2 heuristic levels"):

1. `node scripts/match-arena.mjs --games 16 --skill 5 --movetime 1200 --fairytime 1200 --seed 7 --budget-min 35` (~40 min with its auto-control)
2. `node scripts/match-arena.mjs --games 16 --skill 5 --movetime 2400 --fairytime 2400 --seed 7 --budget-min 60` (~60 min with its auto-control)
3. **Re-run both bot cells** (see defect below) — L7 and L4 as before, n=32.
4. Interpolate the anchor table (tiers → budget → score → proposed displayed rating), write the go/no-go for [Ship the wasm as tiers 1–7](03-ship-wasm-low-tiers.md) citing row ids, close the ticket, update the map's Decisions-so-far.

**Defect to repair first (this is why the bot cells must be re-run):** the UCI shim wrapper lived only in `../markrukthai-1/scripts/` and the site repo was branch-switched and cleaned after measurement — the exact bytes that produced `engineId sha256:479ffc269f67` (b0064/b0069/b0072) are unrecoverable. The shim's *behaviour* is fully reconstructed and now committed at `.scratch/makruk-integration/assets/` (install instructions in its README), but the new wrapper hashes `e50ca1359bdd`, so those three rows cite an artifact nobody can rebuild or hash-verify. The ledger is append-only: the rows stay, and this paragraph is their annotation. The scores are almost certainly right (margins are 95%+ and both self-play controls passed), but this map's destination is that *no placement claim survives without a verifiable artifact* — so the handoff re-runs both bot cells with the committed wrapper before the anchor table cites them.

**Rig extensions this ticket shipped** (needed so the ledger can name a non-fairy opponent honestly):
- `match-arena.mjs`: `OPP_LABEL` env — records the opponent under its own name with `notes` stating movetime is ignored; skips fairy-only `setoption`s; forwards `--budget-min` into the auto-run control (a mandated control at a long clock would otherwise refuse against its inherited ceiling and fatal the block); sanitizes `OPP_LABEL` out of the control child.
- New ledger kind **`measure`** (block-schema + audit): a measurement against a NAMED external opponent (neither ours nor fairy); renders in the default view; off the fairy monotonicity ladder by construction (difficulty null).
- `control-trigger.mjs` + audit's `rungOf`: named external opponents get their own `ext:` rung cells so different bot levels never pool into one comparison cell.
- `ledger-audit.mjs`: timing detector skips `measure` rows (the opponent does not honor `go movetime`, so predicted-time arithmetic cannot apply); **band recalibrated 0.99 → 1.016 ceiling** by its own midpoint rule — first blocks at site clocks landed at ratio 0.991/0.937 (fixed per-move overhead amortizes at long clocks); the 0.0007-over conviction refused the next block outright, which is the gate working, and the recalibration is the prescribed response.

## Answer

(pending — remaining cells above, then the anchor table and go/no-go)

## Acceptance

- Ledger rows exist for ours-vs-fairy at ≥3 site movetimes and ours-vs-heuristic-shim at ≥2 heuristic levels.
- A written anchor table: tier → our config → measured score vs named opponent → proposed displayed-rating range.
- A go/no-go recommendation for [Ship the wasm as tiers 1–7](03-ship-wasm-low-tiers.md) that cites row IDs, with the refusal path fully legitimate if tiers 1–7 turn out stronger than expected.
