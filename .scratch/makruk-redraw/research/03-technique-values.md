# What are the missing search and eval techniques actually worth?

Research ticket: [03](../issues/03-what-the-missing-techniques-are-worth.md) · closed 2026-08-03
Cost: reading, plus ~4 min of one core for the in-ticket corpus measurements (§A). No arena, no training, no lockout.

---

## Read this first: three things the ticket got wrong

1. **Check extensions are already implemented.** `src/search.rs:271` — `let ext: i16 = if in_check { 1 } else { 0 }`, applied at
   `depth - 1 + ext` on line 336 and again on the LMR re-search at line 341. The ticket lists them as missing. They are not.
   The open question is not whether to add them but whether the *unconditional, unlimited* form here is safe (§S7).

2. **The single biggest eval finding is not on the ticket's list.** It is the **counting-gate blindness** in
   `src/eval.rs` (§E1). Measured on this repo's own corpus, holding material edge *and* piece count fixed: at a
   400–700 cp edge with 4–8 pieces on the board, the stronger side scores **92.3%** while any unpromoted bia remains
   and **62.0%** once they are all gone — a **30-point** swing the eval cannot see, because `counting_term()` returns
   0 until `game.counting` is already `Some`. This has no chess analogue at all, so no chess number could ever have
   suggested it.

3. **"Real play on the site is one long game" is half right.** `src/uci.rs:43` clears the TT on `ucinewgame`, and
   `browserEngineBotWorker.ts:118` sends it (AGENTS.md). So the between-games saturation is already handled. What is
   *not* handled is within one game — and makruk makes that worse than chess, not better (§S1).

---

## Ranked table — strictly by Elo per implementation hour

Elo estimates are **against this engine's own previous build at movetime 100**, i.e. Gate-A-shaped, not ladder-shaped.
Elo/h uses the midpoint of the range. See "Two warnings" below before spending any of these numbers.

**Evidence class** is the column to read first: **[M]** measured here on makruk data, **[R]** measured in this repo
previously, **[S]** structural — derived from reading this source, **[B]** borrowed from chess and unvalidated here.

