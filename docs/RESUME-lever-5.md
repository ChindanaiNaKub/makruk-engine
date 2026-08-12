# Resume — lever 5, classical eval terms

**KILLED 2026-08-12** by Gate A accept-H0. ADR 0003 stop-bar: no iteration.
`src/eval.rs` reverted; the measurement stays in the ledger.

## Result

| block | kind | conditions | result |
|---|---|---|---|
| `b0068` | gate-a | pawn-advance PST fix vs baseline classic, 100/100 ms, concurrency 2 | **50.6% (+4 Elo)**, 39 pairs, LLR −3.10, **REJECT** |

No dedicated control fired (OPP_BIN fingerprint already known from levers 3–4).
Do not quote +4 Elo as an effect size — SPRT stopped rejecting H1 = +30 Elo; the
point estimate sits on a coin flip.

## What was tested

Moved `PAWN_ADVANCE_*` peak (+30) off the unreachable promotion row onto the
last reachable pre-promotion rank (white row 4, black row 3). Zero nps cost.
`cargo test --release` green beforehand.

## Frozen list — end state after this session

| # | lever | outcome |
|---|---|---|
| 1 | scaling-slope curve | **blocked** — no GPU/corpus (user skipped env action) |
| 2 | LMR | already landed round 4 — no remaining single-axis change |
| 3 | aspiration windows | **killed** `b0065` |
| 4 | SEE qsearch ordering | **killed** `b0067` |
| 5 | classical eval terms | **killed** `b0068` |

Bound 2026-09-10. Lever 1 can still run on a machine with the corpus; until then
the list’s executable half is exhausted.
