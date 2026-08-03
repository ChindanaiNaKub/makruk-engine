// Selftest for the ledger's correction primitives — the amendment record.
//
// Mandated by `.scratch/makruk-ledger/issues/02-the-amendment-record.md`.
//
// A guard with no test proving it refuses is a guard nobody has seen work. The
// amendment primitive is allowed to rewrite what the record SAYS, so the cases
// that matter here are the refusals: an outcome field, an unprovable row, a
// retracted row, a proof that did not reproduce. Each of those is a rule the map
// settled before any code existed, and each is worth exactly as much as the test
// that shows it holding.
//
// Everything runs against a scratch ledger (`MAKURUK_LEDGER`) in a temp dir, and
// the proof runner is injected — the record's own logic is exercised without
// spawning a single game, so this is free to run and free to run often.
//
// Usage: node scripts/ledger-selftest.mjs

import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { validateBlock } from "./lib/block-schema.mjs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "makruk-ledger-selftest-"));
const LEDGER = path.join(dir, "blocks.jsonl");

// results.mjs resolves MAKURUK_LEDGER at module load, so the env has to be set
// before the import — hence the dynamic import below.
process.env.MAKURUK_LEDGER = LEDGER;

// ---------------------------------------------------------------------------
// Fixture. Append-only, exactly like the real thing: the cases run in sequence
// against one growing ledger rather than a fresh one each time, because "can a
// row be amended twice" and "does an amendment consume an id" are questions
// about a ledger's history, not about a single call.
// ---------------------------------------------------------------------------
const g = (tag, plies) => ({ tag, plies });

// The historical defect, reproduced: this block ran `go depth 5`, and records
// `movetime 100 / opponentMovetime 400`. Its 52s of game time is a fixed-depth
// figure and the audit convicts it on that alone.
const DEFECT = {
  id: "bx001",
  ts: "2026-08-02T16:08:37.292Z",
  engineCommit: "deadbee",
  engineDirty: true,
  kind: "gate-a",
  mine: { engine: "ours", eval: "net", weights: "tiny.bin", armed: "net /tmp/tiny.bin" },
  opponent: { engine: "ours", eval: "classic", weights: null, armed: "classic" },
  games: 6,
  movetime: 100,
  opponentMovetime: 400,
  openingPlies: 4,
  seed: 7,
  w: 1, l: 1, d: 3, maxPlies: 1, errors: 0,
  score: 0.5,
  perGame: [g("DRAW", 313), g("MAXPLY", 400), g("DRAW", 267), g("MINE", 222), g("FAIRY", 157), g("DRAW", 210)],
  concurrency: 6,
  wallClockS: 15,
  gameTimeS: 52,
};

// A sound movetime block. Nothing wrong with it — it is here to be refused,
// because a movetime block can never be replayed bit-for-bit.
const MOVETIME = {
  ...DEFECT, id: "bx002", seed: 11, kind: "gate-b",
  opponent: { engine: "fairy", skill: 5, eval: "classical", binary: "native" },
  gameTimeS: 386,
};

// Retracted, so off-limits to an amendment whatever else is true of it.
const RETRACTED = { ...DEFECT, id: "bx003", seed: 13 };

// First two games are indistinguishable — two stalls at the ply cap "match" any
// run that also stalls twice, so the proof has to widen before it means anything.
const INDISTINCT = {
  ...DEFECT, id: "bx004", seed: 17, games: 4,
  w: 1, l: 0, d: 1, maxPlies: 2, errors: 0, score: 0.625,
  perGame: [g("MAXPLY", 400), g("MAXPLY", 400), g("DRAW", 300), g("MINE", 150)],
};

writeFileSync(
  LEDGER,
  [DEFECT, MOVETIME, RETRACTED, INDISTINCT]
    .map((b) => JSON.stringify(b))
    .concat(JSON.stringify({ type: "retraction", retracts: "bx003", reason: "harness bug", ts: DEFECT.ts }))
    .join("\n") + "\n"
);

const { amend, readBlocks, appendBlock, retract, table } = await import("./results.mjs");
const { binaryId } = await import("./lib/identity.mjs");

