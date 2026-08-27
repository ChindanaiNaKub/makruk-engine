// Ledger audit: which rows say something that cannot be true?
//
// Mandated by `.scratch/makruk-ledger/issues/01-audit-what-cannot-be-true.md`.
//
// The amendment primitive was being designed from ONE defect — five rows that
// record `movetime 100/400` for blocks that ran `go depth N`. Designing a
// correction mechanism from a single example is how you get a mechanism that
// fixes exactly that example. This sweeps the whole record instead, and it is a
// script rather than a hand sweep because it has to be re-runnable after every
// future block (and, later, gateable).
//
// Two severities, and the difference is the whole point:
//
//   CONTRADICTION — the row's own fields cannot all be true at once, or the row
//     is contradicted by its own numbers. Exits non-zero. These are what the
//     amendment primitive exists for.
//   INCOMPLETE — a field was never recorded. That is data, not a defect: this
//     project's standing rule is that missing numbers stay visibly missing
//     rather than being reconstructed. Reported, never fatal.
//
// The audit must not need the ledger to be correct in order to read it, so a
// malformed line is a finding and a missing field is a skip — never a crash.
//
// Usage:
//   node scripts/ledger-audit.mjs              audit the committed ledger
//   node scripts/ledger-audit.mjs --verbose    + the timing-detector calibration
//   node scripts/ledger-audit.mjs --json       machine-readable findings
//   node scripts/ledger-audit.mjs --gate       fail only on contradictions NOT in the baseline
//   node scripts/ledger-audit.mjs --write-baseline    accept today's as pre-existing
//   MAKURUK_LEDGER=/tmp/x.jsonl node scripts/ledger-audit.mjs

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The same judgment the rig itself uses. An audit that re-implemented the
// control band would be checking its own opinion, not the rig's.
import { controlVerdict } from "./control-trigger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const LEDGER = process.env.MAKURUK_LEDGER || path.join(root, "results", "blocks.jsonl");

const KNOWN_TYPES = new Set(["retraction", "clearance", "amendment"]);
// Kept in step with results.mjs's AMENDABLE_FIELDS. Duplicated rather than
// imported on purpose: the audit's job is to check the record against what the
// rules SAY, and a check that imports the implementation it is checking agrees
// with itself by construction.
const AMENDABLE_FIELDS = new Set(["depth", "movetime", "opponentMovetime"]);
const SPRT_DECISIONS = new Set(["accept-h0", "accept-h1", "inconclusive", "no-decision-at-exit"]);
const MAX_PLIES = 400; // match-arena.mjs:45

// ---------------------------------------------------------------------------
// Tolerant read. Rows are returned with their line number so a finding can name
// the physical line even when the row has no id to name it by.
// ---------------------------------------------------------------------------
function readLedger() {
  if (!existsSync(LEDGER)) return { rows: [], unparseable: [] };
  const rows = [];
  const unparseable = [];
  const lines = readFileSync(LEDGER, "utf8").split("\n");
  lines.forEach((text, i) => {
    if (!text.trim()) return;
    try {
      rows.push({ ...JSON.parse(text), _line: i + 1 });
    } catch (e) {
      unparseable.push({ line: i + 1, text: text.slice(0, 120), error: e.message });
    }
  });
  return { rows, unparseable };
}

// ---------------------------------------------------------------------------
// The timing detector.
//
// Under `go movetime`, a move costs its budget: the engine searches until its
// clock runs out. A game of P plies therefore costs about P x (mine + opponent)
// / 2 ms, and — this is what makes it a detector rather than an estimate —
// CONTENTION DOES NOT CHANGE THAT. Engines at fixed movetime search fewer nodes
// when they contend, they do not take longer (rig ticket 01). So the ratio of
// recorded game time to claimed budget is tight across the whole ledger, and a
// row whose ratio is outside the band did not run at the movetime it claims.
//
// Measured over the 31 blocks that record every field needed: 0.796 to 0.942.
// Each edge is placed at the MIDPOINT of the gap between that population and the
// nearest row it convicts — 0.75 between b0029 (0.796) and b0042 (0.707), 0.99
// between b0033 (0.942) and b0043 (1.042). Centring matters more on the ceiling
// than it looks: the honest population runs UNDER 1.0 because engines return a
// little under budget, and nothing anchors the upper edge to a mechanism, so a
// ceiling parked just above the observed maximum would convict the next honest
// block that happened to run slightly long.
//
// The margins are ~0.05, which is not much. The report prints the passing
// population's observed range on every --verbose run for exactly that reason: a
// future block landing outside this band by a hair should recalibrate these
// constants, not be convicted by them.
//
// RECALIBRATED 2026-08-26 (integration ticket 01), by the rule in the paragraph
// above rather than against it: the first blocks at site movetimes landed at
// 0.991 (b0065) and 0.937 (b0066) — over the old ceiling by seven
// ten-thousandths in the control's case, which refused the next block outright.
// The mechanism is the one the original note implies but did not extrapolate:
// fixed per-move overhead is a smaller FRACTION of an 850 ms budget than of a
// 100 ms one, so honest ratios rise toward 1.0 as the clock lengthens. New
// ceiling = midpoint between the new honest maximum (0.9908) and the nearest
// historically convicted value (b0043, 1.042): 1.016.
// ---------------------------------------------------------------------------
const TIMING_BAND = { lo: 0.75, hi: 1.016 };

