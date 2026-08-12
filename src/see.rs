//! Static exchange evaluation (SEE) for capture ordering.
//!
//! ADR 0003 lever 4: order quiescence captures by the material that survives a
//! recapture sequence on the target square, instead of MVV-LVA alone. Values
//! use `Kind::counting_value` — the same table MVV-LVA already uses — so SEE is
//! a pure ordering change, not a retune of material.

use crate::board::*;

/// Approximate material gained by playing `mv`, assuming both sides keep
/// recapturing on `mv.to` with their least valuable attacker. Quiet non-captures
/// score 0 (quiescence already filters them in).
pub fn see(board: &Board, mv: Move) -> i32 {
    let Some(attacker) = board.at(mv.from) else {
        return 0;
    };
    let captured_val = board.at(mv.to).map(|p| p.kind.counting_value()).unwrap_or(0);
    let promo = attacker.kind == Kind::P && sq_row(mv.to) == attacker.color.promotion_row();
    let mut piece_on_target = if promo { Kind::PM } else { attacker.kind };

    let mut gain = [0i32; 32];
    let mut d = 0usize;
    gain[0] = captured_val
        + if promo {
            Kind::PM.counting_value() - Kind::P.counting_value()
        } else {
            0
        };

    let mut occ = board.clone();
    occ.squares[mv.from as usize] = None;
    occ.squares[mv.to as usize] = Some(Piece {
        kind: piece_on_target,
        color: attacker.color,
    });

    let mut side = attacker.color.other();
    loop {
        let Some((from, kind)) = least_valuable_attacker(&occ, mv.to, side) else {
            break;
        };
        d += 1;
        if d >= gain.len() {
            break;
        }

        let victim_val = piece_on_target.counting_value();
        let promo_now = kind == Kind::P && sq_row(mv.to) == side.promotion_row();
        let next_on_target = if promo_now { Kind::PM } else { kind };
        let promo_delta = if promo_now {
            Kind::PM.counting_value() - Kind::P.counting_value()
        } else {
            0
        };
        // gain[d] = what we take now, minus what we leave hanging from last ply.
        gain[d] = victim_val + promo_delta - gain[d - 1];

        occ.squares[from as usize] = None;
        occ.squares[mv.to as usize] = Some(Piece {
            kind: next_on_target,
            color: side,
        });
        piece_on_target = next_on_target;
        side = side.other();
    }

    while d > 0 {
        gain[d - 1] = -gain[d].max(-gain[d - 1]);
        d -= 1;
    }
    gain[0]
}

/// Least-valuable attacker of `sq` by `by_color`, as (from-square, kind).
/// Scans in ascending material order so the first hit is LVA.
fn least_valuable_attacker(board: &Board, sq: Square, by_color: Color) -> Option<(Square, Kind)> {
    let row = sq_row(sq) as i8;
    let col = sq_col(sq) as i8;
    let fwd = by_color.forward();

    // Bia (100)
    for dc in [-1i8, 1] {
        if let Some(from) = try_sq(row - fwd, col + dc) {
            if let Some(p) = board.at(from) {
                if p.color == by_color && p.kind == Kind::P {
                    return Some((from, Kind::P));
                }
            }
        }
    }

    // Met / promoted bia (200)
    for (dr, dc) in [(-1i8, -1i8), (-1, 1), (1, -1), (1, 1)] {
        if let Some(from) = try_sq(row + dr, col + dc) {
            if let Some(p) = board.at(from) {
                if p.color == by_color && matches!(p.kind, Kind::M | Kind::PM) {
                    return Some((from, p.kind));
                }
            }
        }
    }

    // Khon (250): diagonals + forward
    for (dr, dc) in [(-1i8, -1i8), (-1, 1), (1, -1), (1, 1)] {
        if let Some(from) = try_sq(row + dr, col + dc) {
            if let Some(p) = board.at(from) {
                if p.color == by_color && p.kind == Kind::S {
                    return Some((from, Kind::S));
                }
            }
        }
    }
    if let Some(from) = try_sq(row - fwd, col) {
        if let Some(p) = board.at(from) {
            if p.color == by_color && p.kind == Kind::S {
                return Some((from, Kind::S));
            }
        }
    }

    // Ma (300)
    for (dr, dc) in [
        (-2i8, -1i8),
        (-2, 1),
        (-1, -2),
        (-1, 2),
        (1, -2),
        (1, 2),
        (2, -1),
        (2, 1),
    ] {
        if let Some(from) = try_sq(row + dr, col + dc) {
            if let Some(p) = board.at(from) {
                if p.color == by_color && p.kind == Kind::N {
                    return Some((from, Kind::N));
                }
            }
        }
    }

    // Rua (500)
    for (dr, dc) in [(-1i8, 0i8), (1, 0), (0, -1), (0, 1)] {
        let mut dist = 1i8;
        loop {
            let Some(from) = try_sq(row + dr * dist, col + dc * dist) else {
                break;
            };
            if let Some(p) = board.at(from) {
                if p.color == by_color && p.kind == Kind::R {
                    return Some((from, Kind::R));
                }
                break;
            }
            dist += 1;
        }
    }

    // Khun last (material 0, but can still recapture).
    for (dr, dc) in [
        (-1i8, -1i8),
        (-1, 0),
        (-1, 1),
        (0, -1),
        (0, 1),
        (1, -1),
        (1, 0),
        (1, 1),
    ] {
        if let Some(from) = try_sq(row + dr, col + dc) {
            if let Some(p) = board.at(from) {
                if p.color == by_color && p.kind == Kind::K {
                    return Some((from, Kind::K));
                }
            }
        }
    }

    None
}

#[inline]
fn try_sq(row: i8, col: i8) -> Option<Square> {
    if in_bounds(row, col) {
        Some(make_sq(row as u8, col as u8))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_met_is_positive() {
        let mut b = Board::empty();
        b.squares[make_sq(3, 3) as usize] = Some(Piece {
            kind: Kind::M,
            color: Color::White,
        });
        b.squares[make_sq(4, 4) as usize] = Some(Piece {
            kind: Kind::M,
            color: Color::Black,
        });
        b.squares[make_sq(0, 4) as usize] = Some(Piece {
            kind: Kind::K,
            color: Color::White,
        });
        b.squares[make_sq(7, 4) as usize] = Some(Piece {
            kind: Kind::K,
            color: Color::Black,
        });
        let mv = Move {
            from: make_sq(3, 3),
            to: make_sq(4, 4),
        };
        assert!(see(&b, mv) >= Kind::M.counting_value());
    }

    #[test]
    fn equal_trade_is_not_positive() {
        let mut b = Board::empty();
        b.squares[make_sq(3, 3) as usize] = Some(Piece {
            kind: Kind::M,
            color: Color::White,
        });
        b.squares[make_sq(4, 4) as usize] = Some(Piece {
            kind: Kind::M,
            color: Color::Black,
        });
        b.squares[make_sq(5, 5) as usize] = Some(Piece {
            kind: Kind::M,
            color: Color::Black,
        });
        b.squares[make_sq(0, 4) as usize] = Some(Piece {
            kind: Kind::K,
            color: Color::White,
        });
        b.squares[make_sq(7, 4) as usize] = Some(Piece {
            kind: Kind::K,
            color: Color::Black,
        });
        let mv = Move {
            from: make_sq(3, 3),
            to: make_sq(4, 4),
        };
        let s = see(&b, mv);
        assert!(s <= 0, "defended equal trade should not score positive, got {s}");
    }
}
