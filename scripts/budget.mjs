// The rig's budgets — one place, enforced, not aspirational.
//
// Decided by `.scratch/makruk-rig/issues/01-pin-the-budgets.md`. Read that ticket
// for the measurements; the short version of why the numbers look like this:
//
//  * Arena wall-clock is movetime-bound and ~95% efficient. There is no overhead
//    to reclaim — the only levers are FEWER GAMES and MORE GAMES AT ONCE.
//  * Datagen job count is a bad thermal knob: 12 -> 4 jobs costs 48% of
//    throughput and buys ~9 °C, which is only about two widths of the measured
//    ±4-5 °C noise floor. Peak stays 84-99 °C at EVERY job count.
//  * This i5-12500H throttles under any sustained multicore load (320,794
//    package throttle events) and every power knob is already at maximum.
//    `platform_profile=balanced` was tried and REFUTED — RAPL limits identical.
//
// The consequence, and the reason this file exists: a thermal ceiling cannot be
// met by tuning. It can only be met by not running the hot thing, or running it
// when the machine is not needed. So the budgets split the rig into two classes
// with different currencies:
//
//   FOREGROUND (arena) — you are sitting there waiting for a verdict.
//     Currency is WALL-CLOCK. The distinguishing property is BREVITY, not
//     coolness: the first two blocks instrumented by this file went 63 °C -> 88
//     mean / 97 peak in 34 seconds, which falsifies the 69 °C peak recorded for
//     the parallel arena in rig ticket 02. Nothing on this machine is cool under
//     load. What separates the classes is that a block is over in a minute.
//     Never niced: games are movetime-bound, so starving a process changes how
//     many nodes it searches in its fixed 100 ms, which changes the RESULT.
//     Deliberately not a knob.
//
//   BACKGROUND (datagen, training) — you walked away.
//     Currency is HEAT AND YOUR LAPTOP. Wall-clock barely matters; whether the
//     machine is usable does. Niced, announced, and confirmed before it starts.
//
// Enforcement is refuse-or-announce, never degrade. Silently dropping
// concurrency mid-run to fit a budget would change the measurement conditions —
// exactly the class of quiet corruption this map exists to stop. A budget breach
// changes the PLAN, not the CONDITIONS.

import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import { createInterface } from "node:readline/promises";

export const BUDGET = {
  // N — the accept/reject clock. Gate A is the decision; Gate B is a ladder
  // MEASUREMENT that runs afterwards (rig ticket 03 drew that line), so it gets
  // its own smaller budget rather than eating into the verdict's.
  //
  // 15 min is a CEILING, not an expectation: a clear candidate decides in ~54
  // games (~3.5 min) and 12.5 min is the SPRT cap being hit, which means the
  // candidate was ambiguous. The ceiling was set BY the cap rather than the
  // other way round — see sprt.mjs, where trimming it to fit a rounder 10 min
  // was measured to throw away one good round in five.
  gateMinutes: 15,
  measureMinutes: 5,

  // X, foreground. 6 concurrent games = 12 busy cores of 16. PINNED: the whole
  // ladder was re-measured at this value on 2026-08-02, and engines at fixed
  // movetime search fewer nodes when they contend, so a different concurrency
  // is a different opponent. Changing it is a clause-(b) binding mechanism and
  // must trigger a control block (rig ticket 07).
  arenaConcurrency: 6,

  // X, background. Job count is NOT the lever (measured above); scheduler
  // priority is. At nice 15 datagen still gets the whole machine when nothing
  // else wants it, and yields within milliseconds when you touch the laptop.
  // That is the actual complaint — responsiveness, not degrees.
  backgroundNice: 15,
  backgroundJobs: 12,

  // Y, foreground: a START GATE, and it protects the NUMBER, not your lap.
  //
  // CORRECTED 2026-08-02, within the hour, by the instrumentation this file
  // shipped. The gate was first written as "refuse above 80 °C", reasoning that a
  // throttled machine searches fewer nodes at fixed movetime. The ledger then
  // said every arena block runs at 88-89 °C mean, and the first back-to-back run
  // — a mandated control block followed by the block it was clearing — was
  // refused at 91 °C. An 80 °C gate rejects every consecutive block, including
  // Gate A followed by Gate B in an ordinary round.
  //
  // The reasoning was inverted: the ladder was itself calibrated by blocks run
  // back to back, so HOT is the normal condition and a cold start is the
  // anomaly. What actually threatens a movetime-bound measurement is CONTENTION
  // — another process taking cores our engines needed inside their fixed 100 ms.
  // So the gate measures that directly. Not load average, which has a 1-minute
  // decay and reads 3.5 right after our own block while the CPU is genuinely
  // idle; instantaneous utilisation from /proc/stat, which read 3.1% at the same
  // moment. Temperature is still recorded on every row — it was recorded from
  // the start precisely so this could be settled with data rather than belief.
  busyStartFraction: 0.25,

  // Y, background: a runaway guard on the 60 s rolling mean. Steady state is
  // 74-84 °C at every job count, so this should never fire in normal operation —
  // it catches a blocked vent or a dead fan, not ordinary load.
  runawayC: 95,
  runawayWindowS: 60,

  // Measured seconds per game at concurrency 6, from results/blocks.jsonl.
  // Our-engine-vs-our-engine (Gate A, control) is slower than vs-fairy because
  // it hits the 400-ply counting cap far more often.
  secPerGame: { selfplay: 3.9, ladder: 3.0 },

  // Background runs longer than this must be consented to, not just announced.
  confirmBackgroundMinutes: 5,
};