| # | Technique | Elo | Hours | **Elo/h** | Ev. | Source of the Elo number | Makruk caveat |
|---|---|---|---|---|---|---|---|
| 1 | Reverse futility / static null-move pruning | +25 to +55 | 1 | **40** | **[B]** | **Blunder +57.1 ± 16.9 / 1,209 games**, SPRT accepted [1]. Note: **no SPRT evidence on TalkChess** — rests on engine logs | Must carry the counting guard, same as NMP — a passive position under a closing count is *losing on the clock*, not neutral (§S2) |
| 2 | **SEE** (qsearch pruning + capture ordering) | +20 to +50 | 4 | **9** ⟶ see note | **[B]** | **Lynx +51.98 ± 16.22 STC / +34.56 LTC; Weiss +35.73 ± 12.73 STC; Ethereal ablation −41.54 ± 2.98 / 22,637; Blunder +25.9 ± 12.8** [1][5][20] | **Promoted, and my earlier demotion was wrong** (§K3). Grows at *short* TC — our direction. Ethereal's gate is depth 10, so it fires inside depth 8. **Also the prerequisite for row 3** |
| 3 | **Gate the existing check extension on SEE ≥ 0** | **+18** | 1 (after SEE) | **18** | **[K]** | **+18 Elo self-play, measured *in makruk*** by Evert Glebbeek [6] | **The only Elo number here measured on makruk by anyone but me**, and `search.rs:271` is exactly the naive `if (in check) depth++` he replaced. Rows 2+3 together: **+38 to +68 for 5 h** |
| 3 | Late move pruning (move-count) | +15 to +40 | 1 | **28** | **[B]** | **Blunder +21.9 ± 11.4 / 2,000** [1]; **Dumb 1.9 ablation `no_lmp` −43.9 ± 4.7 / ~11,000 games** [5] | Branching factor **22.8** vs chess's ~35 (§A1) — shorter tail to prune, so expect the low end; retune the count thresholds |
| 4 | Futility pruning (frontier nodes) | +15 to +35 | 1 | **25** | **[B]** | **Blunder +37.4 ± 13.4 / 1,780 games**, SPRT accepted [1] | Same counting guard. Blunder measured it *after* static null-move, so the two were additive there, not redundant |
| 5 | Delta pruning in quiescence | +0 to +25 | 0.5 | **25** | **[B]** | **Contested.** One TalkChess report +80 (500 games) its own author doubted; another found strength *decreased* [4] | **Danger, makruk-specific**: sources warn to disable it in late endgames for insufficient-material blindness — makruk's *counting* endgames are that failure mode with a clock (§S5) |
| 6 | **Counting-gate eval term** (unpromoted bia blocks counting) | +20 to +60 | 2 | **20** | **[M]** | **Measured here** (§A3) | Makruk-only. No chess literature exists or could. **30-point** swing at a 400–700 cp edge, piece count fixed |
| 7 | **Principal variation search (PVS)** | +10 to +25 | 1.5 | **12** | **[B]** | Blunder **+56.2 ± 13.8**, Rustic **+54.2 ± 16.6** — **but only +13.9 ± 10.8 once LMR is already present** [2], and **−12.7 ± 9.0 / 4,311 games** with a buggy move scorer | We already have LMR *and* null-window LMR re-searches, so take the **+13.9**, not the +55. PVS prices your move ordering, not itself |
| 8 | **Dead `PAWN_ADVANCE` slot + colour-blind king safety** | +0 to +15 | 0.5 | **15** | **[M]** | **Measured here** (§A4) | `PAWN_ADVANCE[5]=30` fired **0/40,000** — unreachable *because* promotion is at rank six |
| 9 | Capture-only movegen for quiescence *(off-ticket)* | +20 to +50 | 3 | **12** | **[S]** | Structural (§S6), priced via **~66 Elo/ply** (Ferreira 2013: Houdini 2894@20ply → 1966@6ply, ~linear) [3] | Largest nps lever in the engine; qsearch generates all legal moves then discards ~90% |
| 10 | **Texel-tune the existing eval constants** | +40 to +120 | 5 | **16** | **[M]** | Loss −4.08% held out, **measured here** (§A5). First-ever tunings elsewhere: **Osterlund/Texel 99.6 over 32k games/term**, chess22k **+137**, chess4j **~120**, RofChade **+75–80**, Weiss **58.1 ± 4.5**, Blunder **60.9 ± 17.5** [9] | **Do not trust the piece values this fit produces** — see §K1. Tune the positional terms; seed a separate imbalance corpus for material |
| 11 | Aspiration windows | **+18** | 2 | **9** | **[B]** | **CT800 +18 (52.5%) over 10,000 games, −50 cp window from depth 4, at a TC where "the usual depth is 8-10 plies"** [7] — *depth-matched to this engine*. Ignore Dumb's −69.9 (TC unstated) [5] | Delorme: *"aspiration windows is a generic term… Not all of them are worth 70 Elo."* §S9 |
| 12 | Tempo | +0 to +5 | 0.25 | **10** | **[B]** | **Blunder +4.2 ± 9.0** (bundled with rook eval) [1]; **Stockfish deleted tempo entirely in 2021 and it passed non-regression** [10] | Weakest row in the document. Fold it into the tuner as a free parameter rather than spending an hour on it (§E7) |
| 13 | **TT "undercut" replacement fix** (not an age field) | **~0 to +10** | 0.5 | **10** | **[R]** | This repo's 17.6 pts / 4.0σ across *games* (§S1). Isolated aging elsewhere: Weiss **+2.23 ± 2.32 / 41,720**, Berserk **+1.99 ± 1.26 / 117,092**, Lynx **−8.4 and −0.2** [20] | **Heavily downgraded — see §X3.** At 88.5k nodes/move into 262,144 slots the table is **3× the tree**, so replacement policy cannot register within a search. Only cross-game accumulation is real, and **undercut** fixes it in a few lines |
| 15 | **Phase interpolation (tapered eval)** | +20 to +60 | 3 | **13** | **[M]** | **Measured here**: 1.38% *further* loss beyond tuning (§A6). Chess: **Rustic +248**, MadChess **+107**, PeSTO-into-TSCP **~+200** [10] — but **always bundled with the retune it requires** | Phase is **bimodal** here (28.2% >20 pieces, 48.6% ≤10). **Makruk-Stockfish's met *gains* 25% into the endgame** — opposite of chess, and opposite of my own fit (§K1) |
| 16 | **Met-pair bonus** (makruk's bishop-pair analogue) | +0 to +15 | 1 | **8** | **[K]** | **Precedent, not a number**: Makruk-Stockfish ships `queen_pair()` in imbalance slot 1000 [11]. No isolated Elo published | Two mets cover both square colours; one met is colour-bound forever. Muller: colour-binding "is the main thing that makes the Ferz so useless" [12] |
| 17 | **Mobility — rua curve + a 0/1-move penalty for everything else** | +5 to +20 | 2 | **6** | **[M]** | **Measured here** (§A2). Chess: Blunder **+27.6**, MadChess **+64**, Stash pin-aware **6.15 ± 4.50** [1][10] | **Do not port per-piece mobility.** For a 1-step mover mobility *is* a PST (§K2). Muller: "whether it has 0 or 2 moves makes a heck of a difference" [12] |
| 18 | Bia structure (doubled / connected / passed) | +0 to +10 | 2 | **3** | **[M]** | **Measured here** (§A2). Chess figures are far larger — Blunder passed pawns **+36.1 ± 13.2**, MadChess **+72** [1][10] — and **do not transfer** | Promotion yields a *met*, worth ~0–100 cp not +800 (§M3, §E6). The clearest case in this document of a chess number that would mislead |

Evidence classes: **[M]** measured here on makruk data · **[R]** measured previously in this repo · **[K]** measured by
someone else **on makruk** · **[S]** structural, from reading this source · **[B]** borrowed from chess, unvalidated here.

### Three things the literature changed after I first drafted this table

1. **PVS went from "small delta" to +55, and the spec's reasoning was wrong.** `docs/strength-spec-v1.md:311` argues
   PVS is a small delta *because* the LMR re-searches are already null-window. Two independent engines measured
   ~+55 [2]. But the same source shows PVS measuring **−12.7 ± 9.0 over 4,311 games** when the move scorer had a bug —
   it is an ordering amplifier, not a standalone gain. Our ordering (TT move, MVV-LVA, killers, history) is the
   right shape, but nothing has ever verified it. **Verify ordering, then do PVS.**

2. **TT aging fell from rank 3 to rank 14.** H.G. Muller: *"there isn't much replacement when the search tree is not
   at least 10x larger than the table"* [8]. At 885k nps × 0.1 s ≈ 88k nodes/move against 262,144 slots, a single
   move's tree is **0.3×** the table — replacement policy cannot matter within one search. Practitioners who measured
   a gain had to shrink the hash to ~1 MB to find it. **What keeps this row alive at all is makruk's game length**
   (§S1): ~30k stores/move × ~100 moves ≈ 3M stores into 262k slots ≈ **11×**, which is exactly Muller's threshold —
   but reached across a game, not within a move. That is a narrower and less certain claim than the one I started with.

3. **There is exactly one makruk Elo measurement in the entire literature, and it is about this engine's own code.**
   Evert Glebbeek replaced a naive `if (in check) depth++` with `if (move gives check && see >= 0) extension = 1`
   and gained **+18 Elo in self-play — in makruk** [6]. `src/search.rs:271` is the naive form, verbatim. Row 7.

### The ranking's own biggest weakness, stated plainly

**Five of the top six rows are [B] — borrowed chess numbers.** They rank high partly because their *denominators* are
small. Elo-per-hour systematically rewards cheap techniques whose numerators are least trustworthy, and this project's
stated history is of being burned by numbers that measured something other than what they claimed.

Read the table two ways:

- **By raw Elo/h** (as the ticket asks): RFP, PVS, LMP. ~3.5 hours for a claimed +70 to +150.
- **By Elo/h among rows measured on makruk** ([M]/[R]/[K]): counting-gate term (20), check-extension gating (18),
  dead-constant cleanup (15), Texel tuning (11), phase interpolation (7), rua mobility (6).

**I would start with Texel tuning even though it ranks 10th.** Reasons in §"Which one I would do first" — the short
version is that it is the only item that builds the instrument that prices most of the others.

### Two warnings about every number below

**W1 — This repo has already measured that self-play Elo does not convert to ladder movement.** Round 4 added null-move
pruning + LMR, went **6W–0L–5D against its own previous binary**, and delivered **one extra draw against fairy skill 10**
(AGENTS.md; `docs/strength-spec-v1.md` §Execution log, "What this means for the lever ranking"). Every Elo figure in the
table is the *self-play-shaped* number the literature reports. Treat Gate B movement as a separate, unproven claim.

**W2 — This engine searches at depth 8, and most published Elo figures come from engines at depth 20+.** Where a
technique's gain is a constant fraction of tree size (PVS, aspiration, SEE ordering) it discounts roughly with depth;
where it is a per-node margin test (RFP, LMP, futility, delta) it does not, and may even be worth *more* shallow.
The table's rankings already apply this discount; the per-technique sections say which side each falls on.

---

## A. What I measured on this repo's own corpus

All of §A is **first-party measurement on makruk data**, not borrowed. Method: sample every 53rd row of
`tools/data/bootstrap-v2.jsonl` (10M rows, fairy self-play, adjudicated by our own oracle), reconstruct the position,
compute features with a JS mirror of `src/eval.rs` + `src/movegen.rs`. Texel target is the stored `wdl` label
(side-to-move relative game result — verified: ply 0 white = `w`, ply 1 black = `l` in a `5-0` game).
**Holdout is split by game, not by position** (9,923 distinct games; ~4 sampled positions per game), so the
train/test split is not leaking positions from the same game.

Scripts are in the session scratchpad, not committed — they are throwaway probes, and anything acted on should be
re-derived in Rust against the real `evaluate_board` (see §E5 on mirror drift).

### A1. Mobility distribution — the makruk answer to "is mobility nearly constant here?"

20,000 positions, per-piece pseudo-legal move counts:

| piece | mean | sd | min | max | sd/mean | share of total board mobility |
|---|---|---|---|---|---|---|
| Rua (R) | 6.54 | 4.17 | 0 | 14 | **0.638** | **27.8%** |
| Khun (K) | 5.80 | 1.81 | 1 | 8 | 0.312 | 25.3% |
| Ma (N) | 4.25 | 2.20 | 0 | 8 | 0.518 | 16.1% |
| Khon (S) | 3.25 | 1.18 | 0 | 5 | 0.363 | 13.1% |
| Met (M) | 2.73 | 0.96 | 0 | 4 | 0.351 | 5.4% |
| Promoted bia (PM) | 3.17 | 0.91 | 0 | 4 | 0.288 | 3.6% |
| Bia (P) | 0.76 | 0.53 | 0 | 3 | 0.697 | 8.7% |

Side-to-move total pseudo-legal moves: **mean 22.80, sd 10.03, range 3–53.**

**The ticket's hypothesis is confirmed but needs sharpening.** Met mobility is not literally constant (sd 0.96) — but
its entire dynamic range is 4 squares, 60% of mets sit at 3 or 4, and 46% of promoted bia are at the maximum of 4.
The met/khon/PM mobility terms are measuring almost nothing. The rua is the only piece with chess-like mobility
variance, and it is also the only piece that slides.

### A2. Which candidate eval terms carry signal — partial correlation with game result, after controlling for material

| candidate term | partial r vs result |
|---|---|
| **rua mobility** | **+0.123** |
| bia advancement (`biaRow`) | +0.032 |
| bia one step from promotion | +0.031 |
| connected bia | +0.031 |
| doubled bia | +0.018 |
| centre bonus, 25-value ring | +0.004 |
| king-safety 20-value squares | +0.009 |
| centre bonus, 15-value ring | **−0.017** |
| ma mobility | **−0.021** |
| khon mobility | **−0.032** |
| met mobility | **−0.075** |
| promoted-bia mobility | **−0.110** |

Two readings, and I flag both as correlational (partial correlation after a linear material control does not
establish causation, and short-range mobility is entangled with "how empty the board is"):

- **Mobility in makruk is a rua term and nothing else.** The chess mobility framework — which is carried by bishop,
  rook and queen rays — has exactly one piece to attach to here.
- **The negative signs on met/PM mobility are probably a phase proxy, not a real anti-mobility effect.** A met with
  4 free squares is a met on an emptying board. Do not implement a negative mobility bonus on the strength of this.

### A3. The counting gate — the largest finding in this ticket

`src/counting.rs:98` — `if has_unpromoted_pawns(board) { return None; }`. **While any unpromoted bia of either colour
remains on the board, board-honour counting cannot start at all.** The moment the last one is captured or promoted,
the weaker side gets a 64-move draw clock.

The eval knows nothing about this. `counting_term()` (`src/eval.rs:129`) returns 0 unless `game.counting` is already
`Some` — it prices the clock once it is running and prices the approach to it at zero.

60,000 positions, grouped by side-to-move material edge, split on whether *any* unpromoted bia is on the board:

**Material AHEAD:**

| material edge | bia on board (n / score) | no bia (n / score) | delta |
|---|---|---|---|
| 50–200 | 5658 / 57.5% | 1030 / 53.4% | +4.0 pts |
| 200–400 | 3990 / 70.0% | 3946 / 53.4% | **+16.6 pts** |
| 400–700 | 3699 / **89.5%** | 1432 / **62.3%** | **+27.2 pts** |
| 700–1200 | 2120 / 98.1% | 476 / 72.5% | **+25.6 pts** |

**Material BEHIND** (mirror image, as it must be):

| material deficit | bia on board | no bia | delta |
|---|---|---|---|
| 200–400 | 34.2% | 46.6% | −12.4 pts |
| 400–700 | 12.9% | 37.7% | **−24.9 pts** |
| 700–1200 | 2.9% | 29.4% | **−26.5 pts** |

23.2% of sampled positions already carry a counting state.

**It is not a piece-count artifact.** The obvious objection is that "no unpromoted bia" is a proxy for "fewer pieces,
later game, more drawish". So I re-ran it (120,000 positions, stride 29) holding **both** material edge and total
piece count fixed:

| material edge | pieces on board | bia on board (n / score) | no bia (n / score) | delta |
|---|---|---|---|---|
| 400–700 | 4–8 | 2443 / **92.3%** | 2468 / **62.0%** | **+30.4 pts** |
| 400–700 | 8–12 | 2311 / 88.0% | 115 / 57.4% | **+30.6 pts** |
| 200–400 | 4–8 | 1332 / 64.1% | 3322 / 57.5% | +6.6 pts |
| 200–400 | 8–12 | 1989 / 70.2% | 313 / 55.9% | +14.3 pts |

The effect **grows** under the control rather than shrinking. Above 12 pieces the no-bia cell is empty by
construction — you cannot have 16 pieces and no unpromoted bia this early — which is itself the point: this is
strictly an endgame term.

Naive significance on the top row is 53.9σ; the honest figure is smaller, because positions within one game share a
label and are correlated (~4–7 sampled positions per game), so divide by roughly 2–2.6. Call it **>15σ**. Either way
it is not noise.

**What it means.** A won makruk endgame is worth roughly *a third less* once the last bia leaves the board, and the
engine's eval is flat across that boundary. The stronger side should pay material to keep an unpromoted bia alive;
the weaker side should pay material to clear the last one off. Neither behaviour is reachable from the current eval.

**Remaining confounds.** (a) Positions where a big edge failed to convert are over-represented in the no-bia bucket
by selection — this inflates the magnitude but cannot invert the sign. (b) The corpus is fairy self-play, so fairy's
own handling of the rule shapes which positions appear. **But the mechanism is not statistical, it is a rule** — a
hard branch at `counting.rs:98` — so the direction is not in doubt even if the magnitude is.

**And one bias that runs the other way.** `datagen.mjs:325`/`:375` discard every row from games that hit the 400-ply
abort. Those are precisely the unconverted games that would have populated the no-bia/drawish bucket, so excluding
them makes the measured 30-point gap **conservative**.

This is also direct evidence for the map's open question *"Is the net's edge general, or concentrated in counting
endgames?"* — the net carries ~10 counting side-channels; classic has one term that fires late. If the net's depth-6/7
advantage is concentrated here, this term is the cheap way to buy it back.

### A4. `PAWN_ADVANCE[5] = 30` is unreachable code

`src/eval.rs:37` — `PAWN_ADVANCE_WHITE: [i32; 8] = [0, 0, 0, 5, 15, 30, 0, 0]`. Index 5 is row 5. But
`Color::White::promotion_row()` **is** row 5 (`src/board.rs:36`), and `movegen.rs:195` promotes a bia the instant it
lands there. A white `Kind::P` on row 5 cannot exist. Same for `PAWN_ADVANCE_BLACK[2] = 30`.

**Fired 0 times in 40,000 sampled positions.** So the largest bia-advance bonus — the one that should reward being
one step from promotion — never applies, and the actual one-step-from-promotion square (row 4) gets only 15.
The promoted bia that results gets **no** advance term at all, only the centre bonus.

This is a rank-6-promotion bug: the table was written with an 8-rank promotion in mind.

### A5. Texel tuning — how much is actually on the table

Objective: standard Osterlund mean-squared error of `sigmoid(score/K)` against the game result, K fit by scan.
**K = 0.45** for this eval's scale. Coordinate descent, integer steps, 8 passes, ~13 s on one core for 40k positions.

| variant | held-out (by game) test E | reduction |
|---|---|---|
| current eval, as shipped | 0.086646 | — |
| **material only, untuned** (all positional terms deleted) | **0.086152** | **−0.57%** |
| retune existing constants only, no new terms | 0.083112 | **−4.08%** |
| add new terms only, existing constants frozen | 0.083634 | −3.48% |
| both | 0.082876 | −4.35% |
| both, with per-phase weight sets (§A6) | 0.081734 | −5.67% |

Train reduction 4.34% vs test reduction 4.35% — **no overfitting**, which is what 9,923 distinct games buys.

Correlation with game result: current eval **0.5558**, material alone **0.5576**, tuned eval **0.5789**, and the
stored fairy teacher label itself **0.5821**. **Tuning takes the classical eval from below material-only to within
0.003 of the depth-labelled teacher.**

**Read that second row again.** The centre bonus, king-safety table and bia-advance table, at their shipped values,
are jointly *worse than nothing* for predicting the game result. That is a stronger statement than "untuned" — the
constants are mis-signed or mis-scaled, not merely imprecise.

The tuned constants (existing terms only, holdout fit):

| constant | shipped | tuned | note |
|---|---|---|---|
| Rua | 500 | **652** | |
| Ma | 300 | 284 | |
| Khon | 250 | 226 | |
| **Met** | **200** | **112** | biggest single change |
| **Promoted bia** | **200** | **96** | ≈ an unpromoted bia |
| centre 5 / 15 / 25 | 5 / 15 / 25 | 13 / 19 / 35 | centre wants to be *stronger*, not weaker |
| bia advance row 3 / row 4 | 5 / 15 | −9 / −3 | wants to be deleted or inverted |
| king safety 20 / 15 / 10 / 5 | 20 / 15 / 10 / 5 | −6 / −5 / −34 / +9 | wants to be deleted (see §E4) |

**Where the piece values come from matters.** `eval::kind_value()` (`src/eval.rs:67`) is a byte-for-byte copy of
`Kind::counting_value()` (`src/board.rs:56`), which is the **counting-rule material table from
`shared/makrukRules.ts`**. That table decides *who is the weaker side for board-honour counting*. It was never a
playing-strength table, and it has been doing a job it was not written for. The two functions are already separate,
so retuning `kind_value` cannot break the rules port — a fact worth stating explicitly before anyone touches it.

### A6. Phase interpolation, measured

Fitting separate weight sets for >20 pieces / 11–20 / ≤10 and evaluating on the by-game holdout gives **1.38% further
loss reduction** beyond the single tuned set — real, but roughly a third of what plain tuning gives, at double the
eval cost and triple the tuning cost.

Corpus phase mix: **28.2%** of positions >20 pieces, **23.2%** 11–20, **48.6%** ≤10. That is a far more
endgame-heavy distribution than a chess corpus, consistent with makruk games running 220–330 plies (AGENTS.md).

Per-phase piece values (opening / endgame): Rua 500/628, Ma 292/252, Khon 202/210, **Met 168/80**, **PM 8/72**.
Rua mobility by phase: opening +1, middlegame +10, endgame −2 — **the rua-mobility signal lives in the middlegame**,
which is exactly where a closed makruk opening (bia walls on rank 3, three empty ranks between) finally opens up.

Caveat: the per-phase fits train on 7.5k / 6.1k / 13k positions each and are noisier than the global fit. The
opening Rua value did not move from 500 at all — in the opening both sides have two rua, the differential is almost
always zero, and there is no gradient. **Piece values are only learnable where imbalances occur.**

---

## S. Search techniques, one by one

### S1. Transposition table aging / generation counter — **the highest-value search item**

**What is there now.** `src/search.rs:214`:

```rust
let replace = match self.tt[idx] {
    None => true,
    Some(old) => old.depth <= depth,
};
```

Direct-mapped, one entry per slot, `TT_SIZE = 1 << 18` = 262,144 slots (`search.rs:11`). Depth-preferred with no
generation, no bucket, no always-replace second slot. Cleared only on `ucinewgame` (`src/uci.rs:43`).

**The ratchet, with numbers.** At movetime 100 and ~885k nps the classical engine spends ~88,500 nodes per move.
Quiescence never stores (`quiescence()` has no `store()` call), so call it ~30k interior stores per move. The table
is nominally full after ~9 moves. From then on a slot only accepts a store of depth ≥ the depth it already holds, so
slot depths monotonically ratchet toward the maximum depth reached (8). Stores at depth 7–8 are rare — they are the
handful of nodes near the root. **For most of a game the engine is writing into a table that mostly refuses writes.**

**Why makruk makes this worse than chess — measured from the ledger, not assumed.** I pulled the per-game ply counts
out of every block in `results/blocks.jsonl` that records them (**n = 1,460 games**):

| | plies |
|---|---|
| mean game length | **203** |
| median | 177 |
| p90 | 400 (the abort cap) |
| share of games ≥ 200 plies | **43.5%** |

That is ~100 moves per side against a chess game's ~40. **The ratchet has roughly 2.5× longer to run per game than
in chess**, and the long tail — the 43.5% of games past 200 plies — is exactly the counting-endgame material that is
quiet, highly transpositional, and where a working TT pays most.

**The ledger also shows the dead TT causing conversion failure directly.** The b0012/b0013 pair is the same
128 games at the same seed, one with the TT cleared per game and one carrying it:

| block | TT | score | games hitting the 400-ply abort |
|---|---|---|---|
| b0012 | cleared | 67.6% | **4** / 128 |
| b0013 | carried | 50.0% | **13** / 128 |

**Carrying the TT more than tripled the unconverted-game count.** That is a second, independent reading of the same
pair, and it speaks directly to the map's open question *"Conversion failure — our engines abort 25% of games against
each other at the 400-ply cap ... unclear whether it is an eval, search, or counting-rule question."* At least part
of it is the transposition table.

**Evidence status — read this before quoting the 17.6 points.**
- *Measured, first-party*: **67.6% cleared vs 50.0% carried = 17.6 points at 4.0σ**, n=128, seed 7, movetime 100/100,
  r3 net vs **native fairy at skill 3**. Ledger rows b0012/b0013.
- **Both rows are formally retracted** — but for *metadata*, not for their scores. The retraction reason records that
  `match-arena` decided `oppIsOurs` via `FAIRY_BIN.includes('makruk-engine')`, and since the repo directory is itself
  named `makruk-engine`, every path matched, so the stored `opponent` field wrongly reads "our classic". The
  retraction states explicitly that *"the games themselves were correct — the real binary was spawned — and the
  scores stand."* **AGENTS.md's prose is right and the raw `opponent` field is the thing that was wrong.** I checked
  this specifically because the raw field contradicted the prose; it is worth knowing that a naive read of the JSONL
  gives the wrong opponent for these two rows.
- *It is still a proxy.* It measures the **between-game** pathology, which `ucinewgame` already fixes everywhere.
  The within-game ratchet is the same mechanism with less time to run, so 17.6 points is an **upper bound** on what
  aging buys in real play, not an estimate of it.
- *Not measured anywhere*: an isolated Elo delta for adding a generation counter to a depth-preferred scheme. Chess
  sources treat aging as obviously-correct hygiene rather than as a measured patch. **The Elo range in the table is
  an inference from this repo's own numbers, not a citation.**

**Implementation, ~1.5 h.** Add `gen: u8` to `TtEntry`, `generation: u8` to `Searcher`, `self.generation =
self.generation.wrapping_add(1)` at the top of `search()`, and:

```rust
Some(old) => old.gen != self.generation || old.depth <= depth,
```

Then consider raising `TT_SIZE`. The table is `Vec<Option<TtEntry>>`; `TtEntry` is 17 bytes of payload
(u64 key + i16 depth + i32 score + enum + 2-byte Move), which pads to 24, and `Option` has no niche to exploit
because the key is a plain `u64` — so each slot costs **32 bytes**, ~8 MB total, with **25% of it spent on a
discriminant byte**. Replacing `Option` with a `key == 0` sentinel or a `depth < 0` sentinel buys a quarter of the
table back for free. That is small for a native binary and material for wasm, where the budgets should probably
differ in code.

**Two adjacent defects found while reading, both free to fix in the same patch:**
- **Mate scores are stored unadjusted for ply.** `store(key, depth, best, …)` on line 372 stores `best` raw. A mate
  score is ply-relative (`MATE - ply`), so a mate found at ply 6 and probed at ply 4 reports the wrong distance.
  Standard fix: `score + ply` on store, `score - ply` on probe, for `|score| > MATE - MAX_PLY`.
- **`history` is never cleared or aged.** `killers` is reset per `search()` (line 141) but `self.history` is not,
  and it accumulates `depth²` forever across a whole game. Over 150 moves the early-game history dominates and
  ordering degrades. Halve it per search, or clear it on `ucinewgame`.

### S2. Reverse futility pruning / static null-move pruning

**Elo, borrowed from chess.** Consistently reported in the +20 to +50 range by engine authors on their own self-play
patches. It is one of the highest Elo-per-line techniques in the standard set.

**Why it survives the depth discount (W2).** RFP is a *per-node margin test* at low remaining depth
(`depth <= 2..8`), not a tree-shape optimisation. Its gain does not need depth 20 to appear; it needs shallow nodes,
which is all this engine has. **This is the search technique whose chess number transfers best to a depth-8 engine.**

**Makruk caveat, and it is a real one.** RFP must carry the same guards as the existing null-move pruning
(`search.rs:279`): skip when in check, at mate-scored beta, **and while a count is active** — a static margin test
assumes a passive position is at least as good as its static score, and under a closing counting clock a passive
position is *losing on the clock*. `counting_term()` encodes exactly that. Reuse `counting_active`.

**~1 h**, roughly:

```rust
if depth <= 6 && !in_check && !counting_active && beta.abs() < MATE - MAX_PLY as i32 {
    let static_eval = eval::evaluate(game, ply);
    if static_eval - MARGIN * depth as i32 >= beta { return static_eval; }
}
```

`MARGIN` wants tuning on makruk's compressed value scale (§M2) — a chess margin of ~80–120 cp/ply is calibrated
against a 900 cp queen. With a 500–650 cp rua as the top piece, expect a smaller margin.

**One implementation trap specific to this eval.** `eval::evaluate` is not cheap here — it scans 64 squares and runs
**two full `is_in_check` attack scans** for the ±50 check bonus (§E4). RFP calls it at nodes that previously
evaluated nothing, so a naive implementation can spend more on evaluation than it saves in tree. Either cache the
static eval per node (it is wanted by futility, LMP and delta pruning too) or delete the check bonus first — which
§E4 argues you should do anyway.

### S3. Late move pruning (move-count pruning)

**Elo, borrowed from chess.** Typically +15 to +40 in engine self-play patches, often reported jointly with LMR.
Also a shallow-depth technique, so it survives the discount.

**Makruk caveat, measured.** Mean branching factor here is **22.8** (§A1) against roughly 35 in chess. LMP prunes
the tail of the move list; a shorter list has a shorter tail. Expect the **low end** of the chess range, and set the
move-count thresholds proportionally lower than a chess engine's (`3 + depth²` style tables are calibrated for ~35).

The engine already has the ordering LMP depends on (TT move, MVV-LVA, killers, history) and already computes the
`i >= 3` index in the LMR block at `search.rs:323`, so LMP is a few lines in the same loop.

### S4. Futility pruning (frontier nodes)

Overlaps RFP heavily; most published figures bundle them. Do RFP first and measure; add frontier futility only if
Gate A still has room. Same counting guard. **~1 h, +5 to +15.**

### S5. Delta pruning in quiescence — best Elo-per-hour in the search list

`quiescence()` (`search.rs:377`) has a stand-pat cutoff and nothing else. Delta pruning is three lines: skip a
capture when `stand_pat + victim_value + margin < alpha`.

**Makruk makes this safer than in chess.** The delta margin has to cover the largest possible swing from one capture.
In chess that is a queen (900) plus promotion (800). In makruk the largest capture is a rua (500, or 652 tuned) and
promotion gains ~0–100 cp (§M3). **The worst-case swing is roughly a third of chess's**, so a tight margin prunes
more with less risk of dropping a real tactic.

**~0.5 h. +10 to +25.**

### S6. Capture-only move generation for quiescence — off-ticket, and probably the largest nps lever in the engine

Not on the ticket's list, but it dominates the answer to "what is search work worth", so it belongs here.

`quiescence()` calls `game.legal_moves()` and *then* filters to captures and promotions (`search.rs:400–404`).
`movegen::legal_moves` (`movegen.rs:203`) generates pseudo-legal moves and, **for each one, clones the entire
64-square board** (`apply_to_board`) and runs a full `is_in_check` attack scan. At a mean 22.8 pseudo-legal moves
per position that is ~23 board clones and ~23 attack scans per quiescence node, of which ~90% are thrown away.

Quiescence is typically 50–80% of nodes in an alpha-beta engine. A capture-target-driven generator (iterate enemy
pieces, find attackers) plausibly buys **1.5–2.5× nps**, which at EBF ~3.5 (see below) is roughly **one extra ply**.

**EBF, derived from the repo's own numbers.** Depth 10 from startpos costs 272k nodes (AGENTS.md), so
272,000^(1/10) ≈ **3.5**. Before null-move + LMR it was 28.3M nodes at depth 10 → ≈ **5.6**. A mature chess engine
with the full pruning set runs 1.8–2.5. **The remaining search headroom is real and large** — this engine prunes
far less effectively relative to its branching factor (3.5/22.8 = 0.15) than a chess engine does (≈2.0/35 = 0.06).
*(Caveat: `nodes^(1/depth)` over a cumulative iterative-deepening tree including quiescence is an approximation, and
nominal depths are not comparable across reduction schemes — the spec makes that point at line 369.)*

### S7. Check extensions — already implemented; the question is whether they are safe

`search.rs:271`, unconditional `+1` on every in-check node, with no extension budget, no ply cap, and no
`depth + ext` clamp. Applied twice — once on the reduced/null-window search and once on the LMR re-search.

**Makruk makes check-extension explosion *less* likely, not more.** Perpetual-check trees blow up when a long-range
piece can deliver check from a distance and shuffle between checking squares. Here the only long-range piece is the
rua; the met, khon, ma and bia all check from adjacent or jump squares, so a checking piece is usually capturable or
must step away. Combined with a mean 22.8 branching factor, the risk profile is milder than chess.

**But there is one makruk-specific way it bites.** In a counting endgame the stronger side has a strong incentive to
give checks to reset nothing (the count is by moves, not by progress), and repeated-check trees against a lone khun
are exactly the position class where the search already burns 25% of self-play games at the 400-ply cap (map,
"Conversion failure"). If check extensions ever need a limit here, it will be in counting endgames, not in the
middlegame. **Untested. I would not touch this before #1–#5.**

### S8. Principal variation search (PVS)

**Elo, borrowed from chess: small.** Every source that isolates it reports a modest gain once a TT and decent move
ordering are already present, and this engine has both. The spec's own round-5 ranking (line 311) already reached
this conclusion: *"the reduced-depth searches above are already null-window, so PVS is a small delta."* That
reasoning is correct — `search.rs:337` already searches reduced moves with `-(alpha+1), -alpha`.

What is genuinely missing is the null-window search of **non-reduced** late moves (the `reduction == 0` path uses the
full window). **~1.5 h, +5 to +20**, and it discounts with depth (W2), so lean low.

### S9. Aspiration windows

**Elo, borrowed from chess: small-to-moderate, and depth-dependent.** Aspiration pays off by making each iteration
cheaper, so its value scales with the number of iterations and with score stability between them.

**This engine completes 8 iterations at movetime 100.** A depth-25 engine completes 25. Aspiration also *costs* on
every fail-high/fail-low re-search, and a shallow search's score is less stable iteration-to-iteration. **This is the
technique the depth discount (W2) hurts most.** Additional complication specific to this code: the root loop at
`search.rs:169` interacts with `iteration_one_complete` and the soft/hard deadline logic (`should_stop`), and the
invariant *"soft deadline never fires before iteration 1"* (AGENTS.md) has to survive a re-search. **~2 h**, and it
is the search item I would defer longest.

### S10. Static exchange evaluation (SEE)

**Elo, borrowed from chess: +10 to +40**, usually reported at depth 15+ where the ordering saving compounds. Two
uses: order captures by SEE instead of MVV-LVA, and prune SEE-negative captures in quiescence.

**Makruk makes SEE cheap.** A SEE routine needs the full attacker set for a square, ordered by value, with x-ray
recomputation after each capture. In chess that means bishop/queen diagonal batteries and rook/queen file batteries.
**Here only the rua slides** — the only x-ray is rua-behind-rua on a rank or file. Everything else (khun, met,
promoted bia, khon, ma, bia) is a fixed offset lookup. A makruk SEE is meaningfully simpler than a chess SEE.

**Makruk makes SEE less urgent.** With values compressed to 100 / 112–200 / 226–250 / 284–300 / 500–652, the cost of
an MVV-LVA ordering mistake is bounded by ~550 cp rather than chess's ~900. MVV-LVA is *less wrong* here.

**And it should come after S6.** Ordering improvements pay off in the tree qsearch generates; if qsearch is being fed
by a full legal-move generator that clones the board 23 times per node, SEE is optimising the wrong end.

**~4 h. Rank 12.**

---

## E. Eval techniques, one by one

### E1. The counting-gate term — the makruk-only lever

Full measurement in §A3. The design question is what shape the term takes:

- **The switch is board-global, not per-side.** `has_unpromoted_pawns` checks the whole board, either colour. So the
  term is `sign(material_edge) × f(number of unpromoted bia remaining)`, not a per-side pawn count.
- **It must not fire when counting is already running** — `counting_term()` handles that case, and double-counting
  the same rule would be worse than not modelling it.
- **The steepest part of the curve is the last bia.** Going from one unpromoted bia to zero flips the gate; going
  from eight to seven does nothing. A term linear in bia count would mostly measure phase. Prefer
  `is_last_bia`/`bia_count <= 1` shaping, then tune the magnitude with the §A5 machinery.
- **Magnitude:** §A3 says a 400–700 cp edge loses ~27 points of expected score at the gate. At K=0.45 that is a large
  term — plausibly 100–200 cp — which is enough to change endgame move choice materially. Tune it, do not guess it.

**~2 h.** No new movegen, no new scan — `has_unpromoted_pawns` already exists in `counting.rs:54` and the material
sign is already computed by `evaluate_board`.

**Also worth checking under this heading:** whether this explains the map's *"Is the net's edge general, or
concentrated in counting endgames?"* fog item, and the 25% self-play abort rate.

### E2. Texel tuning — **the one I would do first**

Everything measured in §A5. Implementation notes that matter:

**Do it in Rust, against the real `evaluate_board`.** This repo has been burned seven times by a measurement that
measured something other than what it claimed (AGENTS.md is a list of them). A JS or Python mirror of the eval is
exactly that failure mode waiting to happen — my own §A probes are mirrors and should be treated as *scouting*, not
as tuned constants to paste in. The safe shape is a `src/bin/tune.rs` that:
1. lifts the constants out of `eval.rs` into a `EvalParams` struct with a `Default` matching today's values,
2. asserts `evaluate_board_with(params_default) == evaluate_board()` on a fixture set — a one-line gate that makes
   mirror drift impossible,
3. loads N rows, runs the **quiescence search** to get the leaf position, evaluates there, and coordinate-descends.

**The refactor is contained.** `evaluate_board` has exactly one caller (`evaluate`, same file), and `eval::evaluate`
has exactly four call sites in the whole tree (`uci.rs:74`, `search.rs:234`, `search.rs:380`, `search.rs:389`).
No test references the eval constants. Threading an `EvalParams` through is a small, low-risk change — the 5-hour
estimate is mostly tuner and validation, not plumbing.

**Quiet positions.** Osterlund's method evaluates the *leaf of a quiescence search*, not the raw position. My §A
probes did not do this — they used raw corpus positions. Skipping it adds symmetric noise but biases nothing
obvious; doing it properly should make the fit tighter, not looser. Budget it in.

**Labels — verified against the generator, not assumed.** [What is one classical-eval term worth?](../issues/05-what-one-eval-term-is-worth.md)
asks explicitly to "check the label schema rather than assuming", so: `scripts/datagen.mjs:4` documents
`wdl = oracle-adjudicated final outcome from that position's STM`, and `datagen.mjs:277` / `:348` implement it as
`r.wdl = base === "d" ? "d" : base === r.side ? "w" : "l"` — the *final game result*, side-to-move relative, stamped
onto every buffered row once the oracle adjudicates. **That is exactly the Texel target. The precondition is
satisfied.**

Two schema details that matter:
- The `eval` field is the teacher's score, not a game result. It is the *net's* training target, not Texel's. Do not
  mix them up — this repo has already lost a round to a label-sign confusion between these two fields.
- The `w` field exists only in the DAgger corpora, not in the bootstrap ones.

**One sampling bias to record.** `datagen.mjs:325` and `:375` **discard all rows from games that hit the 400-ply
abort**. So the corpus systematically excludes the positions that were hardest to convert. For the counting-gate
finding (§A3) this cuts in a helpful direction — the unconverted games are exactly the ones that would have landed in
the no-bia/drawish bucket, so their absence makes the measured 30-point gap an **under**statement, not an artifact.
For piece-value tuning it is a mild bias toward positions that resolve.

**Corpus choice.** Use `bootstrap-v2.jsonl` or `bootstrap-d6.jsonl` (10M rows, 50k games, 30.4% deep endgames).
**Do not use the DAgger corpora** — AGENTS.md records they contain *zero* deep endgames (0.0% bare), and half the
value here is endgame piece values (§A6: values are only learnable where imbalances occur).

**One caution the literature is explicit about:** Texel tuning is normally run on the *tuned engine's own* self-play
games. This corpus is fairy self-play. The position distribution is fairy's, which biases the fit toward positions
fairy reaches. It is still a legitimate fit against real game outcomes — but if the first tuned artifact underperforms
its held-out loss, this is the first thing to suspect, and the fix is a corpus from our own games
(`match-arena.mjs --dump-games` already exists).

**Expected Elo.** I am giving +40 to +90 and I want to be precise about where that comes from. It is **not** a
citation. It is: (a) the measured fact that the tuned eval moves from *below material-only* to within 0.003 of the
depth-labelled teacher's own correlation with results (§A5); (b) the measured fact that the teacher label ceiling
is worth 9–21 probe points in this repo's own diagnostics (AGENTS.md); (c) the general chess-engine experience that
a never-tuned hand-set eval gains substantially from its first tuning pass. **(c) is the borrowed part and it is the
weakest part.** The honest floor is "the static fit improves measurably and the nps cost is zero"; the Elo is a Gate
A block away and that block costs ~2 minutes.

### E3. Mobility — rua only, and only if it clears its nps cost

§A1 and §A2. Implement **rua mobility and nothing else**. Do not port a per-piece mobility table.

**The nps arithmetic the eval ticket demands.** Rua mobility needs a ray walk from each rua — 4 directions, mean 6.5
squares total. `evaluate_board` currently scans 64 squares and calls `is_in_check` **twice** (`eval.rs:116–121`),
each a full attack scan. Adding ~4 rua ray walks is small next to two attack scans. But at 885k nps the whole eval
budget is ~1.1 µs, so measure it rather than assume — and note that **deleting the ±50 check bonus would pay for rua
mobility several times over** (see E4).

Expect the term to be worth most in the **middlegame** (§A6: rua mobility weight is +1 opening, +10 middlegame,
−2 endgame), which argues for doing phase interpolation first or gating the term on phase.

### E4. The ±50 check bonus is the most suspect constant in the file, and it is not on the ticket's list

`eval.rs:116–121` gives ±50 for giving/being in check, and pays **two full `is_in_check` attack scans per
evaluated node** to compute it. Two problems:

- **Cost.** This is likely the single most expensive line in the eval, on the hot path of every node including every
  quiescence node.
- **Correctness.** A static bonus for giving check is a well-known eval anti-pattern: it rewards pointless checks
  that the search would otherwise reject, and the search already extends checks (`search.rs:271`) so the tactical
  value is counted twice.

I did not model it in §A (my mirror does not compute checks), so **this is untested here** — but it is a
free-to-test hypothesis: delete it, re-run the §A5 fit, and see whether held-out loss moves. If it does not, the
line is pure nps cost.

**Related: the king-safety table is colour-blind.** `KING_SAFETY` (`eval.rs:42`) gives +20 on rows 0–1 *and* rows
6–7, applied identically to both colours — so a black khun that has marched to White's back rank scores the same
"safety" as one sitting at home. The §A5 fit wants to drive the whole table negative, which is consistent with it
measuring something incoherent. Making it colour-relative before tuning is ~0.2 h and is the right order of
operations.

### E5. Phase interpolation

§A6: **+1.38% held-out loss beyond tuning**, at double the eval cost and triple the tuning cost, on a corpus whose
phase distribution (28.2% / 23.2% / 48.6%) is far more bimodal than chess.

**Do it after tuning, not instead of it, and not before.** Tapered eval doubles the parameter count; tuning 2N
parameters with a tuner you have not yet built and validated is the wrong order. It is also the technique most
exposed to the §A6 caveat that piece values are only learnable where imbalances occur — the opening-phase rua value
did not move at all in my fit, because both sides always have two.

**Makruk-specific phase function.** Do not port a chess phase function keyed on queens and rooks. The met is not a
queen; promoted bia *become* mets, so met count *rises* toward the endgame (10,419 PM vs 18,094 M in a 20k-position
sample). Key the phase on total non-khun material, or on piece count, and check it against the §A6 buckets.

### E6. Bia structure and the promotion race

§A2: doubled +0.018, connected +0.031, one-step-from-promotion +0.031 — the three weakest signals I tested.

**The chess passed-pawn framework does not transfer, for a structural reason worth stating plainly.** In chess a
passed pawn is valuable because promotion is worth **+800 cp**. In makruk, promotion at rank six turns a bia
(100) into a promoted bia that **moves exactly like a met** — nominal +100, and the §A5 fit puts a promoted bia at
**96**, i.e. *the same as an unpromoted bia*. A makruk promotion race is a race for approximately nothing in
material terms.

What promotion *does* do in makruk is **flip the counting gate** (§A3, §E1) — and that is worth 25 points of expected
score. **So the promotion term worth writing is not a passed-bia bonus. It is the counting-gate term.** If you
implement E1, most of what a chess engine gets from passed-pawn logic is already accounted for, through a completely
different mechanism.

Also note the bia geometry: white bia start on row 2 and promote on row 5, so **every bia is at most three pushes
from promotion** and there is no double-step first move (`movegen.rs:165–172`) and therefore no en passant. A
"distance to promotion" term has three possible values, not six.

**Fix `PAWN_ADVANCE[5]` (§A4) as part of this, or on its own in 6 minutes.**

### E7. Tempo

**Chess-asserted, ~10–15 cp**, and I could not find an isolated measurement I would trust. Cheapest possible change
(one constant added to the side-to-move perspective). **Makruk-specific reasoning I would not act on without
testing:** with a mean branching factor of 22.8 and pieces that move one square, a single tempo plausibly matters
*more* than in chess in the opening (where developing the khon/met takes many single steps) and *less* in counting
endgames (where the move counter, not the initiative, decides). Untested here. **Fold it into the §A5 fit as one
more free parameter and let the corpus price it** — that costs nothing once the tuner exists.

---

## K. What the makruk-specific literature actually says

There is more of it than the ticket assumed — and it validates one of my findings, contradicts another, and kills a
third. All of it comes from reading engine source or published papers, not documentation.

### K1. Published makruk piece values — the first external check on §A5

Every source normalised to bia = 100. My §A5 Texel fit is the last row.

| Source | met | khon | ma | rua |
|---|---|---|---|---|
| Fairy-Max, `fmax.ini` "Game: makruk" (Muller) [12] | 181 | 300 | 450 | 630 |
| SjaakII `variants.txt` (Glebbeek) [13] | 187 | 344 | 406 | 625 |
| Makruk-Stockfish, middlegame [11] | 159 | 312 | 412 | 676 |
| Makruk-Stockfish, endgame [11] | 192 | 293 | 386 | 645 |
| ChessV | 150 | 260 | — | — |
| **`src/eval.rs` as shipped** (= the counting-rule table) | **200** | **250** | **300** | **500** |
| **My §A5 Texel fit** | **112** | **226** | **284** | **652** |

Four things fall out, and they matter more than any single number in this document:

1. **The rua agrees almost exactly.** My 652 sits inside the published 625–676 band. That is a genuine external
   validation of the fit on the one piece where the corpus has real signal (§A6: rua imbalances actually occur).
2. **The shipped met value of 200 is higher than every published source.** The consensus band is 150–192, and Muller's
   direct self-play measurement puts the shatranj ferz — geometrically the *same piece* — at **≈1.35 pawns** [12].
   So the direction of my headline finding is confirmed by four independent sources: **the met is overvalued in
   `eval.rs`.**
3. **But my 112 is below every published value, and I now know why.** See K3 — this is a known Texel failure mode
   and I walked into it.
4. **The shipped table is not merely untuned, it is an outlier.** It is the *highest* met value and the *lowest* rua
   value of any source in the table. That is what you get when a counting-rule adjudication table is pressed into
   service as a playing-strength table (§M5).

**One clean contradiction I cannot resolve.** Makruk-Stockfish's met **gains** 25% from middlegame to endgame
(159 → 192); every other piece loses value. My §A6 phase fit says the opposite (met 168 opening → 80 endgame).
A plausible reconciliation is that promoted bia become mets, so late-game mets are abundant and the *marginal* met is
cheap — but I am guessing. **Treat my per-phase met values as unreliable and Makruk-Stockfish's as the prior.**

### K2. Mobility for short-range pieces — the structural argument is stronger than my measurement

My §A2 partial correlations said mobility is a rua-only term. The literature says the same thing far more decisively,
by *absence*:

| Engine / source | short-range mobility term? |
|---|---|
| Bonanza `evaluate.c` (shogi) | **zero occurrences of "mobilit"** — material + KKP + KPP only |
| YaneuraOu, Apery (shogi) | **zero** |
| Gikou (2016 WCSC runner-up) | control features for **Rook, Bishop, Lance only** — the three sliders. Gold/silver/knight/pawn get none |
| Xiangqi consensus (Pham Hong Nguyen) | "Mobility. **Mainly for Rooks and Horses.**" Advisors and elephants get none |
| Hoki & Kaneko, JAIR 49 (2014) [14] | **"mobilit" appears 0 times in the 42-page paper** |
| Stockfish / MadChess | knight, bishop, rook, queen only |
| **Fairy-Stockfish** [15] | met and khon are `Pt > QUEEN`, so they fall to an **untuned generic formula**, never a tuned table |

And Stockfish's own tuned tables make the gradient explicit — the shortest-range piece with a real table has the
smallest range: knight endgame mobility span **105 cp**, rook **257**, queen **270**.

**The sharpest form of the argument, which I did not have and which supersedes mine:** for a one-step mover,
mobility *is* a piece-square table. A met on d4 always has 4 pseudo-legal moves and on a1 always 2; the only variance
is own-piece occupancy. **A met/khon mobility term is therefore largely redundant with the centre-bonus table that
already exists** — a much stronger reason to skip it than "the correlation is small".

**What to implement instead** (Muller [12]): *"it does not matter so much if your Rook has 10 or 12 moves. But
whether it has 0 or 2 moves makes a heck of a difference."* So — a real mobility curve for the **rua**, and for
everything else only a **low-tail penalty at 0 or 1 legal moves**. My §A1 histogram says that tail is real and rare:
0.7% of khon and 0.7% of met are fully immobilised, 9.9% of mets have exactly one move.

### K3. The Texel piece-value trap — I walked into it, and so has everyone else

Primary source, hgm and jdart, *"Texel tuning for piece values"* [16]: **in a corpus drawn from ordinary games,
material is almost always balanced, so there is nearly no signal to separate piece values**, and the fit collapses
them toward whatever best fits the sigmoid on positional grounds. jdart stopped tuning piece values altogether;
hgm's prescription is a **separate corpus generated by self-play from deliberately imbalanced starting positions**,
with values fit only on that.

I rediscovered this independently in §A6 without recognising it: *"the opening-phase rua value did not move from 500
at all — in the opening both sides have two rua, the differential is almost always zero, and there is no gradient."*
That is exactly the failure mode, observed in my own data.

**And there is an internal disproof that settles it without appealing to the literature at all.** `src/eval.rs:72`
reads:

```rust
Kind::M | Kind::PM => 200,
```

**Met and promoted bia share a match arm because they are the same piece** — a promoted bia in makruk *is* a met,
with identical movement (`movegen.rs:142`). My fit was free to move them independently, and did:

| parameter | shipped | tuned (overall) | tuned (opening / endgame) |
|---|---|---|---|
| Met | 200 | **112** | **168 / 80** |
| Promoted bia | 200 | **96** | **8 / 72** |

Two parameters that are *physically the same piece* came out **15% apart overall and 21× apart in the opening**
(168 vs 8). Nothing about makruk can produce that. **It bounds the fit's own noise floor on piece values at worse
than ±15% — wider than the entire published disagreement between makruk engines** (§K1: 159 to 192).

**The pattern confirms the diagnosis rather than contradicting it.** The rua moved 500 → 652, *toward* the published
band where three independent engines agree. The rua is the piece that appears in lopsided endgames; the met is the
piece that almost never appears as a clean imbalance. **The fit worked exactly where Muller predicts it works and
failed exactly where he predicts it fails.**

**What survives, precisely:**

- **SURVIVES** — the −4.08% held-out loss from retuning existing constants, and the finding that the shipped
  positional terms predict game results *worse than deleting them*. By-game holdout, and it is the actual argument
  for tuning first.
- **SURVIVES, and is better supported** — "build the tuner first". The instrument needs constraints that this
  argument could not have discovered without it.
- **DOES NOT SURVIVE** — every per-piece number in §A5 and §A6. Met 112, PM 96 and the per-phase splits are artifacts.
- **DOES NOT SURVIVE** — §M2's "compressed piece values" argument, which leans on the tuned range and was my sole
  justification for originally ranking SEE last (§X2). **Use the published values in §K1 for that argument, or drop
  it.**

**Required before the tuner's output is trusted:** (1) tie met and promoted bia to **one shared parameter** — if the
met then lands in the published 150–192 band, this was identifiability rather than discovery; (2) anchor bia at 100
rather than fitting it; (3) check what else got crushed toward zero — `PM 8` in the opening is Petzke's iCE failure
mode visible in my own output (§K4); (4) fit piece values on a separate imbalance-seeded corpus, or not at all.

**Consequence for the recommendation — this is the single most important correction in this document.**
**Split the tuning job in two:**

- **Positional terms** (centre bonus, king safety, bia advance, tempo, and any new term) — tune them on
  `bootstrap-v2` as described in §E2. This is where the measured −4.08% held-out loss actually lives, and it is
  well-posed.
- **Piece values** — do **not** ship the numbers my fit produced. Either leave them alone, or move them toward the
  published makruk consensus in §K1 (met 150–190, khon 290–340, ma 390–450, rua 625–675), or generate an
  imbalance-seeded corpus and fit them properly. `match-arena.mjs` can already dump games; seeding imbalanced
  starts would be new work and should be its own costed ticket.

**Makruk is a friendlier case than chess here, but not a free one.** 48.6% of corpus positions have ≤10 pieces
(§A6), so material imbalances genuinely occur — far more than in a chess corpus. That is probably why my rua value
landed on the published band. But the met, which is abundant and often traded evenly, is exactly the piece the
method mis-fits, and it is the piece my fit moved furthest.

### K4. Texel tuning has produced real regressions, and the loss number does not protect you

Two engines measured a **loss** from tuning [9]:

- **iCE (Petzke): −20 to −24 Elo.** Cause: the optimiser zeroed "smaller terms that contribute only small parts to
  the score", because betting on a draw minimises MSE. He judged those terms worth "at least 20 Elo".
- **Zurichess (Moșoi): −28 Elo *despite a lower MSE*** (0.0559 vs 0.0573) — `180–238–291 [0.459] 709`.

**"Lower held-out loss" is exactly the evidence I have, and it is exactly the evidence that failed for Zurichess.**
Petzke's failure mode is visible in my own §A5 output: the fit drove the entire king-safety table negative and the
bia-advance terms to zero or below. Some of that is a real bug (the table is colour-blind, §E4); some of it may be
the optimiser deleting small true terms. **Do not ship the fit unmeasured** — Gate A is two minutes and this is
precisely what it is for.

### K5. Counting rules in eval — there is a working precedent, and Fairy-Stockfish is not it

- **Fairy-Stockfish treats counting as adjudication only.** `CountingRule` is consumed solely by
  `is_optional_game_end()` → `VALUE_DRAW`; grepping `evaluate.cpp`, `search.cpp`, `material.cpp`, `endgame.cpp`
  returns **zero hits** [15]. Its eval is blind to the counting clock until the position is already drawn. It also
  sets `nMoveRule = 0`, so the usual shuffle damper is skipped too.
- **Makruk-Stockfish — ianfab's dedicated fork — does have counting-aware eval**, from a commit titled *"Make KXK
  drawish if counting is enabled"* [11]:

  ```cpp
  result = result * std::max(2 * pos.counting_limit() - pos.rule50_count(), 0) / 128;
  ```

  That is a *scaling* of the win score by remaining count — structurally the same idea as our `counting_term()`,
  which adds a linear bonus instead. **Scaling is the better shape**: a won position should decay toward zero as the
  clock closes, not receive a fixed offset that can swamp or be swamped by material.

**Neither engine has anything resembling the §A3 counting-gate term.** The finding that an unpromoted bia *blocks
counting from starting* appears nowhere in either codebase. §E1 stands as novel, and the Makruk-Stockfish scaling
form is the right template for how to write it.

**Also relevant, from the rules authority [17]:** *"it can happen that the ultimate count is already lower than the
start count… In that case there is an automatic draw."* **In makruk, having more material can be strictly worse** —
because the count starts at the piece count, and the limit is set by the stronger side's piece mix. That is a real
eval non-monotonicity with no chess analogue whatsoever, and neither our eval nor either Stockfish models it.

### K6. There is one published academic result on makruk endgames

**Tudsuan & Thanatipanonda (2026), "Building Makruk Endgame Tablebases"** [18] quantifies exactly the effect §A3
measures, from the other direction: for khon + promoted-bia versus a bare khun, the 44-move pieces'-honour limit
(adjusted to 41 for four pieces) **drops the win ratio from 85.77% to 83.49%**, eliminating 278,040 positions that
need more than 41 moves — including mates up to 57 moves long.

This is the KMITL tablebase work the map lists as an unsharpened fog item. It is a real, citable, ground-truth source
and it confirms that counting materially changes endgame outcomes.

## M. Makruk facts that drove the answers above

Confirmed by reading `src/movegen.rs`, `src/board.rs`, `src/counting.rs` — not taken on faith:

**M1 — Only one piece slides.** `movegen.rs:136–188`: khun 8 one-square dirs; met and promoted bia 4 diagonal
one-square; khon 4 diagonals + 1 forward; ma knight jumps; **rua is the only ray piece**; bia one forward, two
diagonal captures, **no double-step and no en passant**. Consequences used above: mobility is a rua term (E3), SEE
has one x-ray case (S10), check extensions are safer (S7).

**M2 — Piece values are compressed.** Shipped 500/300/250/200/100; tuned 652/284/226/112/96/100. The top-to-bottom
ratio is ~6:1 versus chess's ~9:1, and the *tuned* ratio makes the met barely stronger than a bia. Consequences:
tighter delta-pruning margins are safe (S5), RFP margins need recalibrating (S2), MVV-LVA is less wrong (S10).

**M3 — Promotion at rank six is worth ~nothing materially.** `board.rs:34` (row 5 / row 2) and `movegen.rs:195`.
Bia → promoted bia = met movement. Consequences: no passed-bia framework (E6), a dead eval constant (A4), and the
real promotion value routes through the counting gate (E1).

**M4 — The counting rules put a hard branch in the middle of the endgame.** `counting.rs:98` gates all board-honour
counting on `has_unpromoted_pawns`. `counting.rs:66` makes the limit depend on the *stronger side's piece mix*
(2 rua → 8, 1 rua → 16, 2 khon → 22, 2 ma → 32, 1 khon → 44, 1 ma → 64). Consequences: the largest eval finding here
(E1/A3); every static-margin pruning technique needs a counting guard (S2, S4); and endgame eval terms genuinely do
not behave like chess, exactly as the ticket suspected.

**M5 — The eval's piece-value table is the *rules'* table.** `eval::kind_value` == `Kind::counting_value` ==
`shared/makrukRules.ts`. They are already separate functions, so tuning one does not touch the rules port.

---

## Which one I would do first, and why

**Texel-tune the existing eval constants** — table row 8, §E2.

Explicitly *not* the top of the Elo-per-hour ranking, and I want the disagreement on the record rather than hidden by
a re-sorted table. It is the one I would do because it is **simultaneously** the best-evidenced item in the document,
the safest to revert, and a **multiplier on everything else** in the eval column:

1. **It is the only row in the table with no borrowed number anywhere in its justification.** Every other Elo figure
   here leans, somewhere, on a chess measurement I am flagging as borrowed. This one was measured on makruk data in
   this ticket, with a by-game holdout, and it generalised (train −4.34%, test −4.35%).

2. **The finding it rests on is not "the constants could be better" — it is "the constants are net-harmful."** The
   shipped positional terms predict game results *worse than deleting them* (§A5). That is a bug-shaped result, not
   an optimisation opportunity, and the repo's own history says bug-shaped results are where the returns are.

3. **Zero nps cost.** Every other eval item on the list must clear its own speed cost, and the eval ticket
   ([05](../issues/05-what-one-eval-term-is-worth.md)) demands that arithmetic be shown. Tuning has no arithmetic to
   show — the eval does exactly as much work afterwards. At 885k nps against a net at 332k, that matters.

4. **It builds the tool that prices everything else in the eval column.** Once `EvalParams` + a Rust tuner exist,
   the counting-gate term (E1), rua mobility (E3), tempo (E7) and phase interpolation (E5) each become "add a
   parameter, refit, read the held-out loss" — minutes each, before spending a single arena game on them. Every other
   ordering leaves that instrument unbuilt and prices the rest of the eval column by argument instead.

5. **It is measurable inside the rig's existing budget.** Gate A is ~2 minutes; the tuning run is ~13 s per pass on
   one core at the scale I ran. Nothing here approaches the map's 20-minute lockout limit, and nothing needs a
   training ticket.

6. **The chess literature backs the size.** First-ever tunings of previously hand-set evals measured **+58 to +137**
   across six engines (§9 in Sources) — Osterlund's own 99.6, chess22k's 137, chess4j's ~120. Our eval has never been
   tuned *and* currently scores below material-only, which is a worse starting point than any of theirs.

7. **It ranks 10th by raw Elo/h, and that is an artifact of the metric.** Most rows above it are borrowed chess
   numbers with small denominators. A ranking that puts a 15-minute tempo constant — worth `4.2 ± 9.0`, and *deleted
   outright* by Stockfish in 2021 — above the largest measured effect in the table is telling you about denominators.

### But do it in the corrected form, not the form I first wrote

**§K3 changed this recommendation and the change is not cosmetic.** Texel tuning cannot reliably fit *piece values*
from a corpus where material is usually balanced [16], and my own §A6 output shows the symptom (the opening rua value
had no gradient and did not move). So:

- **Tune the positional constants** — centre bonus, king safety, bia advance, tempo, and any new term. This is
  where the measured −4.08% held-out loss lives, and it is well-posed.
- **Do not ship the piece values my fit produced.** Move them toward the published makruk consensus instead
  (§K1: met 150–190, khon 290–340, ma 390–450, rua 625–675), which is four independent engines rather than one
  under-determined fit. My rua landed in that band; my met did not.
- **Measure it through Gate A regardless.** Two engines got a *loss* from tuning, one of them **with a lower MSE**
  (§K4). Held-out loss is exactly the evidence that failed for Zurichess. Two minutes of arena settles it.

**Then, in order: the counting-gate term (E1) with Makruk-Stockfish's scaling shape (§K5), gating the existing check
extension on SEE ≥ 0 (the one makruk-measured +18, §K3/row 7 — needs SEE first), and the dead-constant/king-safety
cleanup (A4/E4).**

**What I would *not* do early, and what changed:** I originally wanted to defer PVS on the spec's reasoning that it
is "a small delta" given the null-window LMR re-searches. **Two independent engines measured PVS at ~+55** [2], so
that reasoning is wrong and PVS moves up — *conditional* on verifying move ordering first, because the same code
measured **−31** with a buggy move scorer. **TT aging moves down**, from rank 3 to rank 14: Muller's sizing rule
[8] says replacement policy cannot register when the per-move tree is 0.3× the table, and only makruk's 203-ply
games keep the row alive at all (§S1). And **aspiration should be priced at CT800's depth-matched +18** [7], not at
Dumb's −69.9 at an unstated time control.

---

## Evidence ledger — what is measured, what is borrowed

Per rule 3 of the ticket. **An unmarked borrowed number is worse than no number**, so this table is the part of the
document to argue with.

| Claim | Status |
|---|---|
| Retuning eval constants cuts held-out Texel loss 4.08% | **Measured, first-party, makruk** (§A5, by-game holdout) |
| Shipped positional terms score worse than material alone | **Measured, first-party, makruk** (§A5) |
| Unpromoted bia on board = +30 pts at a 400–700 cp edge, piece count held fixed | **Measured, first-party, makruk** (§A3, >15σ; correlational — confounds listed) |
| `PAWN_ADVANCE[5]` never fires | **Measured, first-party** (0/40,000) **and proven by construction** (§A4) |
| Mobility is a rua-only term | **Measured, first-party, makruk** (§A1, §A2, correlational) |
| Phase interpolation worth 1.38% further loss reduction | **Measured, first-party, makruk** (§A6, noisier fits) |
| Mean branching factor 22.8 | **Measured, first-party, makruk** (§A1) |
| Corpus phase mix 28.2 / 23.2 / 48.6% | **Measured, first-party, makruk** |
| Clearing the TT per game = 17.6 pts, 4.0σ | **Measured, first-party** (ledger b0012/b0013, verified against the retraction rows) — but it measures *between-game* saturation, so it is an **upper bound** on the within-game case |
| Carrying the TT tripled the 400-ply abort rate (4 → 13 of 128) | **Measured, first-party** (ledger b0012/b0013 `perGame`) |
| Makruk games mean 203 plies, 43.5% ≥ 200 | **Measured, first-party** (ledger, n=1,460 games with `perGame` data) |
| EBF ≈ 3.5 (was 5.6 pre-NMP/LMR) | **Derived** from repo node counts; `nodes^(1/depth)` is an approximation |
| Search self-play gains do not convert to ladder gains | **Measured, first-party** (round 4: 6–0 self-play → one extra draw vs skill 10) |
| Check extensions already implemented | **Verified in source** (`search.rs:271`) |
| Mate scores stored TT-unadjusted; history never aged | **Verified in source** (`search.rs:372`, `search.rs:141`) |
| qsearch generates all legal moves then filters | **Verified in source** (`search.rs:400`, `movegen.rs:203`) |
| Only the rua slides; promotion at row 5; counting gated on unpromoted bia | **Verified in source** (`movegen.rs`, `board.rs:34`, `counting.rs:98`) |
| My tuned **rua** value (652) matches published makruk values (625–676) | **Cross-validated** against four independent makruk engines (§K1) — the one piece value I would trust |
| My tuned **met** value (112) is below every published source (150–192) | **KNOWN FAILURE MODE.** Texel cannot separate piece values from balanced-material corpora [16] (§K3). Do not ship it |
| Gating check extensions on SEE ≥ 0 is worth **+18** | **MEASURED BY SOMEONE ELSE, IN MAKRUK** (Evert Glebbeek [6]) — the only such number in existence. Self-play, no error bars, n not stated |
| Met is overvalued at 200 in `eval.rs` | **Converging evidence**: four published makruk sources say 150–192, Muller's ferz self-play says ~135, my fit says 112. Direction certain, magnitude not |
| RFP worth +25 to +55 | **BORROWED.** Blunder +57.1 ± 16.9 / 1,209 games [1]. No makruk evidence. Shallow-depth technique, so the transfer is more credible than most. **TalkChess has no SPRT evidence for RFP at all** — it rests on engine logs |
| PVS worth +30 to +55 | **BORROWED**, but *two* independent measurements [2]. **Conditional on move ordering** — the same code measured −12.7 ± 9.0 over 4,311 games with a buggy move scorer |
| LMP worth +15 to +40 | **BORROWED.** Blunder +21.9 ± 11.4 (LLR did not reach the bound); Dumb `no_lmp` −43.9 ± 4.7 at unknown TC [1][5]. Discounted for BF 22.8 vs 35 |
| Futility pruning worth +15 to +35 | **BORROWED.** Blunder +37.4 ± 13.4, measured *after* RFP so genuinely additive there [1] |
| Delta pruning worth +0 to +25 | **BORROWED AND CONTESTED** — one +80 its own author doubted, one strength *decrease* [4]. Plus a makruk-specific hazard (§S5) |
| Aspiration worth +10 to +25 | **BORROWED**, but **depth-matched**: CT800's +18 over 10,000 games was measured at "usual depth 8–10 plies" [7]. Dumb's −69.9 is at unknown TC and should not be used here |
| SEE worth +20 to +50 | **BORROWED.** Blunder +25.9 ± 12.8; Dumb `no_see` −51.3 ± 4.6 [1][5] |
| Tempo worth +0 to +5 | **BORROWED and near-zero everywhere measured.** Blunder 4.2 ± 9.0 (bundled); **Stockfish removed tempo entirely in 2021 and it passed non-regression** [1][10] |
| Tapered eval worth +20 to +60 | **PART-MEASURED HERE, PART-BORROWED.** The 1.38% is mine; the chess figures (+107 to +248) are **always bundled with the retune tapering requires**, so they are not a clean attribution [10] |
| Mobility is a rua-only term | **Measured here AND structurally corroborated**: no shogi or xiangqi engine ships short-range mobility; Fairy-Stockfish leaves met/khon on an untuned formula (§K2) |
| TT aging is worth Elo *as an isolated patch* | **NOT MEASURED ANYWHERE.** Confirmed in the canonical thread [19] — no participant reports a gain, one reports unclear benefit. **And Muller's sizing rule [8] says it cannot register at our nps × movetime.** Downgraded to rank 14 |
| Texel tuning worth +40 to +120 Elo | **PART-MEASURED, PART-BORROWED.** The −4.08% held-out loss is measured here; the loss→Elo conversion is borrowed. **Two engines measured a *loss* from tuning, one of them with a lower MSE** (§K4) |

**Correction to my own first draft: makruk-specific literature does exist, and this document now uses it.** Four
engines publish makruk piece values (§K1); one engine has counting-aware eval (§K5); one author measured a check-
extension change *in makruk* (§K3, row 7); and there is one published tablebase paper (§K6). My initial statement
that no makruk evidence existed was wrong, and the piece-value cross-check it produced is the most useful thing in
this document after §A3.

---

## What this ticket could not answer

Stated so the next ticket does not re-discover them:

1. **The Elo-per-ply price for this engine.** Every search technique's value routes through depth, and nothing here
   prices a ply on the fairy ladder. That is [Is the wall depth, or is it eval?](../issues/04-is-the-wall-depth-or-eval.md)'s
   job, and until it lands, every search row in the table converts tree-size savings to Elo on borrowed reasoning.

2. **Whether any of this moves Gate B.** W1 is the standing warning: round 4's search work was 6–0 in self-play and
   worth one extra draw against fairy skill 10. Nothing in this document escapes that precedent.

3. **What the ±50 check bonus actually costs and buys.** My §A mirror does not compute checks, so the single most
   suspect constant in `eval.rs` is the one term I could not price. It is cheap to test once the tuner exists (§E4).

4. **Whether the counting-gate effect (§A3) survives causally.** The correlation is enormous and the mechanism is a
   rule, but the clean test is an arena block with the term in and out — ~2 minutes of Gate A, not more analysis.

5. **Whether the net already knows the counting gate.** The net carries ~10 counting side-channels and beats classic
   at equal depth (issue 02). If its edge is concentrated here, §E1 is the cheap way to buy it into the classical
   eval — and that is a corpus-side question the §A5 machinery can answer without an arena block.

## Sources

Numbered as cited in the table and body. Engine testing logs and source code are preferred over wiki prose
throughout; where a number exists only as a forum recollection, it is marked.

1. **Blunder engine testing log** (Christian Dean / algerbrex) — per-feature SPRT results with error bars and game
   counts. The single best-structured primary source found.
   https://github.com/deanmchris/blunder/blob/main/docs/testing.md
2. **PVS measurements, Blunder + Rustic** — +56.2 ± 13.8 and +54.2 ± 16.6, and the −12.7 ± 9.0 / 4,311-game result
   with a buggy move scorer. algerbrex, verbatim: *"When I copy and paste in my code for scoring moves, PVS becomes a
   loss. When I replace my code with the code I copied from Rustic, PVS becomes a win again."* TalkChess.
3. **Diogo R. Ferreira, "The Impact of the Search Depth on Chess Playing Strength", ICGA Journal 36(2), 2013** —
   Houdini 1.5a: 2894 Elo at 20 ply, 1966 at 6 ply, approximately linear ⇒ **~66 Elo/ply**.
   https://web.ist.utl.pt/diogo.ferreira/papers/ferreira13impact.pdf
4. **Delta pruning test thread**, TalkChess — the +80/500-game report its own author doubted, and the contrary
   report of a strength *decrease*; plus the warning to disable it in late endgames for insufficient-material
   blindness. https://talkchess.com/viewtopic.php?t=73180
5. **Richard Delorme, ablation of *Dumb* 1.9-dev** — ~11,000 games per row: `no_aspiration` −69.9 ± 4.9,
   `no_see` −51.3 ± 4.6, `no_lmp` −43.9 ± 4.7, `no_razoring` −1.5 ± 4.7, `no_hash` −348.7, `hash_bmo` −210.0.
   **Time control is not stated** — treat every row as TC-unknown.
6. **Evert Glebbeek, "Is a Check Extension Really a Win?"** — *"it had a simple 'if (in check) depth++' style check
   extensions, which I replaced with a more sensible 'if (move gives check and see>=0) extension=1'. It gained about
   18 Elo in self-play. The game in question was not chess though (**it was Makruk**)."* Same thread: Hakkapeliitta
   **+3, error (2,3), over 39,589 games** — the largest N found anywhere, and it is zero; Maverick measured **+33 for
   removing** check extensions. Henk's mechanism: *"If LMR does not reduce when in check… that is your extension."*
7. **CT800** — aspiration windows **+18 Elo over 10,000 games at 10 s/game**, author states *"usual depth is 8–10
   plies"*. The only aspiration figure found at this engine's actual depth.
8. **H.G. Muller on TT replacement sizing** — *"there isn't much replacement when the search tree is not at least 10x
   larger than the table. So if you do 1-min games (~1 sec/move) and your engine does 1Mnps, you will only start to
   see an effect when the hash table has fewer than 100K entries (i.e. < 1.6MB)."* Muller also recommends measuring
   time-to-depth over a position set rather than playing games; lithander did exactly that — 300 WAC positions to
   fixed depth 20 at 5 MB, **196 min → 136 min**.
9. **Texel tuning results.** Peter Osterlund's original CCC post, 2014-01-31 — objective
   `E = (1/N) Σ (R_i − σ(q_i))²`, `σ = 1/(1+10^(−K·q/400))`, **K = 1.13**, `q_i` = **quiescence-search score, not
   static eval**, 64,000 games at 1s+0.08s → ~8.8M positions. His per-term gains total **99.6 Elo**, each measured
   over 32,000 games. https://talkchess.com/viewtopic.php?t=50823&start=26
   Other first-time tunings: chess22k **+137** (68.7% / 500 games), chess4j/Prophet **~120** (10k-game gauntlet),
   RofChade **+75–80**, Weiss v1.1 **58.13 ± 4.49** STC, Blunder 8.0.0 **60.9 ± 17.5**.
   **Regressions:** iCE **−20 to −24**; Zurichess **−28 despite a lower MSE** (0.0559 vs 0.0573).
   Andrew Grant's refinements (sigmoid rebased to *e*, K ≈ 3.0; L1 loss *"tried with no success"*; and — contra
   Osterlund — *"using a large number of positions from the same game has been shown to produce a lower quality
   dataset"*): https://github.com/AndyGrant/Ethereal/blob/master/Tuning.pdf
10. **Tapered eval and mobility figures.** Rustic **+248** self-play for tapered+tuned eval, with Vanthoor's
    conversion note: *"As a rule of thumb… 60% of the rating improvement obtained in self-play will 'stick'…
    A notable difference seems to be the tapered and tuned evaluation… the entire gain seems to carry over."*
    MadChess: tapered **+107**, mobility **+64** (1694→1766), passed pawns **+72**, king safety **+63**.
    PeSTO tables into TSCP **~+200**. Stash: pin-aware mobility **6.15 ± 4.50** / 10,623 games; connected pawns
    **25.38 ± 10.40** STC → **18.57 ± 8.45** LTC.
11. **Makruk-Stockfish** (ianfab) — counting-aware eval at `endgame.cpp:133` from the commit *"Make KXK drawish if
    counting is enabled"*; met-pair bonus via `queen_pair()` in imbalance slot 1000; piece values in `src/types.h`
    (`PawnValueMg 199/Eg 206`, met `316/396`, khon `620/604`, ma `820/796`, rua `1346/1328`).
12. **H.G. Muller** — Fairy-Max `fmax.ini` makruk and shatranj piece values; self-play measurement *"Ferz ≈ 1.35
    pawns"*; the short-range leaper formula *"1.1*(30 + 5/8*N)*N"*; *"forward moves seem to contribute twice as much
    to value as backward or sideway moves"*; and on the khon vs met gap: *"The forward step furthermore breaks the
    colour binding, which is the main thing that makes the Ferz so useless."* Also the mobility framing quoted in
    §K2 — and his own disclaimer: *"I have never tried mobility evaluation, so none of what I am going to say is
    substantiated by experiment."*
13. **SjaakII** (Evert Glebbeek) `variants.txt` — makruk piece values.
14. **Hoki & Kaneko, "Large-Scale Optimization for Evaluation Functions with Minimax Search", JAIR 49 (2014)
    527–568** — the reference large-scale shogi eval-tuning paper. **The string "mobilit" appears zero times in
    42 pages.** https://www.jair.org/index.php/jair/article/view/10871
15. **Fairy-Stockfish source** — `variant.cpp:156` (makruk: promotion ranks 6-8, `promotionPieceTypes = MET`,
    `doubleStep = false`, `nMoveRule = 0`, `countingRule = MAKRUK_COUNTING`); `types.h:409` where
    **`MET = FERS` and `KHON = SILVER`**, so it structurally cannot value the makruk met differently from the
    shatranj ferz; `evaluate.cpp:492-495` where every piece above QUEEN falls to an untuned generic mobility
    formula; zero counting-rule references in any eval or search file.
    https://github.com/fairy-stockfish/Fairy-Stockfish
16. **"Texel tuning for piece values"**, hgm and jdart, TalkChess — the balanced-material failure mode and the
    imbalance-seeded-corpus prescription. https://talkchess.com/forum3/viewtopic.php?t=69194
17. **Hans Bodlaender, Thai chess rules** — ultimate counts 8/16/22/32/44/64; *"The count always starts at the total
    number of pieces (including both Kings) on the board, plus one"*; and the non-monotonicity quoted in §K5.
    https://www.chessvariants.com/oriental.dir/thai.html
18. **Tudsuan & Thanatipanonda, "Building Makruk Endgame Tablebases", J. Science Ladkrabang 35(1), 2026, 112–129.**
    DOI `10.55003/scikmitl.2026.270913`.
20. **Ethereal, Weiss, Lynx and Berserk commit/PR test records** — the ablation and addition figures in §X1–X4.
    SEE: Lynx PR 558 **+51.98 ± 16.22 STC / +34.56 ± 13.23 LTC**, Weiss `2568fb7a` **+35.73 ± 12.73 STC**,
    Ethereal `e755a814` ablation **−41.54 ± 2.98 / 22,637 games**. TT aging: Weiss `df0d853f` **+6.54 ± 5.23** at
    8 MB and **+2.23 ± 2.32 / 41,720** at 64 MB (author: *"Improves strength when TT is small… Otherwise seems to be
    a wash"*), Berserk `7cf3c50a` **+1.99 ± 1.26 / 117,092**, Lynx PR 526 **−8.4 ± 9.6** and **−0.2 ± 5.7**.
    Ethereal's pruning gate depths (Beta 8, Futility 8, LMP 8, SEE 10, NMP 2, ProbCut 5, Window 4) from
    `src/search.c`. hgm's "undercut" replacement idea: https://talkchess.com/viewtopic.php?p=881516#p881516
19. **"Transposition Age Tutorial"**, TalkChess — Hyatt's replacement rule (*"If the table age is different from the
    current age, overwrite immediately"*) and Evert's statement of the exact failure mode in `search.rs:214`:
    *"the TT will fill up with stale deep entries that are never replaced."* **No participant reports a measured Elo
    gain from aging**; D Sceviour reports empirical tests showing unclear benefit.
    https://talkchess.com/viewtopic.php?t=59047

**Two sourcing warnings for whoever re-runs this.** (a) `chessprogramming.org` returned HTTP 503/403 throughout;
CPW content had to come via Wayback. (b) TalkChess's phpBB fulltext index **silently drops the token "elo"** as too
common — it reports `ignored: elo`. Every "how much Elo is X worth" search anyone has run was really searching the
*other* terms, date-ordered rather than relevance-ranked. Use `viewtopic.php?p=NNNNNN` permalinks directly.

**And one warning about the sources themselves:** algerbrex recalled his own doubled/isolated and passed-pawn work
as *"about 20 Elo… another 20 Elo… so overall 40-ish"*. His own SPRT log says 33.4 and 36.1 — roughly 70 combined,
a ~40% understatement **by the person who ran the tests**. Prefer logged tables over forum recollection, including
the author's own.

## Method note

The §A measurements sample every 53rd row of a 10M-row corpus (2.1M rows scanned, 40–60k positions used), reconstruct
positions with a JavaScript mirror of `movegen.rs`/`eval.rs`, and hold out **one third of games** — not of positions —
for validation. Total cost: ~4 minutes on one `nice`d core. No engine binary was invoked, no arena block was played,
no training was run.

**The mirrors are scouting instruments and must not be trusted as implementations.** Anything in §A that gets acted
on should be re-derived in Rust against the real `evaluate_board`, with the default-parameters-equal-current-eval
assertion described in §E2 — which is precisely the discipline `scripts/preflight.mjs` enforces for the arena and
which nothing yet enforces for the eval.

---


## Appendix: where the sources disagree, and what changed my mind

Three independent literature sweeps fed this document. They disagreed with my first draft in five places. Recording
the disagreements rather than a tidy consensus, because two of them are still unresolved.

### X1. Addition Elo and ablation Elo are different measurements — do not mix them

The calibration point I should have made in the first draft. **Ablation** = Elo *lost* when a feature is removed from
a complete engine (Ethereal, Stockfish). **Addition** = Elo *gained* when it is added to a sparse one (Blunder,
Rustic, Lynx). RFP measures **+57 by addition** (Blunder) and **−32 by ablation** (Ethereal): same feature, and the
gap is the method.

**For a sparse, shallow engine the ADDITION numbers are the ones that transfer**, and that is the class this engine
is in. Every figure in the main table is an addition number where one exists.

Two corollaries worth keeping:

- **Model pruning gates on Ethereal, not Stockfish.** Ethereal's gates are all ≤10 (Beta 8, Futility 8, LMP 8,
  SEE 10, NMP 2, ProbCut 5, Window 4), so each fires inside a depth-8 ceiling. Stockfish's mostly do not (check
  extension `depth > 9`, IID `depth >= 7`, ProbCut `depth >= 8`). **A Stockfish-shaped gate is dead code here.**
