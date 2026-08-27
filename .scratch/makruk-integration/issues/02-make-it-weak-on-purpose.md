# Make the strong engine weak on purpose

Type: build
Status: open
Blocked by: informed by [What is the wasm engine worth at site movetimes?](01-worth-at-site-movetimes.md), not hard-blocked
Parent: map.md

## Question

The engine has exactly one strength knob today: how long you let it think. `setoption` is accepted silently (`src/uci.rs`), `stop` is a no-op because searches are synchronous, and there is no skill/Elo machinery. Meanwhile the incumbent heuristic bot degrades along four axes (`maxDepth/maxNodes/maxMs/noise/blunderRate`) and the personas promise twelve distinguishable opponents from "New" to "Grandmaster". How do we manufacture a *ladder* from an engine that plays one way?

Candidate mechanisms, to be decided by calibration evidence rather than taste:

1. **Pure caps.** Map each tier to `go depth D` / `go nodes N` / `go movetime M`. Depth is naturally self-degrading — depth 1 is what `movetime 50` buys (`search.rs:177`), and the M4 search reaches depth 10 in 0.37 s native — so a depth ladder of roughly 1→6 produces a genuine gradient with zero new code in the engine.
2. **Blunder layer in the worker.** With probability ε per move, replace `bestmove` with a random legal move — `WasmEngine::legal_moves()` already exists — optionally filtered to "not immediately losing" using cheap static eval over captures/checks only. Mirrors the heuristic bot's own `blunderRate` axis, keeps the comparison fair.
3. **Sibling-score softening.** Pick among top root moves by eval noise. Rejected for now: sibling scores require a root sweep or MultiPV exposure that does not exist; revisit only if calibration fails with mechanisms 1+2.

## Where it lives

`js/worker.js` — the classic-worker UCI shim — behind a level config table mirroring `shared/botStrength.ts`. The wire protocol stays byte-identical (`uci/uciok/isready/readyok/ucinewgame/position/go/bestmove`); the site must be able to swap engines without touching its chain. Invariants that must survive:

- `bestmove` promotions keep the `m` suffix (fairy rejects bare endpoints).
- `ucinewgame` still clears the TT between games.
- No panic path: an illegal `position`, malformed `go`, or `(none)` bestmove falls through exactly as today.

## Calibration

Each tier config earns a small arena block vs a fixed anchor (fairy skill 3) — the same discipline as the ladder, so tier difficulty is comparable across releases. Target: monotone win% across tiers 1–7, with tier 7 measurably above the old heuristic bot's anchor and tier 1 winnable-but-lost by a beginner. Non-monotone = the mechanism is broken, not the numbers unlucky.

## Acceptance

- `js/worker.js` carries a documented tier→config table; `npm run test:wasm` green including a new tier-mechanism smoke (same position, low tier ≠ high tier move where expected, protocol lines unchanged).
- Calibration blocks recorded in the ledger, monotone, referenced by the integration ticket.
- Engine core untouched except where a cap exposed an actual bug.