// ---------- package temperature ----------
// Straight from sysfs — no `sensors` subprocess, so sampling is free and this
// works on a machine without lm_sensors installed. Returns NaN if coretemp is
// absent rather than throwing: a missing thermometer must not stop a block.
let tempPath;
export function packageTempC() {
  try {
    if (tempPath === undefined) {
      tempPath = null;
      for (const h of readdirSync("/sys/class/hwmon")) {
        const base = `/sys/class/hwmon/${h}`;
        if (readFileSync(`${base}/name`, "utf8").trim() !== "coretemp") continue;
        // temp1 is "Package id 0" on Intel; verify rather than assume the index.
        if (readFileSync(`${base}/temp1_label`, "utf8").trim().startsWith("Package")) {
          tempPath = `${base}/temp1_input`;
        }
        break;
      }
    }
    return tempPath ? Number(readFileSync(tempPath, "utf8")) / 1000 : NaN;
  } catch {
    return NaN;
  }
}

/// Instantaneous CPU utilisation across all cores, sampled over `ms`. Deliberately
/// not os.loadavg(): that is a 1-minute exponential average and still reads ~3.5
/// immediately after one of our own blocks, when the machine is in fact idle.
/// Async on purpose: a synchronous spin would burn a core for the whole sample
/// window and inflate the very number it is measuring by ~1/ncores.
export async function cpuBusyFraction(ms = 250) {
  const snap = () => {
    const f = readFileSync("/proc/stat", "utf8").split("\n", 1)[0].split(/\s+/).slice(1).map(Number);
    return { idle: f[3] + f[4], total: f.reduce((a, b) => a + b, 0) };
  };
  try {
    const a = snap();
    await new Promise((r) => setTimeout(r, ms));
    const b = snap();
    const dt = b.total - a.total;
    return dt > 0 ? 1 - (b.idle - a.idle) / dt : NaN;
  } catch {
    return NaN;
  }
}

const mins = (s) => (s < 60 ? `${s.toFixed(0)}s` : `${(s / 60).toFixed(1)} min`);

// Measured aggregate throughput of `datagen.mjs --depth 3 --label static`,
// 2026-08-02, 75 s arms (rig ticket 01). Note the per-job rate RISING as jobs
// fall — 241, 304, 357, 377 pos/s per job — which is the throttling signature,
// not a scaling anomaly.
const DATAGEN_POS_PER_S = [[4, 1509], [6, 2142], [8, 2430], [12, 2897]];

/// Rough seconds for a datagen run. Piecewise-linear over the measured curve and
/// extrapolated flat past its ends; deeper searches or --selfplay are slower than
/// this, so it is a floor on the cost, not a promise.
export function estimateDatagenS(positions, jobs) {
  const t = DATAGEN_POS_PER_S;
  let rate;
  if (jobs <= t[0][0]) rate = (t[0][1] / t[0][0]) * jobs;
  else if (jobs >= t[t.length - 1][0]) rate = (t[t.length - 1][1] / t[t.length - 1][0]) * jobs;
  else {
    const i = t.findIndex(([j]) => j > jobs);
    const [j0, r0] = t[i - 1];
    const [j1, r1] = t[i];
    rate = r0 + ((r1 - r0) * (jobs - j0)) / (j1 - j0);
  }
  return positions / Math.max(1, rate);
}

/// Worst-case wall-clock for a block, in seconds. `games` is the CAP, not the
/// expectation — the point of an announcement is the number that would make you
/// cancel, and under SPRT the typical block finishes in a third of this.
///
/// Two regimes, and the estimate is the larger of them. A full pool is
/// throughput-bound, so cost is games × the measured per-game rate. A pool with
/// fewer games than slots is latency-bound: the block lasts as long as its
/// SLOWEST game, and at fixed movetime the slowest possible game is the 400-ply
/// counting cap. Missing that floor made a 4-game smoke announce 12s and take 34.
export function estimateBlockS(
  games,
  {
    selfplay = false,
    concurrency = BUDGET.arenaConcurrency,
    movetime = 100,
    opponentMovetime = 400,
    maxPlies = 400,
  } = {}
) {
  const per = selfplay ? BUDGET.secPerGame.selfplay : BUDGET.secPerGame.ladder;
  const slots = Math.max(1, Math.min(concurrency, games));
  // The measured per-game rates are already AT concurrency 6; scale if a caller
  // overrides it.
  const throughputBound = games * per * (BUDGET.arenaConcurrency / slots);
  const longestGameS = ((maxPlies / 2) * (movetime + opponentMovetime)) / 1000;
  return Math.max(throughputBound, longestGameS);
}

