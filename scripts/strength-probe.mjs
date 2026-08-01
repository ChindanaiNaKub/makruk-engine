// Fast strength proxy for an eval artifact (strength-spec v1 §M4 amendment).
//
// Why this exists: the arena is ground truth but carries no gradient — v1, r1 and
// r2 all score 0-16 vs fairy skill 10, which cannot rank them. Every metric the
// training loop *can* see (val loss, WDL acc, counting-slice acc, int8 agreement)
// was green while the artifact lost every game. This measures two things the
// training metrics miss, cheaply enough to gate every round:
//
//   1. top1  — agreement with native fairy's fixed-depth best move on a frozen
//              probe set, stratified by phase x counting-state. Smooth: it moves
//              in percent, not in win counts.
//   2. shuffle — self-play from the endgame probe positions, measuring whether
//              the eval drives progress at all. A value-only WDL head returns a
//              flat near-draw score across shuffle positions, so search repeats;
//              this counts how often that happens.
//
// Usage:
//   node scripts/strength-probe.mjs                                  # classic baseline
//   MAKURUK_EVAL=net MAKURUK_WEIGHTS=out/v1/<a>.bin \
//     node scripts/strength-probe.mjs --movetime 50 --shuffle 12
//
// The engine under test is configured entirely by MAKURUK_* env, exactly as in
// match-arena.mjs, so the same command scores classic and any net artifact.

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
const MOVETIME = Number(arg("movetime", "100"));
const SHUFFLE_GAMES = Number(arg("shuffle", "8"));
const SHUFFLE_PLIES = Number(arg("shuffle-plies", "60"));

// src/search.rs:177 refuses to start an iteration unless min(movetime, 50) ms
// remain, so movetime <= ~60 yields exactly one iteration — depth-1 play, which
// measures nothing about the eval. 100 ms is also what match-arena gates at.
if (MOVETIME < 100) {
  console.error(`--movetime ${MOVETIME} is below the depth-1 cliff (see src/search.rs:177); use >= 100`);
  process.exit(1);
}
const JSON_OUT = args.includes("--json");
const BIN = path.join(root, "target", "release", "makruk-engine");

function startEngine(env = process.env) {
  const proc = spawn(BIN, [], { stdio: ["pipe", "pipe", "inherit"], env });
  const rl = readline.createInterface({ input: proc.stdout });
  const waiters = [];
  rl.on("line", (line) => {
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i](line)) waiters.splice(i, 1);
  });
  const waitFor = (pred, label, timeoutMs = 60000) =>
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
  const collectUntil = (pred, label, timeoutMs = 30000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout " + label)), timeoutMs);
      const lines = [];
      waiters.push((line) => {
        lines.push(line);
        if (!pred(line)) return false;
        clearTimeout(timer);
        resolve(lines);
        return true;
      });
    });
  return {
    send,
    waitFor,
    collectUntil,
    bestMove: async (fen, moves = []) => {
      send(moves.length ? `position fen ${fen} moves ${moves.join(" ")}` : `position fen ${fen}`);
      send(`go movetime ${MOVETIME}`);
      const line = await waitFor((l) => l.startsWith("bestmove "), "bestmove");
      const mv = line.split(/\s+/)[1];
      return mv === "(none)" ? null : mv;
    },
    status: async (fen, moves = []) => {
      send(moves.length ? `position fen ${fen} moves ${moves.join(" ")}` : `position fen ${fen}`);
      send("d");
      const lines = await collectUntil((l) => l.includes(" | "), "d");
      if (lines.find((l) => l.includes("illegal move"))) return { illegal: true };
      const [f, outcome, counting] = lines.find((l) => l.includes(" | ")).split(" | ");
      return { fen: f, outcome, counting: counting?.replace("counting=", "") };
    },
    kill: () => proc.kill("SIGKILL"),
  };
}

const pct = (a, b) => (b === 0 ? 0 : (100 * a) / b);

// ---------- metric 1: top-1 agreement with fairy's fixed-depth move ----------
async function topOne(eng, rows) {
  const byStratum = new Map();
  let hit = 0;
  for (const row of rows) {
    const mv = await eng.bestMove(row.fen);
    const ok = mv === row.best;
    if (ok) hit++;
    const s = byStratum.get(row.stratum) || { hit: 0, n: 0 };
    s.hit += ok ? 1 : 0;
    s.n += 1;
    byStratum.set(row.stratum, s);
  }
  return { hit, n: rows.length, byStratum };
}

