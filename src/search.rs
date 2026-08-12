//! Negamax alpha-beta with iterative deepening, aspiration windows,
//! transposition table, quiescence, MVV-LVA ordering, killers, and history.

use std::collections::HashSet;

use crate::board::*;
use crate::eval;
use crate::game::{Game, Outcome};

const MAX_PLY: usize = 128;
const TT_SIZE: usize = 1 << 18;
const TT_MASK: usize = TT_SIZE - 1;
const INF: i32 = 1_000_000;
const MATE: i32 = eval::CHECKMATE_SCORE;
/// Aspiration half-window in centipawns. CT800 measured +18 Elo with a 50 cp
/// window from depth 4 at depths that match this engine (8–10 plies). Research
/// ticket 03 / ADR 0003 lever 3.
const ASPIRATION_WINDOW: i32 = 50;
/// Depths below this search with a full window — the score is too noisy for a
/// narrow window to pay, and CT800's measured figure started at depth 4.
const ASPIRATION_MIN_DEPTH: u32 = 4;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Bound {
    Exact,
    Lower,
    Upper,
}

#[derive(Clone, Copy)]
struct TtEntry {
    key: u64,
    depth: i16,
    score: i32,
    bound: Bound,
    best: Move,
}

const NULL_MOVE: Move = Move { from: 0, to: 0 };

#[derive(Clone, Copy, Default)]
pub struct SearchLimits {
    pub depth: u32,
    pub movetime_ms: u64,
    pub max_nodes: u64,
}

pub struct SearchInfo {
    pub best_move: Option<Move>,
    pub score: i32,
    pub depth: u32,
    pub nodes: u64,
    pub pv: Vec<Move>,
    pub elapsed_ms: u64,
}

pub struct Searcher {
    tt: Vec<Option<TtEntry>>,
    killers: [[Option<Move>; 2]; MAX_PLY],
    history: [[i32; 64 * 64]; 2],
    nodes: u64,
    limit: SearchLimits,
    deadline_ms: Option<f64>,
    hard_deadline_ms: Option<f64>,
    iteration_one_complete: bool,
    stopped: bool,
    history_set: HashSet<u64>,
}

#[inline]
fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now()
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }
}

/// True when `color` holds at least one piece that is neither the khun nor an
/// unpromoted bia — the null-move zugzwang guard. Promoted bia counts: it moves
/// like a met, so it has somewhere to go that is not straight ahead.
#[inline]
fn has_non_bia_material(board: &Board, color: Color) -> bool {
    board.squares.iter().flatten().any(|p| {
        p.color == color && !matches!(p.kind, Kind::K | Kind::P)
    })
}

impl Searcher {
    pub fn new() -> Searcher {
        Searcher {
            tt: vec![None; TT_SIZE],
            killers: [[None; 2]; MAX_PLY],
            history: [[0; 64 * 64]; 2],
            nodes: 0,
            limit: SearchLimits::default(),
            deadline_ms: None,
            hard_deadline_ms: None,
            iteration_one_complete: false,
            stopped: false,
            history_set: HashSet::new(),
        }
    }

    pub fn clear_tt(&mut self) {
        for e in self.tt.iter_mut() {
            *e = None;
        }
    }

    fn should_stop(&mut self) -> bool {
        if self.nodes & 2047 != 0 {
            return self.stopped;
        }
        if self.limit.max_nodes > 0 && self.nodes >= self.limit.max_nodes {
            self.stopped = true;
        }
        // Hard cap: always enforced, so a degenerate position can't hang us.
        if let Some(hdl) = self.hard_deadline_ms {
            if now_ms() >= hdl {
                self.stopped = true;
                return self.stopped;
            }
        }
        // Soft cap: ignored until iteration 1 completes, so the root always
        // has a fully scored move even under severe CPU contention.
        if self.iteration_one_complete {
            if let Some(dl) = self.deadline_ms {
                if now_ms() >= dl {
                    self.stopped = true;
                }
            }
        }
        self.stopped
    }

