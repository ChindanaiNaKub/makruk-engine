// The results ledger — the single machine-readable record of every block played.
//
// Mandated by `.scratch/makruk-rig/issues/06-where-results-live.md`.
//
// Three records existed before this and none of them was a lookup: AGENTS.md
// (running prose mixing live, superseded and retracted numbers in the same
// paragraphs), the spec's execution log (excellent narrative history, ~270 lines
// deep, unusable for "what did r3 score at skill 5?"), and raw logs — the ladder
// that redirected the whole project lived in a /tmp scratchpad belonging to a
// dead session and would have vanished on reboot.
//
// Design, in one line each:
//   * results/blocks.jsonl is APPEND-ONLY and committed. Rows are never edited
//     and never deleted.
//   * A retraction is a NEW ROW referencing the retracted one. Provenance is
//     preserved (the spec log's job); the default view is clean (the job that
//     was actually failing).
//   * match-arena writes its own row. A number cannot be transcribed wrong
//     because nothing transcribes it.
//
// Usage:
//   node scripts/results.mjs                     live blocks, newest first
//   node scripts/results.mjs --all               include retracted, with reasons
//   node scripts/results.mjs --kind gate-b       filter
//   node scripts/results.mjs --retract b0007 --reason "harness bug X"
//   node scripts/results.mjs --write-agents      regenerate AGENTS.md standings

import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Circular by design and safe: both sides export only hoisted function
// declarations, and neither calls the other at module-evaluation time.
import { controlVerdict } from "./control-trigger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
// Overridable so the suspect/clearance machinery can be integration-tested
// against a scratch ledger instead of the committed one. Nothing in normal
// operation sets it.
const LEDGER = process.env.MAKURUK_LEDGER || path.join(root, "results", "blocks.jsonl");
const AGENTS = path.join(root, "AGENTS.md");
const MARK_BEGIN = "<!-- BEGIN GENERATED standings — node scripts/results.mjs --write-agents -->";
const MARK_END = "<!-- END GENERATED standings -->";

const git = (args, dflt = "unknown") => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return dflt;
  }
};

export function readRaw() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/// Live blocks, with retractions applied. A retracted block keeps its row — it
/// is annotated, never removed, because "why was this wrong" is exactly the
/// question a future session needs answered.
const META_TYPES = new Set(["retraction", "clearance"]);

/// Live blocks, with retractions applied. A retracted block keeps its row — it
/// is annotated, never removed, because "why was this wrong" is exactly the
/// question a future session needs answered.
///
/// A SUSPECT block (rig ticket 07) is one whose result tripped the control-block
/// trigger: it is real data, so it is recorded, but it is held out of the default
/// view and out of the generated standings until a passing control block clears
/// it. That exclusion is the whole point — a warning nobody has to act on is the
/// convention that already failed once.
export function readBlocks({ includeRetracted = false, includeSuspect = false } = {}) {
  const raw = readRaw();
  const retractions = new Map();
  const clearances = new Map();
  for (const r of raw) {
    if (r.type === "retraction") retractions.set(r.retracts, r);
    else if (r.type === "clearance") clearances.set(r.clears, r);
  }
  let blocks = raw
    .filter((r) => !META_TYPES.has(r.type))
    .map((b) => ({
      ...b,
      retraction: retractions.get(b.id) ?? null,
      clearance: clearances.get(b.id) ?? null,
      // Suspect only while uncleared.
      suspectOpen: b.suspect?.length ? !clearances.has(b.id) : false,
    }));
  if (!includeRetracted) blocks = blocks.filter((b) => !b.retraction);
  if (!includeSuspect) blocks = blocks.filter((b) => !b.suspectOpen);
  return blocks;
}

function nextId() {
  const n = readRaw().filter((r) => !META_TYPES.has(r.type)).length;
  return "b" + String(n + 1).padStart(4, "0");
}

