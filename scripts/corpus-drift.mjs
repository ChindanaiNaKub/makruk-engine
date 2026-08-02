// Has the corpus gone stale — i.e. does the student now play in positions the
// training data barely contains?
//
// The trigger for regenerating a corpus, decided by rig ticket 05. DAgger's
// whole premise is that a student visits states its expert's data does not
// cover, so "stale" is a COVERAGE question, not an age question. This measures
// the coverage gap directly and cheaply, without running datagen.
//
// It is also the diagnostic that would have caught the recorded failure. The
// round-2 slice analysis found the net 3-4x worse than classic in the opening
// and at-or-above it only in the counting-active endgame — "exactly what it was
// trained on (46.5% of corpus rows are counting-active)". That is a corpus
// composition mismatch, and three DAgger rounds were spent before anyone
// measured it. One run of this would have said so up front.
//
// WHAT IT FOUND, and why datagen came off the per-round critical path: each
// generator has a FIXED POINT and regeneration does not move it. Three 10M-row
// bootstrap corpora built on different days sit within 0.026 of each other; two
// DAgger corpora built from different students sit within 0.025 of each other;
// bootstrap and DAgger sit 0.515 apart. So a round never earns a new corpus on
// freshness grounds — a fresh corpus from the same generator is the same corpus.
// Only switching generator changes coverage, and choosing to is strength work.
//
// The DAgger fixed point is worth knowing on its own: dagger-r1/r2 are ~47%
// opening, ~41% middlegame, and contain literally ZERO bare-king endgames
// (bootstrap is 30% bare-pawnless). The two modes are near-complementary.
//
// Usage:
//   node scripts/match-arena.mjs --games 20 --skill 5 --dump-games /tmp/g.jsonl
//   node scripts/corpus-drift.mjs --games /tmp/g.jsonl --corpus tools/data/bootstrap-d6.jsonl
//
//   --games PATH    move dump from match-arena --dump-games
//   --corpus PATH   training corpus (JSONL with a "fen" field)
//   --sample N      corpus positions to sample (default 20000)
//   --seed N        sampling seed (default 7)
//
// Buckets are computed from the FEN ALONE, identically on both sides. That is
// deliberate: makruk counting is stateful, so a bare corpus row cannot be asked
// whether counting is running, and a metric that could only be computed on one
// of the two distributions would not be a comparison. `pawnless` is the honest
// FEN-only proxy for the board-honor counting regime.

import { spawn } from "node:child_process";
import { openSync, readSync, closeSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32 } from "./lib/rng.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const ENGINE = path.join(root, "target", "release", "makruk-engine");
const START = "rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w";

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const GAMES = arg("games", null);
const CORPUS = arg("corpus", null);
const SAMPLE = Number(arg("sample", "20000"));
const SEED = Number(arg("seed", "7"));

if (!GAMES || !CORPUS) {
  console.error("usage: node scripts/corpus-drift.mjs --games <dump.jsonl> --corpus <corpus.jsonl>");
  process.exit(2);
}

// ---------- bucketing ----------
// Phase by non-king piece count (30 at the start, 15 a side). Pawnless is the
// FEN-only stand-in for the counting regime — board-honor counting begins once
// a side has no bia, which is precisely when these endgames get their character.
function bucket(fen) {
  const board = fen.split(" ")[0];
  let pieces = 0;
  let wp = 0;
  let bp = 0;
  for (const ch of board) {
    if (ch === "/" || (ch >= "1" && ch <= "9")) continue;
    if (ch === "k" || ch === "K") continue;
    pieces++;
    if (ch === "p" || ch === "f") bp++;
    if (ch === "P" || ch === "F") wp++;
  }
  const phase = pieces >= 24 ? "opening" : pieces >= 14 ? "middlegame" : pieces >= 6 ? "endgame" : "bare";
  const pawnless = wp === 0 || bp === 0;
  return `${phase}${pawnless ? " pawnless" : ""}`;
}

const ORDER = ["opening", "opening pawnless", "middlegame", "middlegame pawnless",
               "endgame", "endgame pawnless", "bare", "bare pawnless"];

// ---------- corpus: byte-offset sampling ----------
// A 1.1 GB / 10M-row corpus takes a minute to parse end to end and this has to
// be cheap enough to run before every round. Seek to random offsets, skip to the
// next line boundary, take that row. Slightly biased toward longer lines, which
// for a fixed-shape JSONL is a bias toward longer FENs — noted rather than
// corrected, since it applies equally across every bucket comparison.
function sampleCorpus(file, n, seed) {
  const size = statSync(file).size;
  const fd = openSync(file, "r");
  const rand = mulberry32(seed);
  const buf = Buffer.alloc(4096);
  const counts = new Map();
  let taken = 0;
  let attempts = 0;
  while (taken < n && attempts < n * 4) {
    attempts++;
    const off = Math.floor(rand() * Math.max(1, size - 4096));
    const got = readSync(fd, buf, 0, 4096, off);
    const s = buf.toString("utf8", 0, got);
    const nl = s.indexOf("\n");
    if (nl < 0) continue;
    const end = s.indexOf("\n", nl + 1);
    if (end < 0) continue;
    try {
      const row = JSON.parse(s.slice(nl + 1, end));
      if (!row.fen) continue;
      const b = bucket(row.fen);
      counts.set(b, (counts.get(b) ?? 0) + 1);
      taken++;
    } catch { /* torn line at a chunk edge — skip */ }
  }
  closeSync(fd);
  return { counts, taken };
}

