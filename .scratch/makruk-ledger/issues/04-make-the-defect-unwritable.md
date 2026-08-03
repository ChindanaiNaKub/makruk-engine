# Make this defect class unwritable

Type: grilling → execution (HITL to choose, AFK to build)
Status: resolved (2026-08-03)
Blocked by: 01, 02, 03

## Question

An amendment repairs a row after the fact. This ticket is the half that stops the next one being written. Without it the map delivers a very good apology mechanism and nothing else.

**The root cause is known and it is structural.** `identity` — the object the control trigger fingerprints — and the row handed to `appendBlock` are built **independently from the same globals** in `match-arena.mjs`, roughly 340 lines apart. They had already drifted before anyone noticed: redraw ticket 02's first patch fixed one site and appeared to do nothing, because the other site was still writing `movetime` on a fixed-depth block. Two constructions of the same truth is the defect; everything else is a symptom.

**Three mechanisms, and they are complementary rather than alternatives — the decision is which belong in this map:**

- **One construction site.** Build the row once and derive `identity` from it (or the reverse). Removes the drift by construction rather than detecting it. Cheapest and strongest, and the only one that addresses the actual cause.
- **A write-time assertion in `appendBlock`.** Refuse to append a row that violates the schema — exactly one of `depth`/`movetime` non-null, `armed` consistent with `eval`, engine identity present. Makes the defect class unwritable in the literal sense. Note the constraint this operates under: `appendBlock` runs at the *end* of a block, so a refusal there discards a real result. Refusing early and cheaply — preflight already exists for preconditions and already runs sub-second — may be the better home for anything knowable before the games are played.
- **The audit as a gate.** Run [Which rows say something that cannot be true?](01-audit-what-cannot-be-true.md)'s script over the whole ledger and fail on any violation. Catches historical rows and anything the write-time schema misses, at the cost of one more thing that can refuse. **It exists and is gate-ready**: `node scripts/ledger-audit.mjs` exits 1 on any contradiction, 0 otherwise, with `--json` for a caller. It also already solves this ticket's Watch — 42 missing fields across 8 historical rows are reported as **INCOMPLETE and never exit non-zero**, which is the exact two-severity split a guard needs so it does not reject the record it is guarding. Note the cost of adopting it wholesale: it will keep failing until [Amend the five](05-amend-the-five-and-reconcile.md) lands, and `b0010` is **permanently** in violation because it is unprovable and can only stay retracted.

**What has to be decided:** which of the three, where the schema lives so it is stated once rather than re-encoded in each mechanism, and what happens on refusal — an assertion that discards a finished 192-game block is a different proposition from one that refuses before the first game.

**Resolve with** the mechanism(s) in the repo, plus a test that deliberately constructs the historical defect — a fixed-depth row carrying movetime — and asserts it is refused. A guard with no test proving it refuses is a guard nobody has seen work.

**Cost:** scripting. One smoke block against a scratch ledger to confirm a legitimate row still writes. Seconds.

**Watch:** the schema this asserts is the schema [The amendment record](02-the-amendment-record.md) assumes and the one [Pin the engine that played the block](03-pin-the-engine-that-played.md) adds a field to — hence both block this ticket. Also: do not let the guard refuse the ledger's own **history**. 44 movetime rows and 2 rows without W/L/D are legitimately shaped the way they are shaped, and a guard that rejects the record it is guarding will be turned off within a day.

---

## Resolution (2026-08-03)

**All three mechanisms, each at a different door — and the one that matters removed the cause.**
`node scripts/ledger-selftest.mjs` — **43 assertions, all green**; `cargo test --release` green.

### 1. One construction site — the cause, gone

`match-arena.mjs` no longer rebuilds the row from the same globals 340 lines after `identity`. The
`appendBlock` row is now literally `{...identity}` plus what could only be known once the games were
played (`armed`, the outcome, the clock). `slotCount` reads `identity.concurrency` instead of
recomputing the same expression — same value today, which is exactly what the two row sites looked
like right up until they diverged.

This is the drift the whole map traces back to: redraw ticket 02's first patch fixed one site and
appeared to do nothing because the other still wrote `movetime` on a fixed-depth block. There is now
one place for that to be wrong.

**Verified by field-diff, not by reading.** A smoke block's row against `b0049`'s: **zero fields
lost.** (`suspect` is absent by design — `...(suspect.length ? {suspect} : {})` — and `tempPeakC: null`
is normal for a 1-second block; historical b0045 and b0046 are null the same way.)

### 2. The schema, stated once, checked at two doors

`scripts/lib/block-schema.mjs` — 11 rules, each tagged `pre` (knowable before a game) or `write`
(needs the result). `preflight` runs the `pre` half where refusing is free; `appendBlock` runs all of
them.

**One line decides the file's whole shape: every rule is "if X and Y are both present, they must
agree". A missing field is never a violation.** That is the ticket's Watch turned into a design rule
rather than a caveat — it is the same two-severity split the audit already runs (CONTRADICTION exits
non-zero, INCOMPLETE never does), and it is what stops the guard rejecting the record it guards.

**Measured against the real ledger: of 49 historical rows the schema convicts exactly one** — b0010,
`kind: gate-b` with `opponent.engine: ours`, a genuine contradiction already in the baseline. **All 44
movetime rows and both rows with no W/L/D pass.** That is asserted as a test, against the committed
ledger, so it cannot quietly stop being true.

### 3. Write-time refusal is a QUARANTINE, not a discard

The constraint the ticket named: `appendBlock` runs at the *end*, so a throw there destroys a finished
block — ~23 minutes of the only machine there is. So a failing row is appended to
`results/rejected.jsonl` with its violations attached, and the caller is told to stop. The ledger
stays clean, the measurement survives, and what to do with a contradictory row is a person's call.

`nextId()` is deliberately **not** called on that path, so a rejected row never burns an id that a
later block would skip. Asserted.

### 4. The audit as a gate — with a baseline, so it works today

The ticket flagged the blocker honestly: adopting the audit wholesale fails until
[Amend the five](05-amend-the-five-and-reconcile.md) lands, and **b0010 is permanently in violation**
(a movetime row that contradicts itself — unprovable, so it can only stay retracted).

So the gate holds a baseline of the contradictions accepted the day it was armed, and fails only on
something **new**. `results/audit-baseline.json`, 15 entries, written by
`node scripts/ledger-audit.mjs --write-baseline`. It is the standard way a linter is adopted on a
record that predates it: protection starts now instead of after a multi-ticket cleanup, and the
cleanup becomes visible — **12 of the 15 are b0040–b0044**, so Amend the five will shrink this file to
three. The gate prints healed entries rather than silently accepting them, so the baseline ratchets
instead of rotting.

Wired into `gate.mjs` as `ledger-audit` (hash-gated on the ledger, the baseline, the audit and the
schema) and into `match-arena`'s precondition list beside `cargo-test`: a block about to append to a
record that already carries a new contradiction should not run at all.

### 5. Where the schema lives — and where it deliberately does not

One module, read by preflight and `appendBlock`. **`ledger-audit.mjs` keeps its own independent
encoding**, the same call made for `AMENDABLE_FIELDS` in ticket 02: an audit that imports the writer
it audits agrees with itself by construction, and the audit's remit explicitly includes rows written
by hand or by an older writer.

### 6. Handed on

`results/audit-baseline.json` is now a work-list with a number on it.
[Amend the five](05-amend-the-five-and-reconcile.md) should delete its own entries as it lands each
amendment — the gate reports them as healed but will not edit the file, because a gate that edits its
own baseline is not a gate.