/// Print the cost before spawning anything. This is the cheapest mechanism on
/// the map and the one that most directly answers the stated pain: the rig
/// should never silently take the machine for an hour.
export function announce({ label, worstS, cores, thermal, extra }) {
  const t = packageTempC();
  console.log(
    `budget: ${label} — worst case ${mins(worstS)}, ${cores} busy cores of ${os.cpus().length}, ` +
      `${thermal}${Number.isFinite(t) ? `, package now ${t.toFixed(0)}°C` : ""}`
  );
  if (extra) console.log(`        ${extra}`);
}

const die = (msg, hint) => {
  console.error(`\nFATAL [budget] ${msg}${hint ? `\n  → ${hint}` : ""}\n`);
  console.error("Nothing ran. Change the plan, then re-run.");
  process.exit(3);
};

/// Foreground gate: refuse a block that cannot fit N, and refuse one that would
/// be measured on an already-throttled machine. Refusal beats a warning — the
/// prose-in-AGENTS.md convention failed precisely because it could be skimmed.
export async function enforceForeground({ label, worstS, budgetMinutes, allowBusy = false, overBudgetHint }) {
  const budgetS = budgetMinutes * 60;
  if (worstS > budgetS) {
    die(
      `${label} could take ${mins(worstS)}, over the ${budgetMinutes} min budget.`,
      overBudgetHint ?? "Reduce --games, or pass --budget-min N to raise the ceiling for this run."
    );
  }
  const busy = await cpuBusyFraction();
  if (Number.isFinite(busy) && busy >= BUDGET.busyStartFraction && !allowBusy) {
    die(
      `${(100 * busy).toFixed(0)}% of the CPU is already busy — something else is using this machine.`,
      "Engines are movetime-bound: contention means fewer nodes searched in the same 100 ms, so this block would not be comparable to the ledger. Stop the other work, or pass --allow-busy to record it anyway."
    );
  }
}

/// Samples package temperature across a run. Two jobs: hand the ledger the
/// thermal context of a block (so a future session can CHECK whether temperature
/// correlates with score, instead of trusting the threshold above forever), and
/// abort a background run that has gone thermally runaway.
export class ThermalGuard {
  constructor({ abortAtC = null, onAbort = null, intervalMs = 3000 } = {}) {
    this.samples = [];
    this.startC = packageTempC();
    this.abortAtC = abortAtC;
    this.onAbort = onAbort;
    this.timer = setInterval(() => this.#tick(), intervalMs);
    this.timer.unref?.();
  }
  #tick() {
    const c = packageTempC();
    if (!Number.isFinite(c)) return;
    this.samples.push({ t: Date.now(), c });
    if (this.abortAtC == null) return;
    const cutoff = Date.now() - BUDGET.runawayWindowS * 1000;
    const window = this.samples.filter((s) => s.t >= cutoff);
    // Require a full window before firing, or a cold start would trip on noise.
    if (window.length < BUDGET.runawayWindowS / 3) return;
    const mean = window.reduce((a, s) => a + s.c, 0) / window.length;
    if (mean >= this.abortAtC) {
      this.stop();
      console.error(
        `\nFATAL [budget] package held ${mean.toFixed(1)}°C over ${BUDGET.runawayWindowS}s, ` +
          `at or above the ${this.abortAtC}°C runaway guard. Check the fan and the vents.`
      );
      this.onAbort?.();
      process.exit(4);
    }
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const cs = this.samples.map((s) => s.c);
    return {
      tempStartC: Number.isFinite(this.startC) ? Math.round(this.startC) : null,
      tempMeanC: cs.length ? Math.round(cs.reduce((a, b) => a + b, 0) / cs.length) : null,
      tempPeakC: cs.length ? Math.round(Math.max(...cs)) : null,
    };
  }
}

/// Background class: yield to the human. Children inherit this, so it must be
/// called before any worker is spawned.
export function goBackground(nice = BUDGET.backgroundNice) {
  try {
    os.setPriority(process.pid, nice);
    return nice;
  } catch {
    return null; // not fatal — niceness is a courtesy, not a correctness property
  }
}

/// Long background runs are consented to, not merely announced. Fails closed
/// without a TTY: an unattended caller must say --yes rather than inherit an
/// hour of the machine by default.
export async function confirmBackground({ label, worstS, yes }) {
  if (yes) return;
  if (worstS < BUDGET.confirmBackgroundMinutes * 60) return;
  if (!process.stdin.isTTY) {
    die(
      `${label} is a ${mins(worstS)} background run and stdin is not a TTY.`,
      "Pass --yes to consent non-interactively."
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nThis will make the laptop hot and slow for about ${mins(worstS)}. Continue? [y/N] `
  );
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.error("\nDeclined. Nothing generated.");
    process.exit(0);
  }
}
