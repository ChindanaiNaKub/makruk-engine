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

| # | Technique | Elo | Hours | **Elo/h** | Ev. | Makruk caveat |
|---|---|---|---|---|---|---|
| 1 | Delta pruning in quiescence | +10 to +25 | 0.5 | **35** | **[B]** | Compressed piece values (§M2) cap the worst-case swing at ~⅓ of chess's, so a tight margin is **safer** here |
| 2 | Reverse futility / static null-move pruning | +15 to +40 | 1 | **28** | **[B]** | Must carry the counting guard, same as NMP — a passive position under a closing count is *losing*, not neutral (§S2) |
| 3 | Late move pruning (move-count) | +15 to +35 | 1 | **25** | **[B]** | Branching factor **22.8** vs chess's ~35 (§A1) — shorter tail to prune, so expect the low end; retune the count thresholds |
| 4 | **Counting-gate eval term** (unpromoted bia blocks counting) | +20 to +60 | 2 | **20** | **[M]** | Makruk-only. No chess literature exists or could. **30-point** swing at a 400–700 cp edge, piece count fixed (§A3) |
| 5 | Tempo | +0 to +10 | 0.25 | **20** | **[B]** | Lowest-confidence row in the document. Fold it into the tuner as one free parameter rather than guessing (§E7) |
| 6 | **TT aging / generation counter** | +15 to +40 | 1.5 | **18** | **[R]** | **Amplified by makruk**: mean game **203 plies**, 43.5% past 200 (n=1,460 ledger games) — ~2.5× chess. Also tripled the unconverted-game rate (§S1) |
| 7 | **Dead `PAWN_ADVANCE` slot + colour-blind king safety** | +0 to +15 | 0.5 | **15** | **[M]** | `PAWN_ADVANCE[5]=30` fired **0/40,000** — unreachable *because* promotion is at rank six (§A4) |
| 8 | **Texel-tune the existing eval constants** | +40 to +90 | 5 | **13** | **[M]** | None — the fit runs on makruk data. **The only row that borrows nothing.** Loss −4.08% held out (§A5) |
| 9 | Capture-only movegen for quiescence *(off-ticket)* | +20 to +50 | 3 | **12** | **[S]** | Largest nps lever in the engine; qsearch generates all legal moves then discards ~90% (§S6) |
| 10 | Futility pruning (frontier nodes) | +5 to +15 | 1 | **10** | **[B]** | Overlaps RFP heavily; sources usually bundle them. Same counting guard |
| 11 | Principal variation search (PVS) | +5 to +20 | 1.5 | **8** | **[B]** | Neutral. Already null-window on LMR re-searches, so the delta is small — the spec reached this independently |
| 12 | Phase interpolation (tapered eval) | +10 to +30 | 3 | **7** | **[M]** | Phase is **bimodal** here (28.2% >20 pieces, 48.6% ≤10). Worth 1.38% *further* loss beyond tuning (§A6) |
| 13 | Aspiration windows | +5 to +20 | 2 | **6** | **[B]** | The depth discount bites hardest here — 8 iterations at movetime 100, not 25 (§S9) |
| 14 | **Mobility — rua only** | +5 to +20 | 2 | **6** | **[M]** | **Do not port per-piece mobility.** Only the rua carries signal (partial r **+0.123**); met/khon/ma are 0 to negative (§A2) |
| 15 | SEE for capture ordering + qsearch pruning | +10 to +30 | 4 | **5** | **[B]** | **Cheaper to write in makruk** (one x-ray case) but **less urgent** (MVV-LVA is less wrong on compressed values) |
| 16 | Bia structure (doubled / connected / passed) | +0 to +10 | 2 | **3** | **[M]** | **The chess framework does not transfer.** Promotion yields a *met* — worth ~0–100 cp, not +800 (§M3, §E6) |

### The ranking's own biggest weakness, stated plainly

**The top three rows are all [B] — borrowed chess numbers I could not validate on makruk.** They rank first largely
because their *denominators* are small (half an hour, one hour), not because their numerators are trustworthy.
Elo-per-hour systematically rewards cheap techniques with unreliable Elo estimates, and this project's stated history
is of being burned by numbers that measured something other than what they claimed.

Read the table two ways:

- **By Elo/h** (as the ticket asks): do delta pruning, RFP and LMP first. ~2.5 hours for a claimed +40 to +100.
- **By Elo/h among rows measured on makruk data** ([M]/[R] only): counting-gate term (20), TT aging (18), dead-constant
  cleanup (15), Texel tuning (13). ~9 hours for a claimed +75 to +205, none of it borrowed.

**I recommend the second list, and within it I would start with Texel tuning even though it ranks fourth of the four.**
Reasons in §"Which one I would do first" — the short version is that it is the only item that builds the instrument
that prices the other three.

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

6. **It ranks 8th by raw Elo/h and that is an artifact of the metric, not a verdict.** The seven rows above it are
   cheap; five of them are borrowed chess numbers. Texel tuning has the largest *absolute* claimed gain in the table
   and the only claim in the top half that was measured on makruk data. A ranking that puts a 15-minute tempo constant
   above it is telling you about denominators, not about strength.

**Then, in order: the counting-gate term (E1), TT aging (S1), the dead-constant/king-safety cleanup (A4/E4), and
delta pruning in quiescence (S5).** That is roughly 9.5 hours covering every row measured on makruk data plus the
single cheapest borrowed one — after which the tuner exists, so RFP/LMP/tempo can each be priced against held-out
loss before any of them costs an arena block.

**What I would *not* do early:** aspiration windows and PVS. Both are real, both are cheap, and both are the
techniques whose published value most depends on search depth this engine does not have — and the spec already
reached the same conclusion about PVS from a different direction.

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
| RFP worth +20 to +50 | **BORROWED from chess self-play patches.** No makruk evidence. Shallow-depth technique, so the transfer is more credible than most |
| LMP worth +15 to +35 | **BORROWED from chess.** Discounted downward for BF 22.8 vs 35 |
| Delta pruning worth +10 to +25 | **BORROWED from chess**, and mostly asserted rather than isolated even there |
| PVS worth +5 to +20 | **BORROWED from chess**, discounted for depth 8 |
| Aspiration worth +5 to +20 | **BORROWED from chess**, discounted hardest for depth 8 / 8 iterations |
| SEE worth +10 to +30 | **BORROWED from chess**, where it is usually measured at depth 15+ |
| Tempo worth ~10–15 cp | **BORROWED and asserted**, not measured. Lowest-confidence row in the document |
| Futility pruning worth +5 to +15 | **BORROWED**, and usually bundled with RFP in the sources, so hard to attribute |
| TT aging is worth Elo *as an isolated patch* | **NOT MEASURED ANYWHERE I could find.** Chess sources treat it as hygiene. The number in the table is an inference from this repo's own 17.6-point proxy |
| Texel tuning worth +40 to +90 Elo | **PART-MEASURED, PART-BORROWED.** The loss reduction is measured here; the *conversion from loss to Elo* is borrowed chess experience and is the weak link. Flagged in §E2 |

**No makruk-specific engine-programming literature was used for any Elo figure in this document.** Every non-repo
Elo number is a chess number. Where a chess number could not be responsibly adjusted, I have said so rather than
adjusting it decoratively.

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

## Second source: an independent chess-literature sweep, and where it disagrees

A peer session ran the same question against the chess literature only — no makruk measurements — and reported back
2026-08-03. Recorded here because two of its conclusions **contradict this document's ranking**, and a disagreement
between sources is worth more in the record than a tidy table.

### Its calibration point, which this document should have made and did not

**Ablation and addition Elo are not the same measurement and must never be mixed.** Ablation = Elo *lost* when a
feature is removed from a complete engine (Ethereal, Stockfish). Addition = Elo *gained* when it is added to a sparse
one (Blunder, Rustic, Lynx). RFP measures **+57 by addition** (Blunder) and **−32 by ablation** (Ethereal) — the same
feature, and the gap is the method. **For a sparse, shallow engine the ADDITION numbers are the ones that transfer**,
which is the class this engine is in.

Two corollaries it drew that this document endorses:

- **Model pruning gates on Ethereal, not Stockfish.** Ethereal's gates are all ≤10 (Beta 8, Futility 8, LMP 8, SEE 10,
  NMP 2, ProbCut 5, Window 4), so every one fires inside a depth-8 ceiling. Stockfish's mostly do not (check ext
  `depth > 9`, IID `depth >= 7`, ProbCut `depth >= 8`). A Stockfish-shaped gate is dead code here.
