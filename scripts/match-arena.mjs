// Match arena: makruk-engine (native binary) vs fairy-stockfish-nnue.wasm.
// Games are adjudicated by OUR Game semantics (same as markrukthai's shared/),
// so counting-rule draws etc. behave exactly as they would on the site.
//
// Usage: node scripts/match-arena.mjs --games 8 --skill -20 --movetime 100
//   --games N      total games (colors alternate)
//   --skill S      fairy skill level, -20 (weakest) .. 20 (default)
//   --movetime MS  time per move for mine (fairy gets 4x)
//   --fairytime MS optional explicit fairy movetime (overrides 4x rule)
// Env:
//   FAIRY_DIR  dir containing fairy-stockfish-nnue.wasm (default: sibling markrukthai-1)
//   FAIRY_BIN  native fairy binary path — replaces the wasm fairy (2.4x faster)
//   FAIRY_EVAL EvalFile for the native fairy (e.g. tools/fairy/makruk-a8c621e24a8c.nnue)

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
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
const GAMES = Number(arg("games", "8"));
const FAIRY_SKILL = Number(arg("skill", "-20"));
const MOVETIME = Number(arg("movetime", "100"));
const FAIRYTIME = arg("fairytime", null) ? Number(arg("fairytime")) : MOVETIME * 4;
const DEPTH = Number(arg("depth", "0")); // >0: `go depth N` for BOTH engines (eval A/B)
const goCmd = (ms) => (DEPTH > 0 ? `go depth ${DEPTH}` : `go movetime ${ms}`);
const MAX_PLIES = 400;
// Random opening plies, replayed with colors reversed on the paired game.
// 0 restores the old every-game-from-startpos behaviour.
const OPENING_PLIES = Number(arg("opening-plies", "4"));
const SEED = Number(arg("seed", "7"));

const FAIRY_DIR =
  process.env.FAIRY_DIR || path.resolve(root, "..", "markrukthai-1", "node_modules");
const FAIRY_BIN = process.env.FAIRY_BIN || null;
const FAIRY_EVAL = process.env.FAIRY_EVAL || null;
// Net weights for the OPPONENT side (only meaningful with FAIRY_BIN = our own
// binary). Enables net-vs-net Gate A blocks; unset means the opponent plays our
// classical eval, as before.
const OPP_WEIGHTS = process.env.OPP_WEIGHTS || null;
const START = "rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w";

// ---- fetch bridge for emscripten under Node 24 ----
const origFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input?.url ?? input);
  if (!/^https?:|^file:|^data:|^blob:/.test(url)) {
    const buf = await readFile(url);
    return new Response(buf, { status: 200 });
  }
  return origFetch(input, init);
};

// ---------- generic UCI child process (our native binary) ----------
function startProcessEngine(bin, setup = [], env = null) {
  const proc = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"], env: env || process.env });
  const rl = readline.createInterface({ input: proc.stdout });
  const waiters = [];
  rl.on("line", (line) => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i](line)) waiters.splice(i, 1);
    }
  });
  const waitFor = (pred, label, timeoutMs = 30000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout " + label)), timeoutMs);
      waiters.push((line) => {
        if (pred(line)) {
          clearTimeout(timer);
          resolve(line);
          return true;
        }
        return false;
      });
    });
  const send = (l) => proc.stdin.write(l + "\n");
  return {
    send,
    waitFor,
    bestMove: async (uciMoves, movetimeMs) => {
      const positionCmd =
        uciMoves.length === 0
          ? `position fen ${START}`
          : `position fen ${START} moves ${uciMoves.join(" ")}`;
      send(positionCmd);
      send(goCmd(movetimeMs));
      const line = await waitFor((l) => l.startsWith("bestmove "), "bestmove", 60000);
      const mv = line.split(/\s+/)[1];
      return mv === "(none)" ? null : mv;
    },
    kill: () => proc.kill("SIGKILL"),
  };
}