// ---------- metric 2: does the eval drive progress, or shuffle? ----------
// Self-play from endgame probe positions, both sides on the eval under test.
// Measures POSITION REPETITION, not absence of captures: the r2 discriminator
// signature was ~150 plies of `e4d4 g1g2 d4e4 g2g1`, i.e. the same position
// recurring. (An earlier capture-based version flagged classic at 100% too and
// so ranked nothing — quiet endgame play is not the same defect as looping.)
async function shuffleRate(eng, rows) {
  const seeds = rows.filter((r) => r.stratum.startsWith("endgame")).slice(0, SHUFFLE_GAMES);
  let finished = 0;
  let repeatedPlies = 0;
  let totalPlies = 0;
  let loopGames = 0;

  for (const seed of seeds) {
    const moves = [];
    const seen = new Map();
    let ended = false;
    let gameRepeats = 0;

    for (let ply = 0; ply < SHUFFLE_PLIES; ply++) {
      const st = await eng.status(seed.fen, moves);
      if (st.illegal) break;
      if (!st.outcome.startsWith("ongoing")) {
        ended = true;
        break;
      }
      const key = st.fen; // board + side to move, as the oracle prints it
      const count = (seen.get(key) || 0) + 1;
      seen.set(key, count);
      if (count > 1) gameRepeats++;

      const mv = await eng.bestMove(seed.fen, moves);
      if (!mv) {
        ended = true;
        break;
      }
      moves.push(mv);
    }
    totalPlies += moves.length;
    repeatedPlies += gameRepeats;
    if (ended) finished++;
    // A third of the game spent revisiting positions = the looping signature.
    if (moves.length > 0 && gameRepeats / moves.length >= 0.33) loopGames++;
  }

  return {
    n: seeds.length,
    finished,
    loopGames,
    repeatPct: totalPlies ? (100 * repeatedPlies) / totalPlies : 0,
  };
}

async function main() {
  const raw = await readFile(path.resolve(root, PROBE), "utf8");
  const rows = raw.trim().split("\n").map((l) => JSON.parse(l));

  const label =
    process.env.MAKURUK_EVAL === "net"
      ? path.basename(process.env.MAKURUK_WEIGHTS || "net")
      : "classic";

  const eng = startEngine();
  eng.send("uci");
  await eng.waitFor((l) => l.includes("uciok"), "uciok");
  eng.send("isready");
  await eng.waitFor((l) => l.includes("readyok"), "readyok");

  const t0 = Date.now();
  const top = await topOne(eng, rows);
  const shuf = SHUFFLE_GAMES > 0 ? await shuffleRate(eng, rows) : null;
  eng.kill();
  const secs = ((Date.now() - t0) / 1000).toFixed(0);

  const report = {
    artifact: label,
    movetime: MOVETIME,
    top1: Number(pct(top.hit, top.n).toFixed(1)),
    positions: top.n,
    strata: Object.fromEntries(
      [...top.byStratum.entries()].sort().map(([k, v]) => [k, Number(pct(v.hit, v.n).toFixed(1))])
    ),
    shuffle: shuf
      ? {
          repeatPct: Number(shuf.repeatPct.toFixed(1)),
          loopGames: shuf.loopGames,
          finished: shuf.finished,
          games: shuf.n,
        }
      : null,
    seconds: Number(secs),
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report));
  } else {
    console.log(`artifact: ${report.artifact}  (movetime ${MOVETIME}ms, ${secs}s)`);
    console.log(`top1: ${report.top1}%  (${top.hit}/${top.n} vs fairy depth ${rows[0].depth})`);
    for (const [k, v] of Object.entries(report.strata)) console.log(`  ${k.padEnd(18)} ${v}%`);
    if (shuf) {
      console.log(
        `shuffle: ${report.shuffle.repeatPct}% repeated plies, ${report.shuffle.loopGames}/${shuf.n} looping, ${report.shuffle.finished}/${shuf.n} reached a result`
      );
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
