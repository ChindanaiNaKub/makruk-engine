// Hash-gated preconditions — enforced by the scripts, not by prose in AGENTS.md.
//
// Mandated by `.scratch/makruk-rig/issues/04-how-the-rig-proves-a-number.md`,
// mechanism 3. `cargo test`, mirror-perft and label-check are all real costs
// (seconds to minutes), so paying them every round does not fit inside the
// wall-clock budget. Paying them when their INPUTS changed does: hash the
// inputs, skip if the hash matches the last passing run. You pay once per actual
// change, which is exactly when the check has anything to say.
//
// Usage:
//   node scripts/gate.mjs                 run every gate that is stale
//   node scripts/gate.mjs cargo-test      run one gate if stale
//   node scripts/gate.mjs --force <name>  run regardless of hash
//   node scripts/gate.mjs label-check <corpus.jsonl>
//
// The cache lives in .gatecache.json (gitignored). Deleting it re-runs everything.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const CACHE = path.join(root, ".gatecache.json");

const readCache = () => (existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {});
const writeCache = (c) => writeFileSync(CACHE, JSON.stringify(c, null, 2) + "\n");

function filesIn(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => path.join(dir, f))
    .filter((f) => statSync(f).isFile());
}

// Hash file *contents*, not mtimes — a checkout or a `touch` must not invalidate.
// The cache keeps the last few passing hashes rather than only the newest, so
// reverting an edit or flipping branches lands back on a known-good hash instead
// of paying for the check twice.
function hashFiles(files) {
  const h = createHash("sha256");
  for (const f of files.slice().sort()) {
    h.update(f);
    h.update(existsSync(f) ? readFileSync(f) : Buffer.from("<missing>"));
  }
  return h.digest("hex").slice(0, 32);
}

const GATES = {
  "cargo-test": {
    why: "engine behaviour (counting rules, do/undo symmetry, nnue parity)",
    inputs: () => [...filesIn(path.join(root, "src"), ".rs"), ...filesIn(path.join(root, "tests"), ".rs"), path.join(root, "Cargo.toml")],
    run: () => spawnSync("cargo", ["test", "--release"], { cwd: root, stdio: "inherit" }).status === 0,
  },
  "mirror-perft": {
    why: "movegen agrees with fairy-stockfish move for move",
    inputs: () => [path.join(root, "src", "movegen.rs"), path.join(root, "src", "board.rs"), path.join(root, "src", "game.rs"), path.join(root, "scripts", "mirror-perft.mjs")],
    run: () =>
      spawnSync("node", ["scripts/mirror-perft.mjs"], {
        cwd: root,
        stdio: "inherit",
        env: { ...process.env, FAIRY_DIR: process.env.FAIRY_DIR || path.resolve(root, "..", "markrukthai-1", "node_modules") },
      }).status === 0,
  },
  "label-check": {
    why: "a new corpus's labels correlate with a reference eval at all",
    needsArg: "corpus.jsonl",
    inputs: (corpus) => [corpus],
    run: (corpus) => {
      const r = spawnSync("node", ["scripts/label-check.mjs", corpus], { cwd: root, encoding: "utf8" });
      process.stdout.write(r.stdout || "");
      if (r.status !== 0) return false;
      const m = (r.stdout || "").match(/Pearson r\s+(-?[\d.]+)/);
      if (!m) {
        console.error("[gate:label-check] could not parse a Pearson r from label-check output.");
        return false;
      }
      const rho = Number(m[1]);
      // Near-zero means the labels are noise; negative means they are inverted.
      // Both cost this project multiple rounds before label-check existed.
      if (rho < 0.3) {
        console.error(
          `\n[gate:label-check] FAIL — Pearson r = ${rho.toFixed(3)} against the classical reference.\n` +
            `  r ≈ 0 means the labels are noise (sign or units bug); r < 0 means they are inverted.\n` +
            `  Do NOT train on this corpus. See the M4 label-sign entry in docs/strength-spec-v1.md.`
        );
        return false;
      }
      return true;
    },
  },
};

export function ensureGate(name, arg, { force = false, quiet = false } = {}) {
  const gate = GATES[name];
  if (!gate) throw new Error(`unknown gate "${name}" — have: ${Object.keys(GATES).join(", ")}`);
  if (gate.needsArg && !arg) throw new Error(`gate "${name}" needs a ${gate.needsArg} argument`);

  const key = arg ? `${name}:${path.resolve(arg)}` : name;
  const cache = readCache();
  const hash = hashFiles(gate.inputs(arg));

  const entry = cache[key] ?? { passing: [] };
  const hit = entry.passing.find((p) => p.hash === hash);
  if (!force && hit) {
    if (!quiet) console.log(`gate ${name}: skipped (these inputs passed ${hit.passedAt})`);
    return true;
  }

  if (!quiet) console.log(`gate ${name}: running — ${gate.why}`);
  const ok = gate.run(arg);
  if (ok) {
    entry.passing = [{ hash, passedAt: new Date().toISOString() }, ...entry.passing.filter((p) => p.hash !== hash)].slice(0, 8);
    cache[key] = entry;
    if (!quiet) console.log(`gate ${name}: PASS`);
  } else {
    // Drop only this hash: other known-good states stay valid.
    entry.passing = entry.passing.filter((p) => p.hash !== hash);
    cache[key] = entry;
    console.error(`gate ${name}: FAIL`);
  }
  writeCache(cache);
  return ok;
}

export function ensureGatesOrDie(specs, opts = {}) {
  for (const { name, arg } of specs) {
    if (!ensureGate(name, arg, opts)) {
      console.error(`\nFATAL precondition "${name}" failed. Nothing ran.`);
      process.exit(4);
    }
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const force = argv.includes("--force");
  const rest = argv.filter((a) => a !== "--force");
  const names = rest.length ? [rest[0]] : Object.keys(GATES).filter((n) => !GATES[n].needsArg);
  let allOk = true;
  for (const n of names) allOk = ensureGate(n, rest[1], { force }) && allOk;
  process.exit(allOk ? 0 : 4);
}
