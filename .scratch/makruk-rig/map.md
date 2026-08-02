# Map: Makruk Engine — A Rig You Can Trust and Afford

Labels: wayfinder:map
Status: active (charted 2026-08-02)
Predecessor: `../makruk-strength/map.md` (done — produced `docs/strength-spec-v1.md`)

## Destination

An experiment rig where a candidate artifact earns an accept/reject decision **inside a pinned wall-clock budget and under a pinned thermal ceiling**, and where a wrong number cannot silently survive a round. The map ends when the rig's design is decided, built, and a real round has been run through it showing both budgets held.

Explicitly **not** a strength goal. No DAgger rounds, no net changes, no ladder advancement — see Out of scope.

## Notes

- **Execution override.** Wayfinder's plan-only default is OFF for this map. A ticket that decides a rig change also makes it; a ticket closes when the change is in the repo with `cargo test --release` + mirror-perft green, not when the decision is written down.
- **Why this map exists.** 2026-08-02 cost ~10 hours and surfaced five harness defects in one day (datagen label sign, mirror-perft promotion regex, max-plies scored as errors, no opening randomization, zsh `env $var` word-splitting). Every one made the engine look *worse* than it is, and several rounds of real work were interpreted against numbers that were wrong. The laptop sat at 80 °C throughout and could not be used for anything else.
- **Binding constraint: both budgets.** The user chose "both, with a hard number" — a wall-clock target per round AND a CPU/thermal ceiling the rig must never exceed. Pinning those numbers is the keystone ticket; every other ticket is designed to them.
- **The gating protocol is open for redesign,** not just for speed-up. Spec §5.1's fixed 64-game / 32-game blocks are themselves a cost. Note that the *prior* map explicitly rejected SPRT ("proxy-baseline ambiguity + tooling lift, revisit later", ticket 05) — this map is the revisit, with better information.
- **Method rule, earned the hard way:** an unexpected *negative* result is a reason to audit the measurement before theorizing about the engine. Five for five so far.
- **Thermal measurements have a ~±4–5 °C noise floor** (measured — see *Pin the budgets*). A single 75 s arm cannot resolve less than ~10 °C. Repeat arms or don't claim the difference. The same discipline the arena needed applies here.
- Skills: `/grilling` + `/domain-modeling` on HITL tickets. Measure locally before reasoning about cost — every unknown in this map is measurable on this machine.
- Refer to tickets by name in narration, never by number.
- Tracker: local markdown, this directory. Tickets are `issues/NN-*.md`.

## Decisions so far

<!-- one line per closed ticket: name (link) + one-line gist -->

- *(none yet — charted this session)*

## Not yet specified

- **Unattended rounds.** Whether the rig should support "kick off a round, walk away, come back to a verdict" (queue + resumable + writes its own result row). Depends on what the budgets in *Pin the budgets* turn out to be and on whether datagen stays in the per-round loop.
- **Training-side budget.** GPU/CPU cost of a training sweep has never been measured against a ceiling; the RTX 3050 may not be the thermal problem at all. Revisit once the CPU side is pinned.
- **Browser-side measurement.** Spec §7's `nps ≥ 500k` in-browser gate has never been run, and there is no wasm measurement harness at all. Whether that belongs in this rig or in the parked strength map is undecided.
- **The ~25% max-plies rate among our own engines.** It makes Gate A blocks both noisier and slower (400 plies of nothing). Might be a scoring-policy question for the rig, might be an engine question that belongs in the parked map. Sharpen after *Replace fixed-size blocks with a sequential test*.
- **Fixed-position regression suites.** Whether some arena games can be replaced outright by a frozen set of positions with known-correct handling (much cheaper, much less noisy). Unclear how much of a gate this could carry.

## Out of scope

- **All strength work** — DAgger rounds, net architecture, eval-speed work (including the per-node `Vec` allocation in `nnue::net_score` and spec §7's unimplemented incremental accumulator), ladder advancement. Deliberately **parked, not abandoned**: the 2026-08-02 ladder re-measurement showed skill 10/15/20 is a single wall and that fairy searches depth 10 at *every* rung below 20, so "≥50% vs skill 20" needs redrawing before more compute goes into it. That redraw is a **fresh map taken up after this one**, not a ticket here. Evidence is recorded in `docs/strength-spec-v1.md` (execution log, top entry) and `AGENTS.md`.
- **Engine speed as a rig lever** — ruled out on evidence, not preference: arena games run at *fixed* movetime, so a faster engine does not make a block finish sooner. Engine nps is purely a strength lever and belongs to the parked map.
- **thatichess.dev site changes** — inherited from the predecessor map; this repo's boundary is unchanged.
