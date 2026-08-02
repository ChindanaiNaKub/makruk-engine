// Sequential probability ratio test for Gate A, on the pentanomial (game-pair)
// distribution.
//
// Mandated by `.scratch/makruk-rig/issues/03-sequential-gate.md`.
//
// Why this exists. Gate A was "accept if >= 55% over a fixed 64 games". With the
// per-game standard deviation measured from real blocks (sd = 0.42), that gate
// has a **17% false-positive rate and 50% false-negative rate**: it accepts a
// coin-flip candidate one time in six and misses a true 55% candidate half the
// time. Round 5's transitivity contradictions were the gate working as designed.
//
// Two independent savings, both measured rather than assumed:
//
//   * Pentanomial. Games are already played in colour-reversed PAIRS on a shared
//     opening, so the opening's inherent bias cancels within the pair. Measured
//     across the recorded n>=64 blocks, pair-model sd is 0.66-0.79x trinomial —
//     a variance ratio near 0.52, i.e. roughly half the games for the same
//     precision, for free, before sequencing enters into it.
//   * Sequencing. A fixed test with alpha = beta = 0.05 at 30 Elo needs ~820
//     games EVERY time. The SPRT averages ~450 on a genuinely borderline
//     candidate and stops a clearly-better one (r3 vs classic was ~+150 Elo) in
//     well under a hundred.
//
// Model. Normal approximation with variance estimated from the observed pairs:
//   LLR = n (s1 - s0) (2 mu - s0 - s1) / (2 var)
// which is the exact log-likelihood ratio for N(mu, var) with known var, testing
// H0: mu = s0 against H1: mu = s1. Bounds are Wald's:
//   accept H1 at LLR >= log((1-beta)/alpha),  accept H0 at LLR <= log(beta/(1-alpha)).

export const eloToScore = (elo) => 1 / (1 + Math.pow(10, -elo / 400));
export const scoreToElo = (s) => (s <= 0 || s >= 1 ? (s <= 0 ? -Infinity : Infinity) : -400 * Math.log10(1 / s - 1));

export const DEFAULTS = {
  // Detect a 30-Elo improvement. Chosen against this project's actual round
  // deltas — r3 over classic was ~+150 Elo, d6 under r3 ~-33 Elo — not against
  // fishtest's [0,5], which assumes tens of thousands of games.
  elo0: 0,
  elo1: 30,
  alpha: 0.05,
  beta: 0.05,
  minPairs: 20, // guards against an early fluke and against an unstable early variance estimate
  // 192 games, ~12.5 min worst case at the measured 3.9 s/game. The cap IS a
  // budget decision, and rig ticket 01 made it with the Monte-Carlo in
  // sprt-cap-sweep.mjs rather than by feel. Three findings, in the order they
  // changed the answer:
  //
  //  * A bigger cap is WORSE, not merely slower. The wrong-call rate RISES with
  //    the cap — 0.8% here against 3.9% at the old 400 — because a longer walk
  //    is more chances to cross the wrong bound. Cheap and accurate point the
  //    same way, so there is no trade to make on that axis.
  //  * What a cap really buys is SENSITIVITY, and the binding case is not the
  //    +150 Elo round (decided by 86 games at p90 under any cap ≥ 48) but the
  //    merely-good one. At 20,000 trials the inconclusive rate for a +100 Elo
  //    candidate is 43% at cap 48, 19% at cap 64, and 2.3% at cap 96. A cap of
  //    64 would have quietly thrown away one in five good rounds — the exact
  //    failure this rig exists to stop, just wearing a budget's clothes.
  //  * Past 96 the curve flattens: cap 400 costs 4× the wall-clock to rescue the
  //    0-to-30 Elo band, and no round of this project has ever landed there
  //    (r3 over classic ~+150, d6 under r3 ~-33).
  //
  // Inconclusive means the incumbent holds (see below), so the residual 2.3% is
  // a lost good round, not a wrong accept. That is the price, and it is named.
  maxPairs: 96,
};

export function bounds({ alpha, beta }) {
  return { lower: Math.log(beta / (1 - alpha)), upper: Math.log((1 - beta) / alpha) };
}

/// pairScores: one entry per COMPLETED colour-reversed pair, each the pair's
/// total normalised to [0,1] — i.e. (game_a + game_b) / 2 with win=1, draw=0.5.
export function llr(pairScores, opts = {}) {
  const { elo0, elo1 } = { ...DEFAULTS, ...opts };
  const n = pairScores.length;
  if (n < 2) return 0;
  const s0 = eloToScore(elo0);
  const s1 = eloToScore(elo1);
  const mu = pairScores.reduce((a, c) => a + c, 0) / n;
  let variance = pairScores.reduce((a, c) => a + (c - mu) ** 2, 0) / (n - 1);
  // A fully one-sided block (0-64-0 happens at skill 10 and 20) has zero sample
  // variance, which would send the ratio to infinity. Floor it: the conclusion
  // there is never in doubt anyway, and the floor keeps the arithmetic finite.
  variance = Math.max(variance, 1e-4);
  return (n * (s1 - s0) * (2 * mu - s0 - s1)) / (2 * variance);
}

/// Verdict after the pairs seen so far. `decision` is null while undecided.
export function evaluate(pairScores, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { lower, upper } = bounds(o);
  const value = llr(pairScores, o);
  const n = pairScores.length;
  const mu = n ? pairScores.reduce((a, c) => a + c, 0) / n : 0;

  let decision = null;
  if (n >= o.minPairs) {
    if (value >= upper) decision = "accept-h1";
    else if (value <= lower) decision = "accept-h0";
  }
  // Hitting the cap without crossing a bound is NOT acceptance. The incumbent
  // holds unless the candidate proves itself; "we could not tell" is not "it is
  // better". A selection gate has to fail closed.
  if (!decision && n >= o.maxPairs) decision = "inconclusive";

  return { decision, llr: value, lower, upper, pairs: n, score: mu, elo: scoreToElo(mu), opts: o };
}

export function describe(v) {
  const pct = (v.score * 100).toFixed(1);
  const elo = Number.isFinite(v.elo) ? `${v.elo >= 0 ? "+" : ""}${v.elo.toFixed(0)} Elo` : "±inf Elo";
  const head = `SPRT[${v.opts.elo0}, ${v.opts.elo1}] α=${v.opts.alpha} β=${v.opts.beta} — ${v.pairs} pairs (${v.pairs * 2} games), score ${pct}% (${elo}), LLR ${v.llr.toFixed(2)} in [${v.lower.toFixed(2)}, ${v.upper.toFixed(2)}]`;
  if (v.decision === "accept-h1") return `${head}\n  ACCEPT — the candidate is better than the incumbent by at least the tested margin.`;
  if (v.decision === "accept-h0") return `${head}\n  REJECT — no improvement of the tested size; the incumbent stands.`;
  if (v.decision === "inconclusive")
    return `${head}\n  INCONCLUSIVE at the ${v.opts.maxPairs}-pair cap — NOT accepted. The incumbent holds; a candidate this close needs a bigger cap or a different question.`;
  return `${head}\n  undecided, continuing`;
}
