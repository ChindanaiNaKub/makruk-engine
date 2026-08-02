//! Tiny NNUE eval (strength-spec v1 §1): 768 -> 256 clip-ReLU accumulator,
//! concat 9 counting side-channels -> 32 -> 32 -> WDL3.
//!
//! Loads a Moka-style flat `.bin` (export.py layout: int8 weights with f32
//! per-output-channel scales + f32 biases, 4-byte-aligned chunks). The JSON
//! manifest + sha256 check stay worker-side (crypto.subtle); this module only
//! parses the fixed-layout bin. Native CLI opts in per process:
//!   MAKURUK_EVAL=net MAKURUK_WEIGHTS=out/v1/makruk-tiny-<hash>.bin
//! WASM: `WasmEngine::init_nnue(bytes)`.

use crate::board::{Color, Kind};
use crate::counting::CountingType;
use crate::game::Game;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::RwLock;

pub const N_FEATURES: usize = 768;
pub const N_CHANNELS: usize = 9;
const L1: usize = 256;
const L2: usize = 32;
const L3: usize = 32;

pub struct TinyNnue {
    table: Vec<f32>, // 768 * L1, dequantized at load
    ft_bias: [f32; L1],
    fc1_w: Vec<f32>, // L2 * (L1 + N_CHANNELS)
    fc1_b: [f32; L2],
    fc2_w: Vec<f32>, // L3 * L2
    fc2_b: [f32; L3],
    out_w: Vec<f32>, // 3 * L3
    out_b: [f32; 3],
}

struct Cursor<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Cursor<'a> {
    fn align(&mut self) {
        while self.p % 4 != 0 {
            self.p += 1;
        }
    }
    fn int8_table(&mut self, rows: usize, cols: usize) -> Result<Vec<f32>, String> {
        self.align();
        let n = rows * cols;
        let raw: &[i8] = bytemuck_i8(self.b, self.p, n)?;
        self.p += n;
        self.align();
        let scales = self.f32s(cols)?; // per-output-channel (one scale per column)
        let mut out = Vec::with_capacity(n);
        for r in 0..rows {
            for c in 0..cols {
                out.push(raw[r * cols + c] as f32 * scales[c]);
            }
        }
        Ok(out)
    }
    fn int8_rows(&mut self, rows: usize, cols: usize) -> Result<Vec<f32>, String> {
        self.align();
        let n = rows * cols;
        let raw: &[i8] = bytemuck_i8(self.b, self.p, n)?;
        self.p += n;
        self.align();
        let scales = self.f32s(rows)?;
        let mut out = Vec::with_capacity(n);
        for r in 0..rows {
            let s = scales[r];
            for c in 0..cols {
                out.push(raw[r * cols + c] as f32 * s);
            }
        }
        Ok(out)
    }
    fn f32s(&mut self, n: usize) -> Result<Vec<f32>, String> {
        if self.p + 4 * n > self.b.len() {
            return Err("bin too short (f32)".into());
        }
        let mut v = Vec::with_capacity(n);
        for i in 0..n {
            let o = self.p + 4 * i;
            v.push(f32::from_le_bytes([self.b[o], self.b[o + 1], self.b[o + 2], self.b[o + 3]]));
        }
        self.p += 4 * n;
        Ok(v)
    }
    fn done(&self) -> bool {
        // trailing bytes beyond EOF tolerance: none — cursor must land exactly
        self.p == self.b.len()
    }
}

fn bytemuck_i8(b: &[u8], off: usize, n: usize) -> Result<&[i8], String> {
    if off + n > b.len() {
        return Err("bin too short (int8)".into());
    }
    Ok(unsafe { std::slice::from_raw_parts(b[off..].as_ptr() as *const i8, n) })
}

impl TinyNnue {
    /// Parse the export.py fixed layout:
    /// ft.weight(int8 768x256, 256 scales) | ft.bias | fc1(int8 32x265, 32)
    /// fc2(int8 32x32, 32) | out(int8 3x32, 3); biases f32.
    pub fn from_bytes(bytes: &[u8]) -> Result<TinyNnue, String> {
        let fc1_in = L1 + N_CHANNELS;
        let mut c = Cursor { b: bytes, p: 0 };
        let table = c.int8_table(N_FEATURES, L1)?;
        let ft_bias = vec_to_arr::<L1>(c.f32s(256)?)?;
        let fc1_w = c.int8_rows(L2, fc1_in)?;
        let fc1_b = vec_to_arr::<L2>(c.f32s(L2)?)?;
        let fc2_w = c.int8_rows(L3, L2)?;
        let fc2_b = vec_to_arr::<L3>(c.f32s(L3)?)?;
        let out_w = c.int8_rows(3, L3)?;
        let out_b = vec_to_arr::<3>(c.f32s(3)?)?;
        if !c.done() {
            return Err(format!("bin has {} trailing bytes", bytes.len() - c.p));
        }
        Ok(TinyNnue { table, ft_bias, fc1_w, fc1_b, fc2_w, fc2_b, out_w, out_b })
    }