/// Clear a suspect block with a control that actually passed. The control id is
/// mandatory and is verified here rather than trusted: "I ran a control" is the
/// kind of claim that decays into nobody having run one.
export function clearSuspect(id, controlId) {
  const all = readBlocks({ includeRetracted: true, includeSuspect: true });
  const target = all.find((b) => b.id === id);
  if (!target) throw new Error(`no block ${id} in the ledger`);
  if (!target.suspect?.length) throw new Error(`${id} is not suspect — nothing to clear`);
  if (target.clearance) throw new Error(`${id} was already cleared by ${target.clearance.control}`);
  const control = all.find((b) => b.id === controlId);
  if (!control) throw new Error(`no block ${controlId} in the ledger`);
  if (control.kind !== "control") throw new Error(`${controlId} is kind '${control.kind}', not a control block`);
  const v = controlVerdict(control);
  if (!v.pass) throw new Error(`${controlId} did not pass: ${v.text}`);
  appendFileSync(
    LEDGER,
    JSON.stringify({ type: "clearance", clears: id, control: controlId, ts: new Date().toISOString() }) + "\n"
  );
  return { target, control, verdict: v };
}

/// Called by match-arena at the end of a block. Everything needed to reproduce
/// and to *trust* the row, including what each side reported it actually armed —
/// `armed` is the field that makes a silent net→classic fallback auditable after
/// the fact rather than only at run time.
export function appendBlock(row) {
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  const full = {
    id: nextId(),
    ts: new Date().toISOString(),
    engineCommit: git(["rev-parse", "--short", "HEAD"]),
    engineDirty: git(["status", "--porcelain"], "") !== "",
    ...row,
  };
  appendFileSync(LEDGER, JSON.stringify(full) + "\n");
  return full;
}

export function retract(id, reason) {
  if (!reason) throw new Error("a retraction without a reason is how numbers become mysteries");
  const blocks = readBlocks({ includeRetracted: true });
  const target = blocks.find((b) => b.id === id);
  if (!target) throw new Error(`no block ${id} in the ledger`);
  if (target.retraction) throw new Error(`${id} is already retracted: ${target.retraction.reason}`);
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  appendFileSync(
    LEDGER,
    JSON.stringify({ type: "retraction", retracts: id, reason, ts: new Date().toISOString() }) + "\n"
  );
  return target;
}

// ---------- presentation ----------
const pct = (b) => (b.score * 100).toFixed(1) + "%";
const sideLabel = (s) =>
  s.engine === "fairy"
    ? `fairy skill ${s.skill}${s.eval === "nnue" ? " +nnue" : ""}`
    : s.eval === "net"
      ? `net ${(s.weights ?? "").replace(/^makruk-tiny-v1-/, "").replace(/\.bin$/, "") || "?"}`
      : "classic";

export function table(blocks) {
  if (!blocks.length) return "_(no blocks recorded yet)_";
  const rows = blocks.map((b) => [
    b.id,
    b.kind,
    sideLabel(b.mine),
    sideLabel(b.opponent),
    String(b.games),
    // null W–L–D means the split was genuinely never recorded (backfilled rows).
    // Shown as "—", never reconstructed from the score fraction.
    b.w == null ? "—" : `${b.w}–${b.l}–${b.d}${b.maxPlies ? ` (${b.maxPlies} mp)` : ""}`,
    pct(b),
    b.retraction ? "**RETRACTED**" : b.suspectOpen ? "**SUSPECT**" : b.clearance ? `cleared by ${b.clearance.control}` : "",
  ]);
  const head = ["id", "kind", "ours", "opponent", "n", "W–L–D", "score", ""];
  const out = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const r of rows) out.push(`| ${r.join(" | ")} |`);
  return out.join("\n");
}

// Kinds that are real records but not results. Single source of truth for both
// the CLI view and the generated AGENTS.md block — they diverged once and put
// seven 2-game smokes into the file that is supposed to be the clean summary.
const NOISE_KINDS = new Set(["smoke", "diag"]);

