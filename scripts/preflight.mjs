// Pre-flight self-test — a hard precondition, not a habit.
//
// Mandated by `.scratch/makruk-rig/issues/04-how-the-rig-proves-a-number.md`.
// Five harness defects surfaced on 2026-08-02 and every one of them made the
// engine look WORSE than it was, so each was indistinguishable from a real
// negative result and got theorised about instead of audited. This runs in well
// under a second and refuses to let a block start when the rig is misconfigured.
//
// It checks the class of bug that actually bit: config/env drift, not engine
// behaviour. Engine behaviour is the hash-gated preconditions' job (gate.mjs).
//
// Usage: node scripts/preflight.mjs [--control] [--seed 7]
//   --control  permit both sides to be the same eval (self-play control blocks
//              are identical BY DESIGN; without this the identical-sides check
//              would make them impossible to run)
//
// Import form: `import { preflight } from "./preflight.mjs"` then
//   await preflight({ sides: [...], control: bool, seed: N })

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32, openingSeed } from "./lib/rng.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const ENGINE = path.join(root, "target", "release", "makruk-engine");
const START = "rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w";
const PERFT3 = 12012; // AGENTS.md invariant: 23 / 529 / 12012 / 273026

class PreflightError extends Error {}
const fail = (check, msg, hint) => {
  throw new PreflightError(`[preflight:${check}] ${msg}${hint ? `\n  → ${hint}` : ""}`);
};

// ---------- check 1: env shape ----------
// The `env $var node …` bug set MAKURUK_EVAL to the literal string
// "net MAKURUK_WEIGHTS=/path", which is not "net", so the engine fell back to
// classic and three blocks measured one engine. resolveEval in match-arena
// already fatals on this; repeating it here means datagen and any future driver
// get the same guarantee from one place.
function checkEnvShape(side) {
  const { label, env } = side;
  const ev = env.MAKURUK_EVAL;
  if (ev !== undefined && ev !== "net" && ev !== "classic") {
    fail(
      "env-shape",
      `${label} has MAKURUK_EVAL=${JSON.stringify(ev)} — must be exactly "net" or "classic".`,
      "zsh does not word-split unquoted parameter expansions. Use inline prefix assignments (VAR=x VAR2=y node …), never `env $var node …`."
    );
  }
  if (ev === "net") {
    if (!env.MAKURUK_WEIGHTS) fail("env-shape", `${label} requests MAKURUK_EVAL=net with no MAKURUK_WEIGHTS.`);
    if (!existsSync(env.MAKURUK_WEIGHTS)) {
      fail("env-shape", `${label} weights not found: ${env.MAKURUK_WEIGHTS}`,
        "The engine would load nothing, print to stderr, and play the classical eval.");
    }
    if (statSync(env.MAKURUK_WEIGHTS).size === 0) {
      fail("env-shape", `${label} weights file is empty: ${env.MAKURUK_WEIGHTS}`);
    }
  }
}

// ---------- check 2: armed eval matches requested eval ----------
// The decisive one. `nnue::mode()` resolves lazily and, when weights fail to
// load, falls back to classic with only an stderr line — invisible to a harness
// driving the binary over UCI. `evalinfo` forces resolution and reports what was
// ACTUALLY armed, so the fallback becomes an assertion failure instead of a
// day of misread blocks.
function armedEval(env) {
  return new Promise((resolve, reject) => {
    const p = spawn(ENGINE, [], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, ...env } });
    let out = "";
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("evalinfo timeout")); }, 10000);
    p.stdout.on("data", (d) => {
      out += String(d);
      const m = out.match(/info string evalinfo (.+)/);
      if (m) { clearTimeout(timer); p.kill("SIGKILL"); resolve(m[1].trim()); }
    });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdin.write("evalinfo\nquit\n");
  });
}

async function checkArmedEval(side) {
  const { label, env } = side;
  const want = env.MAKURUK_EVAL === "net" ? "net" : "classic";
  let armed;
  try {
    armed = await armedEval(env);
  } catch (e) {
    fail("armed-eval", `${label}: could not read evalinfo from ${ENGINE}: ${e.message}`,
      "Stale binary? `cargo build --release`. The evalinfo command landed 2026-08-02.");
  }
  const got = armed.startsWith("net ") ? "net" : "classic";
  if (got !== want) {
    fail("armed-eval", `${label} requested eval=${want} but the engine armed: ${armed}`,
      "This is the silent-fallback class that cost a day. Nothing plays until it matches.");
  }
  side.armed = armed;
  return armed;
}

