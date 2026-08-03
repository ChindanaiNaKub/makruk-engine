# The amendment record: shape, overlay, and what counts as a proof

Type: grilling → execution (HITL to settle, AFK to build)
Status: resolved (2026-08-03)
Blocked by: 01

## Question

Four constraints are already settled on the map and are **not** open here: an amendment is a new meta-row beside `retraction` and `clearance`; `readBlocks` overlays it and the original row is never touched; it may never change `games`/`w`/`l`/`d`/`score`/`perGame`; and it does not land without a proof. This ticket turns those four into a record shape and a verifier.

**The sketch to react to, from charting:**

```json
{"type":"amendment","amends":"b0040",
 "set":{"depth":5,"movetime":null,"opponentMovetime":null},
 "proof":{"games":2,"seed":7,"matched":["DRAW/313","MAXPLY/400"]},
 "reason":"--depth predated the ledger's depth field"}
```

**What has to be decided:**

1. **What a proof contains, and how much of one is enough.** A fixed sample (first K games) or a fraction of the block? `b0046` reproduced across all 8 games; `b0040` and `b0043` were each settled by 2. Matching on `tag` **and** `plies` is what makes a match overwhelming — a tag-only match is weak, since draws dominate. Note the asymmetry: a proof needs the *claimed* conditions to reproduce the *recorded* results, so a wrong claim fails loudly and a right one cannot be faked.
2. **Who runs the proof.** Does `results.mjs --amend` shell out to `match-arena.mjs` and verify the result itself — the `clearSuspect` pattern, which verifies rather than trusts — or does it accept a proof record produced separately? The project already decided once that "I ran a control" decays into nobody running one.
3. **Overlay semantics in `readBlocks`.** An amended row presumably reports its amended values with the amendment attached, the way `retraction` and `clearance` attach today. Then: does `table()` show that a row was amended, and does `--all` show what it used to say? A correction nobody can see is a silent edit.
4. **The awkward cases.** Can an amended row be amended again? Retracted? Can an amendment amend a *retracted* row? Can it amend a `type: clearance` row? Cheapest defensible answer for each, stated rather than discovered later.
5. **What `set` is allowed to contain**, enforced. The map says never an outcome; the enforcement is a field allowlist or an outcome-field denylist, and the difference matters when a new field is added later — an allowlist fails closed, a denylist fails open.

**Resolve with** the record shape written down, the writer and verifier implemented in `scripts/results.mjs`, and a test that a forbidden `set` is **refused**, not warned about. `cargo test --release` is untouched by this; the test belongs wherever the ledger's own tests live, exercised against a scratch ledger via `MAKURUK_LEDGER`.

**Cost:** design conversation plus a session of scripting. Proof re-runs during development are seconds against a scratch ledger. Thermally free.

**Watch:** [Which rows say something that cannot be true?](01-audit-what-cannot-be-true.md) may surface defect classes beyond the search-condition fields — that is exactly why it blocks this ticket. If the audit turns up a violating row that is *not* fixed-depth, the "proof is mandatory" rule bites for real and this ticket has to say what happens to that row rather than leaving it implied.

## What the audit handed this ticket (2026-08-03)

It did turn up a non-fixed-depth row, and it narrowed three of the five open questions.

- **Question 5, `set`'s vocabulary, is settled by the evidence:** the only fields any amendable row
  needs are **`depth`, `movetime`, `opponentMovetime`**. No violating row needs anything else. Keep
  the **allowlist** (it fails closed) — the point of the decision was never the size of the list.
- **Question 4's awkward cases are not hypothetical.** `b0010`, `b0012`, `b0013` are retracted for a
  metadata defect whose own retraction reason says *"the scores stand"* — three sound measurements
  discarded because retraction was the only tool. They are **movetime blocks and therefore
  unprovable**, so decision 4 refuses them. State that plainly: *can an amendment amend a retracted
  row* has a concrete answer to give (no, not these — they cannot be proven), and the deeper question
  underneath it is whether there is a class of amendment whose claim is **not a re-runnable
  measurement**. b0010's claim is about *identity*; only [an engine
  hash](03-pin-the-engine-that-played.md) could establish it, never a re-run.
