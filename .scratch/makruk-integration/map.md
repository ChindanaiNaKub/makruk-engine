# Map: Makruk Engine — Serving thaichess.dev

Labels: wayfinder:map
Status: **active** — [What is the wasm engine worth at site movetimes?](issues/01-worth-at-site-movetimes.md) ~80% measured 2026-08-26/27 (ladder @850ms + bot-vs-heuristic cells in, controls passing); finishing cells + anchor table handed off 2026-08-27 — see the ticket's *State when handed off* (includes a shim-identity defect the handoff repairs first).
Predecessors: `../makruk-rig/map.md` (done — produced the arena/ledger/gates this map measures with) and `../makruk-strength/map.md` → `docs/strength-spec-v1.md`.

## Destination

For each of the three site surfaces — **bot tiers**, **analysis**, **puzzles** — a recorded, evidence-backed decision about whether and where `makruk-engine` serves thaichess.dev, plus at least one shipped slice end-to-end: either tiers 1–7 served by the wasm build behind the site's unchanged fallback chain, or a documented refusal carrying the block numbers that justified it; and one puzzle candidate traveling **miner → proof/uniqueness → referee → quarantine-or-editorial** with no number hand-transcribed anywhere.

The map ends when a wrong engine placement cannot survive quietly: every placement claim points at a ledger row, and every shippable puzzle carries machine-verifiable proof or dual-engine consensus.

Explicitly **not** a strength goal. No DAgger rounds, no net changes, no ladder advancement — the strength redraw stays parked and owns those questions.

## Notes

- **Execution override.** Wayfinder's plan-only default is OFF. A ticket that decides a mechanism also builds it; a ticket closes when the code is in the right repo with `cargo test --release` + mirror-perft green (engine side) and `npm test` green (site side), not when the decision is written down.
- **This map deliberately crosses the boundary.** Both predecessor maps declared "thaichess.dev site changes" out of scope. That was correct while the rig did not exist; it is wrong now — tickets [Ship the wasm as tiers 1–7](issues/03-ship-wasm-low-tiers.md) and [Two engines agree or it does not ship](issues/08-referee-consensus.md) execute changes in `../markrukthai-1`. The rules authority stays read-only: `shared/engine.ts` + `shared/makrukRules.ts` are consumed, never edited, by this map.
- **Budgets are inherited, not re-litigated.** Foreground (arena/measurement blocks): wall-clock ceilings, concurrency pinned at 6, `nice` forbidden. Background (mining, proving, batch validation): `nice 15`, no wall-clock ceiling, consent prompt over 5 min. Every run announces what it costs before spawning anything — the rig's discipline applies to anything this map measures.
- **The engine's honest ceiling is known and load-bearing.** At equal 100 ms movetime vs fairy: ~72% at skill 3, ~34% at skill 5, ~15% at skill 8, **0/64 at skill ≥ 10**. Fairy searches depth 10 at every rung below 20; we reach depth 8 native / ~9 wasm at 300 ms. Any placement claim that requires beating fairy head-on is dead on arrival; placements must exploit what the small engine is actually good at: **156 KB instant-load payload, exact mirror of the site's adjudication rules, and cheap bulk inference**.
- **The net stays out of the browser.** Classical eval is the incumbent (+89 Elo SPRT accept over the r3 net). Shipping `init_nnue` weights would add 204 KB and lose strength. Revisit only when the parked strength map produces an artifact that passes Gate A.
- **Method rule, inherited:** an unexpected result is a reason to audit the measurement first. It caught six harness defects last map; assume it will be needed again.
- Refer to tickets by name in narration, never by number.
- Tracker: local markdown, this directory. Tickets are `issues/NN-*.md`.

## Decisions so far

<!-- one line per closed ticket: name (link) + one-line gist -->

- none yet

## Tickets

### Track A — Bot (tiers 1–7)

- [What is the wasm engine worth at site movetimes?](issues/01-worth-at-site-movetimes.md) — measure before placing: our engine vs fairy rungs at the site's actual 850–2400 ms budgets, and vs the incumbent JS heuristic bot through a UCI shim. Produces the rating-anchor evidence every label claim below depends on.
- [Make the strong engine weak on purpose](issues/02-make-it-weak-on-purpose.md) — the engine has no skill option (`setoption` is silently ignored); weakness must be manufactured. Depth/nodes/movetime caps plus a blunder layer, built in `js/worker.js`, wire protocol untouched.
- [Ship the wasm as tiers 1–7](issues/03-ship-wasm-low-tiers.md) — the integration ticket: asset pipeline mirroring the fairy setup script, availability probe, fallback chain preserved, personas and estimated-Elo tables re-anchored to ticket-one blocks.

