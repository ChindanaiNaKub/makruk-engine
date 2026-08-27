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
//   * An AMENDMENT is a new row too, and says the opposite of a retraction: the
//     number stands, the description lied. It may correct how a block was RUN
//     and never what it scored, and it does not land without a proof that the
//     corrected conditions reproduce the recorded games.
//   * match-arena writes its own row. A number cannot be transcribed wrong
//     because nothing transcribes it.
//
// Usage:
//   node scripts/results.mjs                     live blocks, newest first
//   node scripts/results.mjs --all               include retracted + amended, with reasons
//   node scripts/results.mjs --kind gate-b       filter
//   node scripts/results.mjs --retract b0007 --reason "harness bug X"
//   node scripts/results.mjs --amend b0040 --set depth=5,movetime=null,opponentMovetime=null --reason "..."
//   node scripts/results.mjs --write-agents      regenerate AGENTS.md standings

import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { binaryId, fairyWasmPath } from "./lib/identity.mjs";
import { validateBlock } from "./lib/block-schema.mjs";
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
const OUR_ENGINE = path.join(root, "target", "release", "makruk-engine");
// Same default match-arena uses, so a proof looks for the wasm fairy where the
// arena would have loaded it from.
const FAIRY_DIR = process.env.FAIRY_DIR || path.resolve(root, "..", "markrukthai-1", "node_modules");
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

/// Rows that annotate a block rather than being one. This set is load-bearing
/// twice over and both uses are silent when it is wrong: `readBlocks` filters on
/// it (an unlisted type is read as a BLOCK, with no id, no score and no games),
/// and `nextId` counts on it (an unlisted type consumes an id, so the next real
/// block skips one). `scripts/ledger-audit.mjs` fires `known-meta-type` on both.
const META_TYPES = new Set(["retraction", "clearance", "amendment"]);

/// What an amendment is allowed to change, and the reason it is an ALLOWLIST.
///
/// An amendment says "this row's number stands, its description lied" — it
/// corrects how a block was *run*, never what it scored. The distinction is the
/// whole primitive: if the result is untrustworthy that is a retraction, and
/// conflating the two would let a bad number be quietly redescribed into a good
/// one.
///
/// A denylist of outcome fields would fail OPEN the day someone adds a field to
/// the row — the new field would be amendable by default, and nobody would
/// notice until it had been. This fails closed instead: a field nobody has
/// thought about is refused. The audit found no violating row that needs
/// anything beyond these three, so the list costs nothing today.
export const AMENDABLE_FIELDS = new Set(["depth", "movetime", "opponentMovetime"]);

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
  const amendments = new Map();
  for (const r of raw) {
    if (r.type === "retraction") retractions.set(r.retracts, r);
    else if (r.type === "clearance") clearances.set(r.clears, r);
    else if (r.type === "amendment") {
      if (!amendments.has(r.amends)) amendments.set(r.amends, []);
      amendments.get(r.amends).push(r);
    }
  }
  let blocks = raw
    .filter((r) => !META_TYPES.has(r.type))
    .map((b) => {
      // Overlay, never edit. The physical row is untouched — every consumer
      // reads the corrected value from here, and `amendedFrom` keeps what the
      // row actually says so `--all` can show the correction rather than hiding
      // it. A correction nobody can see is a silent edit.
      //
      // Applied in ledger order, latest-wins PER FIELD: a row may be amended
      // again (a second correction is not evidence the first was wrong, and
      // append-only means the history is intact either way).
      const applied = amendments.get(b.id) ?? [];
      const overlaid = { ...b };
      const amendedFrom = {};
      for (const a of applied) {
        for (const [k, v] of Object.entries(a.set ?? {})) {
          if (!(k in amendedFrom)) amendedFrom[k] = b[k] ?? null;
          overlaid[k] = v;
        }
      }
      return {
        ...overlaid,
        retraction: retractions.get(b.id) ?? null,
        clearance: clearances.get(b.id) ?? null,
        amendments: applied,
        amendment: applied.at(-1) ?? null,
        amendedFrom: applied.length ? amendedFrom : null,
        // Suspect only while uncleared.
        suspectOpen: b.suspect?.length ? !clearances.has(b.id) : false,
      };
    });
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
  const meta = {
    ts: new Date().toISOString(),
    engineCommit: git(["rev-parse", "--short", "HEAD"]),
    engineDirty: git(["status", "--porcelain"], "") !== "",
  };

  // The last door (ledger ticket 04). Everything knowable in advance was already
  // refused by preflight, so reaching this is a harness bug introduced between
  // the two — but a bug that surfaces HERE has a finished block behind it, and on
  // this machine a Gate A block is ~23 minutes of the only laptop there is.
  //
  // So the row is QUARANTINED rather than discarded: it goes to a sidecar with
  // its violations attached and the caller is told to stop. The ledger stays
  // clean, the measurement is not lost, and the decision about what to do with a
  // contradictory row belongs to a person. Note it is quarantined WITHOUT an id
  // — `nextId()` is deliberately not called, so a rejected row never burns an id
  // that a later block would then skip.
  const violations = validateBlock({ ...meta, ...row });
  if (violations.length) {
    const quarantine = path.join(path.dirname(LEDGER), "rejected.jsonl");
    appendFileSync(quarantine, JSON.stringify({ ...meta, ...row, rejected: violations }) + "\n");
    throw new Error(
      `this block contradicts itself and was NOT recorded:\n` +
        violations.map((v) => `  [${v.name}] ${v.detail}`).join("\n") +
        `\n\nThe games are not lost — the row is in ${path.relative(root, quarantine)} with its violations attached.\n` +
        `Fix the harness, then decide whether to re-append it by hand or replay the block.`
    );
  }

  const full = { id: nextId(), ...meta, ...row };
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

