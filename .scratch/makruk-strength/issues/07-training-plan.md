# What is the training data + compute plan?

Type: grilling
Status: resolved
Blocked by: 01, 02, 06
Parent: map.md

## Question

Decide the plan the spec writes down for producing weights: self-play volumes and generation setup (native fairy binary, 16 cores), teacher scoring strategy (direct fairy eval distillation vs game outcomes vs hybrid), iteration cadence (bootstrap from current engine's games like Moka did), who/what runs training sessions on the RTX 3050, and checkpoint evaluation against the benchmark ladder. Depends on the Moka recipe, fairy tooling findings, and the native binary being in place.

## Answer

Locked by grilling (2026-08-01):

1. **Teacher = fairy_sf_14 + official `makruk-a8c621e24a8c.nnue`** (already installed at `tools/fairy/`, verified loading). Every label — eval score and game result — comes from the strongest known makruk player (+248 Elo over the primary benchmark bar). Classical-teacher and two-stage loops rejected: they cap label quality at the bar we're trying to exceed.
2. **Datagen = own UCI self-play harness** (new script beside `match-arena.mjs`): native NNUE-armed fairy self-plays at depth 2–4 through **our Game oracle**, exporting per position: FEN + teacher eval + final WDL. Adjudication is site-exact by construction (pieces-honor-before-mate, Sak Mak/Kradan) — the fairy-vs-site divergence risk from research/02 is eliminated rather than managed. Throughput smoke first; fall back to `variant-nnue-tools` only if <1k pos/s.
3. **Volume/cadence: small bootstrap, iterate on-policy** (Moka's core lesson). 10k-position smoke → ~10M bootstrap corpus → v1 net trained **locally on the RTX 3050** (PyTorch, per-channel INT8 QAT from the start, whole-game splits) → repeated small DAgger rounds (50–100k on-policy positions: our-vs-teacher games through the oracle, 1-epoch continuations, adapter-only fine-tunes, checkpoint soups). **Every round gated by the dev-tier 16-game blocks** (ticket 05); nothing ships that doesn't pass. ~100M volume-first rejected (written for 45k-input nets; Moka's replicated negative result). Runs as AFK agent sessions; Colab fallback only if the 3050 OOMs.
