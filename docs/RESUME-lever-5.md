# Resume — lever 5, classical eval terms

Started 2026-08-12. Lever 1 remains blocked (user skipped GPU/corpus setup).
Levers 3 and 4 were killed at Gate A this session.

## What this lever is

`PAWN_ADVANCE_*` put a +30 peak on the promotion row itself. Unpromoted bia
never sit there — promotion is automatic on landing (`Color::promotion_row`) —
so the peak fired **0/40,000** positions in the redraw research corpus. Lever 5
moves the peak to the last reachable pre-promotion rank (white row 4, black
row 3). Zero nps cost: same table lookup, different immediate.

Counting-multiplier retune (`b0054`) and king-safety isolation already failed
or died on free evidence under redraw ticket 05; ADR 0003 forbids iterating
those. This is a different classical-eval axis (dead/unreachable PST slot).

## Stop-bar (ADR 0003)

Gate A SPRT vs classical-eval incumbent at the parent commit, elo0 = 0,
elo1 = 30.

- accept-H1 → **land**
- accept-H0 → **kill**, no iteration, no “also fix king-safety colouring”
