// Score our (untrained) classic eval against a corpus's stored eval labels.
//
// This is the baseline that separates "the net fits the labels badly" from
// "the labels are wrong" — a classical material eval cannot overfit, cannot be
// undertrained, and has no capacity story, so a near-zero correlation with the
// teacher's labels means the labels are broken. Running it on the bootstrap
// corpus would have caught the sign inversion that cost rounds 1–3 (see the M4
// label-sign entry in docs/strength-spec-v1.md); run it on every new corpus
// BEFORE spending a training run on it.
//
// Usage: node scripts/label-check.mjs <corpus.jsonl> [sample=3000]
//
// Reading the output:
//   r ≈ 0            labels are noise — almost certainly a sign or units bug
//   r < 0            labels are inverted
//   r ≈ 0.9+         labels agree with material counting (typical of depth-0
//                    static labels)
//   r ≈ 0.8          labels carry information material alone does not — what
//                    you want from search-depth labels; that gap is the
//                    headroom the net has to learn

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const file = process.argv[2];
const N = Number(process.argv[3] || 3000);
if (!file) {
  console.error("usage: node scripts/label-check.mjs <corpus.jsonl> [sample=3000]");
  process.exit(2);
}

const proc = spawn(path.join(root, "target", "release", "makruk-engine"), [], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, MAKURUK_EVAL: "classic" },
});
const out = readline.createInterface({ input: proc.stdout });
let pending = null;
out.on("line", (l) => {
  if (pending && l.startsWith("eval ")) {
    pending(parseInt(l.split(/\s+/)[1], 10));
    pending = null;
  }
});
const ourEval = (fen) =>
  new Promise((res) => {
    pending = res;
    proc.stdin.write(`position fen ${fen}\neval\n`);
  });

const rows = [];
const rl = readline.createInterface({ input: createReadStream(file) });
for await (const line of rl) {
  const r = JSON.parse(line);
  if (r.eval === null || r.eval === undefined) continue;
  rows.push(r);
  if (rows.length >= N) break;
}
rl.close();

// Compare in tanh(cp/400) space — the space the loss actually works in, so a
// handful of mate scores can't dominate the statistic.
const xs = [];
const ys = [];
for (const r of rows) {
  xs.push(Math.tanh((await ourEval(r.fen)) / 400));
  ys.push(Math.tanh(r.eval / 400));
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const mx = mean(xs);
const my = mean(ys);
let sxy = 0;
let sxx = 0;
let syy = 0;
let sse = 0;
for (let i = 0; i < xs.length; i++) {
  sxy += (xs[i] - mx) * (ys[i] - my);
  sxx += (xs[i] - mx) ** 2;
  syy += (ys[i] - my) ** 2;
  sse += (xs[i] - ys[i]) ** 2;
}
const r = sxy / Math.sqrt(sxx * syy);
const verdict =
  r < 0.1 ? "  <-- NOISE: labels are broken, do not train on this" :
  r < 0 ? "  <-- INVERTED: labels have the wrong sign" : "";

console.log(`${file}  n=${xs.length}`);
console.log(`  Pearson r     ${r.toFixed(3)}${verdict}`);
console.log(`  R² (classic)  ${(1 - sse / syy).toFixed(3)}`);
console.log(`  MSE           ${(sse / xs.length).toFixed(4)}`);
console.log(
  `  label mean ${my.toFixed(3)}  sd ${Math.sqrt(syy / xs.length).toFixed(3)}  |cp|>2000 ${((rows.filter((x) => Math.abs(x.eval) > 2000).length / rows.length) * 100).toFixed(1)}%`
);

proc.kill("SIGKILL");
