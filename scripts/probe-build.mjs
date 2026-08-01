// Build the frozen strength-probe set (strength-spec v1 §M4 amendment).
//
// The arena is ground truth but has no gradient: a 0-16 block tells you the net
// is worse and nothing else. This produces a smooth, low-variance proxy instead —
// positions sampled from the bootstrap corpus, each labelled with native fairy's
// best move at fixed DEPTH (not movetime, so the labels are machine-independent
// and reproducible).
//
// Usage: FAIRY_BIN=tools/fairy/fairy-stockfish FAIRY_EVAL=tools/fairy/makruk-a8c621e24a8c.nnue \
//          node scripts/probe-build.mjs --corpus tools/data/bootstrap-v1.jsonl \
//          --n 320 --depth 12 --out tests/fixtures/probe-v1.jsonl
//
// Stratified across game phase x counting-state so the report can localise a
// regression (opening play vs endgame vs counting-active) instead of averaging
// it away. One position per source game, so strata aren't dominated by a single
// long game.

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
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
const CORPUS = arg("corpus", "tools/data/bootstrap-v1.jsonl");
const N = Number(arg("n", "320"));
const DEPTH = Number(arg("depth", "12"));
const OUT = arg("out", "tests/fixtures/probe-v1.jsonl");
const SCAN = Number(arg("scan", "3000000")); // rows to scan before sampling stops

const FAIRY_BIN = process.env.FAIRY_BIN;
const FAIRY_EVAL = process.env.FAIRY_EVAL || null;
if (!FAIRY_BIN) {
  console.error("FAIRY_BIN is required (labels come from native fairy)");
  process.exit(1);
}

// Deterministic sampler: no Math.random, so a rebuild from the same corpus
// reproduces the same probe set byte for byte.
const hash32 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const phaseOf = (fen) => {
  const board = fen.split(" ")[0];
  const pieces = board.replace(/[^a-zA-Z]/g, "").length;
  if (pieces >= 26) return "opening";
  if (pieces >= 16) return "middle";
  return "endgame";
};

// Only four strata are physically reachable: counting cannot be active while
// 16+ pieces remain, so opening/counting and middle/counting are always empty.
const STRATA = ["opening/none", "middle/none", "endgame/none", "endgame/counting"];
const PER_STRATUM = Math.ceil(N / STRATA.length);

async function sample() {
  const buckets = new Map(STRATA.map((s) => [s, []]));
  const seenGames = new Set();
  const seenFens = new Set(); // identical openings recur across games
  const rl = readline.createInterface({
    input: createReadStream(path.resolve(root, CORPUS)),
    crlfDelay: Infinity,
  });

  let scanned = 0;
  for await (const line of rl) {
    if (++scanned > SCAN) break;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row.ply < 8) continue; // opening book noise, every engine agrees
    if (row.eval === null) continue; // in-check rows: fairy gave no static eval
    if (seenGames.has(row.game)) continue;
    if (seenFens.has(row.fen)) continue;

    const key = `${phaseOf(row.fen)}/${row.counting === "none" ? "none" : "counting"}`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.length >= PER_STRATUM) continue;
    // Thin deterministically so samples spread across the corpus, not the head.
    if (hash32(row.fen) % 97 !== 0) continue;

    bucket.push({ fen: row.fen, ply: row.ply, counting: row.counting, stratum: key });
    seenGames.add(row.game);
    seenFens.add(row.fen);
    if ([...buckets.values()].every((b) => b.length >= PER_STRATUM)) break;
  }
  rl.close();
  return buckets;
}

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
  const send = (l) => proc.stdin.write(l + "\n");
  return { send, waitFor, kill: () => proc.kill("SIGKILL") };
}

const toFairyFen = (fen) => fen.replaceAll("F", "M").replaceAll("f", "m");

async function main() {
  const buckets = await sample();
  const rows = [...buckets.values()].flat().slice(0, N);
  for (const [k, v] of buckets) console.log(`stratum ${k}: ${v.length}`);

  const fairy = startFairy();
  fairy.send("uci");
  await fairy.waitFor((l) => l.includes("uciok"), "uciok");
  fairy.send("setoption name UCI_Variant value makruk");
  fairy.send("setoption name Skill Level value 20");
  fairy.send("setoption name Threads value 1"); // label must not depend on scheduling
  if (FAIRY_EVAL) fairy.send(`setoption name EvalFile value ${FAIRY_EVAL}`);
  fairy.send("isready");
  await fairy.waitFor((l) => l.includes("readyok"), "readyok");

  const out = [];
  const t0 = Date.now();
  for (const row of rows) {
    // Carried hash state made depth-12 answers position-order dependent: the same
    // FEN got two different "best" moves in the first build. Reset per position so
    // the label set is reproducible from the corpus alone.
    fairy.send("ucinewgame");
    fairy.send("setoption name Clear Hash");
    fairy.send("isready");
    await fairy.waitFor((l) => l.includes("readyok"), "clear hash");
    fairy.send(`position fen ${toFairyFen(row.fen)} - - 0 1`);
    fairy.send(`go depth ${DEPTH}`);
    const line = await fairy.waitFor((l) => l.startsWith("bestmove "), "bestmove");
    const best = line.split(/\s+/)[1];
    if (best === "(none)") continue; // terminal position, nothing to predict
    out.push({ ...row, best, depth: DEPTH });
    if (out.length % 40 === 0) {
      const rate = (out.length / ((Date.now() - t0) / 1000)).toFixed(1);
      console.log(`labelled ${out.length}/${rows.length} (${rate}/s)`);
    }
  }
  fairy.kill();

  await writeFile(path.resolve(root, OUT), out.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`\nwrote ${out.length} probe positions to ${OUT} (fairy depth ${DEPTH})`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
