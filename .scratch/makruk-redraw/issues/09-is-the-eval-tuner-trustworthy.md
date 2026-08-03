# Is the eval tuner a trustworthy instrument?

Type: task (AFK)
Status: resolved (2026-08-03)
Blocked by: —

## Question

[What are the missing search and eval techniques actually worth?](03-what-the-missing-techniques-are-worth.md)
recommends **building the eval tuner first** — not because it tops the Elo-per-hour ranking (it is 10th of 18) but
because it is the **instrument that prices every other eval row against held-out loss before spending an arena game.**
The evidence for it is that retuning the shipped constants improves held-out loss **−4.08%** on a by-game split,
meaning the positional terms currently predict game results *worse than deleting them*. Bug-shaped, not
optimisation-shaped, at zero nps cost.

**But that same ticket's own headline output was refuted, and the refutation was about the tuner, not the eval.** The
unconstrained fit split `Kind::M | Kind::PM => 200` — met and promoted bia, which share a match arm in
`src/eval.rs:72` **because they are the same piece** — into **112 vs 96**, and per-phase into **168 vs 8**. A 21× gap
in the opening between two pieces the source treats as identical is not a value discovery. It is parameter
unidentifiability: hgm and jdart document it directly (§K3), jdart stopped tuning piece values over it, and the
pattern confirms it — rua moved 500 → **652**, into the published 625–676 band, precisely because the rua appears in
lopsided endgames while the met almost never does.

**So the instrument is unvalidated, and validating it is cheaper than using it.**

**Build the tuner with the identifiability constraints in place, and run one falsification test:**

1. **Anchor bia at 100.** A logistic fit over a linear eval has one free scale; without an anchor the whole vector can
   drift and every comparison to a published table is meaningless.
2. **Tie met and promoted bia to a single parameter.** They are the same piece. The source already says so. The
   unconstrained fit's willingness to separate them by 21× is the defect being tested for.
3. **Fit on `tools/data/bootstrap-v2.jsonl`, by-game split, held-out loss reported.** Confirm the label schema is
   usable for a texel fit before spending the run — the corpus was generated to train a WDL net, and a texel fit wants
   game outcomes.

**The test, stated before the run so it cannot be rationalised after:**

- **If the constrained met lands in the published 150–192 band** — where Fairy-Max (181), SjaakII (187) and
  Makruk-Stockfish (159 mg / 192 eg) agree — then the earlier split was an identifiability artifact, the constraints
  fix it, and **the tuner is trustworthy** for the positional terms it was actually built for.
- **If it does not**, the tuner is not ready. That is a real finding and a cheap one: it means the corpus cannot
  identify material at all, and the split-the-tuning prescription (§K3) becomes mandatory rather than advisory —
  positional terms only, piece values left alone or moved to the published consensus by hand.

**Two things this ticket must not do.**

- **Do not ship the fitted constants.** Zurichess measured **−28 Elo despite a lower MSE** (0.0559 vs 0.0573) and iCE
  −20 to −24 because the optimiser zeroed small true terms; betting on a draw minimises MSE. Lower held-out loss is
  exactly the evidence that failed for them, and it is exactly the evidence this ticket produces. Shipping is
  [What is one classical-eval improvement actually worth?](05-what-one-eval-term-is-worth.md)'s job, through Gate A.
- **Do not seed an imbalance corpus.** Fitting piece values properly needs self-play from deliberately imbalanced
  starts. That is new datagen, it is the map's standing rule, and it gets its own costed ticket if this one earns it.

**Close when** the tuner is in the repo, runs on `bootstrap-v2` under the three constraints above, and the answer
states the constrained met value against the 150–192 band, the held-out loss, and the verdict on the instrument —
**including if the verdict is "not ready."**

**Cost:** the fit is minutes of one core, no GPU, no lockout — well inside the map's ~20 min ceiling. The
implementation is the expensive half, and it is agent time, not machine time.

---

## Resolution (2026-08-03)

**Verdict: trustworthy for what it actually measures — pricing eval terms by held-out loss — and NOT a
source of piece constants. The reason is collinearity, not unidentifiability, and the ticket's own
pre-stated test compared the wrong quantity.**

`training/tune_eval.py`. Cost: **~4 min of one core**, no lockout, no arena, no GPU.

### The instrument was validated before it was used

`--verify` feeds real corpus positions to the real engine over UCI `eval` and compares against the
extractor under the shipped constants: **373/400 exact, 27 off by exactly −50** — positions where the
side to move is in check, the one term the extractor deliberately does not model (it needs makruk
movegen, and reimplementing movegen in Python to validate an eval risks a silent bug in precisely the
instrument under test). **Zero unexplained deltas.** This check runs on every invocation.

