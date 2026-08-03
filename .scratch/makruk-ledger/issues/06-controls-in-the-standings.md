# Should a control block appear in the standings?

Type: grilling → execution (HITL to settle, AFK to build)
Status: resolved (2026-08-03)
Blocked by: 02

## Question

Two files disagree about what counts as a result, and the generated standings take the losing side.

```js
// results.mjs:198        — drives the CLI default view and AGENTS.md
const NOISE_KINDS = new Set(["smoke", "diag"]);
// control-trigger.mjs:37 — drives which blocks the trigger reasons over
const NOISE_KINDS = new Set(["smoke", "diag", "control"]);
```

So a self-play control — a block whose *expected* score is 0.5 by construction, played against
itself, to prove the harness is symmetric — renders in `AGENTS.md` in the same table as a Gate A
verdict, with a score column, as though it measured something about the engine. **b0009 is the row
that makes this visible**: net 4452 vs net 4452 at 100/100 ms, 16 games, **40.6%**, live in the
standings. A reader scanning that table sees the incumbent net scoring 40.6% and has no way to know
the opponent was itself.

This was charted as fog ("a failed control block is live in the standings"). The audit refuted the
premise and sharpened what remains: **b0009 did not fail.** `controlVerdict()` passes it, because its
3–6–4 split gives sd 0.416 and a **±20.8pp** band. Nothing is broken about b0009. What is wrong is
that it is being read as a result at all.

**What has to be decided:**

1. **Does `kind: control` belong in the default view and the generated standings?** The trigger
   already says no. If the answer is also no here, the fix is one word in `results.mjs`'s
   `NOISE_KINDS` — and then `--kind control` is how you look at them, exactly as `--kind smoke`
   already works.
2. **If a control is hidden, what shows that it ran?** A control is *evidence about the standings*,
   so making it invisible has a cost the smoke/diag exclusion does not: rig ticket 07 made the
   suspect flag load-bearing precisely because a check nobody can see is a check nobody trusts. A
   footer count ("3 controls, all passing") is the cheap end; a `cleared by bNNNN` column already
   exists on the cleared rows.
3. **Should the two `NOISE_KINDS` sets be one thing?** They have already drifted once, they are eight
   lines apart in files that import each other, and this map's whole root cause is two construction
   sites built from the same idea. Either share the constant or state why they legitimately differ —
   the trigger's set answers "what may a control be triggered by", the view's answers "what is a
   result", and those are not obviously the same question.
4. **Does an amended row render differently here?** [The amendment record](02-the-amendment-record.md)
   decides whether `table()` marks an amended row and whether `--all` shows what it used to say. This
   ticket is the second consumer of that decision, which is why it waits on it.

**Resolve with** the change in `results.mjs`, `node scripts/results.mjs --write-agents` re-run, and
the audit still green. State the answer to (3) either way.

**Cost:** a conversation and a few lines. No arena blocks. Thermally free.

**Watch:** the *width* of a control's band is out of scope — `observedSd` drops max-plies games and
inflates every band by up to 45% (see the map's Out of scope). That is control-trigger behaviour. This
ticket is about whether the row is shown, not about what its PASS is worth.

---

## Resolution (2026-08-03)

**Controls are out of the standings. The standings went 21 rows → 13, and all 8 controls pass.**
`node scripts/ledger-selftest.mjs` 47/47; `cargo test --release` green; audit gate clean.

### 1. No, `kind: control` does not belong in the default view

One word in `results.mjs`. The trigger already said no; now both files agree, and `--kind control` is
how you look at them, exactly as `--kind smoke` already worked.

The reason is not that b0009 is broken — **it is not.** It passes its band (3–6–4 gives sd 0.416 and
±20.8pp). The reason is that a self-play control's expected score is **0.5 by construction**, so a
score column beside a Gate A verdict can only mislead: `net 4452f72612f1 | net 4452f72612f1 | 40.6%`
scans as the incumbent losing badly, and the opponent was itself.

### 2. What shows they ran: the VERDICT, not the count

The footer now reads `8 controls, all passing — --kind control`. When one fails it reads
`N controls, 1 FAILING` **and prints the block id with `controlVerdict()`'s text below**, the same
shape a suspect row already uses.

That distinction is the whole answer to the objection this ticket raised. A control is *evidence
about* the standings, so hiding it costs something the smoke/diag exclusion does not — and rig ticket
07 made the suspect flag load-bearing precisely because a check nobody can see is a check nobody
trusts. `8 controls` alone would have been a number nobody can act on. **Both branches are tested,
through the CLI rather than the API, because the decision lives in what a reader sees.**

### 3. The two sets stay separate — and the reason is sharper than "they might diverge"

**After this change they have IDENTICAL MEMBERS FOR DIFFERENT REASONS**, which is the most dangerous
shape a pair of constants can take: it looks shareable and is not.

- `results.mjs` → **`NOT_A_RESULT`** answers *"what counts as a result?"* — editorial. A control is
  excluded because a reader would misread it.
- `control-trigger.mjs` → **`NOT_TREND_EVIDENCE`** answers *"what may the trigger reason over?"* —
  mechanical. A control is excluded because `rung()` pools blocks into a trend, and a block whose
  expected score is 0.5 by construction **poisons** that trend.

Both were named `NOISE_KINDS`, which is what let them read as the same idea and drift. They are now
named after their questions, and each carries a comment naming the other and saying why it is not
shared. Coincidental equality is not shared meaning: if a kind is added to one, that should be a
decision rather than a merge. This is the one place in the map where the answer to "two things built
from the same idea" is **keep them apart** — because they were never the same idea.

### 4. Amended rows: already settled, nothing to decide

[The amendment record](02-the-amendment-record.md) fixed it — `table()` prints `amended` stacked
beside `cleared by bNNNN`, `--all` prints both readings plus the proof. Visible in `--kind control`
today on b0041 and b0044.

### 5. Reconciled

`--write-agents` re-run: **zero control rows in AGENTS.md**. The one paragraph that legitimately cites
a control (b0027's 58% draw rate, the evidence for computing SE bands from the observed split) now
says where controls live, since a reader can no longer look b0027 up in the table.
