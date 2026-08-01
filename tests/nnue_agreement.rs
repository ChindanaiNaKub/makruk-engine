//! Python↔Rust NNUE agreement gate (strength-spec v1, M3): the Rust encoder +
//! forward pass must reproduce the int8 artifact's floating-point logits
//! (computed by training/dump_vectors.py) for every fixture position.

use makruk_engine::counting;
use makruk_engine::game::Game;
use makruk_engine::nnue::{encode, TinyNnue};
use std::path::Path;

fn artifact_bytes() -> Option<Vec<u8>> {
    if let Ok(p) = std::env::var("MAKURUK_WEIGHTS") {
        return std::fs::read(p).ok();
    }
    for dir in ["out/v1"] {
        let rd = std::fs::read_dir(dir).ok()?;
        let mut bins: Vec<_> = rd
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x == "bin").unwrap_or(false))
            .collect();
        bins.sort();
        if let Some(p) = bins.pop() {
            return std::fs::read(p).ok();
        }
    }
    None
}

#[test]
fn rust_matches_python_int8_forward() {
    let bin = match artifact_bytes() {
        Some(b) => b,
        None => {
            eprintln!("SKIP: no NNUE artifact (out/v1/*.bin) — run training first");
            return;
        }
    };
    let fixture = Path::new("tests/fixtures/nnue_vectors.jsonl");
    if !fixture.exists() {
        eprintln!("SKIP: tests/fixtures/nnue_vectors.jsonl missing — run training.dump_vectors");
        return;
    }
    let net = TinyNnue::from_bytes(&bin).expect("artifact parses");
    let text = std::fs::read_to_string(fixture).unwrap();
    let mut checked = 0;
    for line in text.lines() {
        let v: serde_json::Value = serde_json::from_str(line).unwrap();
        let fen = v["fen"].as_str().unwrap();
        let counting_s = v["counting"].as_str().unwrap();
        let ply = v["ply"].as_u64().unwrap() as usize;
        let expected: Vec<f64> = v["logits"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_f64().unwrap())
            .collect();

        let mut game = Game::from_fen(fen).unwrap();
        if counting_s != "none" {
            game.set_counting(counting::parse_counting(counting_s));
        }
        game.position_history = vec![0u64; ply];
        let (idxs, ch) = encode(&game);
        let got = net.wdl(&idxs, &ch);
        for i in 0..3 {
            let diff = (got[i] as f64 - expected[i]).abs();
            assert!(
                diff < 2e-3,
                "{fen} logit[{i}]: rust {:.6} vs python {:.6} (diff {diff:.2e})",
                got[i],
                expected[i]
            );
        }
        checked += 1;
    }
    println!("agreement: {checked} vectors matched within 2e-3");
    assert!(checked >= 10);
}