- **Techniques that SHRINK as time control grows are good bets for us; ones that grow are bad bets.** Measured:
  Weiss qsearch futility 33.79 → 6.10 STC→LTC, Lynx qsearch SEE 51.98 → 34.56, Weiss TT replacement 16.98 → 6.63
  (all favourable — they are worth *more* at our short movetime); Weiss quiet LMP 8.89 → 22.78 and Lynx aspiration
  n.s. → 4.82 (both unfavourable).

### X2. UNRESOLVED — SEE. I demoted it on an argument that turned out to rest on an artifact

My first draft ranked SEE 15th of 16, arguing that makruk's compressed piece values make MVV-LVA "less wrong" so SEE
matters less. **That argument leaned on the tuned value range (652/284/226/112/96/100), and §K3 established those
values are an identifiability artifact.** The demotion rested on nothing, and SEE is now row 2.

Against my mechanism argument, four measurements:

| source | result | n |
|---|---|---|
| Lynx PR 558, qsearch | **+51.98 ± 16.22 STC / +34.56 ± 13.23 LTC** | — |
| Weiss commit 2568fb7a, qsearch | **+35.73 ± 12.73 STC / +24.89 ± 9.66 LTC** | — |
| Ethereal commit e755a814 (ablation) | **−41.54 ± 2.98** | 22,637 |
| Blunder, qsearch | +25.9 ± 12.8 | 2,000 |

