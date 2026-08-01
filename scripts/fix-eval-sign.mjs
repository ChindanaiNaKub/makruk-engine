// Repair the eval-label sign bug in corpora generated before 2026-08-02.
//
// scripts/datagen.mjs normalized the teacher eval with `evalSide === side`, but
// evalSide is "white"/"black" and side is "w"/"b", so the comparison was never
// true and every label was negated — i.e. stored black-relative rather than
// side-to-move relative. Black-to-move rows are therefore correct by accident and
// white-to-move rows are inverted.
//
// stored = -white_cp, and the correct stm value is (side == "w" ? white_cp : -white_cp),
// so the repair is exactly: negate eval on even-ply rows, keep odd-ply rows.
// (`side` is `ply % 2 === 0 ? "w" : "b"` in the playout, ply 0 = startpos = white.)
//
// Does NOT repair DAgger corpora's `w` (Goldilocks) weights: those were computed
// against the corrupted teacher eval and the student eval is not stored, so
// dagger-r*.jsonl must be regenerated rather than patched.
//
// Usage: node scripts/fix-eval-sign.mjs tools/data/bootstrap-v1.jsonl tools/data/bootstrap-v1-fixed.jsonl

import { createReadStream, createWriteStream } from "node:fs";
import readline from "node:readline";

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) {
  console.error("usage: node scripts/fix-eval-sign.mjs <in.jsonl> <out.jsonl>");
  process.exit(1);
}

const rl = readline.createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
const out = createWriteStream(OUT);

let n = 0;
let flipped = 0;
let nulls = 0;
for await (const line of rl) {
  if (!line) continue;
  const row = JSON.parse(line);
  if (row.eval === null || row.eval === undefined) {
    nulls++;
  } else if (row.ply % 2 === 0) {
    row.eval = -row.eval;
    flipped++;
  }
  n++;
  if (!out.write(JSON.stringify(row) + "\n")) {
    await new Promise((res) => out.once("drain", res));
  }
  if (n % 1_000_000 === 0) console.log(`  ${n / 1e6}M rows...`);
}
out.end();
await new Promise((res) => out.once("finish", res));
console.log(`${IN} -> ${OUT}`);
console.log(`  rows ${n}, eval sign flipped ${flipped} (${((100 * flipped) / n).toFixed(1)}%), null evals ${nulls}`);