### Track B — Analysis

- [Where does the small engine serve analysis?](issues/04-analysis-placement.md) — a decision ticket. Candidates: pre-fairy bootstrap for the eval bar, offline/quick mode, editor sanity check. Settles eval-scale normalization and the raw-±100000 mate-score display problem. Spawns a build ticket only if it answers yes.

### Track C — Puzzles

- [Mine puzzle candidates from games we already have](issues/05-blunder-miner.md) — blunder-ply scanner over `--dump-games` dumps and datagen corpora, counting-aware, provenance attached, emitting the candidate queue everything downstream consumes.
- [Prove mate puzzles instead of scoring them](issues/06-mate-prover.md) — exhaustive AND/OR minimax to depth 2N−1 with unsound prunings disabled; the only puzzle class whose correctness is provable regardless of engine strength.
- [Uniqueness is a root sweep, not a MultiPV gap](issues/07-uniqueness-root-sweep.md) — all legal root moves searched at a pinned budget; winner-margin and all-alternatives-below-threshold gates; emits `onlyMoveChainLength`/`multiPvGap`-shaped metadata the site's validation already speaks.
- [Two engines agree or it does not ship](issues/08-referee-consensus.md) — fairy as independent referee at pinned depth; consensus on solution move AND outcome class required, disagreement auto-quarantines; wired into the site's existing candidate/reviewStatus flow.
- [Who validates the validator?](issues/09-validator-health.md) — append-only verdict ledger written by the tooling, blind hold-out solving with a fail-closed agreement gate, editorial spot-check checklist, and trend metrics that catch a rotting pipeline.

Dependency sketch: 01 → 02 → 03. 05, 06, 07 are independent builds; 08 consumes all three; 09 watches 08. 04 stands alone.

## Not yet specified

- **Wasm inside the preflight.** The rig proves the native binary before every block (`preflight.mjs`: env, eval identity, sides differ, seeds, perft). Nothing proves the *wasm* artifact the site would ship beyond `smoke-wasm.mjs`. If tier 1–7 ships, a hash-gated wasm smoke belongs in `gate.mjs`. Sharpen when the integration ticket lands.
- **Server-side role for our native binary.** The site's server already spawns the fairy binary with two lanes and caches aggressively; our binary is tiny and fast but strictly weaker. Probably a refusal — but it deserves the same recorded-numbers treatment as the client questions, especially for bulk jobs (whole-game review pre-pass) where 885k nps classical eval is the asset. Not scheduled; do not let it jump the queue.
- **PWA/offline packaging.** If the analysis decision picks the offline niche, service-worker caching of a 156 KB payload is trivial — but only worth a ticket if the offline mode itself is wanted.
- **Difficulty grading against humans.** Mate depth × only-move chain length × engine solver success is a proxy. Calibrating against real solve data from `/puzzles` telemetry is a separate question once shipped puzzles accumulate.
- **Real site games as a puzzle source.** The richest blunder corpus is the site's own games; fair-play policy and privacy decide whether it is touchable. Parked until the pipeline proves itself on self-play data.
- **MultiPV contingency.** If the analysis decision ever demands MultiPV from our engine, that is real engine work (root-sweep exposure) and belongs to a fresh ticket, not a retrofit here.

## Out of scope

- **All strength work** — parked at the redraw, unchanged: DAgger, nets, eval-speed work, ladder advancement. This map consumes whatever artifact is incumbent and nothing else.
- **Rules changes** — `shared/engine.ts` / `shared/makrukRules.ts` are the sole authority and are read-only here. If a puzzle exposes a genuine rules bug, that is a defect report to the site repo, not a fork.
- **Replacing fairy at tiers 8–12.** The ladder says 0/64 at skill ≥ 10; the top personas keep fairy. Revisit only after a strength-redraw artifact passes Gate A *and* Gate B.
- **wasm-bindgen / js-sys version bumps.** Pinned 0.2.100 / 0.3.77 per AGENTS.md; any bump is its own gated change nowhere on this map's critical path.