- **Techniques that SHRINK as time control grows are the good bets for us**, and ones that grow are bad bets. Measured:
  Weiss QS futility 33.79 → 6.10 STC→LTC, Lynx qsearch SEE 51.98 → 34.56, Weiss TT replacement 16.98 → 6.63 (all
  favourable); Weiss quiet LMP 8.89 → 22.78, Lynx aspiration n.s. → 4.82 (both unfavourable).

### Disagreement 1 — qsearch SEE pruning. UNRESOLVED, and it is this document's weakest row.

This document ranks SEE **15th of 16** (Elo/h 5), on the argument that compressed makruk piece values make MVV-LVA
"less wrong" so SEE is less urgent. **That is a mechanism, not a measurement**, and the peer has measurements against
it:

| source | result | n |
|---|---|---|
| Lynx PR 558, qsearch | **+51.98 ± 16.22 STC / +34.56 ± 13.23 LTC** | — |
| Weiss commit 2568fb7a, qsearch | **+35.73 ± 12.73 STC / +24.89 ± 9.66 LTC** | — |
| Ethereal commit e755a814 (ablation) | **−41.54 ± 2.98** | 22,637 |
| Blunder, qsearch | +25.9 ± 12.8 | 2,000 |

Two independent ~1.2 M-nps engines agree, it **grows at short time control** (the favourable direction for us), and
Ethereal's gate is `SEEPruningDepth = 10`, so it fires inside our depth-8 ceiling. On the peer's evidence it is the
**#1 pick**; on this document's it is 15th.

**Neither is validated on makruk.** The honest position: this document's compressed-values argument predicts a smaller
gain, and nothing has measured whether that prediction is right. **Once the tuner exists, SEE pruning is cheap to
price against held-out loss before spending an arena block** — which is another reason to build the tuner first, and
is how this disagreement should actually be settled.

### Disagreement 2 — TT aging. The peer is closer to right, and this document over-ranked it.

This document ranks it 6th at **+15 to +40**, amplified by makruk's 203-ply mean game. The peer found the three
isolated measurements that exist, and they are far smaller — one pair is **negative**:

| source | result | n |
|---|---|---|
| Weiss df0d853f, Hash = 8 MB | +6.54 ± 5.23 | 9,136 |
| Weiss df0d853f, Hash = 64 MB | +2.23 ± 2.32 | 41,720 |
| Berserk 7cf3c50a | +1.99 ± 1.26 | 117,092 |
| Lynx PR 526, two attempts | **−8.4 ± 9.6 (H0 accepted) and −0.2 ± 5.7** | — |

The reconciling mechanism, from Weiss's author verbatim: *"Improves strength when TT is small (in context of the time
control). Otherwise seems to be a wash."* **Value is a function of hash size relative to fill per move, not of depth
or game length directly.** This document's 203-ply argument raises fill-per-game, which is the right variable — but
the ceiling those four rows imply is single-digit Elo, not +40, and **the +15 to +40 in the table above is not
supported.** Treat row 6's range as wrong-high pending a measurement here.

**The peer's actionable correction, which this document missed entirely:** fix the **replacement scheme** before adding
an age field. Weiss's replacement-scheme change measured **+16.98 ± 8.97 STC**, Lynx's **+6.6 ± 5.2** over 10,275
games, and Blunder's TT-replacement **bug fix alone +30.0 ± 11.9 (H1 accepted)** — every one larger than aging itself.
`src/search.rs:214` replaces on depth alone, which is a *scheme* problem before it is an *aging* problem.

Supporting mechanism from Stockfish `tt.cpp` (sf_17): replacement value is `depth8 − relative_age * 2` where
`relative_age()` returns multiples of `GENERATION_DELTA = 8`, so **one generation of staleness costs 16 plies of depth
credit** — age overrides depth entirely rather than tie-breaking it.

### Disagreement 3 — check extensions. This document is right, and the question was malformed.

The peer answered the ticket as written (~1–3 Elo; Stockfish removed them entirely in SF17; SF's `depth > 9` gate
would never fire under a depth-8 ceiling) — all correct, and all moot. **They are already implemented here**
(`src/search.rs:271`, applied at `depth - 1 + ext` on lines 336 and 341). Verified in source. The live question
remains §S7: whether the unconditional, unlimited form is safe.