- **Question 3, overlay semantics, has a hard constraint:** a **clearance's validity is derived from
  fields an amendment can change.** `b0041` clears `b0040`, and whether that clearance is sound
  depends on both rows' search conditions matching. So `readBlocks` must re-derive meta-row
  consistency **after** the overlay, never cache it from the raw row.
- **Two one-line landmines when the row type ships.** `readBlocks` filters on a two-element
  `META_TYPES` set (`results.mjs:65`), so an `{"type":"amendment"}` row is **read as a block**; and
  `nextId()` counts the same way (`results.mjs:99`), so the next real block would skip an id.
  `node scripts/ledger-audit.mjs` fires on both (`known-meta-type`).
- **Suspect reasons are out of the primitive's remit,** and no allowlist debate is needed to get
  there: map decision 3 says an amendment corrects *how a block was run*, and a `suspect[].reason` is
  a derived judgment. The audit confirmed all three stored reasons are exactly reproducible from the
  live ledger, so the text is faithful and the fault lies in the trigger's cell — which the map's
  Out of scope already parks.

---

## Resolution (2026-08-03)

**The primitive is in the repo, and it refuses a wrong claim on the row it was built for.**
`node scripts/ledger-selftest.mjs` — **33 assertions, all green**; `cargo test --release` green.

### 1. The record shape

Exactly the charting sketch, plus a proof that names the binary it ran against:

```json
{"type":"amendment","amends":"b0040",
 "set":{"depth":5,"movetime":null,"opponentMovetime":null},
 "proof":{"games":2,"seed":7,"matched":["DRAW/313","MAXPLY/400"],
          "engine":"sha256:…","blockEngine":null},
 "reason":"ran at go depth 5; --depth predated the ledger's depth field",
 "ts":"…"}
```

`blockEngine: null` is the honest half of question 5's third case: **no historical row can be pinned
retroactively**, so the proof records the binary the *evidence* ran against and declines to claim an
equality it cannot check. [Pin the engine that played the block](03-pin-the-engine-that-played.md)
fills the other side; nothing here waits on it.

### 2. Who runs the proof — `results.mjs --amend` does, and it fails SAFE

Decided (A): the writer shells out to `match-arena.mjs` against a throwaway ledger, matches the reply
against `perGame`, and appends only on a match — the `clearSuspect` pattern, because *"I ran a
control"* already decayed into nobody running one once.

**Proven end-to-end on b0040 itself, against a scratch ledger** (~2 min, 2 games, committed record
untouched):

- claimed **depth 5** → replayed `DRAW/313 MAXPLY/400`, matched, amendment written;
- claimed **depth 6** → replayed `DRAW/265` against the row's `DRAW/313`, **refused, nothing written**.

A verifier that never rejects is indistinguishable from one that works, so the second run is the one
that matters. The env is rebuilt from `mine.armed` / `opponent.armed` — and because the audit proved
`armed` is **unfalsifiable** (`preflight.mjs:74` probes our own binary under the *believed* env), a
mismatch refuses to conclude the row is wrong. It says the replay did not reproduce, names the
likelier cause first, and writes nothing. This map's own charting lost three attempts to an unset
`FAIRY_BIN`; a verifier that shouted "the record is wrong" at its own misconfiguration would be worse
than none. A **native fairy opponent refuses up front** — the row stores `binary: "native"`, never the
path — rather than silently proving against fairy's wasm build.

### 3. How much proof is enough — 2 games, widened when they say nothing

Two, because game `g` takes `openings[g >> 1]` and colour `g % 2` (`match-arena.mjs:568`): games 0 and
1 are the **same opening colour-reversed**, so a wrong claim fails twice on one opening. Matched on
`tag` **and** `plies` — a tag-only match is weak when draws dominate.

