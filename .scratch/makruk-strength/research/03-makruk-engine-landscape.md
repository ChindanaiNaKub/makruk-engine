# Makruk engine landscape research (ticket 03)

Date: 2026-08-01. Pure research, no code changes.

## Summary

- **Fairy-Stockfish is the accepted strongest makruk engine**, but by community consensus/default, not by any published rated match — it is deploy-only proof: it is the only engine serviced on pychess-variants and one of just three variants (with Xiangqi, Janggi) that got an official built-in-NNUE release (`makruk-a8c621e24a8c.nnue`, built Sep 2022, +248 Elo over its classical makruk eval). Its strongest title is unchallenged because the old guard (Bilis, Alisa) died before fairy matured.
- The pre-fairy hierarchy is well documented by the **Makruk Computer Association (MCA)** and a 2013 talkchess tournament: **Bilis 2.0 (Filipino, Deuterium-family) >> Bilis 1.0 > Nebiyu > Sjaak II ≈ Fairy-Max > SamChess-MK > HaChu > PyChess**. Bilis 2.0 scored 94.8% in a 192-game gauntlet *with the counting rule enforced* and beat the Thai GUI program Alisa 2.0 +4 =4 −0.
- **Documented exploitable fairy gaps**: the makruk NNUE is one of fairy's weakest variant investments (+248 Elo vs +400–2000 for most variants, single Discord contributor, stale since 2022); counting-rule rule-code had three real bugs as late as 2020 (#75, #76, #104); variant endgame knowledge only landed in v14.0.2 (Aug 2024, issue #820) — the areas our arena results already probe (counting-rule draw saves).
- **Prior learned-eval work exists only at fairy + hobby level**: fairy's variant-nnue-pytorch pipeline and its makruk net; small student repos (PPO, DQN+MCTS, sf-kernel fork "makruk-sf"). **No large-scale self-play makruk NN project exists in public.** This leaves the "trained properly, makruk-specific" niche genuinely open.
- **Makruk tablebases are brand new and partial**: Tudsuan & Thanatipanonda (Jan 2026, KMITL, J. Science Ladkrabang) built K+N+bia-ngai vs K and K+Khon+bia-ngai vs K via retrograde analysis and showed the counting rule materially changes outcomes (Khon 41-move cap cuts wins 85.8% → 83.5%). Earlier Thai work: a 2021 heuristic KNN-vs-K tablebase paper and a 2023 Thammasat PhD thesis. **The only engine rating list that ever existed is MCA's bullet list (now frozen); "top 3" claims can hang on MCA results + fairy's deploy monopoly on pychess.**

## Engines & relative strength

### Documented strength ladder (MCA + talkchess, 2013–~2016, pre-NNUE era)

| Rank | Engine | Author / origin | Evidence |
|---|---|---|---|
| 1 (post-2019) | **Fairy-Stockfish** (+ makruk NNUE) | Fabian Fichter (ianfab), DE | Powers pychess-variants; only makruk engine with official NNUE release; chess-variants.github.io calls it "strongest open source chess variant engine"; Sjaak II "mostly superseded by Fairy-Stockfish" |
| 1 (pre-fairy) | **Bilis 2.0** | "Deuterium relative" (Deuterium = Ferdinand Mosca, PH) | MCA T3 (counting ON): 182/192 (94.8%) vs Bilis 1.0, Nebiyu, Sjaak II, Fairy-Max, SamChess, HaChu; MCA T4: beat Alisa 2.0 6–2 at 10s/move with worse hardware terms (1 core vs 2 + ponder) — strongest non-fairy engine published |
| 2 | **Alisa 2.0** | PeaceDev (TH), GUI-locked, black-only | Wikipedia-cited "world strongest makruk program" ~2016; lost 2–6 to Bilis 2.0 (MCA T4) |
| 3 | **Bilis 1.0** | as above | MCA bullet list anchor 2500: +50=9−1 across 60 games |
| 2–3 | **Nebiyu 1.45** | Daniel Shawul (ET) | MCA bullet 2287; talkchess 2013 blitz test winner (85%) |
| 4–5 | **Sjaak II 1.4.1** | Evert Glebbeek (NL) | MCA bullet 2142 (tied); configurable variant engine |
| 4–5 | **Fairy-Max 5.0b / MateMax** | H.G. Muller (NL) | MCA bullet 2142; needed a special "MateMax" patch to win KMMMK/KNMMK endgames |
| 6 | **SamChess-MK 1.0** | Thai hobby | MCA bullet 2024 |
| 7 | **HaChu 0.21b** | H.G. Muller | MCA bullet 1865 (shogi-variant engine, makruk capable) |
| 8 | **PyChess 0.12.4** | gbtami & co | MCA bullet 1351 (GUI engine, 1.7% score) |

