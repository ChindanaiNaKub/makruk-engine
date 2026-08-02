# Implement the conditional control-block trigger

Type: task
Status: open
Blocked by: 06-where-results-live.md
Parent: map.md

## Question

[How does the rig prove a number before anyone acts on it?](04-how-the-rig-proves-a-number.md) settled *when* a self-play control block is mandatory:

> (a) a block's result deviates from the trend line by more than the SE band (~8.8 points at n=32), or (b) a new **binding mechanism** is introduced — a new env var, a new opponent type, a new config axis (explicitly **not** a new weight) — or (c) it is the first block at a new rung.

Mechanisms 1–3 of that ticket shipped. This one could not, because **clause (a) needs a trend line and there is no machine-readable record of past blocks to compute one from** — which is exactly what [Where do results live?](06-where-results-live.md) decides. The capability itself exists: `match-arena.mjs --control` runs identical sides with the `sides-differ` assertion opted out, and an r3-vs-r3 block through it reads 50.0%.

To implement once the ledger exists:

- **Compute the trend line.** From what — the same artifact's prior blocks at the same rung, or a fitted ladder across rungs? The SE band is ~8.8 points at n=32; if [Replace fixed-size blocks with a sequential test](03-sequential-gate.md) lands first, blocks will have *varying* n and the band has to be computed per block rather than assumed.
- **Detect clause (b) mechanically.** "A new binding mechanism" is a human-legible idea; the rig needs a checkable version. Candidate: hash the *set of env var names* and the opponent-engine identity that a block ran under, and treat a previously-unseen combination as new plumbing — which correctly ignores a new *value* for `MAKURUK_WEIGHTS` while catching a first-ever `OPP_WEIGHTS`.
- **Detect clause (c).** First block at a rung is a ledger lookup, trivial once the ledger exists.
- **Decide what firing means.** Does the rig run the control automatically and refuse to record the suspect block until the control passes, or does it print a demand and stop? Automatic costs a block of wall-clock without being asked; a demand can be ignored, which is how prose-in-AGENTS.md failed.
- **Decide the control's own pass condition.** r3-vs-r3 came back 1–1–8 and 50.0% in two separate runs; what band around 50% counts as "the plumbing is fine" at a given n?

## Answer

<!-- filled on resolution -->
