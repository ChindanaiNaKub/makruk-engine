# Is the eval tuner a trustworthy instrument?

Type: task (AFK)
Status: open
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
