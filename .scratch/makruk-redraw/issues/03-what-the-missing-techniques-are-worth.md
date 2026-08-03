# What are the missing search and eval techniques actually worth?

Type: research (AFK — `/research` subagent)
Status: resolved (2026-08-03)
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

---

## Resolution (2026-08-03)

**Deliverable:** [`../research/03-technique-values.md`](../research/03-technique-values.md) — 16 techniques ranked by
Elo per implementation hour, every row tagged by evidence class, plus two independent chess-literature sweeps folded
in as second and third sources.

**Cost overrun, stated:** the ticket said "free — reading only, no machine time." The work used **~4 minutes of one
core** for corpus measurements against `tools/data/`. Trivial, no lockout, but not what was promised.

### Three things the ticket got wrong

1. **Check extensions are already implemented** — `src/search.rs:271`, applied at `depth - 1 + ext` on lines 336 and
   341. Verified in source. The ticket listed them as missing; the live question is whether the *unconditional,
   unlimited* form is safe.
2. **The biggest eval finding was not on the list.** `counting_term()` (`src/eval.rs:130`) returns 0 while
   `game.counting` is `None`, so the eval is blind to the *approach* of a count. Measured on this repo's corpus with
   material edge and piece count held fixed: at a 400–700 cp edge with 4–8 pieces, the stronger side scores **92.3%**
   while any unpromoted bia remains and **62.0%** once they are gone — a **30-point swing the eval cannot see.** No
   chess analogue exists, so no borrowed number could have suggested it.
3. **"Real play is one long game" is half right.** `src/uci.rs:43` clears the TT on `ucinewgame` and the site sends it,
   so between-game saturation is handled. Within one game it is not.

### The recommendation: build the eval tuner first

Not the top of the Elo/h ranking, and the deliverable argues the disagreement openly. The case: retuning the existing
constants improves held-out loss by **−4.08%** on a by-game split, meaning **the shipped positional terms predict game
results worse than deleting them** — bug-shaped, not optimisation-shaped. It costs zero nps. And it builds the
instrument that prices every other eval row against held-out loss before spending an arena game.

### The correction that matters most — its own headline result was wrong

A peer session challenged the tuned piece values, and **the challenge holds**. `src/eval.rs:72` is
`Kind::M | Kind::PM => 200` — met and promoted bia share a match arm **because they are the same piece.** The fit
moved them independently to **112 and 96**, and per-phase to **168 and 8**. A 21× gap in the opening between two
pieces the source treats as identical is a parameter-identifiability failure, not a value discovery — exactly what
H.G. Muller predicts when a corpus of ordinary games has near-balanced material.

The pattern confirms it: **rua moved 500 → 652, toward the published band** where Fairy-Max (630), SjaakII (625) and
Makruk-Stockfish (676) agree, because the rua appears in lopsided endgames. The met almost never does.

**What survives:** the −4.08% held-out gain, and "build the tuner first" — now better supported, since the instrument
needs constraints the argument could not have found without it. **What does not:** every per-piece number, and with
it §M2's "compressed piece values" argument, which was the *sole* justification for ranking SEE 15th.

### Consequences for the map

- **SEE pruning is contested, not settled.** Two independent ~1.2 M-nps engines measure qsearch SEE at **+52/+36 STC**
  (Lynx) and **+36/+25 STC** (Weiss), and it **grows at short time control** — the favourable direction here. Its
  demotion in the deliverable rested on the piece-value argument that just fell.
- **TT aging is over-ranked** — *and the follow-on advice was then retracted, see below.* The three isolated
  measurements are **+6.5 / +2.2 / +2.0**, and Lynx measured it **negative twice**. Value tracks hash size relative to
  fill, not depth.
- **Model pruning gates on Ethereal, not Stockfish.** Ethereal's are all ≤10 so every one fires inside a depth-8
  ceiling; Stockfish's mostly do not (check ext `depth > 9`, IID `depth >= 7`, ProbCut `depth >= 8`).
- **Ablation and addition Elo are different measurements.** RFP is +57 by addition and −32 by ablation. For a sparse,
  shallow engine the addition numbers transfer.

### Third pass: the makruk literature exists, and it moved the table again

Two further corrections landed after the peer sweep, both from primary sources, both verified against this repo's own
constants. The deliverable is now **18 rows, not 16**, and carries a `[K]` evidence class — *measured by someone else,
on makruk*.

