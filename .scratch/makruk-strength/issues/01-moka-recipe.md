# How was Moka built? (distilling the millionco/moka recipe)

Type: research
Status: resolved
Blocked by:
Parent: map.md

## Question

Read the Moka repo (https://github.com/millionco/moka) and any linked writeups, and surface the concrete recipe: net architecture and layer sizes, how the 101 KB weight budget is achieved (quantization scheme), how teacher (KataGo) positions were sampled and augmented with Moka's own games, distillation targets (policy/value), training loop and data volumes, and inference design that keeps the browser runtime ~6 KB. Deliver facts + file references a makruk adaptation could copy.

## Answer

Full detail: `../research/01-moka-recipe.md`. Gist: Moka = 105k-param CNN shipped as 113 KB of per-output-channel symmetric INT8 with a ~4 KB hand-rolled JS conv loop (they benchmarked WASM and deliberately didn't ship it). The real lesson is the pipeline, not the net: pure teacher off-policy data plateaued (~16/100 vs teacher); the climb came from small **arena-gated on-policy DAgger rounds** (15% teacher intervention), 1-epoch continuations, critical-regret QAT, adapter fine-tunes, checkpoint soups — and data *volume* regressed quality. Discipline to copy: always arena-test the quantized artifact itself; 50% hard + 50% soft policy targets. For makruk: policy head needs a ~41-plane displacement encoding (no diagonal sliders, forced promotion), and counting-rule input planes are essential or the value head bleeds draws.