// ---------- fairy wasm engine ----------
async function startFairyEngine() {
  const require = createRequire(FAIRY_DIR + path.sep);
  const Stockfish = require("fairy-stockfish-nnue.wasm/stockfish.js");
  const sf = await Stockfish();
  const waiters = [];
  sf.addMessageListener((line) => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i](line)) waiters.splice(i, 1);
    }
  });
  const waitFor = (pred, label, timeoutMs = 120000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("fairy timeout " + label)), timeoutMs);
      waiters.push((line) => {
        if (pred(line)) {
          clearTimeout(timer);
          resolve(line);
          return true;
        }
        return false;
      });
    });
  const send = (l) => sf.postMessage(l);

  send("uci");
  await waitFor((l) => l.includes("uciok"), "uciok");
  send("setoption name UCI_Variant value makruk");
  send(`setoption name Skill Level value ${FAIRY_SKILL}`);
  send("isready");
  await waitFor((l) => l.includes("readyok"), "readyok");

  return {
    send,
    bestMove: async (uciMoves, movetimeMs) => {
      const positionCmd =
        uciMoves.length === 0
          ? `position fen ${toFairyFen(START)} - - 0 1`
          : `position fen ${toFairyFen(START)} - - 0 1 moves ${uciMoves.join(" ")}`;
      send(positionCmd);
      send(goCmd(movetimeMs));
      const line = await waitFor((l) => l.startsWith("bestmove "), "fairy bestmove");
      const mv = line.split(/\s+/)[1];
      return mv === "(none)" ? null : mv;
    },
    kill: () => sf.terminate(),
  };
}

const toFairyFen = (fen) => fen.replaceAll("F", "M").replaceAll("f", "m");

// ---------- native fairy binary (FAIRY_BIN; ~2.4x faster than wasm) ----------
async function startFairyProcessEngine(bin) {
  // Sanitize MAKURUK_* out of the opponent's env so FAIRY_BIN can point at our
  // own binary without both sides inheriting the same eval. Default opponent is
  // our classical eval; OPP_WEIGHTS arms it with a net instead, which is what
  // spec §5.1 Gate A needs — a candidate net played head-to-head against the
  // incumbent net, not against a third party.
  const env = { ...process.env };
  delete env.MAKURUK_EVAL;
  delete env.MAKURUK_WEIGHTS;
  if (OPP_WEIGHTS) {
    env.MAKURUK_EVAL = "net";
    env.MAKURUK_WEIGHTS = OPP_WEIGHTS;
  }
  const eng = startProcessEngine(bin, [], env);
  eng.send("uci");
  await eng.waitFor((l) => l.includes("uciok"), "fairy uciok");
  eng.send("setoption name UCI_Variant value makruk");
  eng.send(`setoption name Skill Level value ${FAIRY_SKILL}`);
  if (FAIRY_EVAL) eng.send(`setoption name EvalFile value ${FAIRY_EVAL}`);
  eng.send("isready");
  await eng.waitFor((l) => l.includes("readyok"), "fairy readyok");

  return {
    send: eng.send,
    bestMove: async (uciMoves, movetimeMs) => {
      const positionCmd =
        uciMoves.length === 0
          ? `position fen ${toFairyFen(START)} - - 0 1`
          : `position fen ${toFairyFen(START)} - - 0 1 moves ${uciMoves.join(" ")}`;
      eng.send(positionCmd);
      eng.send(goCmd(movetimeMs));
      const line = await eng.waitFor((l) => l.startsWith("bestmove "), "fairy bestmove", 120000);
      const mv = line.split(/\s+/)[1];
      return mv === "(none)" ? null : mv;
    },
    kill: eng.kill,
  };
}