function timingRatio(b) {
  const pg = b.perGame;
  if (!Array.isArray(pg) || !pg.length) return null;
  // A `measure` row's opponent is a NAMED EXTERNAL engine that does not honor
  // `go movetime` (integration ticket 01 — the site heuristic bot governs itself
  // via persona maxMs). The prediction below assumes both sides are
  // movetime-bound; against such an opponent it is not merely wrong, it is
  // wrong in a direction nothing here can calibrate, so the invariant does not
  // apply rather than applying loosely.
  if (b.kind === "measure") return null;
  if (b.gameTimeS == null || b.movetime == null || b.opponentMovetime == null) return null;
  // Opening plies are played from the book, not searched, so they cost nothing.
  const open = b.openingPlies ?? 0;
  const searched = pg.reduce((a, g) => a + Math.max(0, (g.plies ?? 0) - open), 0);
  const predictedS = (searched * (b.movetime + b.opponentMovetime)) / 2 / 1000;
  if (predictedS <= 0) return null;
  return { ratio: b.gameTimeS / predictedS, predictedS, observedS: b.gameTimeS, games: pg.length };
}

// ---------------------------------------------------------------------------
// The determinism detector.
//
// With `--opening-plies N`, games 2k and 2k+1 are the SAME opening with colours
// reversed. When both sides run the same engine and eval, and the search is
// fixed-depth, the two games are the same game mirrored — identical ply counts,
// mirrored results. At fixed movetime they cannot be: timing jitter makes a
// movetime block un-reproducible, which is precisely why 44 of this ledger's
// blocks can never be proven by re-running them.
//
// So a self-play block that claims movetime and replays its own pairs exactly
// did not run at movetime. No threshold, no calibration — a mechanism.
// ---------------------------------------------------------------------------
function pairedDeterminism(b) {
  const pg = b.perGame;
  if (!Array.isArray(pg) || pg.length < 4) return null;
  if (!(b.openingPlies > 0)) return null;
  const m = b.mine ?? {};
  const o = b.opponent ?? {};
  const identicalSides =
    o.engine === "ours" && m.engine === "ours" && m.eval === o.eval && (m.weights ?? null) === (o.weights ?? null);
  if (!identicalSides) return null;
  let pairs = 0;
  let same = 0;
  for (let i = 0; i + 1 < pg.length; i += 2) {
    pairs++;
    if (pg[i].plies === pg[i + 1].plies) same++;
  }
  return pairs ? { pairs, same, fraction: same / pairs } : null;
}

// Honest self-play movetime controls land at 0/10, 0/8, 1/60, 0/10, 2/10 — ply
// counts collide by chance. Two thirds is far outside that and far below the
// 10/10 a deterministic block produces.
const DETERMINISM_FRACTION = 0.6;

/// What search condition a row can be SHOWN to have run under, as opposed to
/// what it claims. Used to check that a clearance's control ran the same
/// plumbing as the block it vouches for.
function effectiveCondition(b) {
  if (b.depth != null) return { kind: "depth", label: `depth ${b.depth}`, proven: true };
  const det = pairedDeterminism(b);
  if (det && det.fraction >= DETERMINISM_FRACTION) {
    return { kind: "deterministic", label: `deterministic (${det.same}/${det.pairs} pairs replay exactly)`, proven: true };
  }
  if (b.movetime != null) return { kind: "movetime", label: `${b.movetime}/${b.opponentMovetime}ms`, proven: false };
  return { kind: "unrecorded", label: "unrecorded", proven: false };
}

