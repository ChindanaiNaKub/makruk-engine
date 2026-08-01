// Does the eval separate sibling moves, or is it flat?
//
// Written to test one explanation for v1's poor probe top-1: the search scalar is
// (W-L) from a softmax trained on a 48.7%-draw corpus, and a draw-dominated
// softmax can push W and L together until `W-L` is near-constant across sibling
// moves — the net would "know" the result distribution while giving alpha-beta
// nothing to order by. That would call for a head fix, not a data fix.
//
// It is not what happens. Measured 2026-08-02 on tests/fixtures/probe-v1.jsonl:
//   classic  median sibling range 147 cp, median stddev 28.8, 5.1% flat (<10 cp)
//   net v1   median sibling range 257 cp, median stddev 63.6, 11.7% flat
//   net r2   median sibling range 297 cp, median stddev 71.2, 11.4% flat
// The net is MORE opinionated than classic and still ranks worse: it is
// confidently wrong, not compressed. Hypothesis rejected; see the M4 log in
// docs/strength-spec-v1.md.
//
// Usage:
//   node scripts/eval-spread.mjs                                   # classic
//   MAKURUK_EVAL=net MAKURUK_WEIGHTS=out/v1/<a>.bin node scripts/eval-spread.mjs

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const PROBE = arg("probe", "tests/fixtures/probe-v1.jsonl");
const BIN = path.join(root, "target", "release", "makruk-engine");

const proc = spawn(BIN, [], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
const rl = readline.createInterface({ input: proc.stdout });
const waiters = [];
rl.on("line", (l) => {
  for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i](l)) waiters.splice(i, 1);
});
const send = (l) => proc.stdin.write(l + "\n");
const waitFor = (pred, label, timeoutMs = 30000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout " + label)), timeoutMs);
    waiters.push((l) => {
      if (!pred(l)) return false;
      clearTimeout(timer);
      resolve(l);
      return true;
    });
  });
const collectUntil = (pred, label, timeoutMs = 30000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout " + label)), timeoutMs);
    const lines = [];
    waiters.push((l) => {
      lines.push(l);
      if (!pred(l)) return false;
      clearTimeout(timer);
      resolve(lines);
      return true;
    });
  });

send("uci");
await waitFor((l) => l.includes("uciok"), "uciok");

const raw = await readFile(path.resolve(root, PROBE), "utf8");
const rows = raw.trim().split("\n").map((l) => JSON.parse(l));

const ranges = [];
const stds = [];
const byStratum = new Map();
let flat = 0;
let totalMoves = 0;

for (const row of rows) {
  send(`position fen ${row.fen}`);
  send("divide 1");
  const lines = await collectUntil((l) => l.startsWith("total: "), "divide");
  const moves = lines.filter((l) => /^[a-h][1-8][a-h][1-8]m?: /.test(l)).map((l) => l.split(":")[0]);
  if (moves.length < 2) continue;

  const vals = [];
  for (const mv of moves) {
    send(`position fen ${row.fen} moves ${mv}`);
    send("eval");
    const l = await waitFor((x) => x.startsWith("eval "), "eval");
    // `eval` is side-to-move relative and we are looking at the child, so negate
    // to get the value of the move to the side that played it.
    vals.push(-Number(l.split(" ")[1]));
  }
  totalMoves += vals.length;
  const range = Math.max(...vals) - Math.min(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  ranges.push(range);
  stds.push(std);
  if (range < 10) flat++;
  const s = byStratum.get(row.stratum) || [];
  s.push(range);
  byStratum.set(row.stratum, s);
}

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const label =
  process.env.MAKURUK_EVAL === "net"
    ? path.basename(process.env.MAKURUK_WEIGHTS || "net")
    : "classic";

console.log(`artifact: ${label}   positions=${ranges.length}  avg legal moves=${(totalMoves / ranges.length).toFixed(1)}`);
console.log("sibling-move spread (mover's view, cp):");
console.log(`  median range   ${med(ranges).toFixed(1)}`);
console.log(`  mean range     ${(ranges.reduce((a, b) => a + b, 0) / ranges.length).toFixed(1)}`);
console.log(`  median stddev  ${med(stds).toFixed(1)}`);
console.log(`  flat (<10cp)   ${flat}/${ranges.length} (${((100 * flat) / ranges.length).toFixed(1)}%)`);
for (const [k, v] of [...byStratum.entries()].sort()) {
  console.log(`  ${k.padEnd(18)} median range ${med(v).toFixed(1)}`);
}
proc.kill("SIGKILL");
process.exit(0);