Anchor tournaments: MCA T1 (2m+1s, no counting): Bilis 1.0 87.5%, Nebiyu 65%, Sjaak II 51.2%, Fairy-Max 46.2%, PyChess 0%. MCA T2 (gauntlets): Bilis 1.0 97.5%. MCA T3 (Bilis 2.0 gauntlet, counting enforced): Bilis 2.0 94.8%. MCA T4: Bilis 2.0 – Alisa 2.0 = 6–2. Talkchess 2013 super-blitz (no counting): Nebiyu 85%, Bilis 80%, MateMax 47%, Fairy-Max 35%, Sjaak 32%, HaChu 20%.

### Other makruk-capable programs / projects found

- **ianfab/Makruk-Stockfish** — ianfab's earlier standalone makruk-only Stockfish fork; repo states "superseded by Fairy-Stockfish"; its makruk endgame code was later ported into Fairy v14.0.2 (issue #820).
- **Homi/makruk-sf** — in-progress Stockfish-derivative (sf-kernel fork) targeting makruk rules + counting + NNUE training pipeline; no releases/results yet. Direct conceptual sibling of our repo's goal.
- **tdelphi.com "Makruk Thai AI"** — Thai commercial makruk app (linked from Wikipedia); no public strength data.
- Hobby/student repos: kaisukez/makruk-js (TS library + AI), SamuraiDangyo/makruk- & Mayhem-makruk (C++), natheetarn/MakRukThaiJava, UncleEngineer/MakrukThai (Thai), daniel-gubler/makruk_ai, ayyoitsIzy/MakrukThaiAI — all minimax-class, no ratings.
- RL attempts (see NN section): Aizabell/MakrukChessModel (PPO), luhtookyaw/makruk-mcts (DQN+MCTS).
- **No makruk event ever ran at the ICGA Computer Olympiad** (full games list checked: xiangqi and shogi variants yes, makruk no) and no CSVN/CCRL makruk list exists. The MCA tournaments 1–4 + talkchess 2013 are the entire published competition history.

## Fairy weaknesses observed

1. **Makruk NNUE is undertrained relative to other variants.** Official network table: `makruk-a8c621e24a8c.nnue` gives **+248 Elo** over fairy's handcrafted makruk eval — versus +914 xiangqi, +931 makpong, +1128 janggi, +400–2000 for most trained variants. Net is from a single Discord community contributor ("belzedar_"), dated 2022-09-19, never refreshed on the "current best" list since. Cambodian/ouk reuses the makruk net.
2. **Counting-rule adjudication was buggy until 2020** (all filed by Fulmene, a Thai pychess/fairy contributor, fixed in v11.1): #75 (lone-king counting wrongly triggered while unpromoted pawns on board), #76 (no manual start of 64-move counting), #104 (ASEAN counting must always start at one). Confirms the rule boundary is the hardest part to get right — and the part Thai players notice first.
3. **Endgame knowledge was bolted on late**: issue #820 "Variant-specific endgame code" (closed for v14.0.2, Aug 2024) ported makruk endgame patterns from ianfab's legacy Makruk-Stockfish. Pre-14.0.2 fairy had essentially no makruk endgame specialization.
4. **SEA-variant classical-eval blind spots are documented**: issue #156 (2020) Fairy-SF "overlooking/underestimating risk of checkmate in a Sittuyin endgame" — the same eval family feeds makruk fallback evaluation.
5. **The "strongest" claim is structurally soft**: no published fairy-vs-Bilis/Alisa match exists; MCA froze before fairy's makruk support. Headroom likely sits in (a) counting-rule-aware eval (fairy adjudicates the draw but net/eval doesn't price the count race), (b) bare-king/lost-side count-down endgames, (c) NNUE retraining on counting-aware data. Consistent with our own arena note: fairy at skill 5 already bleeds counting-rule draws.

## Prior NN / tablebase work