function writeAgents() {
  const blocks = readBlocks().filter((b) => !NOISE_KINDS.has(b.kind));
  const body = [
    MARK_BEGIN,
    "",
    `_Generated from \`results/blocks.jsonl\` (${blocks.length} live blocks). Do not hand-edit — run \`node scripts/results.mjs --write-agents\`._`,
    "",
    table(blocks),
    "",
    MARK_END,
  ].join("\n");

  let md = readFileSync(AGENTS, "utf8");
  if (md.includes(MARK_BEGIN) && md.includes(MARK_END)) {
    const pre = md.slice(0, md.indexOf(MARK_BEGIN));
    const post = md.slice(md.indexOf(MARK_END) + MARK_END.length);
    md = pre + body + post;
  } else {
    throw new Error(
      `AGENTS.md has no generated-standings markers. Insert:\n${MARK_BEGIN}\n${MARK_END}\nwhere the standings should live.`
    );
  }
  writeFileSync(AGENTS, md);
  console.log(`AGENTS.md standings regenerated from ${blocks.length} live blocks.`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 ? argv[i + 1] : d; };

  // These refuse for good reasons — an unreadable stack trace turns a clear
  // "no, and here is why" into something that looks like a crash.
  const guarded = (fn) => {
    try { fn(); } catch (e) { console.error(`refused: ${e.message}`); process.exit(2); }
  };

  if (argv.includes("--write-agents")) {
    writeAgents();
  } else if (argv.includes("--retract")) {
    guarded(() => {
      const t = retract(arg("retract"), arg("reason"));
      console.log(`retracted ${t.id} (${sideLabel(t.mine)} vs ${sideLabel(t.opponent)}, ${pct(t)}) — the row stays, annotated.`);
    });
  } else if (argv.includes("--clear-suspect")) {
    guarded(() => {
      const { target, verdict } = clearSuspect(arg("clear-suspect"), arg("control"));
      console.log(verdict.text);
      console.log(`cleared ${target.id} (${pct(target)}) — it rejoins the default view.`);
    });
  } else {
    const all = argv.includes("--all");
    let blocks = readBlocks({ includeRetracted: all, includeSuspect: all });
    const kind = arg("kind");
    // Diagnostics and smokes stay in the ledger but out of the default view:
    // they are real records of real runs, and they are not results. Ask for them
    // by kind. Nothing is ever hidden without being counted at the bottom.
    const hiddenNoise = kind ? 0 : blocks.filter((b) => NOISE_KINDS.has(b.kind)).length;
    blocks = kind ? blocks.filter((b) => b.kind === kind) : blocks.filter((b) => !NOISE_KINDS.has(b.kind));
    blocks.reverse();
    console.log(table(blocks));
    if (all) {
      for (const b of blocks.filter((x) => x.retraction)) {
        console.log(`\n${b.id} RETRACTED: ${b.retraction.reason}`);
      }
    } else {
      const everything = readBlocks({ includeRetracted: true, includeSuspect: true });
      const hidden = everything.filter((b) => b.retraction).length;
      const suspect = everything.filter((b) => b.suspectOpen && !b.retraction);
      const notes = [];
      if (hidden) notes.push(`${hidden} retracted — --all to see them and why`);
      if (suspect.length) notes.push(`${suspect.length} SUSPECT, awaiting a control block — --all to see them`);
      if (hiddenNoise) notes.push(`${hiddenNoise} smoke/diag — --kind smoke or --kind diag`);
      if (notes.length) console.log(`\n(${notes.join("; ")})`);
      for (const b of suspect) {
        console.log(`\n${b.id} SUSPECT: ${b.suspect.map((s) => `[clause ${s.clause}] ${s.reason}`).join("; ")}`);
        console.log(`  → run a control, then: node scripts/results.mjs --clear-suspect ${b.id} --control <controlId>`);
      }
    }
  }
}
