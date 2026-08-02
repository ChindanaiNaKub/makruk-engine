// Monte-Carlo validation of scripts/sprt.mjs.
//
// A gate is only worth what its stated error rates are worth, so they get
// verified rather than asserted: simulate blocks at known true strengths and
// check the realised false-positive / false-negative rates land near alpha and
// beta, and report the expected number of games at each strength.
//
// Usage: node scripts/sprt-selftest.mjs [trials=2000]
import { evaluate, eloToScore, DEFAULTS } from "./sprt.mjs";
import { mulberry32 } from "./lib/rng.mjs";

const TRIALS = Number(process.argv[2] ?? 2000);

// Draw rate taken from the real blocks: across b0021-b0024 roughly a quarter of
// games are draws or max-plies. The pair model then follows from two games.
const DRAW = 0.25;

function simulatePair(rand, pWin) {
  // Two games at the same true strength, colours reversed.
  let total = 0;
  for (let i = 0; i < 2; i++) {
    const r = rand();
    total += r < DRAW ? 0.5 : r < DRAW + (1 - DRAW) * pWin ? 1 : 0;
  }
  return total / 2;
}

function trial(seed, elo) {
  const rand = mulberry32(seed);
  const s = eloToScore(elo);
  // decisive-game win probability consistent with an overall score of s
  const pWin = Math.min(1, Math.max(0, (s - DRAW / 2) / (1 - DRAW)));
  const pairs = [];
  for (;;) {
    pairs.push(simulatePair(rand, pWin));
    const v = evaluate(pairs);
    if (v.decision) return { decision: v.decision, games: pairs.length * 2 };
  }
}

const scenarios = [
  { label: "equal (0 Elo) — should REJECT", elo: 0, want: "accept-h0" },
  { label: "worse (-30 Elo) — should REJECT", elo: -30, want: "accept-h0" },
  { label: `at H1 (${DEFAULTS.elo1} Elo) — should ACCEPT`, elo: DEFAULTS.elo1, want: "accept-h1" },
  { label: "clearly better (+150 Elo) — should ACCEPT", elo: 150, want: "accept-h1" },
];

console.log(`SPRT self-test — ${TRIALS} simulated blocks per scenario`);
console.log(`bounds [${DEFAULTS.elo0}, ${DEFAULTS.elo1}] Elo, α=${DEFAULTS.alpha}, β=${DEFAULTS.beta}, cap ${DEFAULTS.maxPairs} pairs\n`);
console.log("scenario                                  wrong-call  inconclusive  median games  p90 games");

let failures = 0;
for (const sc of scenarios) {
  const games = [];
  let wrong = 0;
  let inconclusive = 0;
  for (let t = 0; t < TRIALS; t++) {
    const r = trial(t * 2654435761 + 12345, sc.elo);
    games.push(r.games);
    if (r.decision === "inconclusive") inconclusive++;
    else if (r.decision !== sc.want) wrong++;
  }
  games.sort((a, b) => a - b);
  const med = games[Math.floor(games.length / 2)];
  const p90 = games[Math.floor(games.length * 0.9)];
  const wrongPct = (100 * wrong) / TRIALS;
  console.log(
    `${sc.label.padEnd(41)} ${(wrongPct.toFixed(1) + "%").padStart(9)}  ${((100 * inconclusive) / TRIALS).toFixed(1).padStart(11)}%  ${String(med).padStart(12)}  ${String(p90).padStart(9)}`
  );
  // The nominal rate is per-bound; allow generous slack since the normal
  // approximation and the estimated variance both bite at small n.
  const nominal = 100 * (sc.want === "accept-h1" ? DEFAULTS.beta : DEFAULTS.alpha);
  if (wrongPct > nominal * 2.5 + 2) {
    console.log(`   ^ FAIL: wrong-call rate ${wrongPct.toFixed(1)}% far exceeds nominal ${nominal}%`);
    failures++;
  }
}

console.log(
  failures === 0
    ? "\nself-test PASS — realised error rates are within tolerance of the stated α/β."
    : `\nself-test FAIL — ${failures} scenario(s) outside tolerance.`
);
process.exit(failures === 0 ? 0 : 1);
