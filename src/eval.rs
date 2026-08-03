//! Handcrafted evaluation. Base tables mirror shared/botEngine.ts so the
//! engine's judgment lines up with the site's existing bot calibration; the
//! counting-rule layer is added on top.

use crate::board::*;
use crate::counting::CountingType;
use crate::game::{Game, Outcome};

pub const CHECKMATE_SCORE: i32 = 100_000;

const CENTER_BONUS: [i32; 64] = build_center_bonus();

const fn build_center_bonus() -> [i32; 64] {
    let t: [[i32; 8]; 8] = [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 5, 5, 5, 5, 5, 5, 0],
        [0, 5, 15, 15, 15, 15, 5, 0],
        [0, 5, 15, 25, 25, 15, 5, 0],
        [0, 5, 15, 25, 25, 15, 5, 0],
        [0, 5, 15, 15, 15, 15, 5, 0],
        [0, 5, 5, 5, 5, 5, 5, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
    ];
    let mut out = [0i32; 64];
    let mut r = 0;
    while r < 8 {
        let mut c = 0;
        while c < 8 {
            out[r * 8 + c] = t[r][c];
            c += 1;
        }
        r += 1;
    }
    out
}

const PAWN_ADVANCE_WHITE: [i32; 8] = [0, 0, 0, 5, 15, 30, 0, 0];
const PAWN_ADVANCE_BLACK: [i32; 8] = [0, 0, 30, 15, 5, 0, 0, 0];

const KING_SAFETY: [i32; 64] = build_king_safety();

const fn build_king_safety() -> [i32; 64] {
    let t: [[i32; 8]; 8] = [
        [20, 20, 10, 0, 0, 10, 20, 20],
        [20, 15, 5, 0, 0, 5, 15, 20],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [20, 15, 5, 0, 0, 5, 15, 20],
        [20, 20, 10, 0, 0, 10, 20, 20],
    ];
    let mut out = [0i32; 64];
    let mut r = 0;
    while r < 8 {
        let mut c = 0;
        while c < 8 {
            out[r * 8 + c] = t[r][c];
            c += 1;
        }
        r += 1;
    }
    out
}

#[inline]
fn kind_value(kind: Kind) -> i32 {
    match kind {
        Kind::R => 500,
        Kind::N => 300,
        Kind::S => 250,
        Kind::M | Kind::PM => 200,
        Kind::P => 100,
        Kind::K => 0,
    }
}

/// Static, side-agnostic board score from `color`'s perspective.
pub fn evaluate_board(board: &Board, color: Color) -> i32 {
    let mut score = 0i32;
    for (idx, cell) in board.squares.iter().enumerate() {
        let piece = match cell {
            Some(p) => *p,
            None => continue,
        };
        let sq = idx as Square;
        let row = sq_row(sq) as usize;

        let center = CENTER_BONUS[idx];
        let mut positional = center;

        match piece.kind {
            Kind::P => {
                positional += match piece.color {
                    Color::White => PAWN_ADVANCE_WHITE[row],
                    Color::Black => PAWN_ADVANCE_BLACK[row],
                };
            }
            Kind::K => {
                positional = KING_SAFETY[idx];
            }
            Kind::N => {
                positional += center / 2;
            }
            _ => {}
        }

        let total = kind_value(piece.kind) + positional;
        if piece.color == color {
            score += total;
        } else {
            score -= total;
        }
    }

    if crate::movegen::is_in_check(board, color.other()) {
        score += 50;
    }
    if crate::movegen::is_in_check(board, color) {
        score -= 50;
    }

    score
}

/// Counting-rule awareness: nudges play toward converting before the count
/// closes when this side is the stronger party, and toward surviving the
/// count when it is the counting party.
fn counting_term(game: &Game, color: Color) -> i32 {
    let c = match &game.counting {
        Some(c) => c,
        None => return 0,
    };
    let remaining = (c.limit as i32 - c.current_count as i32).max(0);

    // Distance the counting side still has to survive. Small linear term so
    // it shapes move choice without swamping material.
    // 3 and 1 are hand-written and TESTED. A constrained texel fit over 600k
    // positions of bootstrap-v2 wanted 6.3 and 2.7 — both roughly double, the
    // largest held-out gain of any pair in this eval (-0.82%). Gate A at equal
    // time rejected it: b0054, 48.8% (-9 Elo), LLR -9.38, against a clean 50.0%
    // control (b0053). Redraw ticket 05.
    //
    // So: lower held-out loss is not Elo, demonstrated on this engine rather
    // than borrowed from Zurichess. Do not re-derive these two constants from a
    // loss curve; the next attempt needs a different instrument, not a rerun.
    let pressure = match c.kind {
        CountingType::PiecesHonor => remaining * 3,
        CountingType::BoardHonor => {
            if c.active {
                remaining * 1
            } else {
                0
            }
        }
    };

    if c.counting_color == color {
        pressure // surviving is good for the counting side
    } else {
        -pressure // the stronger side feels the closing clock
    }
}

/// Full node evaluation from the perspective of the side to move.
/// `ply` distances mate scores so earlier mates score higher.
pub fn evaluate(game: &Game, ply: u32) -> i32 {
    match game.outcome {
        Outcome::Checkmate { winner } => {
            if winner == game.turn {
                // Side to move just delivered mate — shouldn't happen (turn flips
                // after a mating move), kept for safety.
                CHECKMATE_SCORE - ply as i32
            } else {
                -(CHECKMATE_SCORE - ply as i32)
            }
        }
        Outcome::Stalemate | Outcome::CountingDraw | Outcome::InsufficientMaterial => 0,
        Outcome::Ongoing => {
            // Learned eval when armed (MAKURUK_EVAL=net / WasmEngine::init_nnue);
            // classical eval remains the default and the "Casual" rung fallback.
            if let Some(cp) = crate::nnue::net_score(game) {
                return cp;
            }
            evaluate_board(&game.board, game.turn) + counting_term(game, game.turn)
        }
    }
}
