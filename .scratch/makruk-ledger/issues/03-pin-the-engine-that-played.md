# Pin the engine that played the block

Type: task (AFK)
Status: resolved (2026-08-03)
Blocked by: —

## Question

A proof re-run is only evidence if it ran against the same engine. **48 of 49 rows record `engineDirty: true`** beside a commit hash, which names a tree state, not a binary — and a dirty tree is precisely the state where the hash stops identifying the code. The two proofs that carried this map through charting are sound only because `src/` was *separately* confirmed untouched since those blocks ran. A future session reading the row alone cannot make that check, which makes "proof" an assumption wearing verification's clothes.

Decide what identifies the engine, record it on every block, and make a proof check it before declaring a match.

**Candidates, cheapest first:**

- **Hash the binary** at block start — one `createHash` over `target/release/makruk-engine`, ~500 KB, sub-millisecond. Identifies exactly the thing that played. Says nothing about *what changed*.
- **The engine's own report.** `nnue::eval_id()` already exists and UCI `evalinfo` already surfaces it; the row already stores `armed`. Whether a version/build string can be extended to cover the search code too, or whether that means threading a build-time constant through, is the thing to find out.
- **Hash the sources** that produce the binary — closer to `engineCommit`'s intent, but re-derives what the binary hash already answers directly, and is wrong the moment a build flag changes without a source change (see `.cargo/config.toml`'s `+simd128`, which is worth 43.7% nps and is not in any `.rs` file).

**Resolve with:**

1. The field, recorded by `appendBlock` for every new block. Name it so it reads as identity, not provenance — it answers "which engine", not "which commit".
2. The proof-side check: given a row and a candidate re-run, is the engine the same? Three outcomes, and all three need a defined behaviour — **same** (proof may proceed), **different** (refuse), **row predates the field** (the case covering all 49 existing rows).
3. That third case is the one that matters today and it is a judgment call, so state it explicitly: a historical row can never be pinned retroactively, so a proof against one records the binary identity it *actually ran against* and says so, rather than claiming an equality it cannot check.

**Cost:** a hash and a field. One smoke block against a scratch ledger (`MAKURUK_LEDGER=`) to confirm the field lands. Seconds.

**Watch:** this is a `match-arena.mjs` row change, and the row is built at **two** independent construction sites that have already drifted apart once. Add the field to both, or add it to neither — a block fingerprinted one way and recorded another is the exact bug this map exists to repair. See [Make this defect class unwritable](04-make-the-defect-unwritable.md), which removes the second site.

**From [the audit](01-audit-what-cannot-be-true.md) — the `armed` candidate is already refuted, and there is a worked example.** `armed` looks like it half-answers this ticket; it does not. `preflight.mjs:74` produces it by spawning **our own binary** under the *believed* env and reading `evalinfo`, so `eval` and `armed` derive from the same belief and are checked against a probe of the same binary — and it never covers a fairy opponent at all, since `sides` gains an opponent entry only when `oppIsOurs`. On `b0010` the belief was wrong (the opponent was native fairy-stockfish), and `armed` recorded `"classic"`, **corroborating the error instead of contradicting it**. The audit's sweep of all 42 rows carrying `armed` found zero mismatches, which is a clean result from an unfalsifiable check.

So the field this ticket adds should be recorded **per side actually spawned**, not per side requested. Hashing the binary each side was spawned with would have caught b0010 the moment it was written — opponent hash = fairy's, `opponent.engine` = `"ours"`, contradiction visible in the row with no prose needed. That is a concrete acceptance test for whichever candidate wins.

**From [The amendment record](02-the-amendment-record.md) — "which engine played" has TWO sides, and
every candidate above only addresses ours.** `opponent.binary` records `"native" | "wasm"` and never a
path or a version. So a proof of a Gate B row cannot even be *attempted* without a human supplying
`FAIRY_BIN` (the amendment verifier refuses up front rather than silently replaying against fairy's
wasm build at the wrong strength) — and once supplied, nothing pins *which* fairy build answered.
Every rung of the ladder is measured against that opponent, so an unpinned opponent is the same
defect as an unpinned engine, one step further out. Decide whether it lands in this ticket or a
sibling; it should not stay unnamed.

The amendment record already reserves the slot: a proof stores `proof.engine` (the binary the
evidence ran against) and `proof.blockEngine` (`null` for every row predating this ticket, because a
historical row can never be pinned retroactively). Whatever field this ticket adds to `appendBlock`
is what fills `blockEngine` for blocks written from here on.

---

## Resolution (2026-08-03)

**Every engine in play is now identified by content, on both sides of every block.**
`node scripts/ledger-selftest.mjs` — **37 assertions, all green**; `cargo test --release` green.