Two independent ~1.2 M-nps engines agree, it **grows at short time control** (our direction), and Ethereal's
`SEEPruningDepth = 10` fires inside our ceiling.

**Still unvalidated on makruk.** The compressed-values argument may yet be right — it just needs the *published*
makruk values (§K1), not my fitted ones, and nobody has measured it. **Once the tuner exists this is cheap to price
against held-out loss before spending an arena block**, which is how the disagreement should be settled.

Note also: **there is no Elo measurement anywhere for SEE-vs-MVV-LVA as *ordering*.** The only data is Hyatt's 1995
Crafty node counts on a SparcStation 20 at ~10k nps. The measured case is entirely about **pruning in quiescence**.
Treat "SEE ordering beats MVV-LVA" as unquantified.

### X3. RESOLVED AGAINST ME — TT aging is worth ~nothing here, and I recommended the wrong fix

My first draft ranked TT aging 3rd at +15 to +40. It is now row 13 at ~0 to +10, and the arithmetic is not close.

hgm's sizing rule [8], verbatim: *"there isn't much replacement when the search tree is not at least 10x larger than
the table."* Applied to this engine's own constants:

| quantity | value | source |
|---|---|---|
| nps, classical eval | 885,000 | AGENTS.md |
| movetime | 100 ms | the gate |
| **nodes per move** | **~88,500** | product |
| `TT_SIZE` | **262,144 entries** | `src/search.rs:11` (`1 << 18`) |
| **tree ÷ table** | **0.34×** | — |