| Work | Who / when | What | Relevance |
|---|---|---|---|
| makruk NNUE (`makruk-a8c621e24a8c.nnue`) | belzedar_ / Fairy-Stockfish, 2022 | +248 Elo HalfKAv2 net; released as one of 3 built-in-NNUE fairy variants | Existing bar; training stack is public |
| **variant-nnue-pytorch** + **variant-nnue-tools** | Fairy-Stockfish org | Generalized NNUE (HalfKAv2) training fork + self-play datagen for any variant incl. makruk | Off-the-shelf training pipeline competitor/reference for our ticket |
| **Makruk endgame tablebases** | Tudsuan & Thanatipanonda, KMITL, Jun 2026 (J. Science Ladkrabang 35(1):112–129) | Retrograde TBs: K+N+biaNgai vs K (11.93M positions, 3.96% wins, max 36 plies; knight's 64-count does NOT bite) and K+Khon+biaNgai vs K (12.17M positions; 85.77% wins max 57 plies, but Khon count cap of 41 moves with 4 pieces cuts it to 83.49% — 278,040 positions become draws) | Hard ground truth for counting-rule-aware eval; only makruk TBs in existence; proof counting math changes WDL |
| Heuristic TB for king–ma–met–khun endgame | Tudsuan & Jearanaitanakij, Ladkrabang Eng. J. 38(2), 2021 (Thai) | Heuristic (non-retrograde) K+N+Met vs K analysis | Same author lineage as 2026 TBs |
| PhD thesis: winning strategies of multimove games on Asian chess | Prapaithrakul, Thammasat U., 2023 (Thai) | Makpong/makruk strategy computation | Referenced by the KMITL paper |
| Student RL repos | 2024–2025 GitHub | Aizabell/MakrukChessModel (PPO), luhtookyaw/makruk-mcts (DQN+MCTS) | Toy scale, no results |
| makruk-sf (sf-kernel fork) | Homi, in progress | Plans makruk NNUE + self-play training | Only other active dedicated-NNUE makruk project |
| arXiv 2412.17948 "Study of the Proper NNUE Dataset" | 2024 | NNUE dataset methodology (surfaced in search; appears shogi-focused, NOT makruk-specific) | Marginal |

No Fairy/Stockfish-style master-level self-play makruk network exists in public; the fairy net is the ceiling of published learned makruk eval.

Rating lists usable for a "top 3" claim: **MCA bullet list (frozen, pre-fairy)**; pychess-variants deployment (fairy is the de-facto #1); talkchess 2013 tournament. Human ratings: no public Thai OTB Elo list; PlayOK and pychess run online human ladders (unrated-Elos not authoritative). No CCRL/CEGT makruk.

## Sources

- MCA (Makruk Computer Association): https://sites.google.com/view/makruks/home — rating: https://sites.google.com/view/makruks/rating/bullet · T1: https://sites.google.com/view/makruks/tournaments/tournament-nr-1 · T2: https://sites.google.com/view/makruks/tournaments/tournament-nr-2 · T3: https://sites.google.com/view/makruks/tournaments/tournament-nr-3 · T4 (Bilis 2.0 vs Alisa 2.0): https://sites.google.com/view/makruks/tournaments/tournament-nr-4
- TalkChess 2013 makruk tournament (enhorning): https://talkchess.com/viewtopic.php?t=49827
- Fairy-Stockfish: https://github.com/fairy-stockfish/Fairy-Stockfish · NNUE network table: https://fairy-stockfish.github.io/nnue/ · built-in-NNUE makruk release: https://github.com/fairy-stockfish/Fairy-Stockfish-NNUE · training: https://github.com/fairy-stockfish/variant-nnue-pytorch , https://github.com/fairy-stockfish/variant-nnue-tools · issues: #75, #76, #104 (counting bugs), #820 (variant endgame code), #156 (Sittuyin endgame miseval) — github.com/fairy-stockfish/Fairy-Stockfish/issues
- ianfab/Makruk-Stockfish (superseded): https://github.com/ianfab/Makruk-Stockfish
- Chess Variant Hub engine page ("Fairy-Stockfish strongest; Sjaak II superseded"): https://chess-variants.github.io/engines/
- Wikipedia Makruk (Alisa link, rules): https://en.wikipedia.org/wiki/Makruk · Alisa: https://peacedev.wordpress.com/download/ (defunct heroku mirror), Wikipedia link archived 2016
- Archive.org makruk engine ISO (Bilis 1.4, Sjaak II 1.4.1, Fairy-SF w/ makruk NNUE, 2023): https://archive.org/details/makruk_chess_win64
- Tudsuan & Thanatipanonda 2026 tablebase paper: https://li01.tci-thaijo.org/index.php/science_kmitl/article/view/270913 (doi:10.55003/scikmitl.2026.270913)
- Computer Olympiad games list (no makruk): https://en.wikipedia.org/wiki/Computer_Olympiad
- pychess-variants makruk issues (UI/counting display, no strength complaints): https://github.com/gbtami/pychess-variants/issues
- Homi/makruk-sf: https://github.com/Homi/makruk-sf · GitHub topic search "makruk" (repo list incl. RL projects): https://api.github.com/search/repositories?q=makruk
