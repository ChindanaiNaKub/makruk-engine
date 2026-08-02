// What does the SPRT max-pairs cap cost, and what does it buy?
//
// The evidence behind `DEFAULTS.maxPairs` in sprt.mjs, kept runnable so the
// number can be re-earned rather than inherited. Pure Monte-Carlo over the same
// `evaluate()` the arena uses — no games are played, nothing heats up, it takes
// a few seconds.
//
// Read the output as: a cap is only a budget question if the wrong-call rate is
// flat across it. It is not — the wrong-call rate RISES with the cap, because a
// longer walk is more chances to cross the wrong bound. So the cheapest cap that
// still always decides a clearly-better candidate is the best cap, not a
// compromise. See `.scratch/makruk-rig/issues/01-pin-the-budgets.md`.
//
// Usage: node scripts/sprt-cap-sweep.mjs [trials=4000]
import { evaluate, eloToScore, DEFAULTS } from "./sprt.mjs";
import { mulberry32 } from "./lib/rng.mjs";
import { BUDGET } from "./budget.mjs";

const TRIALS = Number(process.argv[2] ?? 4000);
// Draw/max-plies share taken from the real blocks in results/blocks.jsonl.
const DRAW = 0.25;
const CAPS = [24, 32, 48, 64, 96, 128, 200, 400];

function trial(seed, elo, maxPairs) {
  const rand = mulberry32(seed);
  const s = eloToScore(elo);
  const pWin = Math.min(1, Math.max(0, (s - DRAW / 2) / (1 - DRAW)));
  const pairs = [];
  for (;;) {
    let total = 0;
    for (let i = 0; i < 2; i++) {
      const r = rand();
      total += r < DRAW ? 0.5 : r < DRAW + (1 - DRAW) * pWin ? 1 : 0;
    }
    pairs.push(total / 2);
    const v = evaluate(pairs, { maxPairs });
    if (v.decision) return { decision: v.decision, games: pairs.length * 2 };
  }
}

const SCENARIOS = [
  { label: "equal (0)", elo: 0, want: "accept-h0" },
  { label: "worse (-30)", elo: -30, want: "accept-h0" },
  { label: `at H1 (+${DEFAULTS.elo1})`, elo: DEFAULTS.elo1, want: "accept-h1" },
  { label: "clear (+150)", elo: 150, want: "accept-h1" },
];

const perGame = BUDGET.secPerGame.selfplay; // Gate A is our engine on both sides

console.log(
  `SPRT cap sweep — ${TRIALS} trials/scenario, bounds [${DEFAULTS.elo0}, ${DEFAULTS.elo1}] Elo, ` +
    `α=${DEFAULTS.alpha} β=${DEFAULTS.beta}, minPairs=${DEFAULTS.minPairs}`
);
console.log(`worst-case wall-clock at ${perGame}s/game, concurrency ${BUDGET.arenaConcurrency} (measured)\n`);
console.log(
  "cap  games  worstWall | " + SCENARIOS.map((s) => s.label.padEnd(17)).join("") + "| worst wrong"
);

for (const maxPairs of CAPS) {
  const cells = [];
  let worstWrong = 0;
  for (const sc of SCENARIOS) {
    let wrong = 0;
    let incon = 0;
    const g = [];
    for (let t = 0; t < TRIALS; t++) {
      const r = trial(t * 2654435761 + 12345, sc.elo, maxPairs);
      g.push(r.games);
      if (r.decision === "inconclusive") incon++;
      else if (r.decision !== sc.want) wrong++;
    }
    g.sort((a, b) => a - b);
    const wp = (100 * wrong) / TRIALS;
    worstWrong = Math.max(worstWrong, wp);
    cells.push(
      `${wp.toFixed(1)}/${((100 * incon) / TRIALS).toFixed(1)}% p90=${g[Math.floor(g.length * 0.9)]}`.padEnd(17)
    );
  }
  const wall = (maxPairs * 2 * perGame) / 60;
  const mark = maxPairs === DEFAULTS.maxPairs ? " <- shipped" : "";
  console.log(
    `${String(maxPairs).padStart(3)}  ${String(maxPairs * 2).padStart(5)}  ${wall.toFixed(1).padStart(6)}min | ` +
      cells.join("") + `| ${worstWrong.toFixed(1).padStart(10)}%${mark}`
  );
}

console.log("\ncell = wrong-call% / inconclusive% p90=games");
console.log("inconclusive means the incumbent holds — the gate fails closed, so it is a");
console.log("loss of sensitivity, not a wrong answer. The column that must stay near 0 is");
console.log("'clear (+150)': a cap that cannot decide an obviously-good candidate is broken.");
