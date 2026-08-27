# Where does the small engine serve analysis?

Type: grilling
Status: open
Blocked by: —
Parent: map.md

## Question

Analysis is the surface where fairy is strongest and our engine is most obviously outgunned: fairy wasm serves MultiPV review (`CompactEnginePanel`/`VariationLine`), a server binary backs game review with caching, and depth 10+ beats everything we have. So the question is not "replace" — it is whether any niche exists where 156 KB instant-load beats a lazy 1.6 MB download without lying to the user. Candidates, in descending order of promise:

1. **Bootstrap tier.** EvalBar paints from makruk wasm immediately; when fairy finishes loading, results upgrade. The site already has the debounce/backoff machinery (`useReviewEngineAnalysis.ts`, 700 ms movetime, 800 ms debounce). Risk: two engines' numbers on screen in sequence must not look like a "swing" — see normalization below.
2. **Offline / quick mode.** PWA-grade analysis with zero engine download. Only real if an offline mode is wanted at all (map: parked).
3. **Editor sanity check.** Instant legal-move + eval feedback while editing a board, where waiting on fairy compile is pure friction.
4. **Server-side bulk.** Whole-game pre-pass at 885k nps classical. Probably a refusal (server fairy is stronger and cached) but deserves recorded numbers like everything else.

## Problems that must be solved before any yes

- **Eval scales differ and must never mix raw.** Our material scale (R=500/N=300/S=250/M=200/P=100, `src/eval.rs:67`) is not fairy's. Display normalizes per-engine — `tanh(cp/400)` is the house precedent (`datagen.mjs` MATE_CP ±30000 rationale) — and `EvalGraph` across a game must never blend two engines' raw cp.
- **Mate scores print raw.** `score cp {n}` emits values near ±100000 minus ply (`src/uci.rs:189`; `CHECKMATE_SCORE = 100_000`, `eval.rs:9`). Either the engine learns `score mate N` (small `uci.rs` change — verify datagen/arena scraping stays compatible) or every client clamps. Pick one, write it down.
- **No MultiPV.** Anything needing multiple lines disqualifies us until real engine work happens (map: out of scope unless this ticket demands it).

## Rule-consistency argument (the one real differentiator)

Our eval collapses toward 0 exactly when the site's own adjudication ends the game — pieces-honor/board-honor/counting are ported line-for-line from `shared/makrukRules.ts`, adjudication order included. Fairy's makruk counting need not agree at the margins. For an *eval bar next to the site's own game-ending logic*, agreement with the authority is worth more than half a pawn of tactical depth. Verify this claim concretely (a counting-active position scored by both engines vs the oracle's verdict) instead of asserting it.

## Acceptance

- A written decision naming roles won AND roles explicitly refused, each with evidence.
- If any role wins: normalization policy + mate-display fix decided here, and a build ticket spawned with acceptance criteria.
- The counting-agreement check exists as a script/test either way — it guards the engine's core value proposition against future drift.
