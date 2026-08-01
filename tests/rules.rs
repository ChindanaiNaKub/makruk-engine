//! Counting-rule spec tests, ported from shared/makrukRules.ts semantics.

use makruk_engine::board::{uci_to_move, Color};
use makruk_engine::counting::{self, CountingType};
use makruk_engine::game::{Game, Outcome};

fn mov(game: &Game, uci: &str) -> makruk_engine::board::Move {
    uci_to_move(uci).unwrap_or_else(|| panic!("bad uci {uci} in {}", game.fen()))
}

#[test]
fn piece_honor_limits_match_spec_table() {
    let cases = [
        ("8/8/8/8/8/8/k2K4/RR6 w", 8),   // 2 rooks
        ("8/8/8/8/8/8/k2K4/R7 w", 16),   // 1 rook
        ("8/8/8/8/8/8/k2K4/SS6 w", 22),  // 2 khons
        ("8/8/8/8/8/8/k2K4/NN6 w", 32),  // 2 knights
        ("8/8/8/8/8/8/k2K4/S7 w", 44),   // 1 khon
        ("8/8/8/8/8/8/k2K4/N7 w", 64),   // 1 knight
        ("8/8/8/8/8/8/k2K4/M7 w", 64),   // 1 met
    ];
    for (fen, limit) in cases {
        let c = counting::fresh_counting_state(
            &makruk_engine::board::Board::parse_position(fen).unwrap().0,
            true,
        )
        .expect("pieces honor expected");
        assert_eq!(c.kind, CountingType::PiecesHonor);
        assert_eq!(c.limit, limit, "{fen}");
        assert!(c.active);
        assert_eq!(c.current_count, c.start_count);
    }
}

#[test]
fn no_counting_while_unpromoted_bia_exist() {
    let game = Game::from_fen("8/8/8/8/8/2p5/k2K4/RR6 w").unwrap();
    assert!(game.counting.is_none());
}

#[test]
fn bare_kings_immediate_draw() {
    let game = Game::from_fen("7k/8/8/8/8/8/8/4K3 w").unwrap();
    assert_eq!(game.outcome, Outcome::InsufficientMaterial);
}

#[test]
fn pieces_honor_start_count_is_piece_total() {
    // K + R vs bare K: 3 pieces -> start count 3, limit 16.
    let game = Game::from_fen("7k/8/8/8/8/8/4K3/R7 w").unwrap();
    let c = game.counting.expect("pieces honor");
    assert_eq!(c.kind, CountingType::PiecesHonor);
    assert_eq!(c.current_count, 3);
    assert_eq!(c.limit, 16);
    assert_eq!(c.counting_color, Color::Black);
    assert_eq!(c.stronger_color, Color::White);
}

#[test]
fn pieces_honor_immediate_draw_when_pieces_exceed_limit() {
    // 2 rooks -> limit 8. With 9 pieces on board, 9 + 1 > 8: instant draw.
    let game = Game::from_fen("7k/8/R7/R7/M7/M7/6K1/M6M w").unwrap();
    assert_eq!(game.outcome, Outcome::CountingDraw);
}

#[test]
fn board_honor_offer_and_clock() {
    // K+M (200) vs K+N (300): white is the weaker side, no bia -> board honor.
    let mut game = Game::from_parts(
        makruk_engine::board::Board::parse_position("8/8/7n/8/8/8/8/K2M3k w")
            .unwrap()
            .0,
        Color::White,
        false, // game-level: no auto start
    );
    let c = game.counting.expect("board honor");
    assert_eq!(c.kind, CountingType::BoardHonor);
    assert!(!c.active);
    assert_eq!(c.limit, 64);
    assert_eq!(c.counting_color, Color::White);
    assert!(game.can_start_counting());

    assert!(game.start_counting());
    assert!(game.counting.unwrap().active);

    // White (the counting side) moves: 1 -> count increments once per move.
    game.do_move(mov(&game, "d1c2"));
    assert_eq!(game.counting.unwrap().current_count, 1);
    // Black moves: clock unchanged.
    game.do_move(mov(&game, "h1g2"));
    assert_eq!(game.counting.unwrap().current_count, 1);
    game.do_move(mov(&game, "c2d1"));
    assert_eq!(game.counting.unwrap().current_count, 2);

    // stop_counting is only legal on the counting side's turn (shared/engine.ts).
    game.do_move(mov(&game, "g2h1"));
    assert!(game.stop_counting());
    assert!(!game.counting.unwrap().active);
}