    pub fn search(&mut self, game: &Game, limit: SearchLimits) -> SearchInfo {
        self.nodes = 0;
        self.stopped = false;
        self.limit = limit;
        self.killers = [[None; 2]; MAX_PLY];
        self.iteration_one_complete = false;
        self.deadline_ms = if limit.movetime_ms > 0 {
            Some(now_ms() + limit.movetime_ms as f64)
        } else {
            None
        };
        self.hard_deadline_ms = if limit.movetime_ms > 0 {
            Some(now_ms() + limit.movetime_ms as f64 * 5.0 + 250.0)
        } else {
            None
        };
        self.history_set = game.position_history.iter().copied().collect();
        let start = now_ms();

        let mut root = game.clone();
        let mut best_move: Option<Move> = None;
        let mut best_score = 0i32;
        let mut completed_depth = 0u32;

        let max_depth = if limit.depth > 0 {
            limit.depth
        } else if limit.movetime_ms > 0 {
            64 // time-bounded: iterate until the clock stops us
        } else {
            5
        };

        // Aspiration windows: after a stable shallow score, search the next
        // depth inside [score ± WINDOW] and only open the window on a fail.
        // Reuses the previous iteration's score (and, via the TT, its PV move).
        // Depths below ASPIRATION_MIN_DEPTH keep the full window.
        let mut asp_alpha = -INF;
        let mut asp_beta = INF;

        for depth in 1..=max_depth {
            let mut alpha = asp_alpha;
            let mut beta = asp_beta;
            let score = loop {
                let s = self.negamax(&mut root, depth as i16, 0, alpha, beta);
                if self.stopped {
                    break s;
                }
                if s <= alpha {
                    // Fail low — open the bottom and re-search.
                    alpha = -INF;
                    continue;
                }
                if s >= beta {
                    // Fail high — open the top and re-search.
                    beta = INF;
                    continue;
                }
                break s;
            };
            // An interrupted iteration must not overwrite a completed shallower
            // result: the score and TT move may be from a truncated tree.
            if self.stopped && depth > 1 {
                break;
            }
            if let Some(entry) = self.probe(root.zobrist_key()) {
                if entry.best != NULL_MOVE && root.is_legal(entry.best) {
                    best_move = Some(entry.best);
                }
            }
            best_score = score;
            completed_depth = depth;
            self.iteration_one_complete = true;
            if best_score.abs() >= MATE - MAX_PLY as i32 {
                break; // mate found, no need to search deeper
            }
            // Seed the next iteration's window from this score.
            if depth + 1 >= ASPIRATION_MIN_DEPTH {
                asp_alpha = best_score.saturating_sub(ASPIRATION_WINDOW).max(-INF);
                asp_beta = best_score.saturating_add(ASPIRATION_WINDOW).min(INF);
            } else {
                asp_alpha = -INF;
                asp_beta = INF;
            }
            if let Some(dl) = self.deadline_ms {
                // Don't start a new iteration we cannot plausibly finish.
                if now_ms() > dl - limit.movetime_ms.min(50) as f64 {
                    break;
                }
            }
        }

        // Defensive: never return an empty hand on an ongoing game.
        if best_move.is_none() {
            best_move = root.legal_moves().first().copied();
        }

        SearchInfo {
            best_move,
            score: best_score,
            depth: completed_depth,
            nodes: self.nodes,
            pv: self.best_line(&root, completed_depth as usize),
            elapsed_ms: (now_ms() - start) as u64,
        }
    }

    #[inline]
    fn probe(&self, key: u64) -> Option<TtEntry> {
        self.tt[(key as usize) & TT_MASK].filter(|e| e.key == key)
    }

    #[inline]
    fn store(&mut self, key: u64, depth: i16, score: i32, bound: Bound, best: Move) {
        let idx = (key as usize) & TT_MASK;
        let replace = match self.tt[idx] {
            None => true,
            Some(old) => old.depth <= depth,
        };
        if replace {
            self.tt[idx] = Some(TtEntry {
                key,
                depth,
                score,
                bound,
                best,
            });
        }
    }

