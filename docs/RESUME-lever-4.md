# Resume — lever 4, SEE ordering in quiescence

**KILLED 2026-08-12** by Gate A accept-H0. ADR 0003 stop-bar: no iteration, no
“also prune SEE&lt;0”. The search change and `src/see.rs` are reverted; the
measurement stays in the ledger.

## Result

| block | kind | conditions | result |
|---|---|---|---|
| `b0066` | control | 100/100 ms | **47.5%** — PASS (inside SE band) |
| `b0067` | gate-a | SEE-ordered qsearch vs baseline classic, 100/100 ms, concurrency 2 | **45.7% (−26 Elo)**, 40 pairs, LLR −3.01, **REJECT** |

Do not quote −26 Elo as an effect size — SPRT stops when ahead of the boundary.

## What was tested

Quiescence sorted captures by static exchange evaluation (LVA swap-off on the
target square) instead of MVV-LVA. Main-search ordering was untouched. Values
used `Kind::counting_value`. `cargo test --release` green beforehand, including
two SEE unit tests (free capture positive; defended equal trade ≤ 0).

## Prior levers this session

- Lever 1: blocked (no GPU / corpus) — see `RESUME-lever-1.md`
- Lever 3: **killed** (`b0065`, 49.1%) — see `RESUME-lever-3.md` on the
  aspiration branch / PR #2
- Lever 4: **killed** (`b0067`) — this file

## Next on the frozen list

**Lever 5 — classical eval terms.** Levers 2–4 of the search family are now
either already-landed (LMR) or killed (aspiration, SEE).