// ---------- amendment: the number stands, the description lied ----------
//
// Mandated by `.scratch/makruk-ledger/issues/02-the-amendment-record.md`.
//
// The ledger had exactly two ways to change the record — append a block, or
// retract one — and neither fits a row whose MEASUREMENT is sound and whose
// DESCRIPTION is wrong. b0040 and b0043 ran `go depth 5` and `go depth 7` and
// record `movetime: 100, opponentMovetime: 400`, which renders as "the opponent
// had 4x the time and we still won". Flattering, and false. Retracting them
// throws away sound measurements to fix a wrong field; editing them breaks the
// append-only rule the whole record rests on.
//
// So: a third meta-row type, overlaid at read time, that may correct how a block
// was RUN and never what it scored — and that does not land without a proof.

/// Can this proof's re-run be compared to the block at all?
///
/// Three outcomes, all three defined, because the interesting one is the third:
///
///   same      — the row names an engine and this is it. Proceed.
///   different — the row names an engine and it is not this one. REFUSE: a
///               replay on a different binary is not evidence about this row,
///               and a coincidental match would be worse than a mismatch.
///   unpinned  — the row predates `engineId` (all 49 rows in the ledger as of
///               2026-08-03 do). A historical row can never be pinned
///               retroactively, so there is nothing to compare and refusing
///               would make the primitive useless on exactly the rows it was
///               built for. Proceed, and record the binary the evidence
///               actually ran against instead of claiming an equality that was
///               never checkable.
///
/// The opponent gets the same treatment, because "which engine played" has two
/// sides: the ladder is measured against fairy, so an unpinned opponent is the
/// same defect one step further out.
function engineMatch(side, live) {
  const recorded = side?.engineId ?? null;
  if (!recorded) return { verdict: "unpinned", recorded, live };
  if (!live) return { verdict: "unpinned", recorded, live };
  return { verdict: recorded === live ? "same" : "different", recorded, live };
}

/// How many games a proof has to replay before a match means anything.
///
/// Two is usually enough — b0040 and b0043 were each settled by two at charting
/// — because game g always takes `openings[g >> 1]` and colour `g % 2`
/// (match-arena.mjs:568), so games 0 and 1 are the SAME opening with colours
/// reversed. A wrong claim therefore fails twice on one opening, and a right one
/// cannot be faked.
///
/// The exception is a slice whose games are indistinguishable. Two games that
/// both read `MAXPLY/400` "match" any run that also stalls twice, which is no
/// evidence at all — so widen until the slice contains at least two distinct
/// ply counts. Computed from the RECORDED per-game results, so the widening
/// costs nothing: it happens before a single game is played.
function proofWidth(perGame, want, cap) {
  let k = Math.min(want, cap);
  while (k < cap && new Set(perGame.slice(0, k).map((g) => g.plies)).size < 2) k += 2; // pairs stay whole
  return Math.min(k, cap);
}

const armedPath = (armed) => (armed ?? "").split(/\s+/).slice(1).join(" ") || null;