    fn negamax(&mut self, game: &mut Game, depth: i16, ply: u32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        if self.should_stop() {
            return eval::evaluate(game, ply);
        }

        match game.outcome {
            Outcome::Checkmate { .. } => return -(MATE - ply as i32),
            Outcome::Stalemate | Outcome::CountingDraw | Outcome::InsufficientMaterial => return 0,
            Outcome::Ongoing => {}
        }

        if depth <= 0 {
            return self.quiescence(game, ply, alpha, beta);
        }

        let ply_i = (ply as usize).min(MAX_PLY - 1);
        let key = game.zobrist_key();

        // Repetition: positions already seen in the real game are treated as
        // draws so the engine stops shuffling when it can make progress.
        if ply > 0 && self.history_set.contains(&key) {
            return 0;
        }

        let mut tt_move: Option<Move> = None;
        if let Some(entry) = self.probe(key) {
            tt_move = Some(entry.best);
            if entry.depth >= depth {
                match entry.bound {
                    Bound::Exact => return entry.score,
                    Bound::Lower if entry.score >= beta => return entry.score,
                    Bound::Upper if entry.score <= alpha => return entry.score,
                    _ => {}
                }
            }
        }

        let in_check = crate::movegen::is_in_check(&game.board, game.turn);
        // Small check extension keeps tactical lines honest.
        let ext: i16 = if in_check { 1 } else { 0 };

        // Null-move pruning: hand the opponent a free move and search shallow.
        // If the position still beats beta after that, it is almost certainly a
        // cut-node. Skipped when in check, when beta is already a mate score,
        // while a count is running (a free move would misstate the clock the
        // eval reads), and in king+bia material where zugzwang is real — bia
        // move one square forward only, so "pass" is not always a gift.
        let counting_active = game.counting.map_or(false, |c| c.active);
        if depth >= 3
            && !in_check
            && beta.abs() < MATE - MAX_PLY as i32
            && !counting_active
            && has_non_bia_material(&game.board, game.turn)
        {
            let r = 2 + depth / 6;
            let nundo = game.do_null_move();
            let score = -self.negamax(game, depth - 1 - r, ply + 1, -beta, -beta + 1);
            game.undo_null_move(nundo);
            if self.stopped {
                return alpha;
            }
            if score >= beta {
                // A mate score out of a null search is unproven — the opponent
                // never got to defend. Return the bound, not the claim.
                return if score >= MATE - MAX_PLY as i32 {
                    beta
                } else {
                    score
                };
            }
        }

        let mut moves = game.legal_moves();
        if moves.is_empty() {
            // Should be unreachable (outcome would not be Ongoing), defensive.
            return if in_check { -(MATE - ply as i32) } else { 0 };
        }
        self.order_moves(game, &mut moves, tt_move, ply_i);

        let mut best = -INF;
        let mut best_move = moves[0];
        let alpha_orig = alpha;

        for (i, mv) in moves.into_iter().enumerate() {
            let undo = game.do_move(mv);

            // Late move reductions: the ordering above puts the plausible moves
            // first, so a quiet move this far down the list is searched shallow
            // and only re-searched at full depth if it beats alpha anyway.
            // Captures, promotions, check evasions and checking moves keep full
            // depth — those are exactly the moves ordering can misjudge.
            let reduction = if depth >= 3 && i >= 3 && ext == 0 && undo.captured.is_none()
                && !undo.promoted
                && !crate::movegen::is_in_check(&game.board, game.turn)
            {
                let r = 1 + (i >= 6) as i16 + depth / 8;
                r.min(depth - 2)
            } else {
                0
            };

            let mut score = -self.negamax(
                game,
                depth - 1 + ext - reduction,
                ply + 1,
                if reduction > 0 { -(alpha + 1) } else { -beta },
                -alpha,
            );
            if reduction > 0 && score > alpha && !self.stopped {
                score = -self.negamax(game, depth - 1 + ext, ply + 1, -beta, -alpha);
            }
            game.undo_move(undo);
            if self.stopped {
                return best.max(alpha);
            }
            if score > best {
                best = score;
                best_move = mv;
            }
            if score > alpha {
                alpha = score;
                self.history[game.turn as usize][(mv.from as usize) * 64 + mv.to as usize] +=
                    (depth as i32) * (depth as i32);
            }
            if alpha >= beta {
                if undo.captured.is_none() {
                    self.push_killer(ply_i, mv);
                }
                break;
            }
        }

        let bound = if best <= alpha_orig {
            Bound::Upper
        } else if best >= beta {
            Bound::Lower
        } else {
            Bound::Exact
        };
        if best > -INF + 1 {
            self.store(key, depth, best, bound, best_move);
        }
        best
    }

