// Datagen harness (spec §3): native NNUE-armed fairy self-plays through OUR Game
// oracle (site-exact adjudication), exporting one labeled row per position:
//   {"fen","eval","wdl","game","ply"} — eval = teacher static eval (cp, side-to-move
//   perspective), wdl = oracle-adjudicated final outcome from that position's STM.
//
// Label design note (M0 finding): fairy suppresses info lines on sub-second
// searches, so depth-scored labels are impractical at datagen speeds. Bootstrap
// labels = static `eval` of the NNUE-armed teacher (depth-0) + game-result WDL.
//
// Usage: node scripts/datagen.mjs --positions 10000 --depth 3 --jobs 12 --out tools/data/smoke.jsonl
//   --positions N   stop after N labeled rows (default 10000)
//   --depth N       teacher search depth per move (default 3)
//   --jobs N        parallel fairy+oracle pairs (default 12)
//   --opening-plies N   skill-randomized opening plies for diversity (default 8)
//   --opening-level N   fairy Skill Level during the opening (default 3)
//   --out PATH      JSONL output (default tools/data/datagen-<ts>.jsonl)
//   --selfplay      DAgger mode: our binary (env-armed) plays the NNUE teacher,
//                   teacher intervenes on 15% of student turns, rows on student
//                   decision positions only, Goldilocks sample weights added.
//   --student-time  student movetime per move in selfplay (default 50)
// Env: FAIRY_BIN (default tools/fairy/fairy-stockfish)
//      FAIRY_EVAL (default tools/fairy/makruk-a8c621e24a8c.nnue; "none" = classical)

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
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
const POSITIONS = Number(arg("positions", "10000"));
const DEPTH = Number(arg("depth", "3"));
const JOBS = Number(arg("jobs", "12"));
const OPENING_PLIES = Number(arg("opening-plies", "8"));
const OPENING_LEVEL = Number(arg("opening-level", "3"));
const OUT = arg("out", path.join(root, "tools", "data", `datagen-${Date.now()}.jsonl`));
const MAX_PLIES = 400;

const SELFPLAY = args.includes("--selfplay");
const STUDENT_TIME = Number(arg("student-time", "50"));
const INTERVENE_P = 0.15;

const FAIRY_BIN = process.env.FAIRY_BIN || path.join(root, "tools", "fairy", "fairy-stockfish");
const FAIRY_EVAL =
  (process.env.FAIRY_EVAL ?? path.join(root, "tools", "fairy", "makruk-a8c621e24a8c.nnue"));
const START = "rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w";
const toFairyFen = (fen) => fen.replaceAll("F", "M").replaceAll("f", "m");

// ---------- generic line-driven UCI child ----------
function startProc(bin) {
  const proc = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] });
  const rl = readline.createInterface({ input: proc.stdout });
  const waiters = [];
  rl.on("line", (line) => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i](line)) waiters.splice(i, 1);
    }
  });
  const waitFor = (pred, label, timeoutMs = 120000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
      waiters.push((line) => {
        if (pred(line)) {
          clearTimeout(timer);
          resolve(line);
          return true;
        }
        return false;
      });
    });
  return { send: (l) => proc.stdin.write(l + "\n"), waitFor, kill: () => proc.kill("SIGKILL") };
}

// ---------- fairy (teacher) ----------
async function startFairy() {
  const eng = startProc(FAIRY_BIN);
  eng.send("uci");
  await eng.waitFor((l) => l.includes("uciok"), "uciok");
  eng.send("setoption name UCI_Variant value makruk");
  eng.send("setoption name Threads value 1");
  eng.send("setoption name Hash value 64");
  if (FAIRY_EVAL !== "none") eng.send(`setoption name EvalFile value ${FAIRY_EVAL}`);
  eng.send("isready");
  await eng.waitFor((l) => l.includes("readyok"), "readyok");

  const setSkill = async (level) => {
    eng.send(`setoption name Skill Level value ${level}`);
    eng.send("isready");
    await eng.waitFor((l) => l.includes("readyok"), "skill readyok");
  };

  // Play one move from `moves` at `depth`; also return teacher static eval of the
  // position the move was played FROM (cp, positive = good for side to move... raw:
  // from the side named in `eval`'s "white|black side"; caller normalizes).
  const moveAndEval = async (moves, depth) => {
    const positionCmd =
      moves.length === 0
        ? `position fen ${toFairyFen(START)} - - 0 1`
        : `position fen ${toFairyFen(START)} - - 0 1 moves ${moves.join(" ")}`;
    eng.send(positionCmd);
    eng.send(`go depth ${depth}`);
    const bm = await eng.waitFor((l) => l.startsWith("bestmove "), "bestmove");
    const mv = bm.split(/\s+/)[1];
    eng.send("eval");
    const evalLine = await eng.waitFor((l) => l.startsWith("Final evaluation"), "eval");
    // "Final evaluation       +1.71 (white side) [...]" or "Final evaluation: none (in check)"
    const m = evalLine.match(/Final evaluation\s+([-+]?[\d.]+)\s+\((white|black) side\)/);
    const val = m ? parseFloat(m[1]) : null; // null = undefined eval (in check)
    const side = m ? m[2] : "white";
    return { mv: mv === "(none)" ? null : mv, evalCp: val === null ? null : Math.round(val * 100), evalSide: side };
  };

  return { setSkill, moveAndEval, kill: eng.kill };
}

