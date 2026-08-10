# Resume — lever 1, the scaling-slope curve

Paused 2026-08-10 evening at the user's request; the machine was needed for other work.
Nothing is lost. Deadline for the whole frozen list is **2026-09-10** (ADR 0003).

## Where it stands

| step | state |
|---|---|
| ADR 0003 written, list frozen, slot 5 swapped | **done, committed** |
| CONTEXT.md — artifact is `(eval, engineId)` | **done, committed** |
| strength-spec §0.2 reindexed by artifact | **done, committed** |
| Power calc — 1,593 games/point, ~4.4 h | **done, committed.** ADR 0002 clause 4 does not fire |
| Subsets built, whole-game verified | **done** (files, gitignored) |
| Arm 1 of 3 trained to convergence | **done** — `out/slopeC-2.5M/last.pt` |
| Arm 2 (5M) | **killed mid-run**, must restart from scratch |
| Arm 3 (10M) | **not started** |
| Three Gate B blocks | not started — 4.4 h arena, user schedules |

## Restart command

Arm 1 is finished. Run only arms 2 and 3 (~1.1 h GPU, machine stays usable):

```sh
training/venv/bin/python -m training.train --data tools/data/slope-5M.jsonl  --epochs 32 --eval-weight 0.85 --out out/slopeC-5M
training/venv/bin/python -m training.train --data tools/data/slope-10M.jsonl --epochs 24 --eval-weight 0.85 --out out/slopeC-10M
```

Do **not** use `set -- $var` or `env $var` in zsh to drive these — zsh does not word-split
unquoted parameter expansions, and it has now silently eaten a run twice in this project's
history (round 5's `MAKURUK_EVAL`, and the first launch of these arms).

## Facts a later session must not re-derive

- **The subsets are nested and split on whole games.** 10M ⊃ 5M ⊃ 2.5M; all 43,764 games
  in `bootstrap-d6.jsonl` are contiguous in the file, verified, so no game is split across
  a boundary. The corpus has 43,764 games, not the 50,029 the spec's round-5 entry claims.
- **The arms train to convergence, not to equal epochs or equal steps.** Both fixed budgets
  bias the slope, in opposite directions. See `power-calc-scaling-slope.md`.
- **`out/slope-*` (no C) are the discarded equal-steps arms.** They are not the curve. Their
  fit numbers run backwards with corpus size; that is a starvation artifact, and fit does
  not predict ladder position on this engine anyway.
- **Arm 1 result, for the record:** `slopeC-2.5M`, 40 epochs, TEST loss 0.0790, acc 0.832,
  evalR2 0.886, cntAcc 0.909. Val had flattened at 0.0799. **This is a fit diagnostic and
  decides nothing** — the stop-bar is Elo on the Gate B blocks.

## What the arena costs when it runs

Three fixed-N Gate B blocks at skill 5, **1,593 games each, ~4.4 h total, ~100 °C peak**.
The machine is unusable throughout. The user has agreed to this spend but schedules it.

Stop-bar, unchanged from ADR 0002 clause 3: **≥ 25 Elo across 2.5M → 10M, monotone across
all three points.** Below it, non-monotone, or unreadable ends the net program.
