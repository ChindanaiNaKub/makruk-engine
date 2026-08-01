# How does the spec capture counting-rule awareness?

Type: grilling
Status: resolved
Blocked by: 04
Parent: map.md

## Question

Research flagged counting-rule-aware evaluation as the biggest exploitable gap (fairy's known weakness; the game-deciding factor in Sak Mak / Sak Kradan / bare-king endgames). Decide which levers the spec commits to: input planes/conditioning for honor counts in the learned eval (per the Moka recipe's advice), distilling the KMITL 2026 retrograde endgame bases (K+N+bia, K+Khon+bia vs K quantify win→draw conversions), fairy's rule-correct self-play labels as teacher signal, and/or shaping in our own self-play. Also: how much rule-awareness should remain hard-coded adjudication vs learned.

## Answer

Locked by grilling (2026-08-01):

1. **Net sees counting state via ~8–10 normalized side-channels into the MLP tail** (appended after the piece-square accumulator, before the WDL head): active honor type, progress ratios toward each limit (pieces-honor count/limit, board-honor count/64), which side holds counting rights, final-attack-pending flag, and repetition-history presence. Moka's komi-plane/global-adapter lesson adapted to NNUE: global game state as MLP side-channels, cost ≈ hundreds of parameters. Rule-blind net explicitly rejected (would steer search into forced draws scored as wins).
2. **Hard adjudication stays 100% in search/engine code** (repo invariant, unchanged). The learned eval only needs to *value* positions under rule pressure; it never adjudicates.
3. **KMITL retrograde bases: deferred distillation with a pre-registered trigger.** v1 relies on natural coverage — counting endgames appear in the oracle-adjudicated self-play labels (ticket 07's pipeline) with truthful WDL outcomes. BUT the spec includes building a small frozen **endgame probe set** from the KMITL bases (positions + correct outcomes) as a dev-gate artifact from day one; if the v1 net bleeds accuracy on the probe, that triggers a targeted DAgger round distilling the bases. Speculative v1 distillation rejected; skipping the probe rejected (rarity of counting endgames in self-play makes bleed invisible without it).