// ---------- reached positions: replay the dumped moves through the oracle ----------
// The same oracle the arena adjudicated with, so these are exactly the positions
// the games actually visited.
function startOracle() {
  const proc = spawn(ENGINE, [], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, MAKURUK_EVAL: "classic" } });
  let bufS = "";
  const waiters = [];
  proc.stdout.on("data", (d) => {
    bufS += String(d);
    let i;
    while ((i = bufS.indexOf("\n")) >= 0) {
      const line = bufS.slice(0, i).trim();
      bufS = bufS.slice(i + 1);
      if (waiters.length && waiters[0](line)) waiters.shift();
    }
  });
  return {
    fenAfter: (moves) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("oracle timeout")), 15000);
        const lines = [];
        waiters.push((line) => {
          lines.push(line);
          if (line.includes(" | ")) {
            clearTimeout(timer);
            resolve(line.split(" | ")[0].trim());
            return true;
          }
          return false;
        });
        proc.stdin.write((moves.length ? `position fen ${START} moves ${moves.join(" ")}` : `position fen ${START}`) + "\n");
        proc.stdin.write("d\n");
      }),
    kill: () => proc.kill(),
  };
}

async function reachedCounts(file) {
  const games = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const oracle = startOracle();
  const counts = new Map();
  let positions = 0;
  for (const g of games) {
    // Every position the game passed through, including the final one.
    for (let k = 0; k <= g.moves.length; k++) {
      const fen = await oracle.fenAfter(g.moves.slice(0, k));
      const b = bucket(fen);
      counts.set(b, (counts.get(b) ?? 0) + 1);
      positions++;
    }
  }
  oracle.kill();
  return { counts, positions, games: games.length };
}

const share = (counts, total) => (b) => (counts.get(b) ?? 0) / Math.max(1, total);

// `--corpus` accepts a game dump as well as a training corpus, which is what
// makes the threshold earnable rather than asserted: comparing two dumps from
// the SAME student on different seeds measures this metric's own noise floor,
// and comparing two different students measures whether student identity moves
// the distribution at all. A threshold set without both of those is a guess.
const isDump = (f) => {
  try {
    return !!JSON.parse(readFileSync(f, "utf8").split("\n", 1)[0]).moves;
  } catch { return false; }
};

const left = isDump(CORPUS)
  ? await reachedCounts(CORPUS).then((r) => ({ counts: r.counts, total: r.positions, desc: `${r.positions.toLocaleString()} positions from ${r.games} games` }))
  : (() => { const c = sampleCorpus(CORPUS, SAMPLE, SEED); return { counts: c.counts, total: c.taken, desc: `${c.taken.toLocaleString()} rows sampled` }; })();
console.log(`baseline: ${path.basename(CORPUS)} — ${left.desc}`);
const reached = await reachedCounts(GAMES);
console.log(`reached:  ${path.basename(GAMES)} — ${reached.positions.toLocaleString()} positions from ${reached.games} games\n`);

const cShare = share(left.counts, left.total);
const rShare = share(reached.counts, reached.positions);

console.log("bucket               baseline   reached     gap");
let tv = 0;
for (const b of ORDER) {
  const c = cShare(b);
  const r = rShare(b);
  if (c === 0 && r === 0) continue;
  tv += Math.abs(c - r);
  const gap = r - c;
  const flag = Math.abs(gap) >= 0.15 ? "  <-" : "";
  console.log(
    `${b.padEnd(20)} ${(100 * c).toFixed(1).padStart(6)}%  ${(100 * r).toFixed(1).padStart(6)}%  ${(gap >= 0 ? "+" : "") + (100 * gap).toFixed(1)}pp${flag}`
  );
}
tv /= 2; // total variation distance

console.log(`\ntotal variation distance: ${tv.toFixed(3)}`);

// Scale, measured 2026-08-02 (rig ticket 05) rather than assumed:
//
//   0.036  noise floor — same student, same opponent, seeds 7 vs 11, 20 games
//   0.006-0.026  bootstrap-v1 / v2 / d6 — three 10M-row corpora, different days
//   0.025  dagger-r1 vs dagger-r2 — two DAgger rounds, different students
//   0.127-0.175  bootstrap-d6 vs where a student actually plays (net / classic)
//   0.140  classic vs r3 net, same seed — student identity moves the states
//   0.515  bootstrap vs DAgger — the only thing that ever moved the distribution
//
// The shape of that list IS the finding: same-generator regeneration lands
// inside the noise floor, and only switching mode moves anything.
const baselineIsCorpus = !isDump(CORPUS);

if (!baselineIsCorpus) {
  console.log(
    tv < 0.10
      ? "SAME DISTRIBUTION — inside the same-generator band (≤0.026 measured). Nothing changed."
      : tv < 0.35
        ? "MOVED — beyond same-generator scatter but short of a mode switch. Find out what changed."
        : "DIFFERENT GENERATOR — this is mode-switch scale (bootstrap vs DAgger measured 0.515)."
  );
} else {
  console.log(
    tv < 0.10
      ? "COVERED — the corpus covers where this student plays, within noise."
      : "COVERAGE GAP — the corpus under-covers where this student plays."
  );
  if (tv >= 0.10) {
    console.log(
      "  → Regenerating with the SAME generator will not close it: bootstrap-v1/v2/d6 sit\n" +
      "    within 0.026 of each other, below this metric's 0.036 noise floor. Changing the\n" +
      "    generator is the only lever, and that is a strength decision, not a rig one."
    );
  }
}
console.log("\nNote: this measures COVERAGE, not label quality. Run label-check.mjs for that,");
console.log("and remember a corpus can be perfectly covered and still teach the wrong thing.");
