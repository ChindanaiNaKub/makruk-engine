# Map: Makruk Engine — Road to Fairy Full-Strength Parity

Labels: wayfinder:map
Status: done (2026-08-01 — destination reached: `docs/strength-spec-v1.md` approved)

## Destination

A locked, written spec — architecture + training/distillation plan + benchmark ladder — for taking this engine from today's 0–8 vs fairy skill 10 to **≥50% vs fairy-stockfish at full strength (skill 20, no limit), equal movetime, in-browser wasm**, within a **~0.5–1 MB weights budget**. The map ends when that spec exists and nothing remains undecided before implementation. Decisions, not deliverables.

## Notes

- Domain: Rust/WASM makruk engine; sole rules authority is markrukthai `shared/engine.ts` + `shared/makrukRules.ts` (adjudication order matters).
- Hard invariants (any approach must preserve): mirror-perft + `cargo test` green; wire protocol compatible with markrukthai-1 `browserEngineBotWorker.ts` (uci/uciok/position/go movetime/bestmove, promotion `m` suffix); wasm-bindgen pinned 0.2.100.
- Current strength (match-arena, fairy at 4× movetime): sweeps skill ≤0, ~even at 5 with counting-rule draw saves, 0–8 at skill 10.
- Rig for training/benchmarks: RTX 3050 4 GB, 16 CPU cores, 15 GB RAM; fairy as wasm at `../markrukthai-1/node_modules` (FAIRY_DIR), fairy native at `tools/fairy/fairy-stockfish` + official makruk NNUE `tools/fairy/makruk-a8c621e24a8c.nnue` (2.4× faster; FAIRY_BIN/FAIRY_EVAL in match-arena).
- Approach is OPEN: NNUE vs Moka-style distillation vs classical is decided by evidence (research tickets), not preference.
- Ticket types: HITL grilling tickets use /grilling + /domain-modeling; research tickets resolve via subagent.
- Refer to tickets by name in all narration; local-markdown tracker per this repo's `.scratch/` conventions.

## Decisions so far

<!-- one line per closed ticket: name (link) + one-line gist -->

- [How was Moka built?](issues/01-moka-recipe.md) — recipe = 105k-param INT8 CNN + arena-gated on-policy DAgger rounds, quantize-the-artifact discipline; makruk adaptation needs displacement-plane policy head + counting-rule inputs. Detail: research/01-moka-recipe.md
- [Can fairy-stockfish generate/train Makruk NNUE data?](issues/02-fairy-nnue-tooling.md) — yes: official makruk NNUE + variant-nnue-tools/pytorch pipeline works on the RTX 3050 with days-scale datagen; nets floor ~6.5 MB → distillation to a tiny net is the path. Detail: research/02-fairy-nnue-tooling.md
- [What makruk engines and strength references exist?](issues/03-makruk-engine-landscape.md) — fairy strongest by default (no rated matches since 2013 MCA/Bilis era); exploitable gaps: counting-rule eval weakness, one weak 2022 net; KMITL 2026 tablebases are ground-truth. Detail: research/03-makruk-engine-landscape.md
- [Which eval architecture does the spec lock?](issues/04-eval-architecture.md) — tiny NNUE (piece-square, no king factorization, ~768→L1 256–512), value-only WDL, per-channel INT8 QAT, incremental accumulator inside existing alpha-beta, distilled from fairy labels. Moka's CNN+PUCT rejected: its ceiling was a weak teacher at 47%.
- [How is the strength ladder measured?](issues/05-benchmark-methodology.md) — two bars (shipped wasm fairy v1.1.11 classical skill 20 = primary; native fairy + official 47.7 MB makruk NNUE = stretch), two-tier protocol on match-arena (16-game dev gates → 2×100-game claim blocks + 500 ms confirm), equal movetime, counting draws = 0.5.
- [Get a native fairy-stockfish binary on this machine](issues/06-native-fairy-binary.md) — done: `tools/fairy/fairy-stockfish` (fairy_sf_14 bmi2; perft-verified rules-identical) + official 47.7 MB makruk net; 2.4× faster than wasm; `FAIRY_BIN`/`FAIRY_EVAL` in match-arena.
- [What is the training data + compute plan?](issues/07-training-plan.md) — NNUE-armed native fairy as teacher, own UCI self-play harness through our oracle (site-exact adjudication), 10k smoke → ~10M bootstrap → v1 on the RTX 3050 → small gated DAgger rounds; volume-first rejected.
- [How does the spec capture counting-rule awareness?](issues/08-counting-rule-eval.md) — ~8–10 normalized counting side-channels into the MLP tail (honor type, count/limit progress, counting side, final-attack flag); adjudication stays hard in search; KMITL bases deferred to a DAgger round triggered by a day-one frozen endgame probe set.
- [What does the spec hand off to thatichess.dev?](issues/09-handoff-artifacts.md) — one net + throttled rungs (measured-gate-anchored), Moka-style bin+JSON manifest (sha256-verified, fingerprinted filenames, dequantize at load), UCI wire protocol unchanged.
- [Write the strength spec (v1.0)](issues/10-write-the-spec.md) — `docs/strength-spec-v1.md` drafted from the 9 prior decisions and **signed off by the user**. Map complete; remaining fog absorbed into the spec as implementation detail.

## Not yet specified

- (Absorbed into `docs/strength-spec-v1.md`: L1 width default 256 with 512 as gated upgrade, datagen label schema, accumulator math; policy-guided move ordering deliberately deferred past v1 — revisit only if the ladder stalls.)

## Out of scope

- **thatichess.dev site changes** (deploy UX, difficulty-ladder UI, site integration work) — charting decision: this map stops at the engine repo boundary; the spec defines artifacts + protocol contract only.
- Multiplayer, other variants, non-engine work — beyond the destination.
