# Set the target: what number, on what rung, by what lever?

Type: grilling (HITL)
Status: open
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