// ---------- adjudicator: our engine binary as the rules oracle ----------
function startOracle() {
  const proc = spawn(path.join(root, "target", "release", "makruk-engine"), [], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const rl = readline.createInterface({ input: proc.stdout });
  const waiters = [];
  rl.on("line", (line) => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i](line)) waiters.splice(i, 1);
    }
  });
  return {
    status: async (uciMoves) => {
      const positionCmd =
        uciMoves.length === 0
          ? `position fen ${START}`
          : `position fen ${START} moves ${uciMoves.join(" ")}`;
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("oracle timeout")), 15000);
        const lines = [];
        waiters.push((line) => {
          lines.push(line);
          if (line.includes(" | ")) {
            clearTimeout(timer);
            resolve(lines);
            return true;
          }
          return false;
        });
      });
      proc.stdin.write(positionCmd + "\n");
      proc.stdin.write("d\n");
      const lines = await promise;
      const illegal = lines.find((l) => l.includes("illegal move"));
      if (illegal) return { illegal };
      const dline = lines.find((l) => l.includes(" | "));
      const [fen, outcome, counting] = dline.split(" | ");
      return { fen, outcome, counting: counting?.replace("counting=", "") };
    },
    legalMoves: (uciMoves) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("oracle divide timeout")), 15000);
        const lines = [];
        waiters.push((line) => {
          lines.push(line);
          if (line.startsWith("total:")) {
            clearTimeout(timer);
            resolve(
              lines.filter((l) => !l.startsWith("total:") && l.includes(":")).map((l) => l.split(":")[0].trim())
            );
            return true;
          }
          return false;
        });
        const positionCmd =
          uciMoves.length === 0
            ? `position fen ${START}`
            : `position fen ${START} moves ${uciMoves.join(" ")}`;
        proc.stdin.write(positionCmd + "\n");
        proc.stdin.write("divide 1\n");
      }),
    kill: () => proc.kill("SIGKILL"),
  };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Both engines are near-deterministic from the start position, so without this
// an N-game block is not N independent samples — it is a handful of games
// replayed, diversified only by the opponent's skill noise and timing jitter.
// At skill 20 (the claim tier) that noise is near zero, which would have made
// M5's 100-game blocks close to meaningless. Each opening is played twice with
// colors reversed, so no opening's inherent bias can favour either side.
async function randomOpening(oracle, openingIdx) {
  if (OPENING_PLIES <= 0) return [];
  const rand = mulberry32(SEED * 7919 + openingIdx);
  const moves = [];
  for (let i = 0; i < OPENING_PLIES; i++) {
    const legal = await oracle.legalMoves(moves);
    if (!legal.length) return moves;
    moves.push(legal[Math.floor(rand() * legal.length)]);
  }
  return moves;
}

async function playGame(mine, fairy, mineColor, gameIdx, opening = []) {
  const oracle = startOracle();
  const moves = [...opening];
  let plies = moves.length;

  while (plies < MAX_PLIES) {
    const mineTurn = (plies % 2 === 0) === (mineColor === "white");
    const engine = mineTurn ? mine : fairy;
    const budget = mineTurn ? MOVETIME : FAIRYTIME;

    // Rules check first: is the game already over?
    const st = await oracle.status(moves);
    if (st.illegal) {
      oracle.kill();
      return { result: "oracle-illegal " + st.illegal, plies, moves };
    }
    if (!st.outcome.startsWith("ongoing")) {
      oracle.kill();
      return { result: st.outcome, plies, moves };
    }

    const mv = await engine.bestMove(moves, budget);
    if (!mv) {
      oracle.kill();
      return { result: "no-move " + (mineTurn ? "mine" : "fairy"), plies, moves };
    }

    // Reject illegal moves immediately (would corrupt the arena otherwise).
    const after = await oracle.status([...moves, mv]).catch(() => ({ illegal: "oracle-error" }));
    if (after.illegal) {
      oracle.kill();
      return {
        result: `illegal-move ${mv} by ${mineTurn ? "mine" : "fairy"} (${after.illegal})`,
        plies,
        moves,
      };
    }
    moves.push(mv);
    plies += 1;
  }

  const st = await oracle.status(moves);
  oracle.kill();
  return { result: "max-plies " + st.outcome, plies, moves };
}

// A mangled MAKURUK_EVAL silently falls back to the classical eval, so a block
// labelled "net" can measure classic and look like a legitimate result. That
// happened: `env $var node ...` in a zsh driver script does NOT word-split, so
// MAKURUK_EVAL was set to the whole string "net MAKURUK_WEIGHTS=/path" and
// three 32-game blocks measured the same engine. Fail loudly instead, and
// always print what each side is actually playing.
function resolveEval(label, evalVar, weightsVar) {
  if (evalVar !== undefined && evalVar !== "net" && evalVar !== "classic") {
    console.error(
      `FATAL: ${label} has MAKURUK_EVAL="${evalVar}" — must be exactly "net" or "classic".\n` +
        `  Use inline prefix assignments (VAR=x VAR2=y node ...), not \`env $var node ...\`.`
    );
    process.exit(2);
  }
  if (evalVar === "net" && !weightsVar) {
    console.error(`FATAL: ${label} requests MAKURUK_EVAL=net with no weights path.`);
    process.exit(2);
  }
  return evalVar === "net" ? `net ${path.basename(weightsVar)}` : "classic";
}