// ---------- oracle (our engine = site rules) ----------
function makeOracle() {
  const proc = spawn(path.join(root, "target", "release", "makruk-engine"), [], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const rl = readline.createInterface({ input: proc.stdout });
  let pending = null;
  rl.on("line", (line) => {
    if (!pending) return;
    pending.lines.push(line);
    if (pending.done(line)) {
      clearTimeout(pending.timer);
      pending.resolve(pending.lines);
      pending = null;
    }
  });
  const query = (moves, cmd2, done) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("oracle timeout")), 30000);
      pending = { lines: [], resolve, timer, done };
      const positionCmd =
        moves.length === 0
          ? `position fen ${START}`
          : `position fen ${START} moves ${moves.join(" ")}`;
      proc.stdin.write(positionCmd + "\n");
      proc.stdin.write(cmd2 + "\n");
    });
  return {
    status: (moves) =>
      query(moves, "d", (l) => l.includes(" | ")).then((lines) => {
        const illegal = lines.find((l) => l.includes("illegal move"));
        if (illegal) return { illegal };
        const dline = lines.find((l) => l.includes(" | "));
        const [fen, outcome, counting] = dline.split(" | ");
        return { fen: fen.trim(), outcome: outcome.trim(), counting: counting?.replace("counting=", "") };
      }),
    perft1Moves: (moves) =>
      query(moves, "divide 1", (l) => l.startsWith("total:")).then((lines) =>
        lines.filter((l) => !l.startsWith("total:")).map((l) => l.split(":")[0].trim())
      ),
    kill: () => proc.kill("SIGKILL"),
  };
}

// ---------- student (our engine) for DAgger selfplay ----------
function startStudent() {
  const eng = startProc(path.join(root, "target", "release", "makruk-engine"));
  const move = async (moves, ms) => {
    const positionCmd =
      moves.length === 0
        ? `position fen ${START}`
        : `position fen ${START} moves ${moves.join(" ")}`;
    eng.send(positionCmd);
    eng.send(`go movetime ${ms}`);
    const line = await eng.waitFor((l) => l.startsWith("bestmove "), "student bestmove", 30000);
    const mv = line.split(/\s+/)[1];
    return mv === "(none)" ? null : mv;
  };
  const evalScore = async () => {
    eng.send("eval");
    const line = await eng.waitFor((l) => l.startsWith("eval "), "student eval", 10000);
    return parseInt(line.split(/\s+/)[1], 10);
  };
  return { move, evalScore, kill: eng.kill };
}

// ---------- Goldilocks weight (spec §5; Moka's 0.25+1.75*gauss on disagreement) ----------
function goldilocks(evalStudentCp, evalTeacherCp) {
  const d =
    Math.min(Math.abs(Math.tanh(evalStudentCp / 400) - Math.tanh(evalTeacherCp / 400)), 2) / 2;
  return 0.25 + 1.75 * Math.exp(-0.5 * Math.pow((d - 0.55) / 0.25, 2));
}

// ---------- one selfplay game (DAgger round) ----------
async function playSelfGame(student, fairy, oracle, gameId, studentWhite) {
  const moves = [];
  const rows = [];
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const st = await oracle.status(moves);
    if (st.illegal)
      return {
        rows: [],
        result: "oracle-illegal " + st.illegal + " || seq: " + moves.slice(-40).join(" "),
        plies: ply,
      };
    if (!st.outcome.startsWith("ongoing")) {
      const base = st.outcome.startsWith("checkmate winner=white")
        ? "w"
        : st.outcome.startsWith("checkmate winner=black")
          ? "b"
          : "d";
      for (const r of rows) {
        r.wdl = base === "d" ? "d" : base === r.side ? "w" : "l";
        delete r.side;
      }
      return { rows, result: st.outcome, plies: ply };
    }

    const side = ply % 2 === 0 ? "w" : "b";
    const studentTurn = (side === "w") === studentWhite;

    // random opening plies diversify trajectories (uniform root move via perft 1)
    if (ply < OPENING_PLIES) {
      const lines = await oracle.perft1Moves(moves);
      const mv = lines[Math.floor(Math.random() * lines.length)];
      if (!mv) return { rows: [], result: "no-opening-move", plies: ply };
      moves.push(mv);
      continue;
    }

    if (studentTurn) {
      const sEval = await student.evalScore();
      const teach = await fairy.moveAndEval(moves, DEPTH);
      let mv;
      if (Math.random() < INTERVENE_P) {
        mv = teach.mv; // DAgger rescue: teacher takes over this turn
      } else {
        mv = await student.move(moves, STUDENT_TIME);
      }
      if (!mv) return { rows: [], result: "no-move", plies: ply };
      if (teach.evalCp !== null) {
        rows.push({
          fen: st.fen,
          eval: teach.evalSide === side ? teach.evalCp : -teach.evalCp,
          w: +goldilocks(sEval, teach.evalSide === side ? teach.evalCp : -teach.evalCp).toFixed(4),
          wdl: null,
          game: gameId,
          ply,
          counting: st.counting || "none",
          side,
        });
      }
      moves.push(mv);
    } else {
      const t = await fairy.moveAndEval(moves, DEPTH);
      if (!t.mv) return { rows: [], result: "no-move", plies: ply };
      moves.push(t.mv);
    }
  }
  return { rows: [], result: "max-plies (aborted, rows discarded)", plies: moves.length };
}