/// Rebuild the run from the row. Returns the argv and env that reproduce the
/// block's first `games` games, or throws with the reason it cannot.
///
/// The uncomfortable part, stated rather than buried: this reconstructs the
/// environment from `armed`, and `armed` is UNFALSIFIABLE. preflight.mjs:74
/// produces it by probing our own binary under the *believed* env, so on b0010 it
/// recorded "classic" for a side that was actually native fairy — corroborating
/// the error instead of catching it. A proof built on it can therefore run the
/// wrong opponent. That is why a mismatch below refuses to conclude anything
/// rather than declaring the row false: this map's own charting lost three
/// reproduction attempts to an unset FAIRY_BIN, and a verifier that shouts
/// "the record is wrong" at its own misconfiguration is worse than none.
function proofInvocation(block, after, games) {
  const env = { ...process.env, MAKURUK_LEDGER: null }; // scratch ledger set by the caller
  const argv = [
    "--games", String(games),
    "--seed", String(block.seed ?? 7),
    "--opening-plies", String(block.openingPlies ?? 4),
    "--depth", String(after.depth),
    "--kind", "smoke",
    // A proof is not a measurement and must not drag the rig's machinery in
    // with it: no control block (this is not a new binding mechanism), and no
    // contention gate (under --depth the search is node-bound, so a busy box
    // changes the wall-clock and not one move).
    "--skip-control",
    "--allow-busy",
  ];

  if (block.mine?.eval === "net") {
    const w = armedPath(block.mine.armed) ?? block.mine.weights;
    if (!w) throw new Error(`${block.id} played a net but records no weights path — nothing to arm`);
    env.MAKURUK_EVAL = "net";
    env.MAKURUK_WEIGHTS = w;
  } else {
    env.MAKURUK_EVAL = "classic";
    delete env.MAKURUK_WEIGHTS;
  }

  const opp = block.opponent ?? {};
  if (opp.engine === "ours") {
    env.FAIRY_BIN = OUR_ENGINE;
    if (opp.eval === "net") {
      const w = armedPath(opp.armed) ?? opp.weights;
      if (!w) throw new Error(`${block.id}'s opponent played a net but records no weights path`);
      env.OPP_WEIGHTS = w;
    } else {
      delete env.OPP_WEIGHTS;
    }
    // Identical evals on both sides is what a control block IS, and preflight
    // treats identical sides as fatal unless told they are the point.
    if (block.mine?.armed === opp.armed) argv.push("--control");
  } else if (opp.engine === "fairy") {
    argv.push("--skill", String(opp.skill));
    // The row records `binary: "native" | "wasm"`, never the PATH — so a native
    // opponent cannot be reconstructed without the caller supplying it. Refuse
    // loudly here rather than silently proving against fairy's wasm build at the
    // wrong skill, which is exactly how charting lost its first three attempts.
    if (opp.binary === "native" && !process.env.FAIRY_BIN) {
      throw new Error(
        `${block.id} played NATIVE fairy and the row does not store its path. ` +
          `Re-run with FAIRY_BIN=<path to fairy-stockfish> so the proof faces the same opponent.`
      );
    }
    if (opp.eval === "nnue" && !process.env.FAIRY_EVAL) {
      throw new Error(`${block.id}'s opponent used fairy's net; set FAIRY_EVAL=<path to the makruk nnue> and retry.`);
    }
  } else {
    throw new Error(`${block.id} records no opponent engine — there is nothing to reproduce`);
  }
  return { argv, env };
}

/// Run the proof and return the replayed per-game results.
function runProofBlock(block, after, games) {
  const { argv, env } = proofInvocation(block, after, games);
  const scratch = mkdtempSync(path.join(tmpdir(), "makruk-proof-")) + "/blocks.jsonl";
  try {
    execFileSync("node", [path.join(here, "match-arena.mjs"), ...argv], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // The proof must never touch the committed record. It is evidence about a
      // row, not a new row.
      env: { ...env, MAKURUK_LEDGER: scratch },
    });
    const rows = readFileSync(scratch, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const played = rows.filter((r) => !META_TYPES.has(r.type)).at(-1);
    if (!played?.perGame) throw new Error("the proof block produced no per-game results");
    return played.perGame;
  } finally {
    rmSync(path.dirname(scratch), { recursive: true, force: true });
  }
}

const gameKey = (g) => `${g.tag}/${g.plies}`;

