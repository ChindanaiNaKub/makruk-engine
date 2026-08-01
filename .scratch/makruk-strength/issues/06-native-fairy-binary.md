# Get a native fairy-stockfish binary on this machine

Type: task
Status: resolved
Blocked by:
Parent: map.md

## Question

The wasm fairy (FAIRY_DIR) is slow for datagen and long matches. Get a native fairy-stockfish binary running locally: try an official release download first, else build from source (make, variant NNUE enabled). Record in the answer: binary path, version, makruk availability check (`uci` + variant=makruk sanity game), node/sec comparison vs the wasm at fixed depth, and the match-arena/env changes needed to use it (e.g. FAIRY_BIN override). This unblocks the training plan; it does not itself decide anything.

## Answer

Done (2026-08-01). Facts later tickets depend on:

- **Binary:** `tools/fairy/fairy-stockfish` — Fairy-Stockfish 14, release tag `fairy_sf_14`, `x86-64-bmi2` asset (CPU has avx2/bmi2/popcnt). `UCI_Variant value makruk` confirmed; `position startpos` + `go perft 4` = **273026** — exact match with our engine and the wasm mirror gate.
- **Official makruk net also fetched:** `tools/fairy/makruk-a8c621e24a8c.nnue` (47,721,376 B). Loads into the native binary via `EvalFile` (verified: `NNUE evaluation using … enabled`). This arms the stretch benchmark bar and the NNUE-teacher datagen path. `tools/` is gitignored.
- **Speed (1 thread, 2M nodes from startpos):** native **1,100k nps** vs wasm **462k nps** → **~2.4× faster**; matching the wasm now costs 2.4× less wall time, and claim-tier 200-game blocks become practical.
- **Env changes shipped:** `scripts/match-arena.mjs` gains `FAIRY_BIN` (native fairy process, otherwise wasm via FAIRY_DIR as before) and `FAIRY_EVAL` (EvalFile for the native fairy). All adjudication still goes through our Game oracle — fairy is a move source only.
- **Sanity:** 2-game arena via FAIRY_BIN, skill 5, 50/50 ms — ran clean, no oracle errors (fairy won both, consistent with equal-time expectations).
- **Not installed here (next ticket's job):** the `variant-nnue-tools` datagen binary (tag `tools-220426`) — training-plan ticket decides the datagen recipe before pulling it.