// ---------- one game ----------
async function playGame(fairy, oracle, gameId) {
  const moves = [];
  const rows = [];
  let aborted = null;

  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const st = await oracle.status(moves);
    if (st.illegal) {
      aborted = "oracle-illegal " + st.illegal;
      break;
    }
    if (!st.outcome.startsWith("ongoing")) {
      // game over: tag buffered rows with the oracle-adjudicated result
      const base = st.outcome.startsWith("checkmate winner=white")
        ? "w"
        : st.outcome.startsWith("checkmate winner=black")
          ? "b"
          : "d";
      for (const r of rows) {
        r.wdl = base === "d" ? "d" : base === r.side ? "w" : "l";
        delete r.side;
      }
      return { rows, result: st.outcome, plies: ply };
    }

    const side = ply % 2 === 0 ? "w" : "b";
    const level = ply < OPENING_PLIES ? OPENING_LEVEL : 20;
    await fairy.setSkill(level);
    const { mv, evalCp, evalSide } = await fairy.moveAndEval(moves, DEPTH);
    if (!mv) {
      aborted = "no-move";
      break;
    }
    rows.push({
      fen: st.fen,
      eval: evalCp === null ? null : evalSide === side ? evalCp : -evalCp,
      wdl: null,
      game: gameId,
      ply,
      counting: st.counting || "none",
      side,
    });
    moves.push(mv);
  }

  return { rows: [], result: aborted || "max-plies (aborted, rows discarded)", plies: moves.length };
}

// ---------- main ----------
async function main() {
  mkdirSync(path.dirname(OUT), { recursive: true });

  const workers = [];
  for (let i = 0; i < JOBS; i++) {
    workers.push({
      fairy: await startFairy(),
      oracle: makeOracle(),
      student: SELFPLAY ? startStudent() : null,
    });
  }

  let total = 0;
  let games = 0;
  let errors = 0;
  const outcomes = {};
  const t0 = Date.now();

  const runWorker = async (w, jobId) => {
    let n = 0;
    let consecutiveErrors = 0;
    while (total < POSITIONS) {
      const gameId = `${jobId}-${n++}`;
      const t = Date.now();
      try {
        const { rows, result, plies } = SELFPLAY
          ? await playSelfGame(w.student, w.fairy, w.oracle, gameId, (Number(gameId.split("-")[1]) + jobId) % 2 === 0)
          : await playGame(w.fairy, w.oracle, gameId);
        if (rows.length > 0) {
          const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
          appendFileSync(OUT, text);
          total += rows.length;
          const tag = result.startsWith("checkmate") ? result.slice(9) : result;
          outcomes[tag] = (outcomes[tag] || 0) + 1;
        } else {
          errors++;
          outcomes["aborted: " + result] = (outcomes["aborted: " + result] || 0) + 1;
        }
        games++;
        if (games % 10 === 0 || total >= POSITIONS) {
          const secs = (Date.now() - t0) / 1000;
          console.log(
            `[${games} games] ${total} positions, ${(total / secs).toFixed(0)} pos/s (last game ${plies} plies, ${((Date.now() - t) / 1000).toFixed(1)}s)`
          );
        }
        consecutiveErrors = 0;
      } catch (e) {
        errors++;
        consecutiveErrors++;
        console.error(`job ${jobId} game ${n}: ERROR ${e.message}`);
        if (consecutiveErrors > 25) throw new Error("circuit breaker: 25 consecutive errored games");
      }
    }
  };

  await Promise.all(workers.map((w, i) => runWorker(w, i)));

  const secs = (Date.now() - t0) / 1000;
  console.log("\n=== datagen smoke summary ===");
  console.log(`positions: ${total} in ${games} games (${errors} errored)`);
  console.log(`elapsed: ${secs.toFixed(1)}s → ${(total / secs).toFixed(0)} pos/s aggregate`);
  console.log(`outcomes: ${JSON.stringify(outcomes)}`);
  console.log(`output: ${OUT}`);
  workers.forEach((w) => {
    w.fairy.kill();
    w.oracle.kill();
    w.student?.kill();
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
