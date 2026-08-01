# Can fairy-stockfish generate/train Makruk NNUE data?

Type: research
Status: resolved
Blocked by:
Parent: map.md

## Question

Investigate fairy-stockfish's NNUE tooling for variants: does upstream fairy-stockfish support learning/NNUE for makruk (variant-specific input features, `generate_training_data`, any nnue-pytorch variant support)? What are the practical data-gen paths on this rig (16 cores, RTX 3050 4 GB, 15 GB RAM): native build vs downloads, expected positions/sec, and whether anofox/other forks have variant training forks. Also: are there existing public makruk game datasets (pychess-variants, lishogi-style archives, PSD/game records)? Output: feasible datagen options ranked, with commands/references.

## Answer

Full detail: `../research/02-fairy-nnue-tooling.md`. Gist: makruk is one of only three variants with an official fairy NNUE (`makruk-a8c621e24a8c.nnue`, 47.7 MB, +248 Elo over classical) and fairy enforces `MAKRUK_COUNTING` in self-play, so its labels are rule-correct. `variant-nnue-tools` + `variant-nnue-pytorch` fully support datagen (prebuilt Linux binaries, ≥100M positions ≈ 7–8 GB) and CUDA training on the RTX 3050 with days-scale datagen. Strategic catch: even fairy's smallest makruk architecture floors at ~6.5 MB — over our 1 MB budget — so the viable path is **distillation** (fairy eval as teacher → custom tiny net). Local arena note: the wasm fairy v1.1.11 embeds no net, so today's benchmark fairy = classical eval, not the +248 Elo net. Public game source: pychess monthly PGN dumps (2019–2024) for opening seeds.
