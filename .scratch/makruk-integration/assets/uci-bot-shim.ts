// UCI stdio shim around the site heuristic bot (`shared/botEngine.ts`).
//
// Integration map ticket 01 ("What is the wasm engine worth at site
// movetimes?") measures the incumbent tiers 1–7 opponent through the makruk-engine
// arena by feeding this process to its FAIRY_BIN slot, which the arena already
// treats as "any UCI opponent".
//
// Deliberate behaviour, recorded here because the ledger rows cannot carry it:
//   * `go movetime N` is IGNORED — the bot's own per-level maxMs/maxNodes govern,
//     exactly as it does on the site. The row records the movetime pair anyway;
//     the `notes` field on measure rows states that the opponent ignores it.
//   * The bot level comes from BOT_LEVEL (default 7). Each level measured gets
//     its own OPP_LABEL (e.g. site-heuristic-bot-l7) so rung() keeps them apart.
//
// The rules authority is consumed read-only: positions are rebuilt through
// shared/engine.ts (createInitialGameState / makeMove), never re-implemented.
//
// CANONICAL COPY: .scratch/makruk-integration/assets/uci-bot-shim.ts in the
// makruk-engine repo. Install: copy both this file and the `uci-bot-shim`
// wrapper into ../markrukthai-1/scripts/ and `chmod +x uci-bot-shim`.
// The wrapper's sha256 (first 12 hex) must equal sha256:479ffc269f67 — the
// engineId recorded on every heuristic-bot ledger row (b0064, b0069, b0072).

import readline from 'node:readline';
import { createInitialGameState, makeMove } from '../shared/engine';
import { getBotMoveForLevel } from '../shared/botEngine';
import { deserializeBoardPosition, moveToUci, uciToMove } from '../shared/engineAdapter';
import type { GameState } from '../shared/types';

const LEVEL = Number(process.env.BOT_LEVEL ?? '7');

let state: GameState | null = null;

function setPosition(line: string): void {
  state = createInitialGameState(0, 0);
  const fenMatch = line.match(/^position\s+fen\s+(\S+)\s+(\S+)/);
  if (!fenMatch) return;
  const board = deserializeBoardPosition(fenMatch[1]);
  if (board) state.board = board;
  if (fenMatch[2] === 'b') state.turn = 'black';
  const movesIdx = line.indexOf(' moves ');
  if (movesIdx < 0) return;
  for (const uci of line.slice(movesIdx + ' moves '.length).trim().split(/\s+/)) {
    const move = uciToMove(uci);
    if (!move || !state) return;
    const next = makeMove(state, move.from, move.to);
    if (!next) return;
    state = next;
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (raw) => {
  const line = raw.trim();
  if (line === 'uci') {
    console.log(`id name site-heuristic-bot-shim (level ${LEVEL})`);
    console.log('id author makruk-integration map ticket 01');
    console.log('uciok');
  } else if (line === 'isready') {
    console.log('readyok');
  } else if (line.startsWith('setoption')) {
    // ignored — including [PERSON_NAME], which this engine does not have
  } else if (line === 'ucinewgame') {
    state = null;
  } else if (line.startsWith('position')) {
    setPosition(line);
  } else if (line.startsWith('go')) {
    if (!state) setPosition('position fen initial w');
    const started = Date.now();
    const move = getBotMoveForLevel(state!, LEVEL);
    const thinkMs = Date.now() - started;
    // movetime deliberately unread: see the header comment
    console.log(`info string shim level=${LEVEL} thinkMs=${thinkMs}`);
    console.log(`bestmove ${move ? moveToUci(move) : '(none)'}`);
  } else if (line === 'quit') {
    rl.close();
    process.exit(0);
  }
});