**The table is 3× larger than the entire per-move search tree**, against a rule that wants the tree 10× larger than
the table — off by ~30× in the wrong direction. A single search never fills the table once, so replacement policy
cannot register, and neither can aging. That is exactly why Lynx measured **−8.4 ± 9.6 and −0.2 ± 5.7**, why
Blunder's +30 required dropping to a **1 MB** hash "to put more pressure on the replacement scheme", and why
lithander's gain appeared only at 5 MB and 10 s+10 s.

Isolated aging measurements, all tiny: Weiss **+6.54 ± 5.23** at 8 MB, **+2.23 ± 2.32** at 64 MB (41,720 games),
Berserk **+1.99 ± 1.26** (117,092 games). Weiss's author, verbatim: *"Improves strength when TT is small (in context
of the time control). Otherwise seems to be a wash."*

**But do not over-correct — the within-game argument survives, as a different mechanism.** hgm's rule answers *"does
replacement policy matter within one search?"* (no). It does not answer *"does the table poison across one long
game?"*, and in makruk those diverge: one search is 88.5k nodes into 262k slots, but one **game** is mean **203
plies** × 88.5k ≈ **18M node-visits** into the same 262k slots under a policy that replaces on **depth alone**. A
deep entry stored at move 20 can never be evicted by a shallower one at move 90. This repo measured the consequence
across games at **17.6 points, 4.0σ**.

