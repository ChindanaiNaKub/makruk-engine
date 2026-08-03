# What are the missing search and eval techniques actually worth?

Type: research (AFK — `/research` subagent)
Status: open
Blocked by: —

## Question

This map has two candidate free levers — the classical eval and the search — and no idea what either is worth before spending a session on it. The engine-programming literature has measured Elo values for most of what is missing here. Get them, and adapt them to makruk rather than importing chess numbers whole.

**What this engine already has.** `src/search.rs`: transposition table, quiescence, MVV-LVA ordering, killers, history heuristic, null-move pruning (`R = 2 + depth/6`, correctly skipped in check, at mate-scored beta, while a count is active, and in king+bia material), and late move reductions. `src/eval.rs` (5.1 KB total): material by piece kind, a center-bonus table, a king-safety table, and a counting term. That is all of it.

**What is missing, and the question for each — what is it worth in Elo, at what implementation cost, and does makruk change the answer?**

Search:
- **Transposition table aging / generation counter.** `search.rs:214` replaces on depth alone with no generation, so entries become un-evictable and the table saturates with stale high-depth entries. The rig map's execution log names this "a live strength lever for real play" — it was fixed *in the arena* by clearing per game, which matches what the site does, but within a single long game the saturation is still real.
- Aspiration windows / iterative-deepening window narrowing.
- Principal variation search (PVS / null-window re-search).
- Static exchange evaluation (SEE) for capture ordering and pruning bad captures in quiescence.
- Futility pruning, reverse futility / static null-move pruning, late move pruning.
- Check extensions, and whether makruk's slow pieces make extensions cheaper or more dangerous.

Eval:
- Mobility, and whether it is worth anything in a game where the met moves one square diagonally and the khon moves one square in five directions — mobility counts that are decisive in chess may be nearly constant here.
- Bia (pawn) structure and promotion-race terms; promotion is rank-based at the sixth rank, not the eighth, so passed-pawn logic does not transfer directly.
- Phase interpolation (opening/endgame weight blending) — absent entirely.
- Tempo.
- Whether **texel-style tuning** of the existing constants is worth it, given a 10M-row labelled corpus already exists in `tools/data/` and a logistic fit over a linear eval is minutes of CPU, not a training sweep. This one matters most: it is the cheapest possible way to improve the strongest artifact in the repo, and nobody has ever tuned it.

**Makruk specifics that must shape every answer** — the sole rules authority is markrukthai `shared/engine.ts` + `shared/makrukRules.ts`; pieces are short-range (no long-diagonal bishop, met moves one square diagonally); promotion is at rank six; and the counting rules mean many endgames are decided by a move counter rather than by mate, so endgame eval terms behave unlike chess.

**Deliverable:** a ranked table — technique, expected Elo, implementation cost in hours, makruk-specific caveat — written to `.scratch/makruk-redraw/research/03-technique-values.md`, with primary sources cited (Chess Programming Wiki, engine authors' measured self-play results, TalkChess/CCC threads reporting Elo deltas). Prefer numbers someone actually measured over numbers someone asserted. Flag clearly where no makruk-specific evidence exists and the chess number is being borrowed on faith.

**Cost:** free — reading only, no machine time.

This ticket blocks nothing but informs [What is one classical-eval term worth?](05-what-one-eval-term-is-worth.md) and [What is one search fix worth?](06-what-one-search-fix-is-worth.md). Fire it immediately and in parallel.
