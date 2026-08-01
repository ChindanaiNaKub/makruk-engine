# Write the strength spec (v1.0)

Type: task
Status: resolved
Blocked by: 08, 09
Parent: map.md

## Question

The destination deliverable. Draft the full implementation spec as a document in this repo (e.g. `docs/strength-spec-v1.md`): synthesize every decision in the map's Decisions-so-far into an executable plan — net definition (features, L1 width, WDL head, quantization manifest), the own-harness datagen pipeline (throughput smoke, ~10M bootstrap, label schema), training stack (PyTorch + QAT on the RTX 3050), DAgger iteration protocol, benchmark gates (two-bar, two-tier), handoff artifacts/contract, and the ordered build milestones with their gates. The agent drafts; the user reviews and signs off. When this spec exists and is approved, the map is done.

## Draft

**v1 draft written 2026-08-01: `docs/strength-spec-v1.md`** — 11 sections: goal/success criteria, net definition (768→L1 256 + ~10 counting side-channels → WDL3, ~0.2 MB INT8), quantization+manifest, own-harness datagen (FEN|eval|WDL), training stack, DAgger protocol, endgame probe + trigger, engine integration, handoff contract, milestones M0–M6 with gates, risks, decision provenance.

**Awaiting user review/sign-off.** Resolve only after the user approves the spec (or edit + re-review).

## Answer

**Spec approved by the user ("sign off"), 2026-08-01.** The deliverable lives at `docs/strength-spec-v1.md`. With this, the destination is reached: a locked, written spec — architecture (tiny NNUE 768→256 + counting side-channels, WDL, INT8 QAT), training/distillation plan (NNUE-armed fairy teacher, own-oracle harness, gated DAgger rounds), benchmark ladder (two bars, two tiers), and handoff contract (one net, throttled rungs, bin+JSON manifest) — ready for implementation. The map is done.
