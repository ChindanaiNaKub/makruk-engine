// Bindgen the release wasm for browser (no-modules: classic worker friendly)
// and nodejs (for smoke tests). Prints the payload sizes.
// Run after: cargo build --release --target wasm32-unknown-unknown

import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, "target", "wasm32-unknown-unknown", "release", "makruk_engine.wasm");

for (const { dir, target } of [
  { dir: "pkg/web", target: "no-modules" },
  { dir: "pkg/node", target: "nodejs" },
]) {
  const out = path.join(root, dir);
  mkdirSync(out, { recursive: true });
  execFileSync(
    "wasm-bindgen",
    [input, "--out-dir", out, "--target", target, "--no-typescript"],
    { stdio: "inherit" }
  );
}

// The nodejs target emits CommonJS; keep it out of this repo's "type":"module".
writeFileSync(
  path.join(root, "pkg", "node", "package.json"),
  JSON.stringify({ type: "commonjs" }) + "\n"
);

const sz = (p) => (statSync(p).size / 1024).toFixed(1) + " KB";
for (const f of [
  "pkg/web/makruk_engine.js",
  "pkg/web/makruk_engine_bg.wasm",
  "pkg/node/makruk_engine_bg.wasm",
]) {
  console.log(sz(path.join(root, f)), " ", f);
}
