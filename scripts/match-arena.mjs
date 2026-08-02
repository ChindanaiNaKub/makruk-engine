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
import { writeFileSync } from "node:fs";
import readline from "node:readline";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32, openingSeed } from "./lib/rng.mjs";
import { preflightOrDie } from "./preflight.mjs";
import { ensureGatesOrDie } from "./gate.mjs";
import { appendBlock } from "./results.mjs";
import { evaluate as sprtEvaluate, describe as sprtDescribe, DEFAULTS as SPRT_DEFAULTS } from "./sprt.mjs";
import { BUDGET, announce, enforceForeground, estimateBlockS, ThermalGuard } from "./budget.mjs";

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
// Self-play control blocks run identical evals on both sides on purpose, so the
// preflight identical-sides check has to be opt-out. See preflight.mjs check 3.
const CONTROL = args.includes("--control");
// Ledger classification. Inferred by default so a block is never filed as the
// wrong kind through forgetfulness; --kind overrides for smokes and one-offs.
const KIND_OVERRIDE = arg("kind", null);
// Each concurrent game costs ~2 busy cores (our engine + the opponent; the oracle
// is mostly idle). PINNED by rig ticket 01 — the whole ladder was re-measured at
// this value, and engines at fixed movetime search fewer nodes when they contend,
// so a different concurrency is effectively a different opponent. Overriding it
// is a clause-(b) binding mechanism and owes a control block (rig ticket 07).
const CONCURRENCY = Number(arg("concurrency", String(BUDGET.arenaConcurrency)));
// Raise the wall-clock ceiling for a deliberately long one-off (a big control
// block, a diagnostic sweep). Named so it shows up in the shell history of the
// run that used it.
const BUDGET_MIN = arg("budget-min", null);
const ALLOW_HOT = args.includes("--allow-hot");
// Opt-in move dump for corpus-drift.mjs (rig ticket 05). Writing the MOVES and
// letting the analysis replay them through the oracle keeps the arena's job
// unchanged — no per-ply bookkeeping in the hot loop, and the positions the
// analysis sees are the same ones the oracle adjudicated.
const DUMP_GAMES = arg("dump-games", null);
// Diagnostic escape hatch: keep transposition tables across games, the way the
// pre-2026-08-02 serial harness did. Only for measuring what that carryover was
// worth — a block run this way depends on slot assignment and is not reproducible.
const KEEP_TT = args.includes("--keep-tt");

// Sequential Gate A. See scripts/sprt.mjs for why, and rig ticket 03 for the
// decision to leave Gate B on fixed blocks: Gate B is a ladder MEASUREMENT that
// has to stay comparable across rungs, while Gate A is a pure accept/reject,
// which is what a sequential test is for.
const SPRT = args.includes("--sprt");
const SPRT_OPTS = {
  elo0: Number(arg("elo0", String(SPRT_DEFAULTS.elo0))),
  elo1: Number(arg("elo1", String(SPRT_DEFAULTS.elo1))),
  alpha: Number(arg("alpha", String(SPRT_DEFAULTS.alpha))),
  beta: Number(arg("beta", String(SPRT_DEFAULTS.beta))),
  minPairs: Number(arg("min-pairs", String(SPRT_DEFAULTS.minPairs))),
  maxPairs: Number(arg("max-pairs", String(SPRT_DEFAULTS.maxPairs))),
};
// Under SPRT --games is a cap, not a target: the cap is the max-pairs budget.
const GAMES_EFFECTIVE = SPRT ? SPRT_OPTS.maxPairs * 2 : GAMES;

const FAIRY_DIR =
  process.env.FAIRY_DIR || path.resolve(root, "..", "markrukthai-1", "node_modules");
const FAIRY_BIN = process.env.FAIRY_BIN || null;
const FAIRY_EVAL = process.env.FAIRY_EVAL || null;
// Net weights for the OPPONENT side (only meaningful with FAIRY_BIN = our own
// binary). Enables net-vs-net Gate A blocks; unset means the opponent plays our
// classical eval, as before.
const OPP_WEIGHTS = process.env.OPP_WEIGHTS || null;
const START = "rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w";
const OUR_ENGINE = path.join(root, "target", "release", "makruk-engine");

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

