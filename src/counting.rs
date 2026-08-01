//! Makruk counting rule (Sak Mak / Sak Kradan) — exact port of
//! shared/makrukRules.ts + the adjudication ordering in shared/engine.ts.

use crate::board::*;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CountingType {
    BoardHonor,  // Sak Kradan: no unpromoted bia, material imbalance, manual start
    PiecesHonor, // Sak Mak: one side reduced to a bare khun, automatic
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CountingState {
    pub active: bool,
    pub kind: CountingType,
    pub counting_color: Color,
    pub stronger_color: Color,
    pub current_count: u16,
    pub start_count: u16,
    pub limit: u16,
    pub final_attack_pending: bool,
}

fn count_pieces(board: &Board) -> u16 {
    board.squares.iter().filter(|c| c.is_some()).count() as u16
}

fn count_non_kings(board: &Board, color: Color) -> u16 {
    board
        .squares
        .iter()
        .filter(|c| matches!(c, Some(p) if p.color == color && p.kind != Kind::K))
        .count() as u16
}

fn count_kind(board: &Board, color: Color, kind: Kind) -> u16 {
    board
        .squares
        .iter()
        .filter(|c| matches!(c, Some(p) if p.color == color && p.kind == kind))
        .count() as u16
}

fn material_score(board: &Board, color: Color) -> i32 {
    board
        .squares
        .iter()
        .filter_map(|c| *c)
        .filter(|p| p.color == color && p.kind != Kind::K)
        .map(|p| p.kind.counting_value())
        .sum()
}

fn has_unpromoted_pawns(board: &Board) -> bool {
    board
        .squares
        .iter()
        .any(|c| matches!(c, Some(p) if p.kind == Kind::P))
}

pub fn has_bare_kings_only(board: &Board) -> bool {
    count_non_kings(board, Color::White) == 0 && count_non_kings(board, Color::Black) == 0
}

/// Port of getMakrukPieceHonorLimit: limit depends on the stronger side's pieces.
pub fn piece_honor_limit(board: &Board, stronger: Color) -> u16 {
    let rooks = count_kind(board, stronger, Kind::R);
    let khons = count_kind(board, stronger, Kind::S);
    let knights = count_kind(board, stronger, Kind::N);
    let _met_like = count_kind(board, stronger, Kind::M) + count_kind(board, stronger, Kind::PM);

    if rooks >= 2 {
        8
    } else if rooks == 1 {
        16
    } else if khons >= 2 {
        22
    } else if knights >= 2 {
        32
    } else if khons == 1 {
        44
    } else if knights == 1 {
        64
    } else {
        64 // metLike > 0, or nothing left to force mate with
    }
}

/// Port of isMakrukPiecesHonorImmediateDraw.
pub fn pieces_honor_immediate_draw(board: &Board, stronger: Color) -> bool {
    count_pieces(board) + 1 > piece_honor_limit(board, stronger)
}

/// Port of getMakrukCountingState. `board_honor_auto_start` controls whether a
/// freshly detected board-honor state begins active (engine search assumption:
/// the weaker side always starts counting, which is the rational-play default).
pub fn fresh_counting_state(board: &Board, board_honor_auto_start: bool) -> Option<CountingState> {
    if has_unpromoted_pawns(board) {
        return None;
    }
    let white_nk = count_non_kings(board, Color::White);
    let black_nk = count_non_kings(board, Color::Black);

    if white_nk == 0 && black_nk == 0 {
        return None; // bare kings: draw is adjudicated elsewhere
    }

    if white_nk == 0 || black_nk == 0 {
        let counting_color = if white_nk == 0 {
            Color::White
        } else {
            Color::Black
        };
        let stronger = counting_color.other();
        let current = count_pieces(board);
        return Some(CountingState {
            active: true,
            kind: CountingType::PiecesHonor,
            counting_color,
            stronger_color: stronger,
            current_count: current,
            start_count: current,
            limit: piece_honor_limit(board, stronger),
            final_attack_pending: false,
        });
    }

    let white_mat = material_score(board, Color::White);
    let black_mat = material_score(board, Color::Black);
    if white_mat == black_mat {
        return None;
    }
    let counting_color = if white_mat < black_mat {
        Color::White
    } else {
        Color::Black
    };
    Some(CountingState {
        active: board_honor_auto_start,
        kind: CountingType::BoardHonor,
        counting_color,
        stronger_color: counting_color.other(),
        current_count: 0,
        start_count: 0,
        limit: 64,
        final_attack_pending: false,
    })
}

/// Port of getNextCountingState: keeps the running clock when the counting
/// identity is unchanged; otherwise replaces it with the fresh state.
/// Pieces-honor limit is sticky once counting has begun.
pub fn next_counting_state(
    previous: Option<&CountingState>,
    board: &Board,
    board_honor_auto_start: bool,
) -> Option<CountingState> {
    let fresh = fresh_counting_state(board, board_honor_auto_start)?;

    if let Some(prev) = previous {
        if prev.kind == fresh.kind
            && prev.counting_color == fresh.counting_color
            && prev.stronger_color == fresh.stronger_color
        {
            return Some(CountingState {
                active: prev.active,
                start_count: prev.start_count,
                current_count: prev.current_count,
                limit: if prev.kind == CountingType::PiecesHonor {
                    prev.limit
                } else {
                    fresh.limit
                },
                final_attack_pending: prev.final_attack_pending,
                ..fresh
            });
        }
    }

    Some(fresh)
}

/// Compact serialization for passing counting state over the wire:
/// `kind,countingColor,currentCount,startCount,limit,active,finalAttackPending`
pub fn serialize_counting(c: &CountingState) -> String {
    let kind = match c.kind {
        CountingType::BoardHonor => "board_honor",
        CountingType::PiecesHonor => "pieces_honor",
    };
    let cc = match c.counting_color {
        Color::White => "white",
        Color::Black => "black",
    };
    format!(
        "{kind},{cc},{},{},{},{},{}",
        c.current_count,
        c.start_count,
        c.limit,
        c.active,
        c.final_attack_pending
    )
}

pub fn parse_counting(s: &str) -> Option<CountingState> {
    let parts: Vec<&str> = s.trim().split(',').collect();
    if parts.len() < 7 {
        return None;
    }
    let kind = match parts[0] {
        "board_honor" => CountingType::BoardHonor,
        "pieces_honor" => CountingType::PiecesHonor,
        _ => return None,
    };
    let counting_color = match parts[1] {
        "white" => Color::White,
        "black" => Color::Black,
        _ => return None,
    };
    let stronger_color = counting_color.other();
    Some(CountingState {
        kind,
        counting_color,
        stronger_color,
        current_count: parts[2].parse().ok()?,
        start_count: parts[3].parse().ok()?,
        limit: parts[4].parse().ok()?,
        active: parts[5].parse().ok()?,
        final_attack_pending: parts[6].parse().ok()?,
    })
}
