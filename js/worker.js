/* makruk-engine browser worker.
 *
 * Drop-in replacement for the fairy-stockfish UCI worker used by
 * markrukthai's client (client/src/workers/browserEngineBotWorker.ts).
 * Speaks the exact same string protocol: uci / uciok, isready / readyok,
 * setoption (accepted silently), ucinewgame, position fen ..., go movetime N,
 * bestmove <uci>. Plus: go perft N, divide N, d, eval.
 *
 * Expected layout when deployed (e.g. client/public/engines/makruk/):
 *   worker.js            (this file)
 *   makruk_engine.js     (wasm-bindgen "no-modules" glue, from pkg/web/)
 *   makruk_engine_bg.wasm
 */

/* global importScripts, wasm_bindgen, self */

importScripts("./makruk_engine.js");

const initPromise = (async () => {
  await wasm_bindgen("./makruk_engine_bg.wasm");
  return new wasm_bindgen.WasmEngine();
})();

self.onmessage = async (event) => {
  let engine;
  try {
    engine = await initPromise;
  } catch (err) {
    self.postMessage("info string engine init failed: " + String(err));
    return;
  }

  const line = String(event.data);
  let out = "";
  try {
    out = engine.command(line);
  } catch (err) {
    self.postMessage("info string command failed: " + String(err));
    return;
  }
  if (!out) return;
  for (const row of out.split("\n")) {
    if (row) self.postMessage(row);
  }
};
