# Set the target: what number, on what rung, by what lever?

Type: grilling (HITL)
Status: resolved (2026-08-03) — §0 rewritten and signed
Blocked by: 01, 02, 04, 05, 06, 08

## Question

This is the destination. Everything before it exists to make this decision defensible instead of hopeful.

By the time this opens, five things will be measured that are not measured today:

- where the **classical eval actually stands** at skill 5, 8 and 10 ([Where does this engine actually stand on the live rungs?](01-where-the-engine-actually-stands.md));
- whether **"classic beats the net" survives an equal-depth test**, and therefore whether the NNUE program is alive or dead ([Is "classic beats the net" a speed artifact?](02-is-classic-beating-the-net-a-speed-artifact.md));
- **what a ply is worth** at those rungs, and whether the exchange rate collapses at the wall ([Is the wall depth, or is it eval?](04-is-the-wall-depth-or-eval.md));
- **what one eval improvement buys** ([What is one classical-eval improvement actually worth?](05-what-one-eval-term-is-worth.md));
- **what one search improvement buys** ([What is one search improvement actually worth?](06-what-one-search-fix-is-worth.md));
- **whether the net's eval advantage is reachable in real play** ([How much of the net's speed deficit can the accumulator close?](08-how-much-speed-can-the-accumulator-close.md)) — added after [Is "classic beats the net" a speed artifact?](02-is-classic-beating-the-net-a-speed-artifact.md) resolved. The net wins at equal depth; whether it wins at equal *time* depends entirely on recovering its 2.7× nps deficit, and that answer decides whether the lever is the net or the classical eval.

Decide, and rewrite §0 of `docs/strength-spec-v1.md` to match:

1. **The number and the rung.** ≥50% at skill 5, 8, or 10 — or some other threshold at one of them if 50% is the wrong bar. It must be a number the measured evidence supports, with the arithmetic shown: baseline plus demonstrated lever gains, not extrapolation past where anything was measured. **If the evidence says no live rung is reachable, say that** and set the target to the honest ceiling. A target this map cannot defend is how the last one died.
2. **The lever.** One primary lever, chosen on the measured deltas from the two lever tickets and the ply exchange rate. Name the runner-up and why it lost, so a future session does not silently re-litigate it.
3. **The verdict on the net.** Kept, parked, or removed from the spec — on the equal-depth evidence, not on the confounded blocks. If it is kept, the incremental accumulator graduates out of fog into the next map's first ticket. If it is removed, say what happens to `src/nnue.rs`, the `MAKURUK_EVAL=net|classic` switch, the corpora under `tools/data/`, and §1–§4 of the spec, which are not refuted — they describe a net that trains and runs exactly as specified, just not one that wins.
4. **Native or in-browser.** The old §0 stated its claim on in-browser wasm; every measurement in this record is native. Settle whether the target is stated natively with a wasm transfer assumption, or whether §7's never-run `nps ≥ 500k` browser gate has to be run before the target means anything. This cannot be deferred again — it is the one fog patch that the target's *wording* depends on.
5. **What the site gets.** §8's rung table pins Club and Expert to gates no artifact has passed, and the spec already forbids naming them on the site before Gate B says otherwise. State what Casual/Club/Expert are anchored to now, or say the table is promissory and stays that way.

Close by writing the amended §0 into `docs/strength-spec-v1.md` with an execution-log entry recording what changed and why, exactly as the previous amendments did — and get the user's sign-off before it lands, the same way [Write the strength spec (v1.0)](../../makruk-strength/issues/10-write-the-spec.md) did. A target the user has not signed is not a target.

**Cost:** conversation plus a spec edit. No machine time.

**Standing rule for this ticket:** an unexpected result is a reason to audit the measurement first — six for six. If any of the five inputs comes back surprising, the honest move is to check the block before writing it into §0.

---

## Resolution (2026-08-03) — §0 rewritten and signed

**Signed off by the user before it landed**, as the ticket required. `docs/strength-spec-v1.md` §0 is
replaced (the old claim retained struck through) and an **M5** execution-log entry records what
changed and why. The spec's opening paragraph, which still promised the retired claim, was corrected
to point at §0.

### 1. The number and the rung

**The measured ceiling is the target, because no demonstrated lever reaches past it.** Classic scores
**39.8% vs fairy skill 5** (`b0055`, ±7.9 pp) and crosses 50% at about **skill 4.4**.

**≥50% at skill 5 is recorded as a *conditional goal*** — it needs +10.2 pp, no measured lever produces
any of it, and it unlocks only if a costed training ticket for a smaller net clears Gate A. The
ticket's own instruction covered this case: *"If the evidence says no live rung is reachable, say that
and set the target to the honest ceiling."* An unconditional 50% would have repeated precisely how the
previous target died.

### 2. The lever

**Primary: a smaller, faster net** — the only untested lever, and a costed training ticket.

**Runner-up, named so it is not silently re-litigated: classical-eval quality.** It lost on measurement,
not on taste — the tuner's best-ranked candidate went to Gate A at **−9 Elo** (`b0054`), and
[ticket 09](09-is-the-eval-tuner-trustworthy.md) established that held-out loss does not predict Elo
here.

**Retired: search and depth**, at ~0 pp/ply ([ticket 04](04-is-the-wall-depth-or-eval.md)).

### 3. The net: KEPT, parked

Better eval at equal depth (67.0% at depth 7, 23–0 decisive across 6–7); unusable at equal time
(2.07× deficit, Gate A 38.8% REJECT). **§1–§4 are not refuted** and everything stays — `src/nnue.rs`,
the `MAKURUK_EVAL` switch, the corpora. The accumulator did not graduate into a next-map first ticket
as this ticket anticipated, because it was built and measured here: +9.8%, not enough.

### 4. Native, and §7 becomes a precondition

**Stated natively.** Every measurement in the record is native, and the old §0 stated its claim on
in-browser wasm with nothing ever measured there. **§7's never-run `nps ≥ 500k` browser gate is now an
explicit precondition of any site-facing claim**, not a milestone inside the target. The fog patch is
closed.

### 5. What the site gets

**Casual** is anchored to the classical eval. **Club and Expert stay promissory** until Gate B says
otherwise.

### The destination, honestly assessed

The map's destination asked for a target "with measured evidence that it is reachable." **The evidence
says no live rung is reachable with any demonstrated lever**, and the ticket anticipated that
explicitly. That is the destination met, not dodged — the map set out to replace a target nothing
supported, and it did, with one nothing in the record contradicts.
