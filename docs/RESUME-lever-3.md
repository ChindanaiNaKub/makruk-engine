# Resume — lever 3, aspiration windows + ID reuse

**KILLED 2026-08-12** by Gate A accept-H0. ADR 0003 stop-bar: no iteration, no
different window constant. The search change is reverted; the measurement stays
in the ledger.

## Result

| block | kind | conditions | result |
|---|---|---|---|
| `b0064` | control | 100/100 ms, concurrency 6 | **50.0%** — PASS |
| `b0065` | gate-a | aspirated vs baseline classic, 100/100 ms, concurrency 2 | **49.1% (−6 Elo)**, 27 pairs, LLR −3.00, **REJECT** |

Do not quote −6 Elo as an effect size — SPRT stops when ahead of the boundary.

## What was tested

From depth 4, root search used `score ± 50` cp (CT800's measured window at
depths matching this engine) and re-searched on fail-low / fail-high. Interrupted
aspiration iterations did not commit. `cargo test --release` green beforehand.

## Why this session skipped lever 1

No GPU, no `tools/data/bootstrap-d6.jsonl`, no `out/slopeC-*` in this cloud
environment. Lever 1 remains the live net bet on a machine that can train — see
`docs/RESUME-lever-1.md`.

## Lever 2 note (unchanged)

Late-move reductions already landed in round 4 (`7fff9d4`). Lever 2 has no
remaining single-axis change that is not an iteration on a tested formula.

## Next on the frozen list

**Lever 4 — SEE ordering in quiescence.** Lever 3 is closed.
