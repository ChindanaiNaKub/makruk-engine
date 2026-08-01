# How is the strength ladder measured?

Type: grilling
Status: resolved
Blocked by:
Parent: map.md

## Question

Lock the benchmark methodology the spec and all future claims use: time control (today's gate gives fairy 4× movetime — the destination demands equal time), skill-ladder rungs (10 → 15 → 20/full), game counts vs statistical rigor (fixed-length matches vs SPRT), native-vs-wasm measurement (claims are about in-browser wasm, but iteration speed favors native), color/randomization policy, and how counting-rule draws are scored. Builds on scripts/match-arena.mjs.

Input from research/02 to factor in: the local wasm fairy (v1.1.11) embeds **no** NNUE net — today's "full strength" opponent is classical-eval fairy, ~248 Elo below the official 47.7 MB makruk net it could later be armed with. The methodology must pin which fairy artifact is the baseline (and how the claim is worded against each), plus decide whether we also benchmark vs the NNUE-armed fairy locally.

## Answer

Locked by grilling (2026-08-01):

1. **Two-bar baseline.** Primary bar: the shipped artifact `fairy-stockfish-nnue.wasm` v1.1.11 (no embedded net = classical eval) at **skill 20, unlimited, equal movetime** — what thatichess.dev users face today. Stretch bar: native fairy + official `makruk-a8c621e24a8c.nnue` (47.7 MB, +248 Elo), local-only. All public claims are worded per bar ("beats browser fairy at full strength" vs "scores X% against NNUE-armed fairy").
2. **Two-tier protocol** built on `scripts/match-arena.mjs` (extended to equal movetime + parallel workers; the 4× fairy handicap is retired):
   - **Dev tier** — 16-game blocks per skill rung (10 → 15 → 20) at 100 ms/100 ms, gating every iteration (Moka-style: nothing ships that doesn't pass its gate).
   - **Claim tier** — two independent 100-game blocks at skill 20 vs the wasm bar (plus the same vs the NNUE-armed native bar when making the stretch claim), W/D/L scoring with counting-rule draws = 0.5, error bars reported, plus one long-time-control (500 ms) confirmation so claims aren't bullet artifacts.
3. Rejected: cutechess-cli SPRT for dev (proxy-baseline ambiguity + tooling lift, revisit later); fixed-200 single tier (kills iteration cadence).
