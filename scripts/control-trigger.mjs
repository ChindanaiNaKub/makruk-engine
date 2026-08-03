// When is a self-play control block mandatory, and what does it prove?
//
// Implements the trigger decided by rig ticket 04 and built by rig ticket 07:
//
//   (a) a block's result deviates from the trend line by more than the SE band
//   (b) a new BINDING MECHANISM is introduced — a new env var, a new opponent
//       type, a new config axis (explicitly NOT a new weight)
//   (c) it is the first block at a new rung
//
// Three design choices, each forced by what the ledger actually contains:
//
// 1. WHEN each clause is computable decides what kind of check it is. (b) and
//    (c) are knowable before a single game is played, so they are PRECONDITIONS
//    and the control runs first. (a) needs the result, so it is a POSTCONDITION:
//    the block is recorded — the ledger is append-only and a played block is
//    real data — but marked `suspect`, which keeps it out of the default view
//    and out of AGENTS.md until a control clears it. A flag that can be ignored
//    is how the prose-in-AGENTS.md convention failed; this one is load-bearing.
//
// 2. THE TREND LINE IS LADDER MONOTONICITY, not a fit. The ledger holds exactly
//    one block per (artifact, rung) cell, so there is no repeated measurement to
//    fit a line through. What there is, is a ladder that must not go up as the
//    opponent gets harder — and a non-monotone ladder is precisely how the zsh
//    `env $var` defect was caught in the first place (rig ticket 04's table).
//    Where a cell HAS been measured twice, the direct comparison runs too.
//
// 3. THE SE BAND IS COMPUTED FROM THE OBSERVED W/L/D SPLIT, never assumed.
//    Control b0027 came back 18-17-70 — 58% draws — whose per-game score sd is
//    ~0.20, not the 0.50 a p=0.5 binomial assumes. A binomial band is 2.4x too
//    wide here and would pass a control that is actually broken. Makruk's draw
//    structure makes this a real error, not a rounding one.

import { readBlocks } from "./results.mjs";

// WHAT THE TRIGGER MAY REASON OVER. Not the same question as "what counts as a
// result" (`results.mjs`'s NOT_A_RESULT), even though ledger ticket 06 gave the
// two sets identical members — which is exactly why they are still two sets.
//
// Here the exclusions are mechanical, not editorial:
//   smoke/diag — too small or too incidental to sit on a trend line, and a
//                diagnostic must not drag a control block along behind it.
//   control    — a self-play block's expected score is 0.5 BY CONSTRUCTION, so
//                pooling one into `rung()` poisons the trend it is being
//                compared against. Excluded because it is not a MEASUREMENT of
//                anything, not because a reader might misread it.
//
// Sharing the constant would make a future change to either question silently
// change the other. If a kind is added to one, that should be a decision.
const NOT_TREND_EVIDENCE = new Set(["smoke", "diag", "control"]);

/// Per-game score standard deviation implied by a W/L/D split. Falls back to the
/// binomial worst case only when the split was never recorded (backfilled rows).
export function observedSd(b) {
  if (b.w == null || b.l == null || b.d == null) return 0.5;
  const n = b.w + b.l + b.d;
  if (n < 2) return 0.5;
  const mean = (b.w + 0.5 * b.d) / n;
  const ss = b.w * (1 - mean) ** 2 + b.d * (0.5 - mean) ** 2 + b.l * (0 - mean) ** 2;
  // Floor keeps an all-draws block from producing a zero-width band.
  return Math.max(Math.sqrt(ss / (n - 1)), 0.02);
}

export const standardError = (b) => observedSd(b) / Math.sqrt(Math.max(1, b.games));

// ---------- clause (b): the binding-mechanism fingerprint ----------
// The PLUMBING a block ran through, deliberately excluding the artifact itself.
// A new net is a new experiment; a new env var is new machinery, and only
// machinery has silently measured the wrong engine. `weights` is therefore
// absent while "does the opponent have weights at all" (i.e. was OPP_WEIGHTS
// set) is present. movetime and concurrency are here because engines at fixed
// movetime search fewer nodes when they contend — rig ticket 01.
export function fingerprint(b) {
  return JSON.stringify({
    mineEngine: b.mine?.engine ?? null,
    mineEval: b.mine?.eval ?? null,
    oppEngine: b.opponent?.engine ?? null,
    oppEval: b.opponent?.eval ?? null,
    oppArmedWithWeights: b.opponent?.weights != null,
    oppBinary: b.opponent?.binary ?? null,
    movetime: b.movetime ?? null,
    opponentMovetime: b.opponentMovetime ?? null,
    // Fixed depth is a binding mechanism in the strongest sense — it changes
    // what BOTH engines compute, and it removes eval speed from the comparison
    // entirely. Without it here, a `--depth` block and a movetime block share a
    // fingerprint, so clause (b) stays silent on a genuinely new mechanism and
    // clause (a) compares two results that were never measuring the same thing.
    // Found by redraw ticket 02, whose first block tripped (a) for that reason.
    depth: b.depth ?? null,
    concurrency: b.concurrency ?? null,
    openingPlies: b.openingPlies ?? null,
    sprt: !!b.sprt,
    // `engineId` is DELIBERATELY ABSENT, and this is the note for whoever
    // notices and thinks it was forgotten (ledger ticket 03). It is the strongest
    // identity the row carries, which is exactly why it does not belong here: the
    // rule above is that a new ARTIFACT is a new experiment while new MACHINERY
    // owes a control, and a rebuilt binary is the artifact. Every `cargo build`
    // moves the hash, so including it would fire clause (b) on every rebuild and
    // demand a 20-game control before every block — alarm fatigue on a check
    // that exists to catch the rare real thing. The hash's job is to let a PROOF
    // verify what it ran against, not to gate the next block.
  });
}

