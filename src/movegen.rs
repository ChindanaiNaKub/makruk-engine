//! Move generation and attack detection. Faithful port of shared/engine.ts.

use crate::board::*;

const KING_DIRS: [(i8, i8); 8] = [
    (-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1),
];
const MET_DIRS: [(i8, i8); 4] = [(-1, -1), (-1, 1), (1, -1), (1, 1)];
const ROOK_DIRS: [(i8, i8); 4] = [(-1, 0), (1, 0), (0, -1), (0, 1)];
const KNIGHT_JUMPS: [(i8, i8); 8] = [
    (-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1),
];

#[inline]
fn khon_dirs(forward: i8) -> [(i8, i8); 5] {
    [(-1, -1), (-1, 1), (1, -1), (1, 1), (forward, 0)]
}

/// Is `sq` attacked by any piece of `by_color`? Equivalent to TS isSquareAttacked,
/// computed from the victim square outward.
pub fn is_square_attacked(board: &Board, sq: Square, by_color: Color) -> bool {
    let row = sq_row(sq) as i8;
    let col = sq_col(sq) as i8;
    let fwd = by_color.forward();

    // Khun
    for (dr, dc) in KING_DIRS {
        if let Some(p) = board.at_rc(row + dr, col + dc) {
            if p.color == by_color && p.kind == Kind::K {
                return true;
            }
        }
    }

    // Met / Bia Ngai (1 diagonal step), and Khon diagonals
    for (dr, dc) in MET_DIRS {
        if let Some(p) = board.at_rc(row + dr, col + dc) {
            if p.color == by_color
                && (p.kind == Kind::M || p.kind == Kind::PM || p.kind == Kind::S)
            {
                return true;
            }
        }
    }

    // Khon forward step: attacker sits directly "behind" the target from its perspective.
    if let Some(p) = board.at_rc(row - fwd, col) {
        if p.color == by_color && p.kind == Kind::S {
            return true;
        }
    }

    // Ma
    for (dr, dc) in KNIGHT_JUMPS {
        if let Some(p) = board.at_rc(row + dr, col + dc) {
            if p.color == by_color && p.kind == Kind::N {
                return true;
            }
        }
    }

    // Bia captures: white bia on (row-1, col+-1) attacks (row, col)
    for dc in [-1i8, 1i8] {
        if let Some(p) = board.at_rc(row - fwd, col + dc) {
            if p.color == by_color && p.kind == Kind::P {
                return true;
            }
        }
    }

    // Rua rays
    for (dr, dc) in ROOK_DIRS {
        let mut dist = 1i8;
        loop {
            let nr = row + dr * dist;
            let nc = col + dc * dist;
            if !in_bounds(nr, nc) {
                break;
            }
            if let Some(p) = board.at_rc(nr, nc) {
                if p.color == by_color && p.kind == Kind::R {
                    return true;
                }
                break; // blocked by first piece on the ray
            }
            dist += 1;
        }
    }

    false
}

pub fn is_in_check(board: &Board, color: Color) -> bool {
    match board.king_square(color) {
        Some(ksq) => is_square_attacked(board, ksq, color.other()),
        None => false,
    }
}

/// Pseudo-legal moves for the piece on `sq`, matching TS getRawMoves:
/// captures of the enemy king are never generated.
pub fn pseudo_legal_moves(board: &Board, sq: Square, out: &mut Vec<Move>) {
    let piece = match board.at(sq) {
        Some(p) => p,
        None => return,
    };
    let row = sq_row(sq) as i8;
    let col = sq_col(sq) as i8;
    let fwd = piece.color.forward();

    let mut push_step = |nr: i8, nc: i8| -> bool {
        // returns whether the ray may continue past this square
        if !in_bounds(nr, nc) {
            return false;
        }
        match board.at_rc(nr, nc) {
            None => {
                out.push(Move {
                    from: sq,
                    to: make_sq(nr as u8, nc as u8),
                });
                true
            }
            Some(t) => {
                if t.color != piece.color && t.kind != Kind::K {
                    out.push(Move {
                        from: sq,
                        to: make_sq(nr as u8, nc as u8),
                    });
                }
                false
            }
        }
    };

    match piece.kind {
        Kind::K => {
            for (dr, dc) in KING_DIRS {
                push_step(row + dr, col + dc);
            }
        }
        Kind::M | Kind::PM => {
            for (dr, dc) in MET_DIRS {
                push_step(row + dr, col + dc);
            }
        }
        Kind::S => {
            for (dr, dc) in khon_dirs(fwd) {
                push_step(row + dr, col + dc);
            }
        }
        Kind::N => {
            for (dr, dc) in KNIGHT_JUMPS {
                push_step(row + dr, col + dc);
            }
        }
        Kind::R => {
            for (dr, dc) in ROOK_DIRS {
                let mut dist = 1i8;
                while push_step(row + dr * dist, col + dc * dist) {
                    dist += 1;
                }
            }
        }
        Kind::P => {
            let nr = row + fwd;
            if in_bounds(nr, col) && board.at_rc(nr, col).is_none() {
                out.push(Move {
                    from: sq,
                    to: make_sq(nr as u8, col as u8),
                });
            }
            for dc in [-1i8, 1i8] {
                let nc = col + dc;
                if in_bounds(nr, nc) {
                    if let Some(t) = board.at_rc(nr, nc) {
                        if t.color != piece.color && t.kind != Kind::K {
                            out.push(Move {
                                from: sq,
                                to: make_sq(nr as u8, nc as u8),
                            });
                        }
                    }
                }
            }
        }
    }
}

/// Apply a move to a cloned board, handling automatic bia promotion.
pub fn apply_to_board(board: &Board, mv: Move) -> Board {
    let mut next = board.clone();
    let mut piece = next.squares[mv.from as usize].take().unwrap();
    next.squares[mv.to as usize] = None;
    if piece.kind == Kind::P && sq_row(mv.to) == piece.color.promotion_row() {
        piece.kind = Kind::PM;
    }
    next.squares[mv.to as usize] = Some(piece);
    next
}

/// Fully legal moves for the piece on `sq`.
pub fn legal_moves_from(board: &Board, sq: Square, out: &mut Vec<Move>) {
    let piece = match board.at(sq) {
        Some(p) => p,
        None => return,
    };
    let mut raw = Vec::with_capacity(16);
    pseudo_legal_moves(board, sq, &mut raw);
    for mv in raw {
        let next = apply_to_board(board, mv);
        if !is_in_check(&next, piece.color) {
            out.push(mv);
        }
    }
}

/// All legal moves for `color`.
pub fn legal_moves(board: &Board, color: Color) -> Vec<Move> {
    let mut out = Vec::with_capacity(48);
    for sq in 0..64u8 {
        if let Some(p) = board.at(sq) {
            if p.color == color {
                legal_moves_from(board, sq, &mut out);
            }
        }
    }
    out
}

pub fn has_any_legal_move(board: &Board, color: Color) -> bool {
    for sq in 0..64u8 {
        if let Some(p) = board.at(sq) {
            if p.color == color {
                let mut moves = Vec::new();
                legal_moves_from(board, sq, &mut moves);
                if !moves.is_empty() {
                    return true;
                }
            }
        }
    }
    false
}
