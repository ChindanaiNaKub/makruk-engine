// Node smoke test for the wasm build: UCI handshake, position, perft, search.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "pkg", "node") + path.sep);
const mod = require(path.join(root, "pkg", "node", "makruk_engine.js"));

const engine = new mod.WasmEngine();
const cmd = (line) => engine.command(line);

const assert = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
};

assert(cmd("uci").includes("uciok"), "uci handshake");
assert(cmd("isready").includes("readyok"), "isready");
cmd("position startpos");
assert(engine.fen().startsWith("rnsmksnr"), "startpos fen");
assert(cmd("go perft 3").includes("nodes 12012"), "perft 3 = 12012");
assert(engine.legal_moves().split(" ").length === 23, "23 legal moves");

cmd("position fen rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w - - 0 1");
const search = cmd("go movetime 300");
assert(search.includes("bestmove ") && !search.includes("(none)"), "search gives bestmove");
console.log(search);

// counting-rule position loads through the wasm boundary
cmd("position fen 7k/8/8/8/8/8/4K3/R7 w");
assert(engine.counting().startsWith("pieces_honor,black"), "pieces honor detected");

console.log("wasm smoke test: ok");