**I retracted my own TT recommendation.** I had written "fix the replacement scheme before adding an age field."
H.G. Muller's sizing rule kills it: replacement policy cannot register unless the search tree is **≥10× the table**.
Ours is **885k nps × 100 ms ≈ 88,500 nodes/move against `TT_SIZE = 1 << 18` = 262,144 entries — 0.3×.** The table is
three times larger than the entire tree for a move. Replacement policy *and* aging both measure ~0 within a search.
What keeps the row alive at all is makruk's game length — ~30k stores/move × ~100 moves ≈ 3M stores into 262k slots
≈ **11×** — but that is a cross-move claim, much narrower than the one I started with. TT aging fell from rank 5 to
**rank 14**.

**There is exactly one makruk-measured Elo figure in the entire literature, and it is about our own code.** Evert
Glebbeek (SjaakII) replaced `if (in check) depth++` with `if (move gives check && see >= 0) extension = 1` and gained
**+18 Elo in self-play, in makruk**. `src/search.rs:271` is that naive form verbatim. But `grep -rn "SEE" src/*.rs`
returns only `game.rs`'s zobrist `SEED` — **we have no SEE at all**, so the +18 is unreachable until SEE is written.
That raises **SEE's** value (it is now the precondition for the only makruk number in the document), not the check
extension's.

**Four published makruk piece tables now exist as an external check on the fit** (§K1). Fairy-Max 181/300/450/630,
SjaakII 187/344/406/625, Makruk-Stockfish mg 159/312/412/676 and eg 192/293/386/645, all at bia = 100. My rua **652
lands inside the published 625–676 band** — real validation on the one piece the corpus has signal for. My met **112
is below every published source** (consensus 150–192). And **the shipped table is the outlier of the whole set**:
highest met (200), lowest rua (500). It is the counting-rule adjudication table pressed into service as a
playing-strength table.

**The identifiability failure is a documented trap, not a novel finding** (§K3). hgm and jdart, *"Texel tuning for
piece values"*: in ordinary games material is near-balanced, so there is nearly no signal separating piece values and
the fit collapses them onto whatever fits the sigmoid positionally. jdart stopped tuning piece values outright.
**Prescription: split the tuning job.** Positional terms on `bootstrap-v2`, where the measured −4.08% actually lives
and the problem is well-posed; piece values *not* from this fit — leave them, move them toward the published
consensus, or seed an imbalance corpus and fit them properly. That last is new datagen and needs its own costed
ticket.

**Lower held-out loss is not Elo, and lower loss is exactly my evidence** (§K4). Zurichess measured **−28 Elo despite
a lower MSE** (0.0559 vs 0.0573); iCE measured −20 to −24 because the optimiser zeroed small true terms — betting on
a draw minimises MSE. Petzke's failure mode is visible in my own §A5 output: king safety driven wholly negative, bia
advance to zero. **Do not ship the fit unmeasured.**

**A working counting-aware eval exists, and it is not Fairy-Stockfish** (§K5). Fairy-Stockfish consumes `CountingRule`
only in `is_optional_game_end() → VALUE_DRAW`; zero hits across `evaluate/search/material/endgame`. Makruk-Stockfish
*scales* the win score by remaining count. **Scaling is the better shape than our additive `counting_term()`** — a won
position should decay toward zero as the clock closes, not take a fixed offset. Neither engine has anything like the
§A3 counting-gate finding, so §E1 stands as novel. Also: the ultimate count can start *below* the current count, an
automatic draw — **in makruk more material can be strictly worse**, modelled by nobody.

**And the KMITL fog patch now has a citable source** (§K6). Tudsuan & Thanatipanonda (2026), *"Building Makruk Endgame
Tablebases"*: the 44-move pieces'-honour limit drops khon + promoted-bia vs bare khun from **85.77% to 83.49%**,
eliminating 278,040 positions needing more than 41 moves, including mates up to 57 long.

**Table movements:** PVS 12th → **2nd** (+56.2 Blunder, +54.2 Rustic, independently) — but it measured **−12.7 over
4,311 games** under a buggy move scorer, so it is an ordering *amplifier*: **verify move ordering before measuring
it.** Aspiration windows now cite CT800's **+18 over 10,000 games at a stated depth of 8–10**, depth-matched to this
engine, rather than an ablation from a deeper one. New rows: SEE-gated check extension (7), met-pair bonus (16).

### What this ticket hands forward

This ticket blocks nothing. It informs [What is one classical-eval improvement actually worth?](05-what-one-eval-term-is-worth.md)
and [What is one search improvement actually worth?](06-what-one-search-fix-is-worth.md), both of which now have prices
to test rather than guesses to argue, and it graduated
[Is the eval tuner a trustworthy instrument?](09-is-the-eval-tuner-trustworthy.md) out of the fog — the falsification
test that decides whether the recommendation this ticket makes can be acted on at all.