    /// WDL logits for a position encoded as (feature indices, side channels).
    /// zip-iterator loops elide bounds checks and auto-vectorize.
    pub fn wdl(&self, idxs: &[u32], ch: &[f32; N_CHANNELS]) -> [f32; 3] {
        let mut acc = self.ft_bias;
        for &i in idxs {
            let row = &self.table[i as usize * L1..(i as usize + 1) * L1];
            for (a, b) in acc.iter_mut().zip(row.iter()) {
                *a += b;
            }
        }
        for a in acc.iter_mut() {
            *a = a.clamp(0.0, 1.0);
        }
        let mut x = [0f32; L1 + N_CHANNELS];
        x[..L1].copy_from_slice(&acc);
        x[L1..].copy_from_slice(ch);

        // NOTE: trained order is relu(W·x) + b (model.py) — bias after activation.
        let mut h1 = [0f32; L2];
        for j in 0..L2 {
            let wrow = &self.fc1_w[j * (L1 + N_CHANNELS)..(j + 1) * (L1 + N_CHANNELS)];
            let s: f32 = wrow.iter().zip(x.iter()).map(|(w, v)| w * v).sum();
            h1[j] = s.max(0.0) + self.fc1_b[j];
        }
        let mut h2 = [0f32; L3];
        for j in 0..L3 {
            let wrow = &self.fc2_w[j * L2..(j + 1) * L2];
            let s: f32 = wrow.iter().zip(h1.iter()).map(|(w, v)| w * v).sum();
            h2[j] = s.max(0.0) + self.fc2_b[j];
        }
        let mut logits = [0f32; 3];
        for o in 0..3 {
            let wrow = &self.out_w[o * L3..(o + 1) * L3];
            let s: f32 = wrow.iter().zip(h2.iter()).map(|(w, v)| w * v).sum();
            logits[o] = s + self.out_b[o];
        }
        logits
    }

    /// Scalar eval in centipawn-class units (spec §1: (W - L) * 1000).
    pub fn eval_cp(&self, idxs: &[u32], ch: &[f32; N_CHANNELS]) -> i32 {
        let l = self.wdl(idxs, ch);
        let m = l[0].max(l[1]).max(l[2]);
        let e0 = (l[0] - m).exp();
        let e1 = (l[1] - m).exp();
        let e2 = (l[2] - m).exp();
        let s = e0 + e1 + e2;
        (((e0 - e2) / s) * 1000.0) as i32
    }
}

fn vec_to_arr<const N: usize>(v: Vec<f32>) -> Result<[f32; N], String> {
    v.try_into().map_err(|_| "bad tensor width".to_string())
}

/// Encode a Game position into (feature indices, counting channels).
/// Mirrors training/makruk/features.py exactly: stm-canonical rank-flip +
/// color-swap, PM folds to M, type order K M S N R P.
pub fn encode(game: &Game) -> (Vec<u32>, [f32; N_CHANNELS]) {
    let flip = game.turn == Color::Black;
    let mut idxs = Vec::with_capacity(32);
    for (idx, cell) in game.board.squares.iter().enumerate() {
        let piece = match cell {
            Some(p) => *p,
            None => continue,
        };
        let (r, c) = (idx / 8, idx % 8);
        let sq = if flip { (7 - r) * 8 + c } else { idx };
        let color = if flip { piece.color.other() } else { piece.color };
        let kind_i = match piece.kind {
            Kind::K => 0,
            Kind::M | Kind::PM => 1,
            Kind::S => 2,
            Kind::N => 3,
            Kind::R => 4,
            Kind::P => 5,
        };
        let band = if color == Color::White { 0 } else { 6 };
        idxs.push((sq * 12 + kind_i + band) as u32);
    }
    (idxs, channels(game))
}