/// Amend a block: correct how it was run, prove the correction, append the row.
///
/// `runProof` is injectable so the record's own logic can be tested without
/// spawning a single game; nothing in normal operation passes it.
export function amend(id, set, { reason, proofGames = 2, maxProofGames = 8, runProof = runProofBlock } = {}) {
  if (!reason) throw new Error("an amendment without a reason is how numbers become mysteries");
  if (!set || !Object.keys(set).length) throw new Error("an amendment that sets nothing is not an amendment");

  // Allowlist, checked first and checked hard. The map's third settled decision
  // is that an amendment may never touch an outcome, and a WARNING here would
  // make that decision advisory.
  for (const k of Object.keys(set)) {
    if (!AMENDABLE_FIELDS.has(k)) {
      throw new Error(
        `'${k}' is not amendable. An amendment corrects how a block was RUN (${[...AMENDABLE_FIELDS].join(", ")}), ` +
          `never what it scored. If the RESULT is not to be trusted, that is a retraction, not an amendment.`
      );
    }
  }

  const all = readBlocks({ includeRetracted: true, includeSuspect: true });
  const target = all.find((b) => b.id === id);
  // A meta row carries no `id`, so it can never be found here — which is the
  // answer to "can an amendment amend a clearance?". Amendments target blocks.
  if (!target) throw new Error(`no block ${id} in the ledger`);
  if (target.retraction) {
    throw new Error(
      `${id} is retracted (${target.retraction.reason}) — a retraction says the measurement is not to be trusted, ` +
        `and polishing the description of a discarded number is not a correction. Amend it only if it is un-retracted first.`
    );
  }

  const after = { ...target, ...set };
  // Decision 4 with teeth: no proof, no amendment. 44 of the ledger's 49 blocks
  // are movetime blocks and can never be replayed bit-for-bit — timing jitter
  // means the games genuinely differ run to run — so a movetime claim cannot be
  // proven and this primitive refuses it. b0010/b0012/b0013 are the live cost of
  // that rule: three sound measurements retracted for a metadata defect whose own
  // retraction reason says "the scores stand", and they stay retracted, because
  // the thing that would rescue them is engine IDENTITY, which no re-run can
  // establish.
  if (after.depth == null) {
    throw new Error(
      `${id} would still be a movetime block after this amendment, and a movetime block is never bit-reproducible ` +
        `(timing jitter changes the games). No proof is possible, so no amendment is. If the row is wrong, retract it.`
    );
  }
  if (!Array.isArray(target.perGame) || !target.perGame.length) {
    throw new Error(`${id} records no per-game results — there is nothing for a proof to match against`);
  }

  // Is the engine the same one? Checked BEFORE the games are played — refusing
  // after a 2-minute replay would be the same answer at more cost.
  const oppIsOurs = target.opponent?.engine === "ours";
  const liveOpp = oppIsOurs ? binaryId(OUR_ENGINE) : binaryId(process.env.FAIRY_BIN ?? fairyWasmPath(FAIRY_DIR));
  const engines = { mine: engineMatch(target.mine, binaryId(OUR_ENGINE)), opponent: engineMatch(target.opponent, liveOpp) };
  for (const [side, m] of Object.entries(engines)) {
    if (m.verdict === "different") {
      throw new Error(
        `${id} was played by a different ${side === "mine" ? "engine" : "opponent"}: the row names ${m.recorded}, this build is ${m.live}.\n` +
          `  A replay on a different binary is not evidence about this row. Check out the engine the row names and retry, or\n` +
          `  accept that this row can no longer be proven — in which case it can only be retracted, never amended.`
      );
    }
  }

  const games = proofWidth(target.perGame, proofGames, Math.min(maxProofGames, target.perGame.length));
  const expected = target.perGame.slice(0, games);
  const replayed = runProof(target, after, games);

  const got = replayed.slice(0, games);
  const mismatch = expected.findIndex((g, i) => gameKey(g) !== gameKey(got[i] ?? {}));
  if (got.length < games || mismatch >= 0) {
    const shown = got.length < games ? `${got.length} of ${games} games came back` : `game ${mismatch} replayed ${gameKey(got[mismatch])}, row says ${gameKey(expected[mismatch])}`;
    throw new Error(
      `proof FAILED for ${id}: ${shown}.\n` +
        `  This does NOT establish the row is wrong — it establishes the replay did not reproduce it, and a wrong\n` +
        `  environment reproduces nothing either (the row's 'armed' fields are self-reported and cannot detect a\n` +
        `  mis-set FAIRY_BIN / OPP_WEIGHTS). Check the opponent first, then the claim. Nothing was written.`
    );
  }

  const row = {
    type: "amendment",
    amends: id,
    set,
    proof: {
      games,
      seed: target.seed ?? null,
      matched: expected.map(gameKey),
      // The binary the EVIDENCE ran against, and — separately — whether that
      // could be compared to what the block ran on. `unpinned` is not a
      // weaker version of `same`; it is the honest record for every row written
      // before engine identity existed, and it stays in the ledger so a future
      // reader can tell a checked equality from an unfalsifiable one.
      engine: engines.mine.live,
      blockEngine: engines.mine.recorded,
      engineVerdict: engines.mine.verdict,
      opponentEngine: engines.opponent.live,
      opponentVerdict: engines.opponent.verdict,
    },
    reason,
    ts: new Date().toISOString(),
  };
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify(row) + "\n");
  return { target, amendment: row };
}