#[test]
fn pieces_honor_final_attack_mate_wins() {
    // Kh8, white Kg6 + Ra1, black to move. After 13 black moves the count
    // reaches 16 (start 3 + 13), arming the final attack; white must mate on
    // the very next move or the game is drawn.
    let mut game = Game::from_fen("7k/8/6K1/8/8/8/8/R7 b").unwrap();
    let c = game.counting.expect("pieces honor");
    assert_eq!(c.current_count, 3);
    assert_eq!(c.limit, 16);

    let black_dance = ["h8g8", "g8h8"];
    let white_dance = ["a1b1", "b1a1"];

    // 13 black moves -> counts 4..16; 12 white shuffles in between.
    for i in 0..12 {
        game.do_move(mov(&game, black_dance[i % 2]));
        game.do_move(mov(&game, white_dance[i % 2]));
        assert_eq!(game.outcome, Outcome::Ongoing);
    }
    // Black's 13th move (odd index -> h8g8 onto g8).
    game.do_move(mov(&game, "h8g8"));

    let c = game.counting.expect("still counting");
    assert_eq!(c.current_count, 16);
    assert!(c.final_attack_pending);

    // The one allowed final attack: Ra1-a8 is mate (Kg8 boxed by white Khun).
    game.do_move(mov(&game, "a1a8"));
    assert_eq!(game.outcome, Outcome::Checkmate { winner: Color::White });
}

#[test]
fn pieces_honor_final_attack_miss_draws() {
    // Same setup, but the final attack does not mate -> immediate draw.
    let mut game = Game::from_fen("7k/8/6K1/8/8/8/8/R7 b").unwrap();
    let black_dance = ["h8g8", "g8h8"];
    let white_dance = ["a1b1", "b1a1"];
    for i in 0..12 {
        game.do_move(mov(&game, black_dance[i % 2]));
        game.do_move(mov(&game, white_dance[i % 2]));
    }
    game.do_move(mov(&game, "h8g8"));
    assert!(game.counting.unwrap().final_attack_pending);

    // Wasted final attack: shuffle the rook along the back rank is not
    // possible; shuffle it to b8? that's check... use a8-file miss: a1b1 left
    // the rook at a1 (12 white moves even). Play a harmless rook move a1a2.
    game.do_move(mov(&game, "a1a2"));
    assert_eq!(game.outcome, Outcome::CountingDraw);
}

#[test]
fn pieces_honor_running_out_draws() {
    // Let the counting side push the count past the limit by surviving.
    let mut game = Game::from_fen("7k/8/8/8/8/8/4K3/R7 w").unwrap();
    // count starts at 3 (K+R vs K), limit 16. Choreograph a non-mating dance:
    // black king shuttles h-file, white king shuttles back rank far away.
    let mut dance = vec![
        ("a1b1", "h8g8"),
        ("b1a1", "g8h8"),
        ("a1b1", "h8g8"),
        ("b1a1", "g8h8"),
        ("a1b1", "h8g8"),
        ("b1a1", "g8h8"),
        ("a1b1", "h8g8"),
        ("b1a1", "g8h8"),
    ];
    // 8 pairs => black moves 8 times: count 4..11
    for (w, b) in dance.drain(..) {
        assert_eq!(game.outcome, Outcome::Ongoing);
        game.do_move(mov(&game, w));
        game.do_move(mov(&game, b));
    }
    // 5 more black moves => count 16 on the last one... white still shuffling.
    for (w, b) in [
        ("a1b1", "h8g8"),
        ("b1a1", "g8h8"),
        ("a1b1", "h8g8"),
        ("b1a1", "g8h8"),
        ("a1b1", "h8g8"),
    ] {
        assert_eq!(game.outcome, Outcome::Ongoing);
        game.do_move(mov(&game, w));
        game.do_move(mov(&game, b));
    }
    let c = game.counting.unwrap();
    assert_eq!(c.current_count, 16);
    assert!(c.final_attack_pending);

    // White king steps sideways: no mate -> counting-rule draw.
    game.do_move(mov(&game, "b1a1"));
    assert_eq!(game.outcome, Outcome::CountingDraw);
}