async function main() {
  const oppIsOurs = FAIRY_BIN && FAIRY_BIN.includes("makruk-engine");
  console.log(
    `mine: ${resolveEval("mine", process.env.MAKURUK_EVAL, process.env.MAKURUK_WEIGHTS)}  vs  ` +
      `opponent: ${oppIsOurs ? resolveEval("opponent", OPP_WEIGHTS ? "net" : "classic", OPP_WEIGHTS) : `fairy skill ${FAIRY_SKILL}${FAIRY_EVAL ? " +nnue" : " classical"}`}` +
      `  @ ${MOVETIME}/${FAIRYTIME} ms\n`
  );
  const mine = startProcessEngine(path.join(root, "target", "release", "makruk-engine"));
  const fairy = FAIRY_BIN ? await startFairyProcessEngine(FAIRY_BIN) : await startFairyEngine();

  const score = { mineWins: 0, fairyWins: 0, draws: 0, maxPly: 0, errors: 0 };
  const results = [];

  const openingOracle = startOracle();
  const openings = [];
  for (let i = 0; i < Math.ceil(GAMES / 2); i++) openings.push(await randomOpening(openingOracle, i));
  openingOracle.kill();
  if (OPENING_PLIES > 0) {
    console.log(`openings: ${openings.length} × ${OPENING_PLIES} random plies (seed ${SEED}), each played both colors\n`);
  }

  for (let g = 0; g < GAMES; g++) {
    const mineColor = g % 2 === 0 ? "white" : "black";
    const t0 = Date.now();
    const { result, plies, moves } = await playGame(mine, fairy, mineColor, g, openings[g >> 1]);
    const secs = ((Date.now() - t0) / 1000).toFixed(0);

    let tag;
    if (result.startsWith("checkmate winner=white")) {
      tag = mineColor === "white" ? "MINE" : "FAIRY";
    } else if (result.startsWith("checkmate winner=black")) {
      tag = mineColor === "black" ? "MINE" : "FAIRY";
    } else if (result.startsWith("stalemate") || result.startsWith("draw")) {
      tag = "DRAW";
    } else if (result.startsWith("max-plies")) {
      // Neither side converted in 400 plies. That is a drawn game, not a failed
      // one — lumping it with illegal moves and discarding it silently dropped
      // 25% of a 64-game Gate A block and biased the score toward whichever
      // side more often reached won-but-unconverted positions. Counted as a
      // draw, reported separately because a high count is itself a finding.
      tag = "MAXPLY";
    } else {
      tag = "ERR";
    }

    if (tag === "MINE") score.mineWins++;
    else if (tag === "FAIRY") score.fairyWins++;
    else if (tag === "DRAW") score.draws++;
    else if (tag === "MAXPLY") score.maxPly++;
    else score.errors++;

    const tail = moves.slice(-6).join(" ");
    console.log(
      `game ${g}: mine=${mineColor} -> ${tag} (${result}, ${plies} plies, ${secs}s) …${tail}`
    );
    if (tag === "ERR") {
      console.log(`  moves: ${moves.join(" ")}`);
    }
    results.push({ tag, result, plies });
  }

  // The headline number is the score fraction the spec's gates are stated in
  // (win 1, any draw 0.5), over every game that produced a position — errors
  // are the only games excluded, because they produced no game at all.
  const played = score.mineWins + score.fairyWins + score.draws + score.maxPly;
  const points = score.mineWins + 0.5 * (score.draws + score.maxPly);
  const pct = played ? ((points / played) * 100).toFixed(1) : "—";
  console.log(
    `\nscore: mine ${score.mineWins} – fairy ${score.fairyWins} – draws ${score.draws} – max-plies ${score.maxPly} – errors ${score.errors}`
  );
  console.log(`score fraction: ${pct}%  (${points}/${played}; max-plies counted as draws)`);
  mine.kill();
  fairy.kill();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
