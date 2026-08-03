// Which engine played this block?
//
// Mandated by `.scratch/makruk-ledger/issues/03-pin-the-engine-that-played.md`.
//
// The ledger already records `engineCommit` + `engineDirty`, and 48 of its 49
// rows carry `engineDirty: true` — which is exactly the state in which a commit
// hash stops identifying the code. That pair is PROVENANCE: it says where the
// tree came from. It cannot say what ran.
//
// A proof re-run is only evidence if it ran against the same engine, so the
// ledger needs identity as well: one hash over the artifact that actually
// played. Hashing the BINARY rather than the sources is deliberate — a source
// hash is wrong the moment a build flag moves, and `.cargo/config.toml`'s
// `+simd128` is worth 43.7% nps while appearing in no `.rs` file at all.
//
// 12 hex characters, matching the fingerprint length this project already uses
// everywhere it content-addresses an artifact: `makruk-tiny-v1-4452f72612f1.bin`
// (training/export.py:72) and fairy's own `makruk-a8c621e24a8c.nnue`. 48 bits is
// far past what telling a handful of local builds apart requires, and matching
// the existing convention is worth more here than the extra bits.

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

/// A content hash of whatever file actually ran, or null when there is no file
/// to name. Null is a legitimate answer and stays visible as one — this project
/// does not reconstruct numbers it never measured.
export function binaryId(file) {
  if (!file || !existsSync(file)) return null;
  return "sha256:" + createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 12);
}

/// Where the wasm fairy actually lives, so a wasm opponent is as identifiable as
/// a native one. Resolved through the same `createRequire(FAIRY_DIR)` the arena
/// loads it with, so this names the file that will really be executed rather
/// than a path that merely looks plausible.
export function fairyWasmPath(fairyDir) {
  try {
    return createRequire(fairyDir + path.sep).resolve("fairy-stockfish-nnue.wasm/stockfish.wasm");
  } catch {
    return null;
  }
}

/// The identity of both sides of a block, in the shape the ledger row stores.
///
/// One function, because `match-arena` builds the row at TWO independent sites
/// and they have already drifted apart once — a block fingerprinted one way and
/// recorded another is the defect this map exists to repair. Two call sites
/// reading one function can still be given different arguments, but they can no
/// longer disagree about what identity MEANS.
export function sidesIdentity({ ourEngine, oppIsOurs, fairyBin, fairyDir }) {
  // Always hash the file that will actually run. `oppIsOurs` no longer implies
  // "the same file" — OPP_BIN lets a DIFFERENT build of our engine be the
  // opponent, which is the whole point of a Gate A on an `src/` change.
  return {
    mine: binaryId(ourEngine),
    opponent: binaryId(oppIsOurs ? (fairyBin ?? ourEngine) : (fairyBin ?? fairyWasmPath(fairyDir))),
  };
}