// ---------- presentation ----------
const pct = (b) => (b.score * 100).toFixed(1) + "%";
const sideLabel = (s) =>
  s.engine === "fairy"
    ? `fairy skill ${s.skill}${s.eval === "nnue" ? " +nnue" : ""}`
    : s.engine && s.engine !== "ours"
      ? String(s.engine)
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
    // The search condition belongs in the summary, not just the raw row. A
    // fixed-depth block and a fixed-movetime block answer different questions —
    // depth removes eval SPEED from the comparison — and rendering both as bare
    // scores invites the reader to conclude the net simply beats classic when it
    // only does so at equal depth. Rows predating the depth field say so rather
    // than claiming a movetime they did not run at (redraw ticket 02).
    b.depth != null
      ? `depth ${b.depth}`
      : b.movetime == null
        ? "— (unrecorded)"
        : `${b.movetime}/${b.opponentMovetime}ms`,
    String(b.games),
    // null W–L–D means the split was genuinely never recorded (backfilled rows).
    // Shown as "—", never reconstructed from the score fraction.
    b.w == null ? "—" : `${b.w}–${b.l}–${b.d}${b.maxPlies ? ` (${b.maxPlies} mp)` : ""}`,
    pct(b),
    // Notes stack: a row can be both amended and cleared, and hiding either
    // behind the other is how a correction becomes invisible. "amended" is the
    // marker that stops a corrected row from reading as one that was always
    // recorded right — `--all` prints what it used to say.
    [
      b.retraction ? "**RETRACTED**" : b.suspectOpen ? "**SUSPECT**" : b.clearance ? `cleared by ${b.clearance.control}` : "",
      b.amendment ? "amended" : "",
    ].filter(Boolean).join("; "),
  ]);
  const head = ["id", "kind", "ours", "opponent", "conditions", "n", "W–L–D", "score", ""];
  const out = [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`];
  for (const r of rows) out.push(`| ${r.join(" | ")} |`);
  return out.join("\n");
}

// WHAT COUNTS AS A RESULT. Real records, every one of them, and none of them a
// statement about how strong the engine is. Single source of truth for the CLI
// view and the generated AGENTS.md block — those two diverged once and put seven
// 2-game smokes into the file that is supposed to be the clean summary.
//
// `control` is here (ledger ticket 06) because a self-play control's expected
// score is 0.5 BY CONSTRUCTION — it is the engine against itself, run to prove
// the harness is symmetric. Rendering it in the same table as a Gate A verdict,
// in a column headed "score", invites exactly one misreading, and b0009 is that
// misreading sitting in AGENTS.md: net 4452 vs net 4452, 16 games, 40.6%, which
// scans as the incumbent losing badly. Nothing is wrong with b0009 — it passes
// its band. What was wrong is that it was being read as a result at all.
//
// NOT shared with `control-trigger.mjs`'s exclusion set, which after this change
// has the SAME MEMBERS FOR DIFFERENT REASONS — the most dangerous shape a pair of
// constants can take, because it looks shareable and is not. That set answers
// "what may the trigger reason over?", and a control is excluded there because
// `rung()` pools blocks into a trend and a block whose expected score is 0.5 by
// construction poisons it. Coincidental equality is not shared meaning: if a kind
// is ever added to one, that should be a decision, not a merge.
const NOT_A_RESULT = new Set(["smoke", "diag", "control"]);

function writeAgents() {
  const blocks = readBlocks().filter((b) => !NOT_A_RESULT.has(b.kind));
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
  } else if (argv.includes("--amend")) {
    guarded(() => {
      // `depth=5,movetime=null,opponentMovetime=null` — numbers and null only,
      // because every amendable field is one or the other.
      const set = {};
      for (const pair of (arg("set") ?? "").split(",").filter(Boolean)) {
        const [k, v] = pair.split("=");
        if (v === undefined) throw new Error(`--set wants field=value pairs, got '${pair}'`);
        set[k.trim()] = v.trim() === "null" ? null : Number(v);
        if (set[k.trim()] !== null && Number.isNaN(set[k.trim()])) throw new Error(`'${pair}' is not a number or null`);
      }
      const id = arg("amend");
      console.log(`proving ${id} before amending it — this replays the block's first games at the claimed conditions.`);
      const { target, amendment } = amend(id, set, {
        reason: arg("reason"),
        proofGames: Number(arg("proof-games", "2")),
      });
      console.log(`proof OK: ${amendment.proof.games} games at seed ${amendment.proof.seed} replayed ${amendment.proof.matched.join(" ")}`);
      console.log(`amended ${target.id} — ${Object.entries(set).map(([k, v]) => `${k}=${v}`).join(", ")}. The row is untouched; the correction is overlaid.`);
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
    // Controls are counted separately from the other non-results because hiding
    // them costs something the smoke/diag exclusion does not: a control is
    // EVIDENCE ABOUT the standings, and rig ticket 07 made the suspect flag
    // load-bearing precisely because a check nobody can see is a check nobody
    // trusts. So the footer below carries their VERDICT, not just their count.
    const hiddenControls = kind ? [] : blocks.filter((b) => b.kind === "control");
    const hiddenNoise = kind ? 0 : blocks.filter((b) => NOT_A_RESULT.has(b.kind) && b.kind !== "control").length;
    blocks = kind ? blocks.filter((b) => b.kind === kind) : blocks.filter((b) => !NOT_A_RESULT.has(b.kind));
    blocks.reverse();
    console.log(table(blocks));
    if (all) {
      for (const b of blocks.filter((x) => x.retraction)) {
        console.log(`\n${b.id} RETRACTED: ${b.retraction.reason}`);
      }
      // What the row physically says, beside what it now reads as. Without this
      // an amendment is indistinguishable from a row that was always recorded
      // correctly, which is the silent edit the append-only rule exists to
      // prevent.
      for (const b of blocks.filter((x) => x.amendment)) {
        const was = Object.entries(b.amendedFrom).map(([k, v]) => `${k}=${v}`).join(", ");
        const now = Object.entries(b.amendedFrom).map(([k]) => `${k}=${b[k]}`).join(", ");
        console.log(`\n${b.id} AMENDED: the row says ${was}; it reads as ${now}`);
        for (const a of b.amendments) {
          console.log(`  ${a.reason} — proven by ${a.proof.games} games at seed ${a.proof.seed} (${a.proof.matched.join(" ")})`);
        }
      }
    } else {
      const everything = readBlocks({ includeRetracted: true, includeSuspect: true });
      const hidden = everything.filter((b) => b.retraction).length;
      const suspect = everything.filter((b) => b.suspectOpen && !b.retraction);
      const notes = [];
      if (hidden) notes.push(`${hidden} retracted — --all to see them and why`);
      if (suspect.length) notes.push(`${suspect.length} SUSPECT, awaiting a control block — --all to see them`);
      // The verdict, not the count. "8 controls" tells a reader nothing they can
      // act on; "8 controls, 1 FAILING" is the whole reason controls exist.
      const controlVerdicts = hiddenControls.map((c) => ({ c, v: controlVerdict(c) }));
      const failing = controlVerdicts.filter((x) => !x.v.pass);
      if (hiddenControls.length) {
        notes.push(
          failing.length
            ? `${hiddenControls.length} controls, ${failing.length} FAILING — --kind control`
            : `${hiddenControls.length} controls, all passing — --kind control`
        );
      }
      if (hiddenNoise) notes.push(`${hiddenNoise} smoke/diag — --kind smoke or --kind diag`);
      if (notes.length) console.log(`\n(${notes.join("; ")})`);
      // A failing control is a statement about the harness, so it is never left
      // as a number in a footer — it says which block and why, the same way a
      // suspect row does below.
      for (const { c, v } of failing) console.log(`\n${c.id} CONTROL FAILED: ${v.text}`);
      for (const b of suspect) {
        console.log(`\n${b.id} SUSPECT: ${b.suspect.map((s) => `[clause ${s.clause}] ${s.reason}`).join("; ")}`);
        console.log(`  → run a control, then: node scripts/results.mjs --clear-suspect ${b.id} --control <controlId>`);
      }
    }
  }
}