So the real defect is **accumulation under a never-evicting policy**, not replacement pressure — and the right fix is
cheaper than either an age field or a rewritten scheme. **hgm's "undercut":** also allow replacement when the new
entry's depth is *exactly one lower* than the occupant's — *"an intermediate between always-replace and
depth-preferred, that eventually flushes out everything."* A few lines at `src/search.rs:214`, no generation counter,
no extra memory.

**And measure it hgm's way, not with games:** *"you should not try to test this by playing games. You should just
measure time-to-depth for a few hundred test positions."* lithander did — 300 WAC positions to fixed depth 20,
**196 min → 136 min**. We have `tests/fixtures/probe-v1.jsonl` and could do the same in minutes, with no arena block
and no thermal cost.

### X4. RESOLVED AGAINST MY FIRST DRAFT — PVS is real, but not at +55 for us

I first deferred PVS on the spec's reasoning that it is "a small delta" given the null-window LMR re-searches. That
reasoning was wrong in general: the headline "+55" has **two** independent measurements (Blunder +56.2 ± 13.8,
Rustic +54.2 ± 16.6), and the earlier "no effect" report was page 1 of a thread that resolves the other way.

But two qualifications bring it back down for *this* engine:

- **On top of LMR it fell to +13.9 ± 10.8.** We have LMR and null-window LMR re-searches already.
- **It measures move ordering, not itself.** Same code, same author: **−12.7 ± 9.0 over 4,311 games** with a
  move-scoring bug, **+56.2** after swapping in Rustic's ordering. algerbrex: *"Since PVS is highly dependent on good
  move ordering, buggy move ordering of course would mean PVS would waste time doing expensive researches."*