// ---------------------------------------------------------------------------
// Checks. Each pushes { id, invariant, says, contradicts, severity, class }.
// ---------------------------------------------------------------------------
function audit() {
  const { rows, unparseable } = readLedger();
  const findings = [];
  const notes = [];
  const add = (f) => findings.push({ severity: "contradiction", ...f });
  const note = (f) => notes.push({ severity: "incomplete", ...f });

  for (const u of unparseable) {
    add({
      id: `line ${u.line}`,
      invariant: "parseable-row",
      says: u.text,
      contradicts: `not valid JSON: ${u.error}`,
      class: "unreadable",
    });
  }

  const metas = rows.filter((r) => r.type != null);

  // Amendments are overlaid BEFORE any check reads a block, for the same reason
  // readBlocks overlays them: a clearance's validity is derived from fields an
  // amendment can change (b0041 clears b0040, and whether that clearance is
  // sound depends on both rows' search conditions matching). An audit that read
  // the raw row would keep convicting a row that has already been corrected —
  // and would be caching what it should re-derive.
  const amendments = new Map();
  for (const m of metas) {
    if (m.type !== "amendment" || !m.amends) continue;
    if (!amendments.has(m.amends)) amendments.set(m.amends, []);
    amendments.get(m.amends).push(m);
  }
  const blocks = rows
    .filter((r) => r.type == null)
    .map((b) => {
      const applied = amendments.get(b.id) ?? [];
      if (!applied.length) return b;
      const out = { ...b, _amended: {} };
      for (const a of applied) {
        for (const [k, v] of Object.entries(a.set ?? {})) {
          if (!(k in out._amended)) out._amended[k] = b[k] ?? null;
          out[k] = v;
        }
      }
      return out;
    });
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const retractions = new Map();
  const clearances = new Map();
  for (const m of metas) {
    if (m.type === "retraction") {
      if (retractions.has(m.retracts)) {
        add({
          id: m.retracts,
          invariant: "retraction-unique",
          says: `retracted twice (line ${retractions.get(m.retracts)._line} and line ${m._line})`,
          contradicts: "a block can only be withdrawn from the record once",
          class: "meta-integrity",
        });
      }
      retractions.set(m.retracts, m);
    } else if (m.type === "clearance") {
      clearances.set(m.clears, m);
    }
  }

  // ---- meta rows ----
  for (const m of metas) {
    if (!KNOWN_TYPES.has(m.type)) {
      add({
        id: `line ${m._line}`,
        invariant: "known-meta-type",
        says: `type: ${JSON.stringify(m.type)}`,
        contradicts: `readBlocks() overlays only ${[...KNOWN_TYPES].join(" and ")}; an unknown type is silently read as a BLOCK`,
        class: "meta-integrity",
      });
      continue;
    }
    const targetId = m.type === "retraction" ? m.retracts : m.type === "amendment" ? m.amends : m.clears;
    if (!targetId || !byId.has(targetId)) {
      add({
        id: `line ${m._line}`,
        invariant: "meta-target-exists",
        says: `${m.type} of ${JSON.stringify(targetId)}`,
        contradicts: "no block with that id is in the ledger",
        class: "meta-integrity",
      });
      continue;
    }
    if (m.type === "retraction" && !m.reason) {
      add({
        id: targetId,
        invariant: "retraction-has-reason",
        says: "retraction with no reason",
        contradicts: "a retraction without a reason is how numbers become mysteries (results.mjs:142)",
        class: "meta-integrity",
      });
    }
    // An amendment is the one meta row that CHANGES what a block says, so the
    // audit has to police it as hard as it polices a block. All three of these
    // are refused by results.mjs at write time; they are checked again here
    // because a row can also arrive by hand, and because a guard that only runs
    // at the one door everyone is supposed to use is a guard on the honest path.
    if (m.type === "amendment") {
      for (const k of Object.keys(m.set ?? {})) {
        if (!AMENDABLE_FIELDS.has(k)) {
          add({
            id: targetId,
            invariant: "amendment-fields-allowed",
            says: `amendment sets ${k}`,
            contradicts: `an amendment corrects how a block was RUN (${[...AMENDABLE_FIELDS].join(", ")}), never what it scored`,
            class: "meta-integrity",
          });
        }
      }
      if (!Object.keys(m.set ?? {}).length) {
        add({ id: targetId, invariant: "amendment-sets-something", says: "amendment with an empty set", contradicts: "nothing is corrected", class: "meta-integrity" });
      }
      if (!m.reason) {
        add({ id: targetId, invariant: "amendment-has-reason", says: "amendment with no reason", contradicts: "an amendment without a reason is how numbers become mysteries", class: "meta-integrity" });
      }
      // The rule with teeth: no proof, no amendment. A row that cannot be
      // reproduced can only be retracted.
      if (!m.proof?.games || !Array.isArray(m.proof?.matched) || !m.proof.matched.length) {
        add({
          id: targetId,
          invariant: "amendment-has-proof",
          says: `amendment: ${JSON.stringify(m.set)}`,
          contradicts: "no proof recorded — an amendment that was never reproduced is an edit with extra steps",
          class: "meta-integrity",
        });
      }
      // Retracted-AND-amended is not itself a contradiction, and this is the one
      // place it differs from clearance: a clearance says "this row rejoins the
      // view", which a retraction directly denies, whereas an amendment only says
      // "its description was wrong" — a claim a later retraction has no quarrel
      // with. Correcting a row and then discovering it was unsound is an ordinary
      // history. What IS a contradiction is an amendment written after the
      // retraction: amend() refuses that (a discarded number is not worth
      // polishing), so such a row got in by hand.
      const r = retractions.get(targetId);
      if (r && r._line < m._line) {
        add({
          id: targetId,
          invariant: "amendment-after-retraction",
          says: `amendment on line ${m._line}: ${JSON.stringify(m.set)}`,
          contradicts: `the row was retracted on line ${r._line} (${r.reason?.slice(0, 50)}…) — a retracted measurement is not to be trusted, so its description is moot`,
          class: "meta-integrity",
        });
      }
      continue;
    }
    if (m.type !== "clearance") continue;

    const target = byId.get(targetId);
    const control = m.control ? byId.get(m.control) : null;
    if (!control) {
      add({
        id: targetId,
        invariant: "clearance-names-a-control",
        says: `cleared by ${JSON.stringify(m.control)}`,
        contradicts: "no block with that id is in the ledger",
        class: "meta-integrity",
      });
      continue;
    }
    if (!target.suspect?.length) {
      add({
        id: targetId,
        invariant: "clearance-target-was-suspect",
        says: `cleared by ${control.id}`,
        contradicts: "the row carries no suspect entry — there was nothing to clear",
        class: "meta-integrity",
      });
    }
    if (retractions.has(targetId)) {
      add({
        id: targetId,
        invariant: "not-both-retracted-and-cleared",
        says: `cleared by ${control.id}`,
        contradicts: `also retracted: ${retractions.get(targetId).reason?.slice(0, 60)}…`,
        class: "meta-integrity",
      });
    }
    if (control.kind !== "control") {
      add({
        id: targetId,
        invariant: "clearance-control-is-a-control",
        says: `cleared by ${control.id}`,
        contradicts: `${control.id} is kind '${control.kind}'`,
        class: "meta-integrity",
      });
    } else if (control.score != null) {
      const v = controlVerdict(control);
      if (!v.pass) {
        add({
          id: targetId,
          invariant: "clearance-control-passed",
          says: `cleared by ${control.id}`,
          contradicts: v.text,
          class: "meta-integrity",
        });
      }
    }
    // A control vouches for PLUMBING, so it has to have run the plumbing the
    // block ran. A movetime control vouching for a fixed-depth block validates
    // machinery the block never used — strictly worse than no control, because
    // it reads as a pass. (match-arena.mjs:409 now forces the match; these are
    // the rows written before it did.)
    const tc = effectiveCondition(target);
    const cc = effectiveCondition(control);
    if (tc.kind !== cc.kind || (tc.kind === "depth" && target.depth !== control.depth) ||
        (tc.kind === "movetime" && (target.movetime !== control.movetime || target.opponentMovetime !== control.opponentMovetime))) {
      add({
        id: targetId,
        invariant: "clearance-condition-matches",
        says: `row claims ${tc.label}, cleared by ${control.id}`,
        contradicts: `${control.id} ran ${cc.label} — the control validated plumbing this block did not use`,
        class: "search-condition",
      });
    }
  }

  // ---- blocks ----
  const timing = [];
  for (const b of blocks) {
    const id = b.id ?? `line ${b._line}`;
    const n = b.games;

    // -- row arithmetic. Cheap, and the floor everything else stands on. --
    if (b.w != null && b.l != null && b.d != null && n != null) {
      const sum = b.w + b.l + b.d + (b.maxPlies ?? 0) + (b.errors ?? 0);
      if (sum !== n) {
        add({
          id,
          invariant: "outcome-sum",
          says: `games ${n}, W-L-D ${b.w}-${b.l}-${b.d} + ${b.maxPlies ?? 0} mp + ${b.errors ?? 0} err`,
          contradicts: `those account for ${sum} games`,
          class: "arithmetic",
        });
      }
      const played = n - (b.errors ?? 0);
      if (played > 0 && b.score != null) {
        const expect = (b.w + 0.5 * (b.d + (b.maxPlies ?? 0))) / played;
        if (Math.abs(expect - b.score) > 1e-9) {
          add({
            id,
            invariant: "score-arithmetic",
            says: `score ${b.score}`,
            contradicts: `the split implies ${expect}`,
            class: "arithmetic",
          });
        }
      }
    }
    if (b.score != null && (b.score < 0 || b.score > 1)) {
      add({ id, invariant: "score-range", says: `score ${b.score}`, contradicts: "a score fraction lives in [0,1]", class: "arithmetic" });
    }
    if (Array.isArray(b.perGame) && n != null) {
      const played = n - (b.errors ?? 0);
      if (b.perGame.length !== played) {
        add({
          id,
          invariant: "pergame-count",
          says: `${b.perGame.length} per-game records`,
          contradicts: `${n} games minus ${b.errors ?? 0} errors is ${played}`,
          class: "arithmetic",
        });
      }
      const tally = { MINE: 0, FAIRY: 0, DRAW: 0, MAXPLY: 0 };
      for (const g of b.perGame) {
        if (g.tag in tally) tally[g.tag]++;
        // MAXPLY is the arena's name for "neither side converted in 400 plies",
        // so the tag and the ply count are the same fact stated twice.
        if ((g.tag === "MAXPLY") !== (g.plies === MAX_PLIES)) {
          add({
            id,
            invariant: "maxply-tag",
            says: `a game tagged ${g.tag} at ${g.plies} plies`,
            contradicts: `MAXPLY means exactly ${MAX_PLIES} plies and ${MAX_PLIES} plies means MAXPLY`,
            class: "arithmetic",
          });
        }
      }
      if (b.w != null && (tally.MINE !== b.w || tally.FAIRY !== b.l || tally.DRAW !== b.d || tally.MAXPLY !== (b.maxPlies ?? 0))) {
        add({
          id,
          invariant: "pergame-tally",
          says: `W-L-D ${b.w}-${b.l}-${b.d} + ${b.maxPlies ?? 0} mp`,
          contradicts: `per-game tags tally ${tally.MINE}-${tally.FAIRY}-${tally.DRAW} + ${tally.MAXPLY} mp`,
          class: "arithmetic",
        });
      }
    }

    // -- search condition: the defect this map was chartered on --
    if (b.depth != null && b.movetime != null) {
      add({
        id,
        invariant: "search-condition-exclusive",
        says: `depth ${b.depth} AND movetime ${b.movetime}/${b.opponentMovetime}ms`,
        contradicts: "under --depth, goCmd sends `go depth N` to both engines and ignores both ms values (match-arena.mjs:44)",
        class: "search-condition",
      });
    }
    if (b.depth == null && b.movetime == null && b.kind != null) {
      note({
        id,
        invariant: "search-condition-recorded",
        says: "neither depth nor movetime",
        contradicts: "the row cannot say what governed the search; table() renders it '— (unrecorded)'",
        class: "incomplete",
      });
    }

    const t = timingRatio(b);
    if (t) {
      timing.push({ id, ...t });
      if (t.ratio < TIMING_BAND.lo || t.ratio > TIMING_BAND.hi) {
        add({
          id,
          invariant: "timing-arithmetic",
          says: `movetime ${b.movetime}/${b.opponentMovetime}ms over ${t.games} games`,
          contradicts:
            `that budget implies ${t.predictedS.toFixed(0)}s of game time; the row records ${t.observedS}s ` +
            `(ratio ${t.ratio.toFixed(2)}, band ${TIMING_BAND.lo}–${TIMING_BAND.hi})`,
          class: "search-condition",
        });
      }
    }

    const det = pairedDeterminism(b);
    if (det && det.fraction >= DETERMINISM_FRACTION && b.depth == null && b.movetime != null) {
      add({
        id,
        invariant: "movetime-is-not-reproducible",
        says: `movetime ${b.movetime}/${b.opponentMovetime}ms`,
        contradicts:
          `${det.same} of ${det.pairs} colour-reversed pairs replay to the same ply — ` +
          `timing jitter cannot produce that, so the search was not time-bound`,
        class: "search-condition",
      });
    }

    // -- kind against what the row says it played --
    const opp = b.opponent ?? {};
    if (b.kind === "gate-a" && opp.engine !== "ours") {
      add({ id, invariant: "kind-matches-opponent", says: `kind gate-a`, contradicts: `opponent.engine is '${opp.engine ?? "absent"}' — gate-a is head-to-head against ourselves (match-arena.mjs:465)`, class: "identity" });
    }
    if (b.kind === "gate-b" && opp.engine !== "fairy") {
      add({ id, invariant: "kind-matches-opponent", says: `kind gate-b`, contradicts: `opponent.engine is '${opp.engine ?? "absent"}' — gate-b is the ladder against fairy (match-arena.mjs:465)`, class: "identity" });
    }
    if (b.kind === "measure" && ["ours", "fairy"].includes(opp.engine ?? "")) {
      add({ id, invariant: "kind-matches-opponent", says: `kind measure`, contradicts: `opponent.engine is '${opp.engine ?? "absent"}' — measure is for a NAMED external opponent played through FAIRY_BIN`, class: "identity" });
    }
    if (b.kind === "control") {
      const m = b.mine ?? {};
      const identical = opp.engine === "ours" && m.eval === opp.eval && (m.weights ?? null) === (opp.weights ?? null);
      if (!identical) {
        add({
          id,
          invariant: "control-sides-identical",
          says: `kind control`,
          contradicts: `mine ${m.eval}/${m.weights ?? "-"} vs opponent ${opp.engine}/${opp.eval}/${opp.weights ?? "-"} — a control's true score is 0.5 only because the sides are the same`,
          class: "identity",
        });
      }
      // Identical engines and a 4x time handicap is not a control of anything.
      if (b.depth == null && b.movetime != null && b.movetime !== b.opponentMovetime) {
        add({
          id,
          invariant: "control-time-symmetric",
          says: `kind control at ${b.movetime}/${b.opponentMovetime}ms`,
          contradicts: "identical engines with one side on 4x the clock have no 50% expectation to test against",
          class: "identity",
        });
      }
      if (b.score != null && !retractions.has(b.id)) {
        const v = controlVerdict(b);
        if (!v.pass) {
          add({ id, invariant: "control-passes-its-own-band", says: `kind control, score ${(100 * b.score).toFixed(1)}%`, contradicts: v.text, class: "identity" });
        }
      }
    }

    // -- which engine played (ledger ticket 03) --
    // `engineCommit` is provenance and 48 of 49 rows are `engineDirty`, so it
    // cannot identify what ran. A missing hash is INCOMPLETE, never a
    // contradiction: every row written before 2026-08-03 lacks it, they can
    // never be pinned retroactively, and a guard that convicts the whole
    // historical record is a guard that gets turned off.
    for (const side of ["mine", "opponent"]) {
      if (b[side] && b[side].engineId == null && b.kind != null) {
        note({ id, invariant: "engine-identified", says: `no engineId for ${side}`, contradicts: "this row predates engine identity, so a proof against it cannot check what it ran on", class: "incomplete" });
      }
    }
    // A CONTROL is self-play by construction, so its 0.5 expectation only holds
    // when both sides are the same binary. Narrowed from "any opponent of engine
    // 'ours'" on 2026-08-03: OPP_BIN makes a Gate A between two different builds
    // legitimate, and that is exactly how an `src/` change gets measured.
    if (b.kind === "control" && b.mine?.engineId && b.opponent?.engineId && b.mine.engineId !== b.opponent.engineId) {
      add({
        id,
        invariant: "control-same-binary",
        says: `control: mine ${b.mine.engineId}, opponent ${b.opponent.engineId}`,
        contradicts: "a control's 0.5 expectation is only true when both sides are the same binary",
        class: "identity",
      });
    }

    // -- armed vs requested eval --
    for (const side of ["mine", "opponent"]) {
      const s = b[side];
      if (!s || s.engine !== "ours") continue;
      if (s.armed == null) {
        note({ id, invariant: "armed-recorded", says: `no armed for ${side}`, contradicts: "this row predates evalinfo, so a silent net→classic fallback is unauditable here", class: "incomplete" });
        continue;
      }
      const armedIsNet = String(s.armed).startsWith("net ");
      if (armedIsNet !== (s.eval === "net")) {
        add({ id, invariant: "armed-matches-eval", says: `${side} eval ${s.eval}`, contradicts: `the engine armed ${JSON.stringify(s.armed)}`, class: "identity" });
      } else if (s.eval === "net" && s.weights && !String(s.armed).includes(s.weights)) {
        add({ id, invariant: "armed-matches-weights", says: `${side} weights ${s.weights}`, contradicts: `the engine armed ${JSON.stringify(s.armed)}`, class: "identity" });
      }
    }

    // -- the field that decides accept/reject --
    if (b.sprt) {
      if (!SPRT_DECISIONS.has(b.sprt.decision)) {
        add({ id, invariant: "sprt-decision-known", says: `sprt.decision ${JSON.stringify(b.sprt.decision)}`, contradicts: `sprt.mjs emits only ${[...SPRT_DECISIONS].join(", ")}`, class: "arithmetic" });
      }
      // A pair is two games. The block can hold MORE games than pairs x 2 —
      // games already in flight when a bound is crossed still finish and are
      // counted — but never fewer.
      if (b.sprt.pairs != null && n != null && b.sprt.pairs * 2 > n) {
        add({ id, invariant: "sprt-pairs-vs-games", says: `${b.sprt.pairs} SPRT pairs over ${n} games`, contradicts: `${b.sprt.pairs} pairs need ${b.sprt.pairs * 2} games`, class: "arithmetic" });
      }
      if (b.sprt.maxPairs != null && b.sprt.pairs > b.sprt.maxPairs) {
        add({ id, invariant: "sprt-cap-held", says: `${b.sprt.pairs} pairs`, contradicts: `the cap was ${b.sprt.maxPairs}`, class: "arithmetic" });
      }
    }

    // -- concurrency against the clock --
    if (b.wallClockS != null && b.gameTimeS != null && b.concurrency != null) {
      // Perfect parallelism is the floor: N slots cannot finish more than N
      // seconds of game per second. 1s of slack absorbs the integer rounding
      // both figures get in match-arena.
      const floor = b.gameTimeS / b.concurrency;
      if (b.wallClockS + 1 < floor) {
        add({
          id,
          invariant: "wallclock-vs-concurrency",
          says: `${b.gameTimeS}s of game time at concurrency ${b.concurrency} in ${b.wallClockS}s wall-clock`,
          contradicts: `${b.concurrency} slots need at least ${floor.toFixed(0)}s`,
          class: "arithmetic",
        });
      }
      if (b.concurrency > 1 && b.wallClockS > b.gameTimeS + 1) {
        note({
          id,
          invariant: "wallclock-vs-gametime",
          says: `wall-clock ${b.wallClockS}s exceeds ${b.gameTimeS}s of game time at concurrency ${b.concurrency}`,
          contradicts: "setup (engine spawn, opening generation) dominated the block",
          class: "incomplete",
        });
      }
    }

    // -- rows that were never complete --
    for (const f of ["perGame", "concurrency", "wallClockS", "gameTimeS"]) {
      if (b[f] == null && b.kind != null) {
        note({ id, invariant: "row-complete", says: `no ${f}`, contradicts: b.backfilled ? "backfilled row — reconstructed from prose, never had one" : "every block written by the arena records it", class: "incomplete" });
      }
    }
    if (b.w == null) {
      note({ id, invariant: "outcome-recorded", says: "no W/L/D", contradicts: "rendered '—' and never reconstructed from the score fraction (results.mjs:185)", class: "incomplete" });
    }
  }

  // -- suspect reasons: is the comparison the row quotes still true? --
  // Each `suspect` entry quotes a number ("X% is Npp from the Y% previously
  // measured at this exact cell"). Y was computed by pooling every LIVE prior
  // block at the same (artifact, opponent) cell — regardless of search
  // condition. Two things can be wrong with that stored text, and they are
  // different defects: the number may no longer be reproducible from the ledger
  // at all, or it may be reproducible but pooled across blocks that were never
  // measuring the same thing.
  const artifactOf = (b) => (b.mine?.eval === "net" ? `net:${b.mine.weights}` : "classic");
  // Kept in step with control-trigger.mjs's rung(): named external opponents
  // get their own ext: cells there, so the recomputation here must pool the
  // same way or a stored suspect reason would fail to reproduce for a reason
  // that is not one.
  const rungOf = (b) =>
    b.opponent?.engine === "fairy"
      ? `fairy:${b.opponent.skill}:${b.opponent.eval}`
      : b.opponent?.engine === "ours"
        ? `ours:${b.opponent?.eval}:${b.opponent?.weights ?? "-"}`
        : `ext:${b.opponent?.engine ?? "?"}`;
  const conditionOf = (b) => (b.depth != null ? `depth ${b.depth}` : `${b.movetime}/${b.opponentMovetime}ms`);
  const NOISE = new Set(["smoke", "diag", "control"]);
  // readBlocks()' default view, which is what postChecks() saw: retracted rows
  // and uncleared suspects are both out.
  const live = (p) => !retractions.has(p.id) && !(p.suspect?.length && !clearances.has(p.id));
  for (const b of blocks) {
    if (!b.suspect?.length) continue;
    const idx = blocks.indexOf(b);
    const prior = blocks.slice(0, idx).filter((p) => live(p) && !NOISE.has(p.kind) && p.score != null);
    const cell = prior.filter((p) => artifactOf(p) === artifactOf(b) && rungOf(p) === rungOf(b));
    if (!cell.length) continue;
    const mean = cell.reduce((a, p) => a + p.score, 0) / cell.length;
    const conds = [...new Set(cell.map(conditionOf))];
    for (const s of b.suspect) {
      const quoted = /from the ([\d.]+)% previously measured at this exact cell/.exec(s.reason ?? "");
      if (s.clause !== "a" || !quoted) continue;
      if (Math.abs(Number(quoted[1]) - 100 * mean) > 0.05) {
        add({
          id: b.id,
          invariant: "suspect-reason-reproducible",
          says: `"${s.reason}"`,
          contradicts:
            `the live ledger gives ${(100 * mean).toFixed(1)}% at that cell (${cell.map((p) => p.id).join(", ")}), ` +
            `not ${quoted[1]}%`,
          class: "suspect-reason",
        });
      }
      if (conds.length > 1 || conds[0] !== conditionOf(b)) {
        add({
          id: b.id,
          invariant: "suspect-reason-comparable",
          says: `"${s.reason}"`,
          contradicts:
            `"this exact cell" is ${cell.map((p) => `${p.id} (${conditionOf(p)})`).join(", ")} while this block ` +
            `claims ${conditionOf(b)} — the quoted average is over blocks run under a different search condition`,
          class: "suspect-reason",
        });
      }
    }
  }

  return { findings, notes, timing, blocks, metas, retracted: new Set(retractions.keys()) };
}