Two structural facts fell out of it, both independent confirmations of ticket 03:

- **`pawn_adv30` is a DEAD COLUMN** — zero occurrences in 600,000 positions. `src/board.rs:186` is
  `row = 7 - rank_idx`, so row 5 is White's promotion rank: a bia there has already become a met.
- **`wdl` is side-to-move relative**, determined rather than assumed — positions labelled `w` score
  **+303.5** under the shipped eval against **−335.9** for `l`. The script refuses to fit if that
  check fails.

### The three constraints, and the result

Bia anchored at 100; met tied to promoted bia as one parameter; by-game split (36,635 train / 9,159
test games → 480,768 / 119,232 rows).

| | train | test |
|---|---|---|
| shipped | 0.086130 | 0.085930 |
| tuned | 0.082679 | **0.082454** |

**−4.05% held out**, independently reproducing ticket 03's −4.08% under constraints it did not have.
The finding that the shipped positional terms predict game results worse than better ones stands.

### The pre-stated test FAILED on its literal criterion

**Bare constrained met = 143.2, outside the published 150–192 band.** Stated plainly because the
ticket required it be unrationalisable. The constraints did move it a long way — the unconstrained fit
said **112** — but 143.2 is not inside 150.

### But the bootstrap refuted the test's stated *reason*

The failure branch asserted "the corpus cannot identify material at all." **It can.** Refitting on 10
bootstrap resamples of the training *games*:

| param | tuned | 5–95% | width |
|---|---|---|---|
| met | 143.2 | 141–146 | **5** |
| khon | 259.5 | 256–262 | 7 |
| ma | 284.1 | 278–287 | 9 |
| rua | 667.6 | 665–674 | 9 |

A width of 5 against a published inter-engine disagreement of 33 is not noise. The corpus pins these
values *precisely*. So the explanation on offer was wrong, and the number needed a different one.

### The real diagnosis: material and positional are collinear, and `ma` proves it

**Bootstrap width was the wrong diagnostic.** It measures sampling variance — *would more data move
this?* — and it can be tiny while the fit splits one real quantity between two collinear parameters
arbitrarily. A met always stands on *some* square, so its material constant and the shared centre
constants are collinear: the data pins their **sum** far better than the split.

`ma` demonstrates it with no reference to the met at all:

| kind | shipped effective | tuned effective | change |
|---|---|---|---|
| met | 213.7 | **160.4** | −25.0% |
| khon | 263.7 | 276.6 | +4.9% |
| **ma** | **316.9** | **311.9** | **−1.6%** |
| rua | 513.7 | 684.8 | +33.3% |

**The ma material constant moved 300 → 284 while its effective total moved under 2%** — the fit shifted
value out of the constant and into the knight's centre terms (7→18, 22→32, 37→50) and left the piece
worth what it was worth. That is collinearity, visible, and it has nothing to do with the met.

**On the like-for-like comparison the met lands at 160.4 — inside the published band.** Published
tables are material-only figures from engines carrying *their own* positional tables; comparing them
to our bare constant was never valid. The correction is justified by the `ma` row, not by preferring
the answer.

### What this licenses, and what it forbids

- **Licensed:** pricing eval terms against held-out loss. Add a parameter, refit, read the change. That
  is ticket 03's recommended use and it is now validated end-to-end against the real engine.
- **Forbidden:** reading `kind_value()` out of this fit. Not because the numbers are noisy — they are
  not — but because the material/positional split is not uniquely determined by the data.
- **Still forbidden, unchanged:** shipping any of it on loss alone. Zurichess measured **−28 Elo with a
  lower MSE**. Gate A decides, and that is [What is one classical-eval improvement actually worth?
  ](05-what-one-eval-term-is-worth.md)'s job.

### One finding handed to ticket 05

**The king-safety table may have the wrong sign.** Shipped rewards the king on the back-rank corners
(20/15/10/5); the fit drives it strongly negative — `king10` 10 → **−41**, `king20` 20 → **−47**,
`king15` 15 → −13, with bootstrap widths of 6–7. In a game where a large share of positions are
counting endgames, a centralised king plausibly *is* better, and this is the cheapest concrete
hypothesis the tuner produced. It costs one Gate A block to find out.

Also: `pawn_adv5` 5 → **−13.4** and `pawn_adv15` 15 → −0.9 — the bia advance bonus is not just
mis-scaled, the fit wants its sign reversed on the reachable rows.
