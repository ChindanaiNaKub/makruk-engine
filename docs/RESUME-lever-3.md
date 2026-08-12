# Resume — lever 3, aspiration windows + ID reuse

Started 2026-08-12 on a cloud agent because lever 1 is blocked here (no GPU, no
`tools/data/bootstrap-d6.jsonl`, no `out/slopeC-*`). ADR 0003 triage order is
respected: lever 1 stays the live net bet on a machine that can train; this
session advances the next *executable* search lever.

## What this lever is

`src/search.rs` iterative deepening previously searched every depth with a full
`[-INF, INF]` window. Lever 3 narrows the window to `score ± 50` cp from depth 4
upward (CT800's measured +18 Elo setup at depths that match this engine) and
re-searches on fail-low / fail-high. The previous iteration's score seeds the
window; the TT already carries the PV move forward (the "ID reuse" half).

An interrupted aspiration re-search no longer commits: a truncated tree must not
overwrite a completed shallower result.

## Stop-bar (ADR 0003)

Gate A SPRT against the classical-eval incumbent at the parent commit, elo0 = 0,
elo1 = 30, α = β = 0.05.

- accept-H1 → **land**
- accept-H0 → **kill**, no iteration, no different window constant

## Lever 2 note

Late-move *reductions* already landed in round 4 (`7fff9d4`). Lever 2 on the
frozen list therefore has no remaining single-axis change that is not an
iteration on a tested formula — which ADR 0003 forbids by name. It stays on the
list until explicitly retired in a follow-up doc commit; this session does not
touch it.

## Lever 1 reminder

See `docs/RESUME-lever-1.md`. Arms 2–3 and the three Gate B blocks still need the
laptop (or a GPU cloud env with the corpus).
