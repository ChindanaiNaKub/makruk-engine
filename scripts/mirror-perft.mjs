// Mirror test: makruk-engine (native binary) vs fairy-stockfish-nnue.wasm.
// Verifies movegen+promotion+check legality by comparing perft counts on
// the start position and on randomly reached positions (shared via FEN).
//
// Usage: node scripts/mirror-perft.mjs [--positions 25] [--depth 3] [--seed 7]
// Env:   FAIRY_DIR  path to the markrukthai node_modules dir containing
//                   the fairy-stockfish-nnue.wasm package.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const POSITIONS = Number(arg("positions", "25"));
const DEPTH = Number(arg("depth", "3"));
const SEED = Number(arg("seed", "7"));

const FAIRY_DIR =
  process.env.FAIRY_DIR ||
  path.resolve(repoRoot, "..", "markrukthai-1", "node_modules");

// ---- Emscripten/node fetch bridge (Node 24 rejects bare fs paths) ----
const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input?.url ?? input);
  if (!/^https?:|^file:|^data:|^blob:/.test(url)) {
    const buf = await readFile(url);
    return new Response(buf, { status: 200 });
  }
  return origFetch(input, init);
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- My engine driver (line protocol) ----------
function startMine() {
  const bin = path.join(repoRoot, "target", "release", "makruk-engine");
  const proc = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] });
  const rl = readline.createInterface({ input: proc.stdout });
  const waiters = [];
  rl.on("line", (line) => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].onLine(line)) waiters.splice(i, 1);
    }
  });
  const collect = (cmds, stopAt) =>
    new Promise((resolve, reject) => {
      const lines = [];
      const timer = setTimeout(
        () => reject(new Error("mine timeout: " + cmds.join(" | "))),
        30000
      );
      waiters.push({
        onLine: (line) => {
          lines.push(line);
          if (stopAt(line)) {
            clearTimeout(timer);
            resolve(lines);
            return true;
          }
          return false;
        },
      });
      for (const c of cmds) proc.stdin.write(c + "\n");
    });

  // `position` prints nothing on success; `d` acts as a 1-line sentinel.
  const setPosition = async (cmd) => {
    const lines = await collect([cmd, "d"], (l) => l.includes(" | "));
    return lines[lines.length - 1];
  };

  return {
    setPosition,
    fenAfter: async (startFen, moves) => {
      const cmd = `position fen ${startFen}${moves.length ? " moves " + moves.join(" ") : ""}`;
      const d = await setPosition(cmd);
      return d.split(" | ")[0];
    },
    divide: async (depth) => {
      const lines = await collect([`divide ${depth}`], (l) => l.startsWith("total: "));
      const map = new Map();
      let total = 0;
      for (const l of lines) {
        const m = l.match(/^([a-h][1-8][a-h][1-8]): (\d+)$/);
        if (m) map.set(m[1], Number(m[2]));
        if (l.startsWith("total: ")) total = Number(l.slice(7));
      }
      return { map, total };
    },
    quit: () => proc.stdin.write("quit\n"),
  };
}

// ---------- Fairy driver ----------
async function startFairy() {
  const require = createRequire(FAIRY_DIR + path.sep);
  const Stockfish = require("fairy-stockfish-nnue.wasm/stockfish.js");
  const sf = await Stockfish();

  const waiters = [];
  sf.addMessageListener((line) => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i](line)) waiters.splice(i, 1);
    }
  });
  const send = (msg) => sf.postMessage(msg);
  const waitFor = (prefix, timeoutMs = 60000) =>
    new Promise((resolve, reject) => {
      const lines = [];
      const timer = setTimeout(
        () => reject(new Error("fairy timeout waiting " + prefix)),
        timeoutMs
      );
      waiters.push((line) => {
        lines.push(line);
        if (line.startsWith(prefix)) {
          clearTimeout(timer);
          resolve(lines);
          return true;
        }
        return false;
      });
    });

  send("uci");
  await waitFor("uciok");
  send("setoption name UCI_Variant value makruk");
  send("isready");
  await waitFor("readyok");

  return {
    send,
    perft: async (positionFen, depth) => {
      const fen = positionFen.replaceAll("F", "M").replaceAll("f", "m");
      send(`position fen ${fen} - - 0 1`);
      // stockfish-family perft ends with "Nodes searched: N"
      const linesPromise = waitFor("Nodes searched:", 180000);
      send(`go perft ${depth}`);
      const lines = await linesPromise;
      const tail = lines[lines.length - 1];
      const n = Number(tail.replace(/[^0-9]/g, ""));
      const map = new Map();
      for (const l of lines) {
        const m = l.match(/^([a-h][1-8][a-h][1-8])\D+(\d+)$/);
        if (m) map.set(m[1], Number(m[2]));
      }
      return { map, total: n };
    },
    quit: () => send("quit"),
  };
}

const toFairyFen = (myFen) => myFen.replaceAll("F", "M").replaceAll("f", "m");

async function comparePos(mine, fairy, myFen, depth, label) {
  const [md, fd] = await Promise.all([mine.divide(depth), fairy.perft(myFen, depth)]);
  const problems = [];
  if (md.total !== fd.total) {
    problems.push(`total mine=${md.total} fairy=${fd.total}`);
  }
  for (const [mv, n] of md.map) {
    const fn = fd.map.get(mv);
    if (fn === undefined) problems.push(`move ${mv} missing in fairy`);
    else if (fn !== n) problems.push(`move ${mv}: mine=${n} fairy=${fn}`);
  }
  for (const mv of fd.map.keys()) {
    if (!md.map.has(mv)) problems.push(`move ${mv} missing in mine`);
  }
  if (problems.length) {
    console.log(`FAIL ${label}  ${myFen}`);
    for (const p of problems.slice(0, 12)) console.log("   " + p);
    return false;
  }
  console.log(`ok   ${label}  nodes@${depth}=${md.total}  ${myFen}`);
  return true;
}

const START = "rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w";

async function main() {
  const mine = startMine();
  const fairy = await startFairy();
  const rnd = mulberry32(SEED);
  let passed = 0;
  let failed = 0;

  // Start position ladder.
  for (const d of [1, 2, 3, 4]) {
    (await comparePos(mine, fairy, START, d, `startpos d${d}`)) ? passed++ : failed++;
  }

  // Random playouts; compare at the reached position.
  for (let i = 0; i < POSITIONS; i++) {
    const plies = 2 + Math.floor(rnd() * 38);
    const moves = [];
    let fen = START;
    let ok = true;
    await mine.setPosition(`position fen ${START}`);
    for (let p = 0; p < plies; p++) {
      const { map } = await mine.divide(1);
      const legal = [...map.keys()];
      if (legal.length === 0) break; // terminal for both sides
      moves.push(legal[Math.floor(rnd() * legal.length)]);
      fen = await mine.fenAfter(START, moves);
      if (!fen) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    (await comparePos(mine, fairy, fen, DEPTH, `rand#${i} ply${moves.length}`))
      ? passed++
      : failed++;
  }

  mine.quit();
  fairy.quit();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