/// Identity of the opponent as a ladder rung.
const rung = (b) =>
  b.opponent?.engine === "fairy"
    ? `fairy:${b.opponent.skill}:${b.opponent.eval}`
    : `ours:${b.opponent?.eval}:${b.opponent?.weights ?? "-"}`;

/// Identity of our artifact.
const artifact = (b) => (b.mine?.eval === "net" ? `net:${b.mine.weights}` : "classic");

/// Fairy skill as an ordinal difficulty, for the monotonicity check. Only
/// comparable within the fairy ladder; head-to-head blocks have no ordering.
const difficulty = (b) => (b.opponent?.engine === "fairy" ? b.opponent.skill : null);

// ---------- preconditions: clauses (b) and (c) ----------
/// `pending` is the block about to be played, in ledger-row shape (it does not
/// need w/l/d — those do not exist yet).
export function preChecks(pending, history = readBlocks()) {
  if (NOT_TREND_EVIDENCE.has(pending.kind)) return [];
  const results = history.filter((b) => !NOT_TREND_EVIDENCE.has(b.kind));
  const fired = [];

  const fp = fingerprint(pending);
  if (!results.some((b) => fingerprint(b) === fp)) {
    fired.push({
      clause: "b",
      reason: "a binding mechanism this rig has never run before (new env/opponent/config combination)",
      detail: fp,
    });
  }

  const r = rung(pending);
  if (!results.some((b) => rung(b) === r)) {
    fired.push({ clause: "c", reason: `first block ever at rung ${r}` });
  }
  return fired;
}

// ---------- postcondition: clause (a) ----------
/// Two forms, both against the SE band computed from the actual splits.
export function postChecks(row, history = readBlocks()) {
  if (NOT_TREND_EVIDENCE.has(row.kind)) return [];
  const results = history.filter((b) => !NOT_TREND_EVIDENCE.has(b.kind) && b.score != null);
  const fired = [];
  const seRow = standardError(row);

  // (a1) same cell, measured before — a direct repeat.
  const sameCell = results.filter((b) => artifact(b) === artifact(row) && rung(b) === rung(row));
  if (sameCell.length) {
    const mean = sameCell.reduce((a, b) => a + b.score, 0) / sameCell.length;
    const sePrior = Math.max(...sameCell.map(standardError));
    const band = 2 * Math.hypot(seRow, sePrior);
    if (Math.abs(row.score - mean) > band) {
      fired.push({
        clause: "a",
        reason:
          `score ${(100 * row.score).toFixed(1)}% is ${(100 * Math.abs(row.score - mean)).toFixed(1)}pp from the ` +
          `${(100 * mean).toFixed(1)}% previously measured at this exact cell (2 SE band = ${(100 * band).toFixed(1)}pp)`,
      });
    }
  }

  // (a2) ladder monotonicity — a harder rung must not score higher than an
  // easier one for the same artifact. This is the check that actually caught a
  // defect: three "net" blocks measured the classical eval and the tell was a
  // ladder that went the wrong way.
  const d = difficulty(row);
  if (d != null) {
    const ladder = results.filter((b) => artifact(b) === artifact(row) && difficulty(b) != null);
    for (const b of ladder) {
      const harder = difficulty(row) > difficulty(b);
      const easier = difficulty(row) < difficulty(b);
      const band = 2 * Math.hypot(seRow, standardError(b));
      if (harder && row.score - b.score > band) {
        fired.push({
          clause: "a",
          reason:
            `non-monotone ladder: ${(100 * row.score).toFixed(1)}% at skill ${d} beats ` +
            `${(100 * b.score).toFixed(1)}% at the EASIER skill ${difficulty(b)} (${b.id}) by more than the ` +
            `${(100 * band).toFixed(1)}pp band`,
        });
        break;
      }
      if (easier && b.score - row.score > band) {
        fired.push({
          clause: "a",
          reason:
            `non-monotone ladder: ${(100 * row.score).toFixed(1)}% at skill ${d} loses to ` +
            `${(100 * b.score).toFixed(1)}% at the HARDER skill ${difficulty(b)} (${b.id}) by more than the ` +
            `${(100 * band).toFixed(1)}pp band`,
        });
        break;
      }
    }
  }
  return fired;
}

// ---------- what a control block has to show ----------
/// Identical engines: the true score is 0.5 by construction, so anything outside
/// the band is plumbing. The band uses the block's own observed variance — with
/// makruk's draw rate that is typically ~0.20 per game rather than 0.50, which
/// makes the control roughly 2.4x more sensitive than a binomial band would.
export function controlVerdict(row, { sigma = 2 } = {}) {
  const se = standardError(row);
  const band = sigma * se;
  const dev = Math.abs(row.score - 0.5);
  return {
    pass: dev <= band,
    score: row.score,
    dev,
    band,
    se,
    sd: observedSd(row),
    text:
      `control ${row.id ?? ""} ${(100 * row.score).toFixed(1)}% over ${row.games} games ` +
      `(sd ${observedSd(row).toFixed(3)}, ${sigma} SE band ±${(100 * band).toFixed(1)}pp) — ` +
      (dev <= band ? "PASS: the plumbing is symmetric." : "FAIL: identical engines did not score 50%."),
  };
}

/// How many games a mandated control should play. Small on purpose — it runs
/// automatically, and it is looking for a gross asymmetry (a side silently
/// playing the wrong eval shows up tens of points out), not a 5-Elo effect.
export const CONTROL_GAMES = 20;
