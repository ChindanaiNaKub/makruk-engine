//! Game state: make/unmake moves, exact adjudication ordering from
//! shared/engine.ts makeMove, zobrist keys, perft.

use crate::board::*;
use crate::counting::{self, CountingState, CountingType};
use crate::movegen;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Outcome {
    Ongoing,
    Checkmate { winner: Color },
    Stalemate,
    CountingDraw,
    InsufficientMaterial,
}

impl Outcome {
    pub fn is_over(self) -> bool {
        self != Outcome::Ongoing
    }
}

#[derive(Clone)]
pub struct Game {
    pub board: Board,
    pub turn: Color,
    pub counting: Option<CountingState>,
    pub outcome: Outcome,
    /// When true, a freshly detected Sak Kradan begins counting immediately.
    /// Search default: true (weaker side always counts in rational play).
    pub board_honor_auto_start: bool,
}

#[derive(Clone, Copy)]
pub struct Undo {
    pub(crate) mv: Move,
    pub(crate) captured: Option<Piece>,
    pub(crate) promoted: bool,
    pub(crate) prev_counting: Option<CountingState>,
    pub(crate) prev_outcome: Outcome,
}

impl Game {
    pub fn startpos() -> Game {
        Game::from_fen(STARTPOS_FEN).expect("valid startpos")
    }

    pub fn from_fen(fen: &str) -> Result<Game, String> {
        let (board, turn) = Board::parse_position(fen)?;
        Ok(Game::from_parts(board, turn, true))
    }

    pub fn from_parts(board: Board, turn: Color, board_honor_auto_start: bool) -> Game {
        let mut game = Game {
            board,
            turn,
            counting: None,
            outcome: Outcome::Ongoing,
            board_honor_auto_start,
        };
        game.counting = counting::fresh_counting_state(&game.board, board_honor_auto_start);
        game.outcome = game.initial_outcome();
        game
    }

    /// Board-only adjudication for positions loaded fresh (no mover info):
    /// matches makeMove's tail checks for mate/stalemate/bare kings.
    fn initial_outcome(&self) -> Outcome {
        let check = movegen::is_in_check(&self.board, self.turn);
        let has_legal = movegen::has_any_legal_move(&self.board, self.turn);
        if check && !has_legal {
            return Outcome::Checkmate {
                winner: self.turn.other(),
            };
        }
        if !check && !has_legal {
            return Outcome::Stalemate;
        }
        if counting::has_bare_kings_only(&self.board) {
            return Outcome::InsufficientMaterial;
        }
        if let Some(c) = &self.counting {
            if c.kind == CountingType::PiecesHonor
                && counting::pieces_honor_immediate_draw(&self.board, c.stronger_color)
            {
                return Outcome::CountingDraw;
            }
        }
        Outcome::Ongoing
    }

    pub fn legal_moves(&self) -> Vec<Move> {
        movegen::legal_moves(&self.board, self.turn)
    }

    pub fn is_legal(&self, mv: Move) -> bool {
        self.legal_moves().contains(&mv)
    }

    pub fn fen(&self) -> String {
        let turn = match self.turn {
            Color::White => "w",
            Color::Black => "b",
        };
        format!("{} {}", self.board.to_fen_board(), turn)
    }

    /// Apply a legal move without structural validation (used by perft/search
    /// after generating legal moves). Returns an Undo token.
    pub fn do_move(&mut self, mv: Move) -> Undo {
        let mover = self.turn;
        let mut piece = self.board.squares[mv.from as usize]
            .take()
            .expect("do_move on empty square");
        let captured = self.board.squares[mv.to as usize].take();
        let promoted = piece.kind == Kind::P && sq_row(mv.to) == piece.color.promotion_row();
        if promoted {
            piece.kind = Kind::PM;
        }
        self.board.squares[mv.to as usize] = Some(piece);

        let undo = Undo {
            mv,
            captured,
            promoted,
            prev_counting: self.counting,
            prev_outcome: self.outcome,
        };

        self.turn = mover.other();
        self.outcome = self.adjudicate(mover);
        undo
    }

    pub fn undo_move(&mut self, undo: Undo) {
        let mut piece = self.board.squares[undo.mv.to as usize]
            .take()
            .expect("undo_move on empty square");
        if undo.promoted {
            piece.kind = Kind::P;
        }
        self.board.squares[undo.mv.from as usize] = Some(piece);
        self.board.squares[undo.mv.to as usize] = undo.captured;
        self.turn = piece.color;
        self.counting = undo.prev_counting;
        self.outcome = undo.prev_outcome;
    }

