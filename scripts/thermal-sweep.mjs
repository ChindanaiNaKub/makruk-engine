// Thermal/throughput curve for datagen: how much heat does each job count buy?
// Runs each arm to thermal steady state, samples package temp, kills it, cools down.
//
// Usage: node scripts/thermal-sweep.mjs [--arms 12,8,6,4] [--run-s 75] [--cool-s 30]
//
// NOTE: a single 75 s arm has a ~±4-5 °C noise floor (measured 2026-08-02 — a
// provably-inert change moved arms by ±5 in both directions). Do not claim a
// difference smaller than ~10 °C from one pass; raise --run-s or repeat the sweep.
// The labelled corpus it produces is throwaway and is deleted on exit.
import { spawn, execSync } from "node:child_process";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };

const ARMS = arg("arms", "12,8,6,4").split(",").map(Number);
const OUT = path.join(os.tmpdir(), "makruk-thermal-throwaway.jsonl");
const RUN_MS = Number(arg("run-s", "75")) * 1000;
const COOL_MS = Number(arg("cool-s", "30")) * 1000;
const SAMPLE_MS = 3_000;

const pkgTemp = () => {
  try {
    const out = execSync("sensors 2>/dev/null", { encoding: "utf8" });
    const m = out.match(/Package id 0:\s+\+?([\d.]+)/);
    return m ? Number(m[1]) : NaN;
  } catch { return NaN; }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function coolTo(label) {
  const t0 = Date.now();
  while (Date.now() - t0 < COOL_MS) await sleep(SAMPLE_MS);
  const t = pkgTemp();
  console.log(`  [cooldown ${label}] ${t.toFixed(0)}°C`);
  return t;
}

const rows = [];
console.log(`baseline: ${pkgTemp().toFixed(0)}°C\n`);

for (const jobs of ARMS) {
  const temps = [];
  let lastRate = NaN;
  const p = spawn("node", [
    "scripts/datagen.mjs",
    "--positions", "9999999",
    "--depth", "3",
    "--jobs", String(jobs),
    "--out", OUT,
  ], { stdio: ["ignore", "pipe", "ignore"] });

  p.stdout.on("data", (d) => {
    for (const ln of String(d).split("\n")) {
      const m = ln.match(/([\d.]+) pos\/s/);
      if (m) lastRate = Number(m[1]);
    }
  });

  const t0 = Date.now();
  while (Date.now() - t0 < RUN_MS) {
    await sleep(SAMPLE_MS);
    temps.push({ t: Date.now() - t0, c: pkgTemp() });
  }
  p.kill("SIGKILL");
  await sleep(1500);

  // steady state = last 30s of the run
  const steady = temps.filter((s) => s.t > RUN_MS - 30_000).map((s) => s.c);
  const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
  const peak = Math.max(...temps.map((s) => s.c));
  rows.push({ jobs, rate: lastRate, mean, peak });
  console.log(`jobs=${String(jobs).padStart(2)}  ${lastRate.toFixed(0).padStart(5)} pos/s   steady ${mean.toFixed(1)}°C   peak ${peak.toFixed(0)}°C`);
  await coolTo(`after ${jobs}`);
}

console.log("\n=== datagen thermal/throughput curve ===");
console.log("jobs | pos/s | steady °C | peak °C | pos/s per job | % of 12-job rate");
const base = rows.find((r) => r.jobs === 12)?.rate ?? rows[0].rate;
for (const r of rows) {
  console.log(
    `${String(r.jobs).padStart(4)} | ${r.rate.toFixed(0).padStart(5)} | ${r.mean.toFixed(1).padStart(9)} | ${r.peak.toFixed(0).padStart(7)} | ` +
    `${(r.rate / r.jobs).toFixed(0).padStart(13)} | ${((100 * r.rate) / base).toFixed(0).padStart(16)}%`
  );
}
console.log("\nreminder: ~±4-5 °C noise floor per arm — don't read a small gap as real.");
rmSync(OUT, { force: true });
