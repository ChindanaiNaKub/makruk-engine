//! UCI-style command handler. The same engine drives the native CLI binary
//! and the browser worker: feed lines in, consume output lines — including
//! `uciok`, `readyok`, `info`, and `bestmove`, so the existing client worker
//! protocol works unchanged.

use crate::board::*;
use crate::counting::{self, serialize_counting};
use crate::game::{perft, perft_divide, Game, Outcome};
use crate::search::{SearchLimits, Searcher};

pub struct UciEngine {
    pub game: Game,
    pub searcher: Searcher,
    pub should_quit: bool,
}

impl UciEngine {
    pub fn new() -> UciEngine {
        UciEngine {
            game: Game::startpos(),
            searcher: Searcher::new(),
            should_quit: false,
        }
    }

    /// Handle one command line; returns output lines to emit.
    pub fn handle(&mut self, input: &str) -> Vec<String> {
        let line = input.trim();
        if line.is_empty() {
            return vec![];
        }
        let mut parts = line.split_whitespace();
        let cmd = parts.next().unwrap_or("");
        let rest = line[cmd.len()..].trim();

        match cmd {
            "uci" => vec![
                "id name makruk-engine 0.1.0".to_string(),
                "id author markrukthai".to_string(),
                "uciok".to_string(),
            ],
            "isready" => vec!["readyok".to_string()],
            "ucinewgame" => {
                self.searcher.clear_tt();
                vec![]
            }
            "setoption" => vec![], // UCI_Variant etc. accepted silently: makruk is all we play
            "stop" | "ponderhit" => vec![],
            "quit" => {
                self.should_quit = true;
                vec![]
            }
            "position" => self.cmd_position(rest),
            "go" => self.cmd_go(rest),
            "perft" => {
                let depth: u32 = rest.parse().unwrap_or(1);
                vec![format!("{}", perft(&mut self.game.clone(), depth))]
            }
            "divide" => {
                let depth: u32 = rest.parse().unwrap_or(1);
                let rows = perft_divide(&mut self.game.clone(), depth);
                let mut out: Vec<String> =
                    rows.iter().map(|(m, n)| format!("{m}: {n}")).collect();
                let total: u64 = rows.iter().map(|(_, n)| n).sum();
                out.push(format!("total: {total}"));
                out
            }
            "d" => vec![self.describe()],
            // Preflight hook: forces eval resolution and reports what was armed,
            // so a silent net->classic fallback cannot survive into a gate block.
            "evalinfo" => vec![format!("info string evalinfo {}", crate::nnue::eval_id())],
            "eval" => vec![format!(
                "eval {}",
                crate::eval::evaluate(&self.game, 0)
            )],
            _ => vec![format!("info string unknown command: {cmd}")],
        }
    }

    fn describe(&self) -> String {
        let outcome = match self.game.outcome {
            Outcome::Ongoing => "ongoing".to_string(),
            Outcome::Checkmate { winner } => format!(
                "checkmate winner={}",
                match winner {
                    Color::White => "white",
                    Color::Black => "black",
                }
            ),
            Outcome::Stalemate => "stalemate".to_string(),
            Outcome::CountingDraw => "draw counting_rule".to_string(),
            Outcome::InsufficientMaterial => "draw insufficient_material".to_string(),
        };
        let counting = self
            .game
            .counting
            .as_ref()
            .map(serialize_counting)
            .unwrap_or_else(|| "none".to_string());
        format!("{} | {} | counting={}", self.game.fen(), outcome, counting)
    }

    fn cmd_position(&mut self, rest: &str) -> Vec<String> {
        let mut tokens = rest.splitn(2, " moves ");
        let head = tokens.next().unwrap_or("").trim();
        let moves_part = tokens.next();

        let fen = if head == "startpos" {
            STARTPOS_FEN.to_string()
        } else if let Some(stripped) = head.strip_prefix("fen ") {
            stripped.trim().to_string()
        } else {
            return vec!["info string position: expected 'startpos' or 'fen <fen>'".into()];
        };

        match Game::from_fen(&fen) {
            Ok(game) => self.game = game,
            Err(e) => return vec![format!("info string invalid fen: {e}")],
        }

        // Track the position history (for search-side repetition handling).
        self.game.position_history = vec![self.game.zobrist_key()];

        if let Some(moves_str) = moves_part {
            for tok in moves_str.split_whitespace() {
                if tok == "counting" {
                    break;
                }
                let mv = match uci_to_move(tok) {
                    Some(m) => m,
                    None => return vec![format!("info string bad move {tok}")],
                };
                if !self.game.is_legal(mv) {
                    return vec![format!("info string illegal move {tok}")];
                }
                self.game.do_move(mv);
                self.game.position_history.push(self.game.zobrist_key());
            }
        }
        vec![]
    }

    fn cmd_go(&mut self, rest: &str) -> Vec<String> {
        let mut limit = SearchLimits {
            depth: 0,
            movetime_ms: 0,
            max_nodes: 0,
        };
        let mut tokens = rest.split_whitespace().peekable();
        while let Some(tok) = tokens.next() {
            match tok {
                "perft" => {
                    let depth: u32 = tokens.next().and_then(|t| t.parse().ok()).unwrap_or(1);
                    let n = perft(&mut self.game.clone(), depth);
                    return vec![format!("info perft {depth} nodes {n}")];
                }
                "depth" => limit.depth = tokens.next().and_then(|t| t.parse().ok()).unwrap_or(5),
                "movetime" => {
                    limit.movetime_ms = tokens.next().and_then(|t| t.parse().ok()).unwrap_or(1000)
                }
                "nodes" => {
                    limit.max_nodes = tokens.next().and_then(|t| t.parse().ok()).unwrap_or(0)
                }
                "infinite" => limit.depth = 32,
                _ => {}
            }
        }
        if limit.depth == 0 && limit.movetime_ms == 0 && limit.max_nodes == 0 {
            limit.depth = 5;
        }

        if self.game.outcome.is_over() {
            return vec!["bestmove (none)".to_string()];
        }

        let info = self.searcher.search(&self.game.clone(), limit);
        let nps = if info.elapsed_ms > 0 {
            info.nodes * 1000 / info.elapsed_ms
        } else {
            info.nodes
        };
        // Replay the PV so promotion suffixes render correctly on every move.
        let mut pv_game = self.game.clone();
        let mut pv_str: Vec<String> = Vec::new();
        for mv in &info.pv {
            pv_str.push(move_to_uci_prom(&pv_game.board, *mv));
            pv_game.do_move(*mv);
        }
        let mut out = vec![format!(
            "info depth {} score cp {} nodes {} nps {} time {} pv {}",
            info.depth,
            info.score,
            info.nodes,
            nps,
            info.elapsed_ms,
            pv_str.join(" ")
        )];
        match info.best_move {
            Some(mv) => out.push(format!(
                "bestmove {}",
                move_to_uci_prom(&self.game.board, mv)
            )),
            None => out.push("bestmove (none)".to_string()),
        }
        out
    }
}

/// Convenience used by the wasm worker: route a full line and join outputs.
pub fn handle_line(engine: &mut UciEngine, line: &str) -> String {
    engine.handle(line).join("\n")
}

pub fn fresh_counting_for(game: &Game) -> Option<String> {
    game.counting.as_ref().map(serialize_counting)
}

pub use counting::parse_counting;
