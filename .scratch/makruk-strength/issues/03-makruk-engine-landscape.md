# What makruk engines and strength references exist?

Type: research
Status: resolved
Blocked by:
Parent: map.md

## Question

Survey the makruk engine landscape beyond fairy-stockfish: other engines that play makruk (e.g. Sjaak II, Nebiyu, older dedicated makruk programs, competition history like CSVN/computer olympiads), and any published strength comparisons. Also: any prior neural/NNUE makruk projects (papers, repos), makruk endgame tablebase work, and known fairy-stockfish makruk weaknesses. Used to position the spec's claims ("top 3 / close to fairy") and to find exploitable gaps.

## Answer

Full detail: `../research/03-makruk-engine-landscape.md`. Gist: fairy-stockfish is the accepted strongest makruk engine **by default** — no published rated match since the 2013 Makruk Computer Association events, where Bilis 2.0 dominated (94.8% gauntlet) over Nebiyu/Sjaak II and friends; makruk has no CCRL presence. Fairy's makruk has documented weakness: counting-rule bugs only fixed in 2020 (issues #75/#76/#104), variant endgame code only in v14.0.2 (2024), and its community nnue (2022) is one of its weakest variant nets (+248 Elo). No public master-level learned makruk network exists. New ground truth: KMITL 2026 retrograde tablebases (K+N+bia, K+Khon+bia vs K) quantify how the counting rule converts wins to draws — strongest lever for a counting-aware eval. A "top 3" claim hangs on MCA history + fairy's deploy monopoly.
