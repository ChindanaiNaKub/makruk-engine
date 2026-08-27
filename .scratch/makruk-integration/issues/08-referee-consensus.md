# Two engines agree or it does not ship

Type: build
Status: open
Blocked by: [Prove mate puzzles instead of scoring them](06-mate-prover.md), [Uniqueness is a root sweep, not a MultiPV gap](07-uniqueness-root-sweep.md)
Parent: map.md

## Question

Our validators share one movegen and one eval family; a shared blind spot passes both. The independent referee breaks ties: fairy at pinned depth (`go depth 16` ≈ 1.16 s/move measured) must agree with our engine on **(a)** the solution move and **(b)** the outcome class after the solution (win/draw per adjudication). Consensus ships; disagreement quarantines; nothing in between.

1. **Legality gate first, always.** Before any engine sees a candidate, replay FEN + line through the oracle (`position ... + d`) — generator movegen is never trusted, including our own dumps. This is the map's read-only contract with `shared/engine.ts`.
2. **Consensus semantics, written down.** Agreement = identical bestmove AND matching outcome class. Outcome disagreement (our engine says win, oracle/fairy says counting-draw) is the *most valuable* quarantine class — it usually means the puzzle violates makruk's draw rules, the exact failure chess-derived puzzle generators produce.
3. **Wire into the site's flow, don't fork it.** Drafts land in the existing queue (`generate:puzzle-candidates` → importQueue/generatedPuzzleCandidates) with `reviewStatus` defaulting to the site's quarantine state; only dual-consensus + editorial flips to ship — mirroring how `engine-generated` + `ambiguous` is already blocked from shipping today. Fairy runs locally via `tools/fairy/` for generation; server-lane integration (`fairyStockfishBinary.ts` analysis lane) is optional later.
4. **Cost accounting.** Referee time is foreground-cheap but nonzero (~1.2 s × candidates); batch runner announces totals up front. Rejected candidates keep their referee verdict — paying 1.2 s twice for the same position is a cache bug.

## Acceptance

- End-to-end: one candidate travels miner → sweep/prover → referee → draft in the site queue, with every verdict machine-written (no hand transcription anywhere).
- Demonstrated quarantine: at least one candidate auto-rejected on outcome-class disagreement, visible in the audit view.
- Site-side `validate:puzzles` + audits green with the bridged drafts present.
- The consensus rule (both clauses, exact thresholds) appears verbatim in the ledger row schema so future readers argue with what shipped, not with folklore.
