# Prove mate puzzles instead of scoring them

Type: build
Status: open
Blocked by: —
Parent: map.md

## Question

Every other puzzle class inherits its engine's blind spots. Mate-in-N does not: an exhaustive AND/OR minimax to depth 2N−1 *proves* the mate and *refutes* every alternative root move, regardless of how weak the searching engine is — the proof's soundness comes from full-width search, not eval quality. Build the prover:

1. **Implementation shape.** Preferred: `src/bin/prover.rs` linking the crate (crate-type already includes `rlib`) — zero risk to the main search, no protocol surface growth. Alternatives recorded in the ticket if visibility fights back: a UCI `proof` extension, or a script driving `divide` recursively (rejected on process-per-node cost alone).
2. **Soundness constraints, non-negotiable.** Plain alpha-beta only. **Null-move pruning and LMR are disabled inside proofs** — both are unsound under zugzwang, and makruk is a zugzwang-heavy game (the house invariant about king+bia exists for exactly this reason). Mate-distance-exact scoring already exists (`CHECKMATE_SCORE − ply`); keep it exact.
3. **Output = evidence.** Per candidate: PROVEN/DISPROVEN at N, the mating line, and for every alternative root move a refutation line to depth budget. Hash of position + proof + engine identity (`evalinfo` pattern) so any later re-run can verify byte-identical conclusions.
4. **Budget discipline.** Background class, per-position node cap pinned before first batch run; a candidate that times out is *unproven*, never "probably fine" — fail closed like everything else on this map.

## Scope honesty

N ≤ 3 keeps exhaustive cost sane (~30 legal moves typical; depth-5 full-width is the ceiling case). Deeper mates go through the consensus path or not at all — a prover that silently prunes to reach N=5 is worse than no prover.

## Acceptance

- Prover proves known mate-in-1/2 fixtures and *disproves* at least one doctored fixture whose "mate" has a hole (the negative test is the product).
- Batch runner processes mined candidates with progress + announced cost; verdicts land in [Who validates the validator?](09-validator-health.md)'s ledger rows.
- `cargo build --release` unchanged for the main binary; new bin compiles under the same flags.
