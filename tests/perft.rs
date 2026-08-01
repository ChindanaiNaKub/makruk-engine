//! Known-answer perft, cross-validated against fairy-stockfish-nnue.wasm
//! (see scripts/mirror-perft.mjs for the live mirror run).

use makruk_engine::board::STARTPOS_FEN;
use makruk_engine::game::{perft, Game};

#[test]
fn startpos_perft() {
    let game = Game::from_fen(STARTPOS_FEN).unwrap();
    assert_eq!(perft(&mut game.clone(), 1), 23);
    assert_eq!(perft(&mut game.clone(), 2), 529);
    assert_eq!(perft(&mut game.clone(), 3), 12012);
    assert_eq!(perft(&mut game.clone(), 4), 273026);
}

#[test]
fn promotion_movegen() {
    // White bia on c5 can push to c6 (promotion row) -> becomes PM.
    let mut game = Game::from_fen("7k/8/8/2P5/8/8/8/4K3 w").unwrap();
    let fen_before = game.fen();
    let moves = game.legal_moves();
    let promo = mov(&game, "c5c6");
    assert!(moves.contains(&promo));
    let undo = game.do_move(promo);
    assert!(game.fen().contains("2F5"));
    game.undo_move(undo);
    assert_eq!(game.fen(), fen_before);
}

#[test]
fn do_undo_roundtrip_startpos() {
    let mut game = Game::startpos();
    let before = (game.fen(), game.zobrist_key(), game.outcome);
    let mut undos = Vec::new();
    for uci in ["c3c4", "c6c5", "b1c3", "b8c6", "e3e4", "e6e5"] {
        let mv = mov(&game, uci);
        assert!(game.is_legal(mv), "{uci} should be legal");
        undos.push(game.do_move(mv));
    }
    for u in undos.into_iter().rev() {
        game.undo_move(u);
    }
    assert_eq!(game.fen(), before.0);
    assert_eq!(game.zobrist_key(), before.1);
    assert_eq!(game.outcome, before.2);
}

fn mov(game: &Game, uci: &str) -> makruk_engine::board::Move {
    makruk_engine::board::uci_to_move(uci).unwrap_or_else(|| {
        panic!("bad uci {uci} in {}", game.fen());
    })
}