// Both engines are near-deterministic from the start position, so without this
// an N-game block is not N independent samples — it is a handful of games
// replayed, diversified only by the opponent's skill noise and timing jitter.
// At skill 20 (the claim tier) that noise is near zero, which would have made
// M5's 100-game blocks close to meaningless. Each opening is played twice with
// colors reversed, so no opening's inherent bias can favour either side.
async function randomOpening(oracle, openingIdx) {
  if (OPENING_PLIES <= 0) return [];
  const rand = mulberry32(openingSeed(SEED, openingIdx));
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
  // Substring-matching "makruk-engine" here was a latent trap: the repository
  // directory is itself named makruk-engine, so ANY path under it matched and a
  // block against the real fairy binary was labelled as a head-to-head against
  // our classical eval. Harmless while it only coloured a console line; actively
  // corrupting once the ledger started recording it. Compare resolved paths.
  const oppIsOurs = !!FAIRY_BIN && path.resolve(FAIRY_BIN) === path.resolve(OUR_ENGINE);

  // Hard precondition, not a habit: the rig proves itself before a single game
  // is played. Sub-second. See .scratch/makruk-rig/issues/04-*.md.
  const sides = [
    { label: "mine", env: { MAKURUK_EVAL: process.env.MAKURUK_EVAL, MAKURUK_WEIGHTS: process.env.MAKURUK_WEIGHTS } },
  ];
  if (oppIsOurs) {
    sides.push({
      label: "opponent",
      env: OPP_WEIGHTS ? { MAKURUK_EVAL: "net", MAKURUK_WEIGHTS: OPP_WEIGHTS } : { MAKURUK_EVAL: "classic" },
    });
  }
  await preflightOrDie({ sides, control: CONTROL, seed: SEED });

  // Hash-gated: free unless src/ actually changed since the last passing run.
  // `--skip-gates` exists for the case where you are deliberately measuring a
  // known-broken build; it prints loudly because that is not a normal state.
  if (args.includes("--skip-gates")) {
    console.warn("WARNING: --skip-gates — engine preconditions were NOT verified for this block.\n");
  } else {
    ensureGatesOrDie([{ name: "cargo-test" }], { quiet: false });
  }

  // ---- budget (rig ticket 01) ----
  // Announced before anything spawns, and refused rather than degraded. Gate A
  // is the accept/reject and gets the 10-minute verdict budget; a fairy block is
  // a ladder MEASUREMENT and gets the smaller one. Under SPRT the announced
  // number is the CAP — the typical block finishes in about a third of it — but
  // the cap is what you would cancel over, so the cap is what gets shown.
  const selfplayRate = oppIsOurs;
  const budgetMinutes = Number(
    BUDGET_MIN ?? (oppIsOurs ? BUDGET.gateMinutes : BUDGET.measureMinutes)
  );
  const worstS = estimateBlockS(GAMES_EFFECTIVE, {
    selfplay: selfplayRate,
    concurrency: CONCURRENCY,
    movetime: MOVETIME,
    opponentMovetime: FAIRYTIME,
    maxPlies: MAX_PLIES,
  });
  announce({
    label: `${GAMES_EFFECTIVE} games${SPRT ? " (SPRT cap)" : ""}`,
    worstS,
    cores: Math.min(CONCURRENCY, GAMES_EFFECTIVE) * 2,
    thermal: "foreground — brief but not cool (~97 °C peak), never niced (movetime-bound)",
    extra: `ceiling ${budgetMinutes} min${BUDGET_MIN ? " (--budget-min)" : ""}`,
  });
  enforceForeground({
    label: `${GAMES_EFFECTIVE} games at concurrency ${CONCURRENCY}`,
    worstS,
    budgetMinutes,
    allowHot: ALLOW_HOT,
    overBudgetHint: SPRT
      ? "Lower --max-pairs, or pass --budget-min N if this long a block is the point."
      : "Lower --games, or pass --budget-min N if this long a block is the point.",
  });
  // Records the thermal context of every block so a future session can CHECK
  // whether temperature correlates with score, rather than trusting the
  // hot-start threshold on faith. No abort here: a foreground block is minutes
  // long and killing it mid-way would waste the games without saving the laptop.
  const thermals = new ThermalGuard();

  console.log(
    `mine: ${resolveEval("mine", process.env.MAKURUK_EVAL, process.env.MAKURUK_WEIGHTS)}  vs  ` +
      `opponent: ${oppIsOurs ? resolveEval("opponent", OPP_WEIGHTS ? "net" : "classic", OPP_WEIGHTS) : `fairy skill ${FAIRY_SKILL}${FAIRY_EVAL ? " +nnue" : " classical"}`}` +
      `  @ ${MOVETIME}/${FAIRYTIME} ms\n`
  );
  const score = { mineWins: 0, fairyWins: 0, draws: 0, maxPly: 0, errors: 0 };

  // Openings are drawn up front from the seeded PRNG, indexed by opening number.
  // Game g always takes openings[g >> 1] and colour g % 2, so the colour-reversed
  // pairing is a property of the game INDEX, not of execution order — which is
  // what makes it survive being played out of order below.
  const openingOracle = startOracle();
  const openings = [];
  for (let i = 0; i < Math.ceil(GAMES_EFFECTIVE / 2); i++) openings.push(await randomOpening(openingOracle, i));
  openingOracle.kill();
  if (OPENING_PLIES > 0) {
    console.log(`openings: ${openings.length} × ${OPENING_PLIES} random plies (seed ${SEED}), each played both colors`);
  }

  // ---- worker pool ----
  // Games were played strictly serially until 2026-08-02: one engine pair for the
  // whole block, so a 32-game block occupied 2 of 16 cores and took ~8 minutes.
  // Each concurrent game needs its OWN engine pair (plus the oracle playGame
  // already spawns per game), because a UCI engine is a single conversation —
  // two games sharing one process would interleave `go`/`bestmove` and corrupt
  // both. Roughly 2 busy cores per slot.
  if (SPRT) {
    console.log(
      `SPRT enabled: H0 = ${SPRT_OPTS.elo0} Elo vs H1 = ${SPRT_OPTS.elo1} Elo, α=${SPRT_OPTS.alpha} β=${SPRT_OPTS.beta}, ` +
        `${SPRT_OPTS.minPairs}–${SPRT_OPTS.maxPairs} pairs (${SPRT_OPTS.minPairs * 2}–${SPRT_OPTS.maxPairs * 2} games). --games is ignored.`
    );
  }
  const slotCount = Math.max(1, Math.min(CONCURRENCY, GAMES_EFFECTIVE));
  console.log(`concurrency: ${slotCount} game${slotCount === 1 ? "" : "s"} at a time (${slotCount * 2} busy cores of ${os.cpus().length})\n`);
  const slots = [];
  for (let i = 0; i < slotCount; i++) {
    slots.push({
      mine: startProcessEngine(OUR_ENGINE),
      fairy: FAIRY_BIN ? await startFairyProcessEngine(FAIRY_BIN) : await startFairyEngine(),
    });
  }

  const results = new Array(GAMES_EFFECTIVE);
  const blockStart = Date.now();
  let nextGame = 0;
  let finished = 0;
  let issued = 0;
  // SPRT state. A pair is games 2k and 2k+1 on the same opening with colours
  // reversed; only COMPLETE pairs are observations. llr() uses just the mean and
  // variance of the pair scores, so it is order-independent — which matters,
  // because the pool completes pairs out of order.
  const pairParts = new Map();
  const pairScores = [];
  let verdict = null;

  await Promise.all(
    slots.map(async (slot) => {
      for (;;) {
        if (verdict) return; // a bound was crossed; stop issuing new games
        const g = nextGame++;
        if (g >= GAMES_EFFECTIVE) return;
        issued++;
        const mineColor = g % 2 === 0 ? "white" : "black";
        const t0 = Date.now();

        // Clear both transposition tables between games. Serially, one engine
        // played every game and carried its TT across all of them; with a pool
        // it would carry across only the games that happened to land in the same
        // slot, which would make a block's result depend on how work was
        // distributed. Starting each game clean makes the block independent of
        // concurrency — the property a reproducible harness needs.
        if (!KEEP_TT) {
          slot.mine.send("ucinewgame");
          slot.fairy.send("ucinewgame");
        }

        const { result, plies, moves } = await playGame(slot.mine, slot.fairy, mineColor, g, openings[g >> 1]);
        const secs = ((Date.now() - t0) / 1000).toFixed(0);

        let tag;
        if (result.startsWith("checkmate winner=white")) {
          tag = mineColor === "white" ? "MINE" : "FAIRY";
        } else if (result.startsWith("checkmate winner=black")) {
          tag = mineColor === "black" ? "MINE" : "FAIRY";
        } else if (result.startsWith("stalemate") || result.startsWith("draw")) {
          tag = "DRAW";
        } else if (result.startsWith("max-plies")) {
          // Neither side converted in 400 plies. That is a drawn game, not a
          // failed one — lumping it with illegal moves and discarding it
          // silently dropped 25% of a 64-game Gate A block and biased the score
          // toward whichever side more often reached won-but-unconverted
          // positions. Counted as a draw, reported separately because a high
          // count is itself a finding.
          tag = "MAXPLY";
        } else {
          tag = "ERR";
        }

        results[g] = { tag, result, plies, mineColor, secs, moves };
        finished++;
        const total = SPRT ? `≤${GAMES_EFFECTIVE}` : String(GAMES_EFFECTIVE);
        console.log(
          `[${String(finished).padStart(3)}/${total}] game ${g}: mine=${mineColor} -> ${tag} (${result}, ${plies} plies, ${secs}s) …${moves.slice(-6).join(" ")}`
        );
        if (tag === "ERR") console.log(`  moves: ${moves.join(" ")}`);

        if (SPRT && tag !== "ERR") {
          const k = g >> 1;
          const pts = tag === "MINE" ? 1 : tag === "FAIRY" ? 0 : 0.5;
          const parts = pairParts.get(k) ?? [];
          parts.push(pts);
          pairParts.set(k, parts);
          if (parts.length === 2) {
            pairScores.push((parts[0] + parts[1]) / 2);
            const v = sprtEvaluate(pairScores, SPRT_OPTS);
            if (pairScores.length % 10 === 0 && !v.decision) {
              console.log(`      SPRT: ${pairScores.length} pairs, LLR ${v.llr.toFixed(2)} in [${v.lower.toFixed(2)}, ${v.upper.toFixed(2)}]`);
            }
            // Only the FIRST crossing is the verdict. Games already in flight
            // keep completing and their pairs keep landing; re-announcing on
            // each would print the same decision several times.
            if (v.decision && !verdict) {
              verdict = v;
              console.log(`\n${sprtDescribe(v)}\n  stopping; games already in flight will finish and are counted.`);
            }
          }
        }
      }
    })
  );

  // Tally in GAME order, not completion order, so the record is deterministic.
  // Under SPRT the results array is sized to the cap and only partly filled, so
  // the holes are dropped here rather than counted as errors.
  const playedResults = results.filter(Boolean);
  for (const r of playedResults) {
    if (r.tag === "MINE") score.mineWins++;
    else if (r.tag === "FAIRY") score.fairyWins++;
    else if (r.tag === "DRAW") score.draws++;
    else if (r.tag === "MAXPLY") score.maxPly++;
    else score.errors++;
  }
  const blockSecs = (Date.now() - blockStart) / 1000;
  const gameSecs = playedResults.reduce((a, r) => a + Number(r.secs), 0);
  const mine = { kill: () => slots.forEach((s) => s.mine.kill()) };
  const fairy = { kill: () => slots.forEach((s) => s.fairy.kill()) };

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
  // gameSecs is the wall-clock this block would have cost serially, so the ratio
  // is the realised speed-up rather than an assumed one.
  console.log(
    `wall-clock: ${blockSecs.toFixed(0)}s at concurrency ${slotCount} ` +
      `(${gameSecs.toFixed(0)}s of game time → ${(gameSecs / blockSecs).toFixed(1)}× vs serial)`
  );

  // ---- always-on assertions on impossible states (rig ticket 04, mechanism 2) ----
  // These cost nothing and fire on the tally, where a corrupt block is still
  // distinguishable from a real negative result.
  mine.kill();
  fairy.kill();
  const bad = [];
  // Every requested game must be accounted for as played or errored. `played`
  // alone is the wrong invariant: errors legitimately produce no game.
  // Short and over are different bugs with different fixes, so say which — the
  // log line has to be diagnosable without re-deriving it from the raw output.
  // Under SPRT the block stops early by design, so the invariant is against the
  // games actually ISSUED, not against the cap.
  const accounted = played + score.errors;
  if (accounted < issued) {
    bad.push(
      `accounting SHORT: ${accounted} of ${issued} issued games reached the tally (${played} played + ${score.errors} errors). ` +
        `${issued - accounted} vanished — a result tag fell through the classifier, or the game loop exited early. ` +
        `The score fraction is over a smaller denominator than you think.`
    );
  } else if (accounted > issued) {
    bad.push(
      `accounting OVER: ${accounted} results for ${issued} issued games (${played} played + ${score.errors} errors). ` +
        `A game was tallied twice — the score fraction is diluted by a duplicate.`
    );
  }
  if (played > 0 && (points / played < 0 || points / played > 1)) {
    bad.push(`score fraction ${pct}% is outside [0,100] — the scoring policy is broken.`);
  }
  if (played === 0) bad.push(`no game produced a position (${score.errors} errors) — there is nothing to score.`);
  if (bad.length) {
    console.error(`\nFATAL [assert] ${bad.join("\n         ")}`);
    console.error("This block's number is not trustworthy. Do not record it.");
    process.exit(3);
  }
  // Warn, never fatal: zero draws in a long block is suspicious in a variant
  // whose counting rule produces them constantly, but it is not impossible — and
  // a fatal that cries wolf once is a fatal you learn to ignore.
  if (played >= 32 && score.draws + score.maxPly === 0) {
    console.warn(
      `\nWARNING: ${played} games, zero draws and zero max-plies. Makruk's counting rule normally produces some.\n` +
        `  Plausible at a rung where one side is simply outclassed (skill 10/20 both read 0–32–0), suspicious anywhere else.`
    );
  }

  // The arena records its own result. Nothing transcribes the number, so nothing
  // can transcribe it wrong — and it does not land in a session-scoped /tmp that
  // dies with the shell that started it. See scripts/results.mjs.
  const armedOf = (label) => sides.find((s) => s.label === label)?.armed ?? null;
  // A block too small to resolve anything is filed as a smoke regardless of what
  // it was asked to be — at n<8 the standard error exceeds 17 points, so calling
  // it a gate would put a number in the ledger that cannot mean what its kind
  // implies. Smokes are kept, just hidden from the default view.
  const kind =
    GAMES < 8 && KIND_OVERRIDE !== "control"
      ? "smoke"
      : (KIND_OVERRIDE ?? (CONTROL ? "control" : oppIsOurs ? "gate-a" : "gate-b"));
  if (DUMP_GAMES) {
    writeFileSync(
      DUMP_GAMES,
      results
        .filter(Boolean)
        .map((r, i) => JSON.stringify({ game: i, tag: r.tag, result: r.result, plies: r.plies, mineColor: r.mineColor, moves: r.moves }))
        .join("\n") + "\n"
    );
    console.log(`dumped ${results.filter(Boolean).length} games to ${DUMP_GAMES}`);
  }

  const row = appendBlock({
    kind,
    mine: {
      engine: "ours",
      eval: process.env.MAKURUK_EVAL === "net" ? "net" : "classic",
      weights: process.env.MAKURUK_WEIGHTS ? path.basename(process.env.MAKURUK_WEIGHTS) : null,
      armed: armedOf("mine"),
    },
    opponent: oppIsOurs
      ? {
          engine: "ours",
          eval: OPP_WEIGHTS ? "net" : "classic",
          weights: OPP_WEIGHTS ? path.basename(OPP_WEIGHTS) : null,
          armed: armedOf("opponent"),
        }
      : { engine: "fairy", skill: FAIRY_SKILL, eval: FAIRY_EVAL ? "nnue" : "classical", binary: FAIRY_BIN ? "native" : "wasm" },
    games: issued,
    movetime: MOVETIME,
    opponentMovetime: FAIRYTIME,
    openingPlies: OPENING_PLIES,
    seed: SEED,
    w: score.mineWins,
    l: score.fairyWins,
    d: score.draws,
    maxPlies: score.maxPly,
    errors: score.errors,
    score: points / played,
    perGame: playedResults.map((r) => ({ tag: r.tag, plies: r.plies })),
    sprt: verdict
      ? { ...SPRT_OPTS, decision: verdict.decision, llr: Number(verdict.llr.toFixed(4)), pairs: verdict.pairs }
      : SPRT
        ? { ...SPRT_OPTS, decision: "no-decision-at-exit", pairs: pairScores.length }
        : null,
    concurrency: slotCount,
    wallClockS: Math.round(blockSecs),
    gameTimeS: Math.round(gameSecs),
    ...thermals.stop(),
  });
  if (SPRT && !verdict) {
    console.log(`\nSPRT: exited with ${pairScores.length} pairs and no decision (cap ${SPRT_OPTS.maxPairs}). NOT accepted — the incumbent holds.`);
  }
  console.log(`\nrecorded as ${row.id} in results/blocks.jsonl`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