### What the peer confirms that this document also found

- Aspiration windows and PVS are low-yield and should not be done early. The peer adds that PVS's gain is
  **contingent on move-ordering quality, not depth**, and that without a TT and good ordering it *loses* Elo
  (TalkChess t=78183 reports a null result at 3+0.08). This engine has both, so the small delta stands.
- LMP is real but modest: **+4.7 ± 3.9 over 18,875 games (Lynx)** is the honest bolt-on expectation, not Ethereal's
  −76.88 ablation. It also **scales up with time control**, which is the wrong direction for us. Row 3's +15 to +35
  is optimistic; expect the low end or below.
- SPRT point estimates are biased high because the test stops when a bound is crossed — trust the 20k–150k-game rows,
  distrust the 600–2,000-game ones. This repo already holds that rule (AGENTS.md).

### One methodological warning the peer supplies and this document should adopt

**The Chess Programming Wiki carries zero Elo numbers across all 14 relevant pages** — it repeatedly *links* the
measurement while omitting the number (Futility links "How much elo from futility?", LMR links "Elo expected from
LMR", SEE and MVV-LVA both link Hyatt's 1995 threads). **Do not cite CPW for Elo.** Related: there is **no Elo
measurement anywhere** for SEE-vs-MVV-LVA as *ordering* — the only data is Hyatt's 1995 Crafty node counts on a
SparcStation 20 at ~10k nps. Treat "SEE ordering beats MVV-LVA" as unquantified.

### Net effect on the recommendation

**Unchanged: Texel-tune the eval constants first.** The disagreements above are all in the *search* column, and both
of the contested rows (SEE, TT aging) become cheap to settle empirically once the tuner exists. The peer's sweep
strengthens the case rather than weakening it — it shows the search column is exactly where borrowed numbers disagree
by 10× and where this project has no instrument to arbitrate.

**Changed:** row 6 (TT aging) is over-ranked and should be read as single-digit Elo until measured here, with the
**replacement scheme** as the larger and prior fix. Row 15 (SEE) is under-ranked on an unvalidated mechanism argument
and should be treated as contested, not settled.

---

## CORRECTION (2026-08-03, same day): the tuned piece values are NOT a measurement

A second peer session challenged the headline Texel result, and the challenge holds. **§A5's per-piece tuned values
above are a parameter-identifiability artifact and must not be quoted as makruk piece values.** The recommendation to
tune first survives; the numbers it produced do not.

### The disproof, from this repo's own source

`src/eval.rs:72` reads:

```rust
Kind::M | Kind::PM => 200,
```

**Met and promoted bia share a match arm because they are the same piece** — a promoted bia in makruk *is* a met, with
identical movement. The engine's author encoded that identity. The fit was free to move them independently and did:

| parameter | shipped | tuned (overall) | tuned (opening / endgame) |
|---|---|---|---|
| Met | 200 | **112** | **168 / 80** |
| Promoted bia | 200 | **96** | **8 / 72** |

Two parameters that are physically the same piece came out **15% apart overall and 21× apart in the opening phase**
(168 vs 8). Nothing about makruk can produce that. It bounds the fit's own noise floor on piece values at worse than
±15% — **wider than the entire published disagreement between makruk engines** (Fairy-Max 181, Makruk-Stockfish 159,
SjaakII 187, normalized to bia = 100).

### The mechanism, and it was predicted

H.G. Muller and jdart, *"Texel tuning for piece values"* (https://www.talkchess.com/forum3/viewtopic.php?t=69194):
in a corpus of ordinary games material is **nearly always balanced**, so there is almost no signal separating piece
values, and the fit collapses them toward whatever best fits the sigmoid on positional grounds. jdart stopped tuning
piece values entirely and tuned imbalance correction factors instead; Muller's prescription is a **separate corpus
generated by self-play from deliberately imbalanced starting positions**, fitting values only on that.

§A6 above gestured at this ("values are only learnable where imbalances occur") and then **quoted the values anyway.**
That was the error.

**The pattern confirms the diagnosis rather than contradicting it.** Rua moved 500 → **652**, *toward* the published
band where Fairy-Max (630), SjaakII (625) and Makruk-Stockfish (676) all agree. The rua is the piece that appears in
lopsided endgames; the met is the piece that almost never appears as a clean imbalance. **The fit worked exactly where
Muller predicts it works and failed exactly where he predicts it fails.**

### What survives, precisely

- **SURVIVES: the −4.08% held-out loss improvement from retuning existing constants** (§A5), and the finding that the
  shipped positional terms predict game results *worse than deleting them*. That is a held-out result on a by-game
  split and it is the actual argument for tuning first.
- **SURVIVES: "build the tuner first."** It is now *better* supported — the instrument needs constraints the argument
  above could not have discovered without it.
- **DOES NOT SURVIVE: every per-piece number in §A5 and §A6.** Met 112, PM 96, and the per-phase splits are artifacts.
- **DOES NOT SURVIVE: §M2's "compressed piece values" argument**, which leans on the tuned range 652/284/226/112/96/100
  and is the sole justification for ranking SEE 15th (§"Disagreement 1"). **That row's demotion now rests on nothing.**

### Required before the tuner's output is trusted

1. **Tie met and promoted bia to one shared parameter.** They share a match arm in the eval; they must share one in
   the fit. If the met then lands in the published 150–192 band, this was identifiability, not discovery.
2. **Anchor bia at 100** rather than fitting it, so the scale is fixed and the others are read against it.
3. **Check what else got crushed toward zero.** Petzke's iCE regression (−20 to −24 Elo,
   http://macechess.blogspot.com/2014/03/the-texel-way-of-tuning_10.html) was caused by the optimizer zeroing small
   terms because predicting a draw minimizes MSE. `PM 8` in the opening phase is that failure mode, visible.
4. **Fit piece values on a separate imbalanced-position corpus, or not at all.** Muller's prescription. The cheap
   version: tune positional terms only, and leave `kind_value()` at its shipped values pending a proper imbalance corpus.

### Published makruk piece values, for the anchor (bia = 100)

| source | met | khon | ma | rua |
|---|---|---|---|---|
| Fairy-Max (H.G. Muller), `fmax.ini` | 181 | 300 | 450 | 630 |
| SjaakII (Evert Glebbeek), `variants.txt` | 187 | 344 | 406 | 625 |
| Makruk-Stockfish (ianfab), mg | 159 | 312 | 412 | 676 |
| Makruk-Stockfish, eg | 192 | 293 | 386 | 645 |
| ChessV | 150 | 260 | — | — |
| **this engine, shipped** | **200** | **250** | **300** | **500** |

Shatranj ferz (identical geometry to the met) consensus band: **1.35–1.9 bia**. Muller self-play: "Ferz ~ 1.35 pawns";
"a pair of Ferzes tested as ~25cP weaker than a Knight". Our shipped 200 sits at the top of the published band; the
tuned 112 sits **below all of it**.

**The met is the only makruk piece that GAINS value into the endgame** (Makruk-Stockfish 316 → 396, +25%, where khon,
ma and rua all lose) — the opposite of chess, and a real argument for tapered eval (row 12) independent of tuning.

### Independent confirmation of the counting-gate finding (§E1)

The same peer read Fairy-Stockfish master: `CountingRule` is **adjudication only** — `count_limit()`
(`position.cpp:3167`) has exactly one consumer, `is_optional_game_end()` returning `VALUE_DRAW`, and there are **zero
hits in `evaluate.cpp`, `search.cpp`, `material.cpp` and `endgame.cpp`**. Fairy-Stockfish has the same blindness this
document measured here, and makruk additionally sets `nMoveRule = 0`, skipping the usual shuffle damper.

**And there is a reference implementation.** ianfab's dedicated Makruk-Stockfish fork *does* have counting-aware eval —
`endgame.cpp:133`: `result = result * max(2 * counting_limit() - rule50_count(), 0) / 128`, from the commit *"Make KXK
drawish if counting is enabled"*. It also carries a met-pair imbalance bonus. §E1 was derived independently here from
this repo's own corpus; it agrees with the one engine that took makruk seriously enough to special-case it.

Note the strength context, which cuts against copying Fairy-Stockfish uncritically: Fairy-Stockfish classical beats
Makruk-Stockfish by **+230.16 ± 16.7**, despite Makruk-Stockfish being the counting-aware one.
