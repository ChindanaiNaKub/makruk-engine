#[cfg(target_arch = "wasm32")]
fn main() {}

#[cfg(not(target_arch = "wasm32"))]
use makruk_engine::uci::UciEngine;

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    let mut engine = UciEngine::new();
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    use std::io::{BufRead, Write};

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        for out in engine.handle(&line) {
            let mut handle = stdout.lock();
            let _ = writeln!(handle, "{out}");
            let _ = handle.flush();
        }
        if engine.should_quit {
            break;
        }
    }
}