**The one addition charting did not have:** a slice whose games are indistinguishable is not evidence.
Two games both reading `MAXPLY/400` "match" any run that also stalls twice, so `proofWidth()` widens
(in whole colour-reversed pairs) until the slice holds two distinct ply counts. Computed from the
**recorded** results, so the widening costs nothing — it happens before a game is played.

### 4. Overlay — and the audit had to learn about it too

`readBlocks` overlays in ledger order, latest-wins per field; the physical row is never touched.
`amendedFrom` keeps what it used to say, `table()` prints `amended` beside `cleared by …` (stacked,
not either/or), and `--all` prints both readings plus the proof. A correction nobody can see is a
silent edit.

Both landmines ticket 01 flagged are closed: `META_TYPES` gained `"amendment"` (`results.mjs`) so the
row is not read as a block and `nextId()` does not skip an id — asserted directly (`b0005`, not
`b0006`).

**`ledger-audit.mjs` now overlays amendments before any check reads a block.** Without it the audit
would keep convicting rows that have already been corrected — the exact caching the constraint
forbids. Verified as ticket 05 predicts: an amended row's `timing-arithmetic` finding **disappears
without being touched directly**, while its un-amended twin stays convicted. The audit also gained
five invariants policing the new row type (`amendment-fields-allowed`, `-sets-something`,
`-has-reason`, `-has-proof`, `amendment-after-retraction`), because `amend()` guards the honest path
and a row can also arrive by hand.

### 5. `set` — allowlist, enforced, refused not warned

`{depth, movetime, opponentMovetime}`. Fails closed: a field nobody has thought about is refused, so
adding a row field later cannot silently make it amendable. Three selftest cases cover it (`w`,
`score` alongside a legal field, `concurrency`).

### 6. The awkward cases, all four answered

| case | answer | why |
|---|---|---|
| amend an amended row | **yes**, latest-wins per field | a second correction is not evidence the first was dishonest; append-only keeps both |
| amend a **retracted** row | **no** | a retraction says the measurement is not to be trusted, and polishing a discarded number is not a correction |
| retract an amended row | **yes** | retraction always wins |
| amend a `clearance`/meta row | **no** | a meta row carries no `id`, so it cannot be named — the refusal is structural |

**One design bug this ticket caught in itself.** The first audit invariant treated *retracted AND
amended* as a contradiction, by analogy with `not-both-retracted-and-cleared`. It is not: a clearance
says "this row rejoins the view", which a retraction denies, whereas an amendment only says "its
description was wrong" — a claim a later retraction has no quarrel with. Corrected to
**`amendment-after-retraction`**, which fires on ledger *order* and so catches only the case `amend()`
refuses. Both directions are now asserted.

### 7. What this settles about b0010 / b0012 / b0013

Refused, and the refusal is a mechanism rather than a policy: after any amendment they would still be
**movetime** blocks, and a movetime block is never bit-reproducible. `amend()` checks the post-
amendment condition and refuses before running anything. Three sound measurements stay retracted —
which is the honest cost of "no proof, no amendment", and the deeper question underneath it is real:
**b0010's claim is about identity, and no re-run can ever establish it.** That is
[Pin the engine that played the block](03-pin-the-engine-that-played.md)'s territory, not this
primitive's.

### 8. Handed to the next ticket

- **The opponent is unidentified too.** `opponent.binary` records `"native" | "wasm"` and never a
  path or a version, so a Gate B row against native fairy cannot be proven without a human supplying
  `FAIRY_BIN` — and even then nothing pins *which* fairy build. Noted on
  [Pin the engine that played the block](03-pin-the-engine-that-played.md): "which engine played" has
  two sides and the ticket's candidates only address ours.
- **The schema [Make this defect class unwritable](04-make-the-defect-unwritable.md) needs is now
  written down twice** — `AMENDABLE_FIELDS` in `results.mjs` and the audit's copy, deliberately
  duplicated so the audit is not checking its own implementation. If ticket 04 states the schema once,
  that is the place these two should collapse into.