Net: row 7 at **+10 to +25**, and **verify move ordering before measuring it**. Nothing in this repo ever has.

### X5. The check-extension corroboration, and the two mechanisms that explain the nulls

Beyond Evert's makruk +18 [6]: Nirvana SEE-gated vs extend-all **+6 ± 17**; Maverick **+33 for REMOVING** extensions
entirely; Hakkapeliitta **+3 (error 2,3) over 39,589 games** — the largest N in the corpus, and it is zero. Hyatt:
*"maybe 20 Elo or so at best… But notice I do NOT extend every check. I exclude checks with a SEE < 0."*

Two mechanisms explain why so many measurements land on zero, and both apply here:

- **Henk:** *"If LMR does not reduce when in check … that is your extension."* `search.rs:323` requires `ext == 0`
  to reduce, so we already have this — part of the gain is priced in.
- **hgm:** extending checks in the endgame *"would sink way too much search effort into checks"*. In makruk, where
  43.5% of games run past 200 plies into counting endgames, that is the dangerous half — and it is the same concern
  §S7 raised from the makruk side.

**Blocking dependency:** `grep -rn "SEE" src/*.rs` returns only zobrist `SEED`. **We have no SEE**, so the +18 is
unreachable until row 2 is built. That is a large part of why SEE moved to row 2.