### 1. The field: `engineId`, per side, hashing the binary

`sha256:` + 12 hex over the file that actually ran, on `mine` **and** `opponent`. Measured on real
blocks: our engine `sha256:47e34aad57c2`, the wasm fairy `sha256:91f78f226169`, native fairy
`sha256:9c8ff22d7474`.

**Hashing the binary, not the sources**, for the reason the ticket already named: a source hash is
wrong the moment a build flag moves, and `.cargo/config.toml`'s `+simd128` is worth 43.7% nps while
appearing in no `.rs` file. **Not the engine's own report** either — `evalinfo` resolves the *net*,
says nothing about the search code, and is self-reported under the believed env (the audit's b0010
finding). 12 hex characters because that is what this project already uses everywhere it
content-addresses something: `makruk-tiny-v1-4452f72612f1.bin` (`training/export.py:72`) and fairy's
own `makruk-a8c621e24a8c.nnue`.

**Half of the question turned out to be already answered.** A net's identity is its weights file, and
both our exporter and fairy's name theirs by content hash — so the row's `weights` basename *is* an
identity, and no second hash was needed. What was missing was the fairy side of it, now recorded:
`opponent.weights` carries `makruk-a8c621e24a8c.nnue` when `FAIRY_EVAL` is set.

### 2. Both sides, because "which engine played" has two of them

Every rung of the ladder is a measurement against fairy, so an unpinned opponent is the same defect
one step further out. Native fairy is hashed from `FAIRY_BIN`; the wasm fairy is resolved through the
same `createRequire(FAIRY_DIR)` the arena loads it with, so the hash names the file that will really
execute rather than a plausible-looking path. A `gate-a` opponent is our own binary, so it carries the
same hash — which is now an audit invariant (`selfplay-same-binary`), because two different hashes
there would mean the row was assembled from two different beliefs about what was playing.

### 3. The Watch, honoured: one computation, spread into both sites

`scripts/lib/identity.mjs` exports `binaryId()`, `fairyWasmPath()` and `sidesIdentity()`.
`match-arena.mjs` calls `sidesIdentity()` **once**, before the games, and spreads the result into both
the `identity` object and the `appendBlock` row. Two call sites can still be handed different
arguments; they can no longer disagree about what identity *means*.
[Make this defect class unwritable](04-make-the-defect-unwritable.md) removes the second site
entirely — that is still the real fix, and this is the shape that does not fight it.

### 4. Deliberately NOT in the control-trigger fingerprint

This is the strongest identity a row carries, which is exactly why it stays out of `fingerprint()`.
That function's own rule is that a new **artifact** is a new experiment while new **machinery** owes a
control — and a rebuilt binary is the artifact. Every `cargo build` moves the hash, so including it
would fire clause (b) before every block and demand a 20-game control each time: alarm fatigue on a
check that exists to catch the rare real thing. Noted in `control-trigger.mjs` at the point of absence,
so the next session to notice does not "fix" it.

### 5. The proof-side check: three outcomes, all three defined and tested

`amend()` now resolves engine identity **before** playing anything — refusing after a two-minute
replay would be the same answer at more cost.

| verdict | when | behaviour |
|---|---|---|
| `same` | the row names an engine and this is it | proceed; `blockEngine` records the checked equality |
| `different` | the row names an engine and it is not this one | **refuse**, nothing played, nothing written |
| `unpinned` | the row predates the field | proceed; record the binary the evidence ran against |

The third case is the one that matters today, and it is a judgment stated rather than implied: **all
49 rows in the ledger are unpinned and can never be pinned retroactively.** Refusing them would make
the amendment primitive useless on precisely the rows it was built for. So a proof against a
historical row records `engineVerdict: "unpinned"` and the hash it *actually ran against* — never an
equality nobody could check. A future reader can tell the two apart from the row.

Both refusal directions are tested, including that a mismatch costs **zero games**.

### 6. What the historical record now says

`node scripts/ledger-audit.mjs`: **98 new INCOMPLETE notes** — 49 rows × 2 sides, "no engineId, so a
proof against this row cannot check what it ran on" — and **contradictions unchanged at 15**. That
split is the whole design: incompleteness is honest and this record is legitimately incomplete, while
a guard that convicted all 49 rows is a guard that gets turned off inside a day.

### 7. Verified

Three smoke blocks against a scratch ledger (~1 min, 6 games at depth 3, committed record untouched):
self-play (same hash both sides, as `selfplay-same-binary` requires), wasm fairy (distinct hash),
native fairy + its own net (distinct hash plus the content-addressed `.nnue`). The field lands from
both construction sites in every shape.