/// The ledger is append-only, so a fixture row arrives the same way a real one
/// does. Used by the engine-identity cases, which need rows that name a binary.
const appendRow = (row) => writeFileSync(LEDGER, readFileSync(LEDGER, "utf8") + JSON.stringify(row) + "\n");

// ---------------------------------------------------------------------------
let pass = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`  FAIL ${name} — ${e.message}`);
  }
};
const eq = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`${what}: got ${a}, wanted ${b}`);
};
/// Asserts the call refuses, and that the refusal MENTIONS the reason — a guard
/// that refuses for the wrong reason passes a bare throws-check.
const refuses = (fn, mentions) => {
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  if (!threw) throw new Error("it was allowed");
  if (mentions && !threw.message.toLowerCase().includes(mentions.toLowerCase())) {
    throw new Error(`refused for the wrong reason: ${threw.message.split("\n")[0]}`);
  }
};
const rawRows = () => readFileSync(LEDGER, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const lines = () => rawRows().length;
// Counted from the file rather than hard-coded, so these two assertions keep
// testing the invariant (a meta row is not a block, and does not eat an id)
// instead of a number that has to be edited every time a fixture is added.
const blockRows = () => rawRows().filter((r) => r.type == null).length;
const metaRows = () => rawRows().filter((r) => r.type != null).length;

// A proof runner that replays whatever the row already says — i.e. the block
// reproduces. `asked` records the width the primitive chose.
const asked = [];
const honestProof = (block, after, games) => {
  asked.push({ id: block.id, games, depth: after.depth });
  return block.perGame.slice(0, games);
};
const DEPTH5 = { depth: 5, movetime: null, opponentMovetime: null };
const reason = "--depth predated the ledger's depth field";

console.log(`ledger: ${LEDGER}\n`);
console.log("refusals — what the primitive is not allowed to do");

check("an outcome field is refused", () =>
  refuses(() => amend("bx001", { w: 40 }, { reason, runProof: honestProof }), "not amendable"));

check("score is refused even alongside a legal field", () =>
  refuses(() => amend("bx001", { depth: 5, score: 0.99 }, { reason, runProof: honestProof }), "not amendable"));

check("a field nobody has thought about is refused (allowlist fails closed)", () =>
  refuses(() => amend("bx001", { concurrency: 12 }, { reason, runProof: honestProof }), "not amendable"));

check("an amendment with no reason is refused", () =>
  refuses(() => amend("bx001", DEPTH5, { runProof: honestProof }), "reason"));

check("an amendment that sets nothing is refused", () =>
  refuses(() => amend("bx001", {}, { reason, runProof: honestProof }), "not an amendment"));

check("a retracted row is refused", () =>
  refuses(() => amend("bx003", DEPTH5, { reason, runProof: honestProof }), "retracted"));

check("a row that stays movetime is refused — no proof is possible", () =>
  refuses(() => amend("bx002", { movetime: 200 }, { reason, runProof: honestProof }), "never bit-reproducible"));

check("a meta row cannot be amended (it has no id to name)", () =>
  refuses(() => amend("clearance", DEPTH5, { reason, runProof: honestProof }), "no block"));

check("an unknown id is refused", () =>
  refuses(() => amend("bx999", DEPTH5, { reason, runProof: honestProof }), "no block"));

check("a proof that does not reproduce is refused, and says so carefully", () => {
  const wrong = (b, _after, n) => b.perGame.slice(0, n).map((x) => ({ ...x, plies: x.plies + 1 }));
  refuses(() => amend("bx001", DEPTH5, { reason, runProof: wrong }), "proof FAILED");
});

check("nothing was written by any refusal", () => eq(lines(), 5, "ledger lines"));

console.log("\nthe proof");

check("an indistinguishable slice widens before it is trusted", () => {
  asked.length = 0;
  amend("bx004", { depth: 6, movetime: null, opponentMovetime: null }, { reason, runProof: honestProof });
  eq(asked.at(-1).games, 4, "proof width for two identical stalls");
});

check("a distinguishable slice stays at two games", () => {
  asked.length = 0;
  amend("bx001", DEPTH5, { reason, runProof: honestProof });
  eq(asked.at(-1).games, 2, "proof width");
});

check("the proof is recorded with what it matched", () => {
  const b = readBlocks().find((x) => x.id === "bx001");
  eq(b.amendment.proof.matched, ["DRAW/313", "MAXPLY/400"], "matched games");
  eq(b.amendment.proof.seed, 7, "proof seed");
});

check("the proof ran at the AMENDED depth, not the row's", () =>
  eq(asked.at(-1).depth, 5, "depth the proof ran at"));

console.log("\nwhich engine played (ticket 03)");

check("a row that predates engineId is UNPINNED, not refused", () => {
  const b = readBlocks().find((x) => x.id === "bx001");
  eq(b.amendment.proof.engineVerdict, "unpinned", "verdict for a historical row");
  eq(b.amendment.proof.blockEngine, null, "nothing to compare against");
  if (!b.amendment.proof.engine?.startsWith("sha256:")) {
    throw new Error("the proof did not record the binary it actually ran against");
  }
});

check("a row naming THIS binary is same, and proceeds", () => {
  const live = binaryId(path.resolve(here, "..", "target", "release", "makruk-engine"));
  appendRow({ ...INDISTINCT, id: "bx005", mine: { ...INDISTINCT.mine, engineId: live }, opponent: { ...INDISTINCT.opponent, engineId: live } });
  amend("bx005", { depth: 5, movetime: null, opponentMovetime: null }, { reason, runProof: honestProof });
  const b = readBlocks().find((x) => x.id === "bx005");
  eq(b.amendment.proof.engineVerdict, "same", "verdict");
  eq(b.amendment.proof.blockEngine, live, "the engine the row named");
});

check("a row naming a DIFFERENT binary is refused before a game is played", () => {
  asked.length = 0;
  appendRow({ ...INDISTINCT, id: "bx006", mine: { ...INDISTINCT.mine, engineId: "sha256:000000000000" } });
  refuses(() => amend("bx006", { depth: 5, movetime: null, opponentMovetime: null }, { reason, runProof: honestProof }),
    "different engine");
  eq(asked.length, 0, "games the refusal cost");
});

check("a different OPPONENT is refused too — the ladder is measured against it", () => {
  appendRow({ ...INDISTINCT, id: "bx007", opponent: { engine: "ours", eval: "classic", weights: null, armed: "classic", engineId: "sha256:000000000000" } });
  refuses(() => amend("bx007", { depth: 5, movetime: null, opponentMovetime: null }, { reason, runProof: honestProof }),
    "different opponent");
});

console.log("\nthe overlay");

check("the block now reads as fixed-depth", () => {
  const b = readBlocks().find((x) => x.id === "bx001");
  eq([b.depth, b.movetime, b.opponentMovetime], [5, null, null], "search condition");
});

check("the physical row is untouched", () => {
  const rawRow = JSON.parse(readFileSync(LEDGER, "utf8").split("\n")[0]);
  eq([rawRow.depth ?? null, rawRow.movetime], [null, 100], "raw row");
});

check("what it used to say is still readable", () => {
  const b = readBlocks().find((x) => x.id === "bx001");
  eq(b.amendedFrom, { depth: null, movetime: 100, opponentMovetime: 400 }, "amendedFrom");
});

check("the outcome is untouched by the overlay", () => {
  const b = readBlocks().find((x) => x.id === "bx001");
  eq([b.w, b.l, b.d, b.score, b.games], [1, 1, 3, 0.5, 6], "outcome");
});

check("the amendment row is not read as a block", () =>
  eq(readBlocks({ includeRetracted: true }).length, blockRows(), "block count vs non-meta rows in the file"));

check("table() marks the row as amended", () => {
  const t = table(readBlocks().filter((b) => b.id === "bx001"));
  if (!t.includes("amended")) throw new Error(`no marker in: ${t.split("\n").at(-1)}`);
});

check("an amendment does not consume a block id", () => {
  const want = "b" + String(blockRows() + 1).padStart(4, "0");
  const row = appendBlock({ kind: "smoke", games: 1, score: 1 });
  eq(row.id, want, `next id after ${blockRows() - 1} blocks and ${metaRows()} meta rows`);
});

console.log("\nthe awkward cases");

check("a row may be amended again, and the last write wins per field", () => {
  amend("bx001", { depth: 7 }, { reason: "the first correction had the wrong depth", runProof: honestProof });
  const b = readBlocks().find((x) => x.id === "bx001");
  eq([b.depth, b.movetime], [7, null], "after re-amendment");
  eq(b.amendments.length, 2, "amendments kept");
});

check("the original value survives two amendments", () =>
  eq(readBlocks().find((x) => x.id === "bx001").amendedFrom.depth, null, "amendedFrom.depth"));

check("an amended row can still be retracted — a retraction always wins", () => {
  retract("bx001", "a later defect");
  const b = readBlocks({ includeRetracted: true }).find((x) => x.id === "bx001");
  if (!b.retraction) throw new Error("retraction did not land");
  eq(readBlocks().some((x) => x.id === "bx001"), false, "still in the default view");
});

check("and once retracted it can no longer be amended", () =>
  refuses(() => amend("bx001", { depth: 8 }, { reason, runProof: honestProof }), "retracted"));

console.log("\nthe defect is unwritable (ticket 04)");

const QUARANTINE = path.join(dir, "rejected.jsonl");
const quarantined = () =>
  existsSync(QUARANTINE) ? readFileSync(QUARANTINE, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];

check("the historical defect — fixed depth carrying a movetime — is REFUSED", () =>
  refuses(() => appendBlock({ ...DEFECT, id: undefined, depth: 5 }), "search-condition-exclusive"));

check("the refused row is quarantined with its violations, not lost", () => {
  const q = quarantined();
  eq(q.length, 1, "quarantined rows");
  eq(q[0].rejected.map((v) => v.name), ["search-condition-exclusive"], "violations attached");
  eq(q[0].perGame.length, 6, "the games survived the refusal");
});

check("a quarantined row does not burn a block id", () => {
  const want = "b" + String(blockRows() + 1).padStart(4, "0");
  eq(appendBlock({ kind: "smoke", games: 1, score: 1 }).id, want, "next id is not skipped");
});

check("a self-contradictory outcome is refused too", () =>
  refuses(() => appendBlock({ kind: "smoke", games: 6, w: 5, l: 5, d: 5, score: 0.5 }), "outcome-sum"));

check("a gate-b block against ourselves is refused", () =>
  refuses(() => appendBlock({ kind: "gate-b", opponent: { engine: "ours" } }), "kind-matches-opponent"));

check("the guard does NOT convict the ledger's own history", () => {
  // The ticket's Watch, as a test. 44 movetime rows and 2 rows with no W/L/D are
  // legitimately shaped the way they are shaped; a guard that rejects the record
  // it is guarding gets turned off within a day. Anything it DOES convict has to
  // be a contradiction the audit already accepted as pre-existing.
  const real = path.resolve(here, "..", "results", "blocks.jsonl");
  const baseline = path.resolve(here, "..", "results", "audit-baseline.json");
  if (!existsSync(real) || !existsSync(baseline)) throw new Error("no committed ledger or baseline to check against");
  const accepted = new Set(JSON.parse(readFileSync(baseline, "utf8")).accepted);
  const rows = readFileSync(real, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.type == null);
  const surprises = rows.flatMap((r) => validateBlock(r).map((v) => `${r.id}:${v.name}`)).filter((k) => !accepted.has(k));
  eq(surprises, [], "historical rows convicted that the audit had not already accepted");
  if (rows.filter((r) => r.movetime != null).length < 40) throw new Error("fixture drift: the ledger no longer holds the movetime rows this asserts about");
});

console.log("\ncontrols are evidence, not results (ticket 06)");

/// The default view, via the CLI, because that is where the decision lives.
const view = (...extra) => {
  try {
    return execFileSync("node", [path.join(here, "results.mjs"), ...extra],
      { encoding: "utf8", env: { ...process.env, MAKURUK_LEDGER: LEDGER } });
  } catch (e) {
    return String(e.stdout ?? "") + String(e.stderr ?? "");
  }
};

// Identical sides at 50% — a control doing exactly its job.
const PASSING_CONTROL = {
  ...DEFECT, id: "bx010", kind: "control", seed: 21,
  opponent: { ...DEFECT.mine, engine: "ours" },
  games: 6, w: 1, l: 1, d: 3, maxPlies: 1, errors: 0, score: 0.5,
};
// Identical sides at 90% — the harness cannot be symmetric and produce this.
const FAILING_CONTROL = {
  ...PASSING_CONTROL, id: "bx011", seed: 23, games: 20,
  w: 18, l: 2, d: 0, maxPlies: 0, errors: 0, score: 0.9,
  perGame: [...Array(18).fill(g("MINE", 120)), ...Array(2).fill(g("FAIRY", 120))],
};

check("a control does not appear in the default view", () => {
  appendRow(PASSING_CONTROL);
  if (view().includes("bx010")) throw new Error("a self-play block is rendering as a result");
});

check("the footer says how many controls there are AND that they pass", () => {
  const out = view();
  if (!/1 controls?, all passing — --kind control/.test(out)) throw new Error(`footer did not assert the verdict:\n${out.split("\n").slice(-3).join("\n")}`);
});

check("--kind control still shows them", () => {
  if (!view("--kind", "control").includes("bx010")) throw new Error("controls are unreachable, not just hidden");
});

check("a FAILING control is announced loudly, not counted quietly", () => {
  appendRow(FAILING_CONTROL);
  const out = view();
  if (!/2 controls, 1 FAILING/.test(out)) throw new Error("a failing control was reported as a bare count");
  if (!out.includes("bx011 CONTROL FAILED")) throw new Error("the failing control was not named");
});

console.log("\nthe audit sees the correction");

const audit = () => {
  try {
    return JSON.parse(execFileSync("node", [path.join(here, "ledger-audit.mjs"), "--json"],
      { encoding: "utf8", env: { ...process.env, MAKURUK_LEDGER: LEDGER } }));
  } catch (e) {
    return JSON.parse(e.stdout);
  }
};
const findings = audit();
const on = (id, inv) => findings.findings.some((f) => f.id === id && f.invariant === inv);

check("the amendment row is not reported as an unknown meta type", () => {
  if (findings.findings.some((f) => f.invariant === "known-meta-type")) {
    throw new Error("the audit does not know about amendments");
  }
});

check("bx004's timing contradiction disappeared without being touched directly", () => {
  if (on("bx004", "timing-arithmetic")) throw new Error("still convicted after being amended");
});

check("an un-amended movetime row is still convicted", () => {
  if (!on("bx003", "timing-arithmetic")) throw new Error("the detector stopped detecting");
});

check("amending a row and later retracting it is NOT a contradiction", () => {
  if (on("bx001", "amendment-after-retraction")) {
    throw new Error("an ordinary history — corrected, then found unsound — was convicted");
  }
});

check("a hand-written amendment of an ALREADY-retracted row is caught", () => {
  writeFileSync(LEDGER, readFileSync(LEDGER, "utf8") +
    JSON.stringify({ type: "amendment", amends: "bx001", set: { depth: 9 }, proof: { games: 2, matched: ["a", "b"] }, reason: "by hand", ts: DEFECT.ts }) + "\n");
  if (!on2("bx001", "amendment-after-retraction")) throw new Error("amending a discarded number was accepted");
});

check("a hand-written amendment with no proof is caught", () => {
  writeFileSync(LEDGER, readFileSync(LEDGER, "utf8") +
    JSON.stringify({ type: "amendment", amends: "bx002", set: { depth: 9 }, reason: "by hand", ts: DEFECT.ts }) + "\n");
  if (!on2("bx002", "amendment-has-proof")) throw new Error("an unproven amendment was accepted");
});

check("a hand-written amendment of an outcome field is caught", () => {
  writeFileSync(LEDGER, readFileSync(LEDGER, "utf8") +
    JSON.stringify({ type: "amendment", amends: "bx002", set: { score: 0.99 }, proof: { games: 2, matched: ["a", "b"] }, reason: "by hand", ts: DEFECT.ts }) + "\n");
  if (!on2("bx002", "amendment-fields-allowed")) throw new Error("a hand-written outcome edit was accepted");
});

// Re-audited after each hand-written row, because the point of these two is that
// the guard also covers rows that did not come through amend().
function on2(id, inv) {
  return audit().findings.some((f) => f.id === id && f.invariant === inv);
}

rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
