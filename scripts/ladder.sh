#!/usr/bin/env bash
# Re-measure the Gate B ladder on the clean harness.
#
# Inline prefix assignments only — `env $var node …` does not word-split in zsh
# and silently demoted three "net" blocks to the classical eval on 2026-08-02.
# preflight now catches that, but the habit stays fixed.
#
# Every block writes its own row to results/blocks.jsonl, so nothing here parses
# or transcribes a score. Usage: bash scripts/ladder.sh [games]
set -euo pipefail
cd "$(dirname "$0")/.."

GAMES="${1:-64}"
# Rungs to walk. Chunk the ladder across invocations so no single run outlives a
# shell timeout — the first attempt at this was killed at 2 minutes mid-block and
# recorded nothing, because the blocks only write their ledger row on completion.
RUNGS="${2:-3 5 8 10 20}"
BASELINE="${3:-yes}"
W="$PWD/out/r3fixed/lam0.97/makruk-tiny-v1-4452f72612f1.bin"
FAIRY="$PWD/tools/fairy/fairy-stockfish"

if [ "$BASELINE" = "yes" ]; then
  echo "=== classic vs fairy skill 3 (baseline) ==="
  FAIRY_BIN="$FAIRY" node scripts/match-arena.mjs \
    --games "$GAMES" --skill 3 --movetime 100 --fairytime 100 --seed 7 --kind gate-b
fi

for SKILL in $RUNGS; do
  echo
  echo "=== r3 net vs fairy skill $SKILL ==="
  MAKURUK_EVAL=net MAKURUK_WEIGHTS="$W" FAIRY_BIN="$FAIRY" node scripts/match-arena.mjs \
    --games "$GAMES" --skill "$SKILL" --movetime 100 --fairytime 100 --seed 7 --kind gate-b
done

echo
echo "=== ladder complete — node scripts/results.mjs ==="
