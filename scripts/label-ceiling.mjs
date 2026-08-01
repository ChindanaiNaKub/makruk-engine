// What is the ceiling on distilling the teacher signal we actually recorded?
//
// The bootstrap corpus labels are fairy's DEPTH-0 static NNUE eval (M0: fairy
// suppresses info lines below ~1.5 s, so depth-scored labels were impractical at
// datagen speeds). A student can never out-rank the signal it distils, so before
// spending a datagen round on "better labels" it is worth measuring what the
// current labels are worth: score native fairy itself at a shallow limit against
// the SAME depth-12 labels the strength probe uses.
//
// Measured 2026-08-02 on tests/fixtures/probe-v1.jsonl (320 positions):
//   depth 1: 36.9%   depth 2: 36.3%   depth 4: 38.8%   depth 6: 45.9%   depth 8: 58.1%
// vs our classic eval 33.4% and net v1 21.6% (strength-probe --nodes 20000).
// So the depth-0 label ceiling is ~37%, and v1 captured well under two thirds of
// it — the labels were not the binding constraint, the fit to them was.
//
// Usage: FAIRY_BIN=tools/fairy/fairy-stockfish \
//        FAIRY_EVAL=tools/fairy/makruk-a8c621e24a8c.nnue \
//        node scripts/label-ceiling.mjs --depth 1

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
const DEPTH = Number(arg("depth", "1"));
const FAIRY_BIN = process.env.FAIRY_BIN;
const FAIRY_EVAL = process.env.FAIRY_EVAL || null;
if (!FAIRY_BIN) {
  console.error("FAIRY_BIN is required (the ceiling is measured on native fairy)");
  process.exit(1);
}

// probe-build.mjs writes our FEN letters; fairy wants its own promoted-bia glyph.
const toFairyFen = (fen) => fen.replaceAll("F", "M").replaceAll("f", "m");

function startFairy() {
  const env = { ...process.env };
  delete env.MAKURUK_EVAL;
  delete env.MAKURUK_WEIGHTS;
  const proc = spawn(FAIRY_BIN, [], { stdio: ["pipe", "pipe", "inherit"], env });
  const rl = readline.createInterface({ input: proc.stdout });
  const waiters = [];
  rl.on("line", (line) => {
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i](line)) waiters.splice(i, 1);
  });
  const waitFor = (pred, label, timeoutMs = 120000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout " + label)), timeoutMs);
      waiters.push((line) => {
        if (!pred(line)) return false;
        clearTimeout(timer);
        resolve(line);
        return true;
      });
    });
  return { send: (l) => proc.stdin.write(l + "\n"), waitFor, kill: () => proc.kill("SIGKILL") };
}

const raw = await readFile(path.resolve(root, PROBE), "utf8");
const rows = raw.trim().split("\n").map((l) => JSON.parse(l));

const fairy = startFairy();
fairy.send("uci");
await fairy.waitFor((l) => l.includes("uciok"), "uciok");
// Mirrored from probe-build.mjs so this is apples-to-apples with the labels.
fairy.send("setoption name UCI_Variant value makruk");
fairy.send("setoption name Skill Level value 20");
fairy.send("setoption name Threads value 1");
if (FAIRY_EVAL) fairy.send(`setoption name EvalFile value ${FAIRY_EVAL}`);
fairy.send("isready");
await fairy.waitFor((l) => l.includes("readyok"), "readyok");

const byStratum = new Map();
let hit = 0;
let scored = 0;
for (const row of rows) {
  // Carried hash state made depth-12 answers position-order dependent when the
  // probe was built; reset per position here for the same reason.
  fairy.send("ucinewgame");
  fairy.send("setoption name Clear Hash");
  fairy.send("isready");
  await fairy.waitFor((l) => l.includes("readyok"), "clear hash");
  fairy.send(`position fen ${toFairyFen(row.fen)} - - 0 1`);
  fairy.send(`go depth ${DEPTH}`);
  const line = await fairy.waitFor((l) => l.startsWith("bestmove "), "bestmove");
  const mv = line.split(/\s+/)[1];
  if (mv === "(none)") continue;
  const ok = mv === row.best;
  if (ok) hit++;
  scored++;
  const s = byStratum.get(row.stratum) || { hit: 0, n: 0 };
  s.hit += ok ? 1 : 0;
  s.n += 1;
  byStratum.set(row.stratum, s);
}

const pct = (a, b) => (b === 0 ? "0.0" : ((100 * a) / b).toFixed(1));
console.log(`fairy @ depth ${DEPTH} (eval=${FAIRY_EVAL ? "official NNUE" : "classical"}) vs depth-${rows[0].depth} labels`);
console.log(`top1: ${pct(hit, scored)}%  (${hit}/${scored})`);
for (const [k, v] of [...byStratum.entries()].sort()) {
  console.log(`  ${k.padEnd(18)} ${pct(v.hit, v.n)}%`);
}
fairy.kill();
process.exit(0);