// ---------- check 3: the two sides are actually different ----------
// A whole class of "we thought we were testing X vs Y" bugs. match-arena used to
// strip MAKURUK_* from the opponent unconditionally, so net-vs-net was silently
// impossible; OPP_WEIGHTS fixed it, and an r3-vs-r3 control (1–1–8) is what
// proved the fix. Which is exactly why identical sides must stay LEGAL when
// asked for explicitly — see --control.
function sideIdentity(side) {
  // The BINARY is part of a side's identity, not just its eval. Two different
  // builds both playing the classical eval are two different engines, and
  // without this the check called them identical and refused a legitimate
  // Gate A on an `src/` change (redraw ticket 05).
  let bin = "";
  if (side.bin && existsSync(side.bin)) {
    bin = ":" + createHash("sha256").update(readFileSync(side.bin)).digest("hex").slice(0, 12);
  }
  if (!side.env.MAKURUK_WEIGHTS || side.env.MAKURUK_EVAL !== "net") return "classic" + bin;
  const sha = createHash("sha256").update(readFileSync(side.env.MAKURUK_WEIGHTS)).digest("hex");
  return `net:${sha.slice(0, 16)}${bin}`;
}

function checkSidesDiffer(sides, control) {
  if (sides.length < 2) return;
  const ids = sides.map(sideIdentity);
  if (new Set(ids).size === 1) {
    if (control) return; // identical by design
    fail("sides-differ", `both sides resolve to the same eval (${ids[0]}) — this block would measure one engine against itself.`,
      "If that is what you want (a self-play control), pass --control / control:true.");
  }
}

// ---------- check 4: seeds reproduce ----------
// `--seed S` is the only reason a block is re-runnable. A PRNG that reached for
// Date.now()/Math.random() would break that with nothing looking wrong.
function checkSeedDeterminism(seed) {
  const draw = (s) => { const r = mulberry32(openingSeed(s, 3)); return [r(), r(), r(), r()].join(","); };
  if (draw(seed) !== draw(seed)) {
    fail("seed-determinism", "the opening PRNG is not pure — the same seed produced two different sequences.",
      "scripts/lib/rng.mjs must stay free of Date.now()/Math.random().");
  }
  if (draw(seed) === draw(seed + 1)) {
    fail("seed-determinism", `seeds ${seed} and ${seed + 1} produce identical openings — the seed is not reaching the PRNG.`);
  }
}

// ---------- check 5: the oracle still knows the rules ----------
// Cheap constant, not the full mirror-perft (that is hash-gated in gate.mjs).
// Catches a movegen regression before it can be read as an eval result.
function checkPerftConstant() {
  return new Promise((resolve, reject) => {
    const p = spawn(ENGINE, [], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("perft timeout")); }, 15000);
    p.stdout.on("data", (d) => {
      out += String(d);
      const m = out.match(/^(\d+)\s*$/m);
      if (m) {
        clearTimeout(timer);
        p.kill("SIGKILL");
        const n = Number(m[1]);
        if (n !== PERFT3) {
          reject(new PreflightError(`[preflight:perft] startpos perft(3) = ${n}, expected ${PERFT3} — movegen has regressed.`));
        } else resolve(n);
      }
    });
    p.on("error", reject);
    p.stdin.write(`position fen ${START}\nperft 3\nquit\n`);
  });
}

// ---------- driver ----------
export async function preflight({ sides = [], control = false, seed = 7, quiet = false } = {}) {
  if (!existsSync(ENGINE)) {
    fail("engine", `no engine binary at ${ENGINE}`, "cargo build --release");
  }
  for (const s of sides) checkEnvShape(s);
  for (const s of sides) await checkArmedEval(s);
  checkSidesDiffer(sides, control);
  checkSeedDeterminism(seed);
  await checkPerftConstant();
  if (!quiet) {
    const armed = sides.map((s) => `${s.label}=${s.armed ?? "n/a"}`).join("  ");
    console.log(`preflight OK — ${armed}${control ? "  [control: identical sides permitted]" : ""}`);
  }
  return true;
}

// Wrap for callers that should die rather than continue on a rig fault.
export async function preflightOrDie(opts) {
  try {
    return await preflight(opts);
  } catch (e) {
    console.error(`\nFATAL ${e.message}\n`);
    console.error("Nothing played. Fix the rig, then re-run.");
    process.exit(2);
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };
  const sides = [{ label: "mine", env: { MAKURUK_EVAL: process.env.MAKURUK_EVAL, MAKURUK_WEIGHTS: process.env.MAKURUK_WEIGHTS } }];
  if (process.env.OPP_WEIGHTS) {
    sides.push({ label: "opponent", env: { MAKURUK_EVAL: "net", MAKURUK_WEIGHTS: process.env.OPP_WEIGHTS } });
  }
  await preflightOrDie({ sides, control: argv.includes("--control"), seed: Number(arg("seed", "7")) });
}