### X6. Two methodology warnings that changed how I read every source

- **The Chess Programming Wiki carries zero Elo numbers across all 14 relevant pages.** It repeatedly *links* the
  measurement while omitting the number (Futility links "How much elo from futility?", LMR links "Elo expected from
  LMR", SEE and MVV-LVA both link Hyatt's 1995 threads). CPW is authoritative on *mechanism* and useless for *value*.
  **Do not cite CPW for Elo.** Its Mobility page is Slater 1950, Turing, Heisman — history, not measurement.
- **SPRT point estimates are biased high**, because the test stops when a bound is crossed. Trust the 20k–150k-game
  rows; distrust the 600–2,000-game ones. This repo already holds that rule (AGENTS.md, "Do not quote an SPRT point
  estimate as an effect size") — it applies to the borrowed numbers too, and most of the Blunder figures in the
  main table are 1,000–3,000-game rows.

### X7. Net effect on the recommendation

**Unchanged: Texel-tune the eval constants first** — in the corrected, split form of §K3. Every disagreement above is
in the *search* column, and the two contested rows (SEE, TT replacement) both become cheap to settle once an
instrument exists: SEE against held-out loss, TT by time-to-depth on the existing probe fixture. Neither needs an
arena block, and neither is blocked by the tuner.

| what moved | was | now |
|---|---|---|
| SEE | 15th, demoted on the compressed-values argument | **row 2** — the argument rested on artifact values (§K3), and four measurements run against it |
| Check extensions | "already implemented, is it safe?" | **row 3** — gate on SEE ≥ 0 for **+18, measured in makruk** |
| PVS | "small delta", deferred | **row 7** at +10 to +25 — real, but LMR already claims most of it |
| Aspiration | +5 to +20, discounted for depth | **row 11 at +18**, measured at exactly depth 8–10 |
| TT aging | **row 3 at +15 to +40** | **row 13 at ~0 to +10** — the table is 3× the tree; do *undercut* instead, and measure by time-to-depth |
