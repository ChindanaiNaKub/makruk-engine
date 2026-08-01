//! makruk-engine: a small, fast Makruk (Thai chess) engine.
//!
//! - Native: `cargo run --bin makruk-engine` gives a UCI-style CLI.
//! - WASM: `wasm-bindgen` exports [`WasmEngine`], one string command in,
//!   output lines out — designed so a thin JS worker can speak the exact
//!   UCI-ish protocol the markrukthai client already uses for fairy-stockfish.

pub mod board;
pub mod counting;
pub mod eval;
pub mod game;
pub mod movegen;
pub mod search;
pub mod uci;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmEngine {
    inner: uci::UciEngine,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmEngine {
        WasmEngine {
            inner: uci::UciEngine::new(),
        }
    }

    /// Feed one UCI-style command line; returns output lines joined by "\n"
    /// (empty string when the command produces no output).
    pub fn command(&mut self, line: &str) -> String {
        uci::handle_line(&mut self.inner, line)
    }

    /// Current position as client-format FEN (board + turn).
    pub fn fen(&self) -> String {
        self.inner.game.fen()
    }

    /// Current counting state in compact form, or empty string when none.
    pub fn counting(&self) -> String {
        uci::fresh_counting_for(&self.inner.game).unwrap_or_default()
    }

    /// Space-separated UCI move list of all legal moves.
    pub fn legal_moves(&self) -> String {
        self.inner
            .game
            .legal_moves()
            .iter()
            .map(|m| board::move_to_uci(*m))
            .collect::<Vec<String>>()
            .join(" ")
    }
}

impl Default for WasmEngine {
    fn default() -> Self {
        Self::new()
    }
}