    /// Port of the adjudication tail of shared/engine.ts makeMove, in the same
    /// order. `mover` is the side that just moved; `new_state` fields like
    /// check/mate/stalemate refer to the side now to move.
    fn adjudicate(&mut self, mover: Color) -> Outcome {
        let to_move = mover.other();
        let check = movegen::is_in_check(&self.board, to_move);
        let has_legal = movegen::has_any_legal_move(&self.board, to_move);
        let is_checkmate = check && !has_legal;
        let is_stalemate = !check && !has_legal;

        let mut counting_next =
            counting::next_counting_state(self.counting.as_ref(), &self.board, self.board_honor_auto_start);

        // 1) Pieces-honor immediate draw. TS checks this before awarding mate,
        //    so a mating move that also completes the draw is a draw.
        if let Some(c) = &counting_next {
            if c.kind == CountingType::PiecesHonor
                && counting::pieces_honor_immediate_draw(&self.board, c.stronger_color)
            {
                self.counting = None;
                return Outcome::CountingDraw;
            }
        }

        // 2) Counting-side move increments the clock.
        if let Some(c) = &mut counting_next {
            let mut c = *c;
            if c.active && mover == c.counting_color {
                c.current_count += 1;
                if c.kind == CountingType::BoardHonor {
                    if c.current_count > c.limit {
                        self.counting = None;
                        return Outcome::CountingDraw;
                    }
                } else if c.current_count > c.limit {
                    self.counting = None;
                    return Outcome::CountingDraw;
                } else if c.current_count == c.limit {
                    c.final_attack_pending = true;
                }
                counting_next = Some(c);
            } else if c.kind == CountingType::PiecesHonor
                && c.final_attack_pending
                && mover == c.stronger_color
            {
                // 3) Stronger side's single final attack after count == limit.
                c.final_attack_pending = false;
                counting_next = Some(c);
                if !is_checkmate {
                    self.counting = None;
                    return Outcome::CountingDraw;
                }
            }
        }
        // 4) Mate, 5) stalemate, 6) bare kings.
        if is_checkmate {
            self.counting = None;
            return Outcome::Checkmate { winner: mover };
        }
        if is_stalemate {
            self.counting = None;
            return Outcome::Stalemate;
        }
        if counting::has_bare_kings_only(&self.board) {
            self.counting = None;
            return Outcome::InsufficientMaterial;
        }

        self.counting = counting_next;
        Outcome::Ongoing
    }

    /// Manual Sak Kradan controls (game-level parity with shared/engine.ts).
    pub fn can_start_counting(&self) -> bool {
        matches!(
            &self.counting,
            Some(c) if c.kind == CountingType::BoardHonor
                && !self.outcome.is_over()
                && !c.active
                && self.turn == c.counting_color
        )
    }

    pub fn can_stop_counting(&self) -> bool {
        matches!(
            &self.counting,
            Some(c) if c.kind == CountingType::BoardHonor
                && !self.outcome.is_over()
                && c.active
                && self.turn == c.counting_color
        )
    }

    pub fn start_counting(&mut self) -> bool {
        if !self.can_start_counting() {
            return false;
        }
        let c = self.counting.as_mut().unwrap();
        c.active = true;
        c.current_count = c.start_count;
        c.final_attack_pending = false;
        true
    }

    pub fn stop_counting(&mut self) -> bool {
        if !self.can_stop_counting() {
            return false;
        }
        let c = self.counting.as_mut().unwrap();
        c.active = false;
        c.final_attack_pending = false;
        true
    }

    pub fn set_counting(&mut self, counting: Option<CountingState>) {
        self.counting = counting;
        self.outcome = self.initial_outcome();
    }
}

/// Zobrist keys, generated at compile time with a fixed-seed xorshift.
pub mod zobrist {

    const SEED: u64 = 0x9E3779B97F4A7C15;

    const fn xorshift(mut x: u64) -> u64 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        x
    }

    // 2 colors * 7 kinds * 64 squares + 1 side key
    pub const PIECES: [[[u64; 64]; 7]; 2] = {
        let mut table = [[[0u64; 64]; 7]; 2];
        let mut state = SEED;
        let mut c = 0;
        while c < 2 {
            let mut k = 0;
            while k < 7 {
                let mut s = 0;
                while s < 64 {
                    state = xorshift(state);
                    table[c][k][s] = state;
                    s += 1;
                }
                k += 1;
            }
            c += 1;
        }
        table
    };

    pub const SIDE: u64 = xorshift(xorshift(SEED));

    #[inline]
    pub fn mix_counting(kind: u8, counting_color: u8, count: u16, limit: u16, active: bool) -> u64 {
        let packed: u64 = kind as u64
            | (counting_color as u64) << 8
            | (count as u64) << 16
            | (limit as u64) << 32
            | (active as u64) << 48;
        // splitmix64
        let mut z = packed.wrapping_add(0x9E3779B97F4A7C15);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
}

impl Game {
    pub fn zobrist_key(&self) -> u64 {
        let mut h = 0u64;
        for (i, cell) in self.board.squares.iter().enumerate() {
            if let Some(p) = cell {
                h ^= zobrist::PIECES[p.color as usize][p.kind as usize][i];
            }
        }
        if self.turn == Color::Black {
            h ^= zobrist::SIDE;
        }
        if let Some(c) = &self.counting {
            h ^= zobrist::mix_counting(
                match c.kind {
                    CountingType::BoardHonor => 0,
                    CountingType::PiecesHonor => 1,
                },
                match c.counting_color {
                    Color::White => 0,
                    Color::Black => 1,
                },
                c.current_count.min(63),
                c.limit,
                c.active,
            );
        }
        h
    }
}

pub fn perft(game: &mut Game, depth: u32) -> u64 {
    if depth == 0 {
        return 1;
    }
    let mut nodes = 0u64;
    let moves = game.legal_moves();
    if depth == 1 {
        return moves.len() as u64;
    }
    for mv in moves {
        let undo = game.do_move(mv);
        // Deliberately expand past game-over children, matching fairy-stockfish
        // perft semantics (a position with no legal moves contributes 0 deeper).
        nodes += perft(game, depth - 1);
        game.undo_move(undo);
    }
    nodes
}

/// Perft with divide output (one line per root move).
pub fn perft_divide(game: &mut Game, depth: u32) -> Vec<(String, u64)> {
    let mut rows = Vec::new();
    for mv in game.legal_moves() {
        let undo = game.do_move(mv);
        let n = perft(game, depth - 1);
        game.undo_move(undo);
        rows.push((move_to_uci(mv), n));
    }
    rows
}
