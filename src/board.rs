//! Board representation, pieces, coordinates, and FEN.
//!
//! Mirrors the markrukthai `shared/` model: internal rows 0..7 map to ranks
//! 1..8 (row 0 = white back rank), cols 0..7 map to files a..h.

pub type Square = u8; // row * 8 + col

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Color {
    White = 0,
    Black = 1,
}

impl Color {
    #[inline]
    pub fn other(self) -> Color {
        match self {
            Color::White => Color::Black,
            Color::Black => Color::White,
        }
    }

    /// Forward direction in rows: white moves toward increasing rows.
    #[inline]
    pub fn forward(self) -> i8 {
        match self {
            Color::White => 1,
            Color::Black => -1,
        }
    }

    /// Row on which a bia promotes (white: rank 6 = row 5, black: rank 3 = row 2).
    #[inline]
    pub fn promotion_row(self) -> u8 {
        match self {
            Color::White => 5,
            Color::Black => 2,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    K = 0, // Khun (king)
    M = 1, // Met
    S = 2, // Khon
    N = 3, // Ma (knight)
    R = 4, // Rua (rook)
    P = 5, // Bia (pawn)
    PM = 6, // Bia Ngai (promoted bia, moves like Met)
}

impl Kind {
    /// Material value used by the counting rules (same table as shared/makrukRules.ts).
    #[inline]
    pub fn counting_value(self) -> i32 {
        match self {
            Kind::R => 500,
            Kind::N => 300,
            Kind::S => 250,
            Kind::M | Kind::PM => 200,
            Kind::P => 100,
            Kind::K => 0,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Piece {
    pub kind: Kind,
    pub color: Color,
}

#[inline]
pub fn make_sq(row: u8, col: u8) -> Square {
    row * 8 + col
}

#[inline]
pub fn sq_row(sq: Square) -> u8 {
    sq / 8
}

#[inline]
pub fn sq_col(sq: Square) -> u8 {
    sq % 8
}

#[inline]
pub fn in_bounds(row: i8, col: i8) -> bool {
    (0..8).contains(&row) && (0..8).contains(&col)
}

/// A move. Promotion is implicit: a bia landing on its promotion row promotes.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Move {
    pub from: Square,
    pub to: Square,
}

/// Start position in the client-serialized format (bia = P, met = M, PM = F).
pub const STARTPOS_FEN: &str = "rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w";

#[derive(Clone)]
pub struct Board {
    pub squares: [Option<Piece>; 64],
}

impl Board {
    pub fn empty() -> Self {
        Board {
            squares: [None; 64],
        }
    }

    #[inline]
    pub fn at(&self, sq: Square) -> Option<Piece> {
        self.squares[sq as usize]
    }

    #[inline]
    pub fn at_rc(&self, row: i8, col: i8) -> Option<Piece> {
        if in_bounds(row, col) {
            self.squares[(row as u8 * 8 + col as u8) as usize]
        } else {
            None
        }
    }

    pub fn king_square(&self, color: Color) -> Option<Square> {
        for (i, cell) in self.squares.iter().enumerate() {
            if let Some(p) = cell {
                if p.kind == Kind::K && p.color == color {
                    return Some(i as Square);
                }
            }
        }
        None
    }

    fn char_to_piece(ch: char) -> Option<Piece> {
        let color = if ch.is_ascii_uppercase() {
            Color::White
        } else {
            Color::Black
        };
        let kind = match ch.to_ascii_uppercase() {
            'K' => Kind::K,
            'M' => Kind::M,
            'S' => Kind::S,
            'N' => Kind::N,
            'R' => Kind::R,
            'P' => Kind::P,
            'F' => Kind::PM, // client serializes promoted bia as F
            'Q' => Kind::PM, // tolerate standard ferz letter
            'B' => Kind::P,  // tolerate fairy-stockfish bia letter
            _ => return None,
        };
        Some(Piece { kind, color })
    }

    fn piece_to_char(piece: Piece) -> char {
        let base = match piece.kind {
            Kind::K => 'K',
            Kind::M => 'M',
            Kind::S => 'S',
            Kind::N => 'N',
            Kind::R => 'R',
            Kind::P => 'P',
            Kind::PM => 'F',
        };
        match piece.color {
            Color::White => base,
            Color::Black => base.to_ascii_lowercase(),
        }
    }

    /// Parse the board half of a FEN-like string (rows listed rank 8 -> rank 1).
    pub fn from_fen_board(board_part: &str) -> Result<Board, String> {
        let mut board = Board::empty();
        let ranks: Vec<&str> = board_part.trim().split('/').collect();
        if ranks.len() != 8 {
            return Err(format!("expected 8 ranks, got {}", ranks.len()));
        }
        for (rank_idx, rank) in ranks.iter().enumerate() {
            let row = 7 - rank_idx as u8;
            let mut col: u8 = 0;
            for ch in rank.chars() {
                if ch.is_ascii_digit() {
                    col += ch as u8 - b'0';
                    continue;
                }
                let piece = Self::char_to_piece(ch).ok_or_else(|| format!("bad piece '{ch}'"))?;
                if col > 7 {
                    return Err("rank overflow".into());
                }
                board.squares[make_sq(row, col) as usize] = Some(piece);
                col += 1;
            }
            if col != 8 {
                return Err(format!("rank {} has {} squares", rank_idx, col));
            }
        }
        Ok(board)
    }

    pub fn to_fen_board(&self) -> String {
        let mut out = String::new();
        for row in (0..8u8).rev() {
            let mut empty_run = 0u8;
            for col in 0..8u8 {
                match self.at(make_sq(row, col)) {
                    None => empty_run += 1,
                    Some(p) => {
                        if empty_run > 0 {
                            out.push((b'0' + empty_run) as char);
                            empty_run = 0;
                        }
                        out.push(Self::piece_to_char(p));
                    }
                }
            }
            if empty_run > 0 {
                out.push((b'0' + empty_run) as char);
            }
            if row > 0 {
                out.push('/');
            }
        }
        out
    }

    pub fn parse_position(
        fen: &str,
    ) -> Result<(Board, Color), String> {
        let mut parts = fen.trim().split_whitespace();
        let board_part = parts.next().ok_or("missing board")?;
        let turn_part = parts.next().ok_or("missing turn")?;
        let board = Board::from_fen_board(board_part)?;
        let turn = match turn_part {
            "w" | "white" | "W" => Color::White,
            "b" | "black" | "B" => Color::Black,
            other => return Err(format!("bad turn '{other}'")),
        };
        Ok((board, turn))
    }
}

#[inline]
pub fn square_to_uci(sq: Square) -> String {
    let col = sq_col(sq);
    let row = sq_row(sq);
    format!("{}{}", (b'a' + col) as char, row + 1)
}

pub fn move_to_uci(mv: Move) -> String {
    format!("{}{}", square_to_uci(mv.from), square_to_uci(mv.to))
}

pub fn uci_to_move(uci: &str) -> Option<Move> {
    let b = uci.trim().as_bytes();
    if b.len() < 4 {
        return None;
    }
    let parse = |file: u8, rank: u8| -> Option<Square> {
        if !(b'a'..=b'h').contains(&file) || !(b'1'..=b'8').contains(&rank) {
            return None;
        }
        Some(make_sq(rank - b'1', file - b'a'))
    };
    let from = parse(b[0], b[1])?;
    let to = parse(b[2], b[3])?;
    Some(Move { from, to })
}