// ---------------------------------------------------------------------------
const CLASS_TITLES = {
  unreadable: "Unreadable rows",
  arithmetic: "Row arithmetic",
  "search-condition": "Search condition — what the block was actually run at",
  identity: "Identity — which engine played, and which block this is",
  "meta-integrity": "Meta rows — retractions and clearances",
  "suspect-reason": "Suspect reasons — comparisons stored in the row",
  incomplete: "Never recorded",
};

// ---------------------------------------------------------------------------
// The baseline (ledger ticket 04).
//
// The audit cannot be a hard gate on day one: it convicts 15 real contradictions
// today, [Amend the five](05) has not landed, and b0010 is PERMANENTLY in
// violation — it is a movetime row that contradicts itself, so it can never be
// proven and can only stay retracted. A gate that fails on all of that is a gate
// switched off within a day, which is how the prose-in-AGENTS.md convention died.
//
// So the gate holds a baseline: the contradictions known and accepted the day it
// was armed. It fails only on something NEW. This is the standard way a linter
// gets adopted on a record that predates it — it protects from here forward
// immediately, instead of waiting for a cleanup that may take several tickets,
// and it makes that cleanup visible: every amendment shrinks the baseline.
// ---------------------------------------------------------------------------
const BASELINE = process.env.MAKURUK_AUDIT_BASELINE || path.join(root, "results", "audit-baseline.json");
const key = (f) => `${f.id}:${f.invariant}`;

