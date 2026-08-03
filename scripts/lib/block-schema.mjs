// What a block row is allowed to say — stated once, checked at two doors.
//
// Mandated by `.scratch/makruk-ledger/issues/04-make-the-defect-unwritable.md`.
//
// The amendment primitive repairs a row after the fact. This is the half that
// stops the next one being written: a row whose own fields contradict each other
// is refused rather than recorded.
//
// ONE LINE DECIDES THE WHOLE SHAPE OF THIS FILE: every rule here is of the form
// "if X and Y are both present, they must agree". A MISSING field is never a
// violation. That is not laziness — it is the same two-severity split the audit
// already runs on (CONTRADICTION exits non-zero, INCOMPLETE never does), and it
// is what keeps the guard from rejecting the record it is guarding. 44 of the
// ledger's rows are legitimately movetime, 2 legitimately have no W/L/D, 8
// predate half these fields, and a guard that convicts them gets switched off
// within a day. Incompleteness is honest; contradiction is the defect.
//
// TWO PHASES, because WHEN a rule is checkable decides what refusing costs:
//
//   "pre"   — knowable before a single game is played. Checked in preflight,
//             where refusing costs nothing.
//   "write" — needs the result. Checked in appendBlock, at the end of a block,
//             where refusing costs the whole block — hence the quarantine there
//             rather than a plain throw.
//
// The audit (`scripts/ledger-audit.mjs`) deliberately keeps its OWN encoding of
// these rules rather than importing this module. An audit that imports the
// writer it audits agrees with itself by construction, and the audit's job
// explicitly includes catching rows that did not come through `appendBlock` —
// written by hand, or by an older version of this file.

const KINDS = new Set(["gate-a", "gate-b", "control", "smoke", "diag"]);
const EVALS = new Set(["net", "classic"]);
const MAX_PLIES = 400; // match-arena.mjs:46

const has = (v) => v !== undefined && v !== null;