fn channels(game: &Game) -> [f32; N_CHANNELS] {
    let mut ch = [0f32; N_CHANNELS];
    if let Some(c) = &game.counting {
        if c.active {
            let ph = (c.kind == CountingType::PiecesHonor) as u8 as f32;
            let bh = (c.kind == CountingType::BoardHonor) as u8 as f32;
            ch[0] = ph;
            ch[1] = bh;
            ch[2] = c.current_count as f32 / c.limit as f32;
            ch[3] = c.limit as f32 / 64.0;
            ch[4] = if c.counting_color == game.turn { 1.0 } else { -1.0 };
            ch[5] = c.final_attack_pending as u8 as f32;
            ch[8] = ph + bh;
        }
    }
    ch[6] = (game.position_history.len().min(400) as f32) / 200.0;
    ch[7] = 0.0; // repetition awareness is search-side only (spec §8)
    ch
}

// ---------- global wiring ----------
static NET: RwLock<Option<TinyNnue>> = RwLock::new(None);
static MODE: AtomicU8 = AtomicU8::new(0); // 0=unknown, 1=classic, 2=net
/// What `mode()` actually armed, as opposed to what was asked for. Empty until
/// resolution. Reported by `eval_id()` — see the note there.
static ARMED: RwLock<String> = RwLock::new(String::new());

const MODE_CLASSIC: u8 = 1;
const MODE_NET: u8 = 2;

fn mode() -> u8 {
    let m = MODE.load(Ordering::Relaxed);
    if m != 0 {
        return m;
    }
    let want_net = std::env::var("MAKURUK_EVAL").map(|v| v == "net").unwrap_or(false);
    let resolved = if want_net { MODE_NET } else { MODE_CLASSIC };
    MODE.store(resolved, Ordering::Relaxed);
    if resolved == MODE_NET {
        let path = std::env::var("MAKURUK_WEIGHTS").unwrap_or_else(|_| "makruk-tiny.bin".to_string());
        match std::fs::read(&path).map_err(|e| e.to_string()).and_then(|b| TinyNnue::from_bytes(&b)) {
            Ok(net) => {
                *NET.write().unwrap() = Some(net);
                *ARMED.write().unwrap() = format!("net {path}");
            }
            Err(e) => {
                eprintln!("[nnue] failed to load {path}: {e} — falling back to classic eval");
                MODE.store(MODE_CLASSIC, Ordering::Relaxed);
                *ARMED.write().unwrap() = format!("classic fallback-from={path} reason={e}");
            }
        }
    } else {
        *ARMED.write().unwrap() = "classic".to_string();
    }
    MODE.load(Ordering::Relaxed)
}

/// Force eval-mode resolution and report what was **actually armed**, not what
/// was requested.
///
/// `mode()` resolves lazily on the first eval and, when the weights fail to
/// load, falls back to the classical eval with only an stderr line. A harness
/// driving this binary over UCI cannot see that, so a block can silently measure
/// the classical eval while believing it measured a net — which is exactly what
/// happened on 2026-08-02 (three "net" blocks, one classical engine, a day lost).
/// The preflight self-test asserts this string against what it requested.
pub fn eval_id() -> String {
    mode();
    let armed = ARMED.read().unwrap().clone();
    if armed.is_empty() { "classic".to_string() } else { armed }
}

/// Feed weights from the host (wasm worker). Activates net mode on success.
pub fn init_nnue(bytes: &[u8]) -> bool {
    match TinyNnue::from_bytes(bytes) {
        Ok(net) => {
            *NET.write().unwrap() = Some(net);
            MODE.store(MODE_NET, Ordering::Relaxed);
            true
        }
        Err(e) => {
            eprintln!("[nnue] init_nnue rejected weights: {e}");
            false
        }
    }
}

/// Net eval in cp for the side to move, or None when classic mode applies.
pub fn net_score(game: &Game) -> Option<i32> {
    if mode() != MODE_NET {
        return None;
    }
    let guard = NET.read().ok()?;
    let net = guard.as_ref()?;
    let (idxs, ch) = encode(game);
    Some(net.eval_cp(&idxs, &ch))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::Game;

    #[test]
    fn encode_startpos_feature_count() {
        // semantic equivalence with the python encoder is proven on real data
        // by tests/nnue_agreement.rs; here we only pin counts/ranges.
        let gw = Game::from_fen("rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w").unwrap();
        let (iw, chw) = encode(&gw);
        assert_eq!(iw.len(), 32);
        assert!(iw.iter().all(|&i| i < 768));
        assert_eq!(chw, [0f32; N_CHANNELS]);
        let gb = Game::from_fen("rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR b").unwrap();
        let (ib, _) = encode(&gb);
        assert_eq!(ib.len(), 32);
        assert!(ib.iter().all(|&i| i < 768));
    }
}