function readBaseline() {
  if (!existsSync(BASELINE)) return null;
  try {
    return new Set(JSON.parse(readFileSync(BASELINE, "utf8")).accepted ?? []);
  } catch {
    return null;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const { findings, notes, timing, blocks, metas, retracted } = audit();

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ findings, notes, timing }, null, 2));
    process.exit(findings.length ? 1 : 0);
  }

  if (argv.includes("--write-baseline")) {
    const accepted = findings.map(key).sort();
    writeFileSync(BASELINE, JSON.stringify({ accepted, writtenAt: new Date().toISOString() }, null, 2) + "\n");
    console.log(`baseline written: ${accepted.length} contradiction(s) accepted as pre-existing.`);
    console.log(`Anything new fails the gate. Every one of these that gets amended should be removed from this file.`);
    process.exit(0);
  }

  if (argv.includes("--gate")) {
    const accepted = readBaseline();
    if (!accepted) {
      console.error(`[gate:ledger-audit] no baseline at ${path.relative(root, BASELINE)} — run: node scripts/ledger-audit.mjs --write-baseline`);
      process.exit(1);
    }
    const fresh = findings.filter((f) => !accepted.has(key(f)));
    const healed = [...accepted].filter((k) => !findings.some((f) => key(f) === k));
    if (healed.length) {
      // Not a failure — the point of the baseline is that it shrinks. Said out
      // loud so nobody has to diff a JSON file to notice progress.
      console.log(`[gate:ledger-audit] ${healed.length} baseline contradiction(s) no longer fire: ${healed.join(", ")}`);
      console.log(`  Remove them from ${path.relative(root, BASELINE)} so the gate keeps ratcheting.`);
    }
    if (!fresh.length) {
      console.log(`[gate:ledger-audit] no NEW contradictions (${findings.length} pre-existing, accepted).`);
      process.exit(0);
    }
    console.error(`[gate:ledger-audit] ${fresh.length} NEW contradiction(s) — not in the baseline:`);
    for (const f of fresh) console.error(`  ${f.id} ${f.invariant}: ${f.says} — contradicts: ${f.contradicts}`);
    process.exit(1);
  }

  console.log(`ledger: ${path.relative(root, LEDGER)} — ${blocks.length} blocks, ${metas.length} meta rows\n`);

  const byClass = new Map();
  for (const f of findings) byClass.set(f.class, [...(byClass.get(f.class) ?? []), f]);
  for (const [cls, list] of byClass) {
    console.log(`## ${CLASS_TITLES[cls] ?? cls} — ${list.length}`);
    for (const f of list) {
      // A contradiction in a retracted row is already out of the default view,
      // so it is a different problem from the same contradiction in a live one.
      const status = retracted.has(f.id) ? " [retracted]" : "";
      console.log(`  ${String(f.id).padEnd(7)} ${f.invariant.padEnd(28)} says: ${f.says}${status}`);
      console.log(`  ${" ".repeat(7)} ${" ".repeat(28)} contradicts: ${f.contradicts}`);
    }
    console.log("");
  }

  if (notes.length) {
    // Grouped, not listed: 30 lines of "b0001 has no perGame" buries the seven
    // findings above it, and incompleteness is a property of a row, not an event.
    const byRow = new Map();
    for (const n of notes) byRow.set(n.id, [...(byRow.get(n.id) ?? []), n]);
    console.log(`## ${CLASS_TITLES.incomplete} — ${notes.length} across ${byRow.size} row${byRow.size === 1 ? "" : "s"} (not defects)`);
    for (const [id, list] of byRow) {
      console.log(`  ${String(id).padEnd(7) } ${list.map((n) => n.says).join(", ")}`);
    }
    console.log("");
  }

  if (argv.includes("--verbose")) {
    const passing = timing.filter((t) => t.ratio >= TIMING_BAND.lo && t.ratio <= TIMING_BAND.hi).map((t) => t.ratio);
    console.log(`## Timing detector calibration — ${timing.length} blocks carry every field it needs`);
    console.log(`   band ${TIMING_BAND.lo}–${TIMING_BAND.hi}; the ${passing.length} passing blocks span ` +
      `${Math.min(...passing).toFixed(3)}–${Math.max(...passing).toFixed(3)}`);
    for (const t of [...timing].sort((a, b) => a.ratio - b.ratio)) {
      const flag = t.ratio < TIMING_BAND.lo || t.ratio > TIMING_BAND.hi ? " <<<" : "";
      console.log(`   ${t.id}  ratio ${t.ratio.toFixed(3)}  (${t.observedS}s recorded vs ${t.predictedS.toFixed(0)}s claimed)${flag}`);
    }
    // Not a check — a control's PASS is only worth what its band is narrow
    // enough to exclude, and that band is computed from the block's own split.
    // A control with few draws gets a wide band and can pass while being far
    // from 50%. Printed so the power of each pass is visible, not assumed.
    console.log(`\n## Control blocks — what each PASS actually excluded`);
    for (const b of blocks.filter((x) => x.kind === "control" && x.score != null)) {
      const v = controlVerdict(b);
      console.log(
        `   ${b.id}  ${(100 * b.score).toFixed(1)}% over ${String(b.games).padStart(3)} games  ` +
          `band ±${(100 * v.band).toFixed(1)}pp  ${v.pass ? "pass" : "FAIL"}` +
          `${retracted.has(b.id) ? " (retracted)" : ""}`
      );
    }
    console.log("");
  }

  if (!findings.length) {
    console.log("no contradictions found.");
    process.exit(0);
  }
  const rows = new Set(findings.map((f) => f.id));
  console.log(`${findings.length} contradiction${findings.length === 1 ? "" : "s"} across ${rows.size} rows: ${[...rows].join(", ")}`);
  // Split out, because a gate built on this has to choose whether a retraction
  // DISPOSES of a contradiction. b0010's does not go away — it can never be
  // proven, so it can never be amended — and a gate that fails on it forever is
  // a gate that gets switched off.
  const inRetracted = findings.filter((f) => retracted.has(f.id)).length;
  if (inRetracted) {
    console.log(`  ${findings.length - inRetracted} in live rows, ${inRetracted} in retracted rows.`);
  }
  process.exit(1);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();

export { audit, timingRatio, pairedDeterminism, TIMING_BAND };