/// Each rule returns a violation string, or null when it passes (or when the
/// fields it judges are not both present).
const RULES = [
  {
    name: "kind-known",
    phase: "pre",
    check: (b) =>
      has(b.kind) && !KINDS.has(b.kind) ? `kind '${b.kind}' is not one of ${[...KINDS].join(", ")}` : null,
  },
  {
    // THE defect this map was chartered on. Under `--depth`, goCmd sends
    // `go depth N` to both engines and ignores both ms values entirely
    // (match-arena.mjs:45) — so a row asserting both is asserting something that
    // cannot be true, and the flattering direction of the lie ("the opponent had
    // 4x the clock") is why it survived unnoticed for five blocks.
    name: "search-condition-exclusive",
    phase: "pre",
    check: (b) =>
      has(b.depth) && has(b.movetime)
        ? `depth ${b.depth} AND movetime ${b.movetime}/${b.opponentMovetime} — under --depth both ms values are ignored`
        : null,
  },
  {
    name: "movetime-is-a-pair",
    phase: "pre",
    check: (b) =>
      has(b.movetime) !== has(b.opponentMovetime)
        ? `movetime ${b.movetime ?? "absent"} but opponentMovetime ${b.opponentMovetime ?? "absent"} — both sides have a clock or neither does`
        : null,
  },
  {
    name: "eval-known",
    phase: "pre",
    check: (b) => {
      for (const side of ["mine", "opponent"]) {
        const s = b[side];
        if (s?.engine !== "ours" || !has(s.eval)) continue;
        if (!EVALS.has(s.eval)) return `${side} eval '${s.eval}' is not one of ${[...EVALS].join(", ")}`;
        if (s.eval === "net" && !has(s.weights)) return `${side} requests eval=net with no weights — a net without its file is not an artifact`;
      }
      return null;
    },
  },
  {
    // The engine reports what it ACTUALLY armed. A silent net→classic fallback
    // used to be an eprintln! invisible to the harness; `armed` is what makes it
    // auditable, and a row where the two disagree recorded one and ran the other.
    name: "armed-matches-eval",
    phase: "write",
    check: (b) => {
      for (const side of ["mine", "opponent"]) {
        const s = b[side];
        if (s?.engine !== "ours" || !has(s.armed) || !has(s.eval)) continue;
        if (String(s.armed).startsWith("net ") !== (s.eval === "net")) {
          return `${side} records eval=${s.eval} but the engine armed ${JSON.stringify(s.armed)}`;
        }
      }
      return null;
    },
  },
  {
    // An opponent of engine 'ours' is FAIRY_BIN pointed at our own binary — one
    // file, one hash. Two hashes mean the row was assembled from two different
    // beliefs about what was playing, which is the drift this ticket removes.
    name: "selfplay-same-binary",
    phase: "pre",
    check: (b) =>
      b.opponent?.engine === "ours" && has(b.mine?.engineId) && has(b.opponent?.engineId) && b.mine.engineId !== b.opponent.engineId
        ? `mine ${b.mine.engineId} but opponent ${b.opponent.engineId} — self-play runs one binary`
        : null,
  },
  {
    name: "kind-matches-opponent",
    phase: "pre",
    check: (b) => {
      if (!has(b.kind) || !has(b.opponent?.engine)) return null;
      if (b.kind === "gate-a" && b.opponent.engine !== "ours") return `kind gate-a but opponent.engine is '${b.opponent.engine}' — gate-a is head-to-head against ourselves`;
      if (b.kind === "gate-b" && b.opponent.engine !== "fairy") return `kind gate-b but opponent.engine is '${b.opponent.engine}' — gate-b is the ladder against fairy`;
      return null;
    },
  },
  {
    name: "outcome-sum",
    phase: "write",
    check: (b) => {
      if (![b.w, b.l, b.d, b.games].every(has)) return null;
      const sum = b.w + b.l + b.d + (b.maxPlies ?? 0) + (b.errors ?? 0);
      return sum !== b.games ? `games ${b.games} but W-L-D + mp + err accounts for ${sum}` : null;
    },
  },
  {
    name: "score-arithmetic",
    phase: "write",
    check: (b) => {
      if (![b.w, b.l, b.d, b.games, b.score].every(has)) return null;
      const played = b.games - (b.errors ?? 0);
      if (played <= 0) return null;
      const expect = (b.w + 0.5 * (b.d + (b.maxPlies ?? 0))) / played;
      return Math.abs(expect - b.score) > 1e-9 ? `score ${b.score} but the split implies ${expect}` : null;
    },
  },
  {
    name: "pergame-count",
    phase: "write",
    check: (b) => {
      if (!Array.isArray(b.perGame) || !has(b.games)) return null;
      const played = b.games - (b.errors ?? 0);
      return b.perGame.length !== played ? `${b.perGame.length} per-game records for ${played} played games` : null;
    },
  },
  {
    // MAXPLY is the arena's name for "neither side converted in 400 plies", so
    // the tag and the ply count are the same fact stated twice.
    name: "maxply-tag",
    phase: "write",
    check: (b) => {
      if (!Array.isArray(b.perGame)) return null;
      const bad = b.perGame.findIndex((g) => (g.tag === "MAXPLY") !== (g.plies === MAX_PLIES));
      return bad >= 0 ? `game ${bad} is tagged ${b.perGame[bad].tag} at ${b.perGame[bad].plies} plies` : null;
    },
  },
];

/// Every violation in `row`, as `{ name, detail }`. `phase: "pre"` runs only the
/// rules knowable before the games; anything else runs all of them.
export function validateBlock(row, { phase = "write" } = {}) {
  const active = phase === "pre" ? RULES.filter((r) => r.phase === "pre") : RULES;
  const out = [];
  for (const r of active) {
    const detail = r.check(row);
    if (detail) out.push({ name: r.name, detail });
  }
  return out;
}

export const RULE_NAMES = RULES.map((r) => r.name);
