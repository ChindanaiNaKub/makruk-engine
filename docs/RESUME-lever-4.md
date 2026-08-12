# Resume — lever 4, SEE ordering in quiescence

Started 2026-08-12 after lever 3 was killed at Gate A (`b0065`).

## What this lever is

Quiescence previously ordered captures with MVV-LVA via `order_moves`. Lever 4
replaces that, in qsearch only, with static exchange evaluation: each capture is
scored by the material that survives a least-valuable-attacker recapture sequence
on the target square. Main-search ordering is untouched (still MVV-LVA + killers
+ history). Values use `Kind::counting_value`, so this is a pure ordering change.

## Stop-bar (ADR 0003)

Gate A SPRT against the classical-eval incumbent at the parent commit, elo0 = 0,
elo1 = 30.

- accept-H1 → **land**
- accept-H0 → **kill**, no iteration, no "SEE with pruning too"

## Prior levers this session

- Lever 1: blocked (no GPU / corpus) — see `RESUME-lever-1.md`
- Lever 3: **killed** (`b0065`, 49.1%, LLR −3.00) — see `RESUME-lever-3.md`