    fn quiescence(&mut self, game: &mut Game, ply: u32, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        if self.should_stop() {
            return eval::evaluate(game, ply);
        }

        match game.outcome {
            Outcome::Checkmate { .. } => return -(MATE - ply as i32),
            Outcome::Stalemate | Outcome::CountingDraw | Outcome::InsufficientMaterial => return 0,
            Outcome::Ongoing => {}
        }

        let stand_pat = eval::evaluate(game, ply);
        if stand_pat >= beta {
            return beta;
        }
        if stand_pat > alpha {
            alpha = stand_pat;
        }
        if ply as usize >= MAX_PLY - 1 {
            return alpha;
        }

        let mut moves = game.legal_moves();
        moves.retain(|mv| {
            game.board.at(mv.to).is_some() // captures
                || is_promotion_move(&game.board, *mv) // promotion swings are forcing
        });
        self.order_moves(game, &mut moves, None, ply as usize);

        for mv in moves {
            let undo = game.do_move(mv);
            let score = -self.quiescence(game, ply + 1, -beta, -alpha);
            game.undo_move(undo);
            if self.stopped {
                return alpha;
            }
            if score >= beta {
                return beta;
            }
            if score > alpha {
                alpha = score;
            }
        }
        alpha
    }

    fn push_killer(&mut self, ply: usize, mv: Move) {
        if self.killers[ply][0] != Some(mv) {
            self.killers[ply][1] = self.killers[ply][0];
            self.killers[ply][0] = Some(mv);
        }
    }

    fn order_moves(&self, game: &Game, moves: &mut [Move], tt_move: Option<Move>, ply: usize) {
        let movers_color = game.turn as usize;
        let score = |mv: &Move| -> i32 {
            if Some(*mv) == tt_move {
                return 1_000_000;
            }
            let mut s = 0i32;
            if let Some(victim) = game.board.at(mv.to) {
                s += 100_000 + 10 * victim.kind.counting_value();
                if let Some(attacker) = game.board.at(mv.from) {
                    s -= attacker.kind.counting_value();
                }
            }
            if is_promotion_move(&game.board, *mv) {
                s += 50_000;
            }
            if ply < MAX_PLY {
                if self.killers[ply][0] == Some(*mv) {
                    s += 30_000;
                } else if self.killers[ply][1] == Some(*mv) {
                    s += 25_000;
                }
            }
            s + self.history[movers_color][(mv.from as usize) * 64 + mv.to as usize]
        };
        moves.sort_by_cached_key(|mv| -score(mv));
    }

    /// Reconstruct the principal variation by following TT entries.
    fn best_line(&self, root: &Game, max_len: usize) -> Vec<Move> {
        let mut game = root.clone();
        let mut pv = Vec::new();
        for _ in 0..max_len {
            match self.probe(game.zobrist_key()) {
                Some(entry) => {
                    let mv = entry.best;
                    if !game.is_legal(mv) {
                        break;
                    }
                    game.do_move(mv);
                    pv.push(mv);
                    if game.outcome.is_over() {
                        break;
                    }
                }
                None => break,
            }
        }
        pv
    }
}
