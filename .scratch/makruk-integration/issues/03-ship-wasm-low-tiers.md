# Ship the wasm as tiers 1–7

Type: build
Status: open
Blocked by: [What is the wasm engine worth at site movetimes?](01-worth-at-site-movetimes.md), [Make the strong engine weak on purpose](02-make-it-weak-on-purpose.md)
Parent: map.md

## Question

If the measurement says yes, tiers 1–7 stop being scripted heuristics and start being a real chess engine in 156 KB. This ticket executes the swap in `../markrukthai-1` without breaking anything the chain currently guarantees:

1. **Asset pipeline.** Mirror `scripts/setup-browser-fairy-stockfish.mjs`: a setup script copies `pkg/web/makruk_engine.js` + `makruk_engine_bg.wasm` into `client/public/engines/makruk/`, records sha256 into the existing `engines/manifest.json` pattern, and runs before `dev`/`build` like its fairy sibling. The worker verifies the hash before first use (the NNUE manifest pattern already exists in this repo's docs).
2. **Availability + fallback.** `client/src/lib/browserEngineBot.ts` gains a makruk probe alongside the fairy HEAD check. The chain in `useBotGameScreen.tsx` becomes: makruk wasm (tiers 1–7) → on any failure (load timeout, illegal move, `(none)` bestmove) → existing local heuristic fallback, untouched. The heuristic code stays; it is the safety net, not dead code.
3. **Config wiring.** `shared/botStrength.ts` tiers 1–7 point at makruk tier configs from [Make the strong engine weak on purpose](02-make-it-weak-on-purpose.md); personas stay identical; `botEstimatedElo.ts` re-anchored to the measured blocks.
4. **Tiers 8–12 untouched.** Fairy loads lazily above the gate exactly as now; the diff should never touch that branch.

## Risks to pin down while building

- **COOP/COEP headers** are already set in `vite.config.ts`; confirm the classic worker + `importScripts` wasm instantiation works under them (fairy proves the pattern, but verify, don't assume — SFIFF builds differ).
- **First-move latency**: wasm instantiate + TT warm must fit inside whatever UX budget the persona select screen implies; measure cold cache on a mid phone if one is available.
- **The mirror gate is the real safety net**: any movegen divergence between our Rust port and `shared/engine.ts` shows up as illegal moves → fallback storm. `mirror-perft.mjs` green is a precondition, and the bot-calibration suite (`src/test/botCalibration.test.ts`) must be extended with at least one "engine move is legal per shared rules on a tricky counting position" assertion.

## Acceptance

- Site tests green: vitest incl. extended botCalibration, Playwright bot-game e2e on a tier ≤ 7 persona.
- Engine side green: `cargo test --release`, `npm run test:wasm`, mirror-perft.
- Bundle math recorded: total added bytes to tiers 1–7 users (wasm + glue, net excluded), compared against fairy's 1.6 MB they never had to download below tier 8.
- A rollback switch exists (config flag back to heuristic) and is exercised once in a test, because "we can always revert" that has never been flipped is a wish.
