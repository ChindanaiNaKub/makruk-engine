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
    /// The feature transformer, left in its on-disk int8 form.
    ///
    /// Accumulator sums are therefore EXACT: a sum of at most 32 int8 values
    /// (a makruk board holds at most 32 pieces) reaches 32*127 = 4,064, which
    /// fits i16 with three bits to spare, and no rounding happens until the
    /// single dequantize at read time. The old f32 table drifted instead —
    /// `accumulator_matches_encode_through_do_and_undo` had to compare with a
    /// 1e-3 tolerance because add-then-subtract does not round-trip in f32.
    table_i8: Vec<i8>, // 768 * L1
    /// Per-column dequantization scale, applied once when the accumulator is
    /// read rather than 32 times while it is built.
    col_scale: [f32; L1],
    ft_bias: [f32; L1],
    fc1_w: Vec<f32>, // L2 * (L1 + N_CHANNELS)
    /// fc1's weights again, kept in their on-disk int8 form with the per-row
    /// scale that dequantizes them. fc1 is 8,480 of the tail's 9,600 MACs, and
    /// integer accumulation is associative — so unlike the f32 chain it packs
    /// 8 lanes wide instead of 4, with no intrinsics and no unsafe. Only the
    /// first L1 columns are stored: the 9 counting channels stay f32 because
    /// their ranges differ per channel and 9 values are not worth a scale.
    fc1_w_i8: Vec<i8>,   // L2 * L1
    fc1_scale: [f32; L2], // per-row dequantization scale
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
    /// The feature transformer, kept raw. Returns (int8 weights, per-column
    /// scales) — dequantization moves to read time so the accumulator can be
    /// integer.
    fn int8_table(&mut self, rows: usize, cols: usize) -> Result<(Vec<i8>, Vec<f32>), String> {
        self.align();
        let n = rows * cols;
        let raw: Vec<i8> = bytemuck_i8(self.b, self.p, n)?.to_vec();
        self.p += n;
        self.align();
        let scales = self.f32s(cols)?; // per-output-channel (one scale per column)
        Ok((raw, scales))
    }
    /// Like `int8_rows`, but also hands back the raw int8 weights and their
    /// per-row scales so an integer forward pass can use them directly.
    fn int8_rows_keep(
        &mut self,
        rows: usize,
        cols: usize,
    ) -> Result<(Vec<f32>, Vec<i8>, Vec<f32>), String> {
        let start = self.p;
        let deq = self.int8_rows(rows, cols)?;
        let end = self.p;
        // Re-read the same bytes rather than threading them out of int8_rows:
        // the two paths must agree by construction, not by parallel edits.
        let mut c = Cursor { b: self.b, p: start };
        c.align();
        let raw = bytemuck_i8(c.b, c.p, rows * cols)?.to_vec();
        c.p += rows * cols;
        c.align();
        let scales = c.f32s(rows)?;
        debug_assert_eq!(c.p, end);
        Ok((deq, raw, scales))
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
        let (table_i8, col_scales) = c.int8_table(N_FEATURES, L1)?;
        let col_scale = vec_to_arr::<L1>(col_scales)?;
        let ft_bias = vec_to_arr::<L1>(c.f32s(256)?)?;
        let (fc1_w, fc1_raw, fc1_scales) = c.int8_rows_keep(L2, fc1_in)?;
        let fc1_b = vec_to_arr::<L2>(c.f32s(L2)?)?;
        // Keep only the L1 accumulator columns of each row; the 9 counting
        // channels are evaluated in f32.
        let mut fc1_w_i8 = Vec::with_capacity(L2 * L1);
        for r in 0..L2 {
            fc1_w_i8.extend_from_slice(&fc1_raw[r * fc1_in..r * fc1_in + L1]);
        }
        let fc1_scale = vec_to_arr::<L2>(fc1_scales)?;
        let fc2_w = c.int8_rows(L3, L2)?;
        let fc2_b = vec_to_arr::<L3>(c.f32s(L3)?)?;
        let out_w = c.int8_rows(3, L3)?;
        let out_b = vec_to_arr::<3>(c.f32s(3)?)?;
        if !c.done() {
            return Err(format!("bin has {} trailing bytes", bytes.len() - c.p));
        }
        Ok(TinyNnue { table_i8, col_scale, ft_bias, fc1_w, fc1_w_i8, fc1_scale, fc1_b, fc2_w, fc2_b, out_w, out_b })
    }

    /// WDL logits for a position encoded as (feature indices, side channels).
    /// zip-iterator loops elide bounds checks and auto-vectorize.
    pub fn wdl(&self, idxs: &[u32], ch: &[f32; N_CHANNELS]) -> [f32; 3] {
        let mut sums = [0i16; L1];
        for &i in idxs {
            let row = &self.table_i8[i as usize * L1..(i as usize + 1) * L1];
            for (a, b) in sums.iter_mut().zip(row.iter()) {
                *a += *b as i16;
            }
        }
        self.wdl_acc(&sums, ch)
    }

    /// The tail, starting from summed feature columns. `sums` excludes
    /// `ft_bias` — an incremental accumulator never has to track it — and is
    /// in raw int8 units, so this is where the per-column scale is applied.
    pub fn wdl_acc(&self, sums: &[i16; L1], ch: &[f32; N_CHANNELS]) -> [f32; 3] {
        let mut acc = self.ft_bias;
        for ((a, s), sc) in acc.iter_mut().zip(sums.iter()).zip(self.col_scale.iter()) {
            *a += *s as f32 * *sc;
        }
        self.wdl_from_acc(acc, ch)
    }

    /// Dot product over EIGHT independent partial sums.
    ///
    /// The obvious `.map(|(w, v)| w * v).sum()` is a single running f32
    /// accumulator, and f32 addition is not associative, so the compiler is
    /// forbidden from reordering it — the whole 8,480-MAC fc1 layer ran
    /// strictly serially at one multiply-add per cycle. Splitting the chain
    /// into 8 lanes lets the vectorizer pack them, because each lane's adds
    /// stay in their original order.
    ///
    /// This changes summation order, so results move in the last f32 ulp or
    /// two. That is why `tests/nnue_agreement.rs` compares with a tolerance
    /// rather than exactly.
    #[inline]
    fn dot(w: &[f32], x: &[f32]) -> f32 {
        let mut p = [0f32; 8];
        let n = w.len().min(x.len());
        let full = n - n % 8;
        for (wc, xc) in w[..full].chunks_exact(8).zip(x[..full].chunks_exact(8)) {
            for k in 0..8 {
                p[k] += wc[k] * xc[k];
            }
        }
        let mut s = ((p[0] + p[1]) + (p[2] + p[3])) + ((p[4] + p[5]) + (p[6] + p[7]));
        for i in full..n {
            s += w[i] * x[i];
        }
        s
    }

    /// The same shape as `dot`, in integers.
    ///
    /// This is where the win is. i32 addition IS associative, so the compiler
    /// may reorder freely and pack 8 i16 lanes per 128-bit register against
    /// f32's 4 — twice the work per instruction, from portable safe code with
    /// no intrinsics. Products are at most 127*1024, and 256 of them reach 33M,
    /// well inside i32, so no saturation handling is needed.
    #[inline]
    fn dot_i8(w: &[i8], x: &[i16]) -> i32 {
        let mut s = 0i32;
        for (a, b) in w.iter().zip(x.iter()) {
            s += *a as i32 * *b as i32;
        }
        s
    }

    fn wdl_from_acc(&self, mut acc: [f32; L1], ch: &[f32; N_CHANNELS]) -> [f32; 3] {
        // The feature transformer's activation. Both callers must go through
        // here — dropping it silently shifted the eval by ~130 cp while every
        // existing test stayed green.
        for a in acc.iter_mut() {
            *a = a.clamp(0.0, 1.0);
        }
        // fc1's accumulator half runs in integers. The FT activation above has
        // already clamped `acc` to [0, 1], so a fixed scale needs no calibration
        // and is exact at both ends of the range.
        //
        // The scale is 1024, not 127. Quantizing activations to u8 costs a
        // 1/127 step, and 256 of those errors accumulate to ~2e-3 of a logit —
        // which is not visibly worse play, but it broke the python-parity
        // fixture's 2e-3 tolerance, and a tolerance widened to admit a
        // deliberate approximation stops guarding against real bugs. i16 at
        // 1024 cuts the step 8x. Products reach 127*1024 and 256 of them reach
        // 33M, so i32 accumulation still cannot overflow, and the layer still
        // packs 8 lanes per 128-bit register against f32's 4.
        let mut xq = [0i16; L1];
        for (q, a) in xq.iter_mut().zip(acc.iter()) {
            *q = (*a * 1024.0 + 0.5) as i16;
        }

        // NOTE: trained order is relu(W·x) + b (model.py) — bias after activation.
        let mut h1 = [0f32; L2];
        for j in 0..L2 {
            let wrow = &self.fc1_w[j * (L1 + N_CHANNELS)..(j + 1) * (L1 + N_CHANNELS)];
            let acc_part =
                Self::dot_i8(&self.fc1_w_i8[j * L1..(j + 1) * L1], &xq) as f32 * self.fc1_scale[j] / 1024.0;
            let ch_part = Self::dot(&wrow[L1..], ch);
            let s = acc_part + ch_part;
            h1[j] = s.max(0.0) + self.fc1_b[j];
        }
        let mut h2 = [0f32; L3];
        for j in 0..L3 {
            let wrow = &self.fc2_w[j * L2..(j + 1) * L2];
            let s = Self::dot(wrow, &h1);
            h2[j] = s.max(0.0) + self.fc2_b[j];
        }
        let mut logits = [0f32; 3];
        for o in 0..3 {
            let wrow = &self.out_w[o * L3..(o + 1) * L3];
            let s = Self::dot(wrow, &h2);
            logits[o] = s + self.out_b[o];
        }
        logits
    }

    /// Scalar eval in centipawn-class units (spec §1: (W - L) * 1000).
    pub fn eval_cp_acc(&self, sums: &[i16; L1], ch: &[f32; N_CHANNELS]) -> i32 {
        Self::cp_from_logits(self.wdl_acc(sums, ch))
    }

    pub fn eval_cp(&self, idxs: &[u32], ch: &[f32; N_CHANNELS]) -> i32 {
        Self::cp_from_logits(self.wdl(idxs, ch))
    }

    fn cp_from_logits(l: [f32; 3]) -> i32 {
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
/// Max active features = max pieces on a makruk board = 32 (16 per side at the
/// start, and nothing ever adds a piece — promotion replaces a bia with a met).
pub const MAX_FEATURES: usize = 32;

/// Allocation-free encode: writes feature indices into a caller-owned buffer and
/// returns how many. `encode` re-sums the whole feature transformer on every
/// node, so it runs in the hottest loop in the engine, and the `Vec` it used to
/// build meant a heap allocation per node (redraw ticket 08).
pub fn encode_into(game: &Game, idxs: &mut [u32; MAX_FEATURES]) -> (usize, [f32; N_CHANNELS]) {
    let flip = game.turn == Color::Black;
    let mut n = 0usize;
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
        // A board can only hold 32 pieces; the guard keeps a corrupt position
        // from writing past the buffer rather than trusting that invariant.
        if n < MAX_FEATURES {
            idxs[n] = (sq * 12 + kind_i + band) as u32;
            n += 1;
        }
    }
    (n, channels(game))
}

/// Incrementally-maintained feature-transformer sums (redraw ticket 08).
///
/// TWO PERSPECTIVES, and that is forced rather than chosen. `encode` flips the
/// board when Black is to move — both the square and the piece colour — so
/// EVERY feature index changes on every move. A single accumulator would have
/// to be rebuilt each ply, which is the thing being eliminated. So one sum is
/// kept per point of view and `net_score` selects by side to move.
///
/// `v[0]` is the White-to-move view, `v[1]` the Black-to-move view. Neither
/// includes `ft_bias` — that is added at read time, so a delta never has to know
/// about it.
#[derive(Clone)]
pub struct Accumulator {
    pub v: [[i16; L1]; 2],
}

pub fn kind_index(kind: Kind) -> usize {
    match kind {
        Kind::K => 0,
        // Same arm as src/eval.rs:72, and for the same reason: a promoted bia
        // IS a met.
        Kind::M | Kind::PM => 1,
        Kind::S => 2,
        Kind::N => 3,
        Kind::R => 4,
        Kind::P => 5,
    }
}

/// Feature index for a piece, from one perspective. Mirrors `encode` exactly —
/// if these two ever disagree the eval silently drifts, which is what
/// `accumulator_matches_encode` exists to catch.
#[inline]
fn feat(persp: usize, sq: usize, kind_i: usize, color: Color) -> usize {
    let (r, c) = (sq / 8, sq % 8);
    let s = if persp == 1 { (7 - r) * 8 + c } else { sq };
    let col = if persp == 1 { color.other() } else { color };
    let band = if col == Color::White { 0 } else { 6 };
    s * 12 + kind_i + band
}

impl Accumulator {
    pub fn zeroed() -> Accumulator {
        Accumulator { v: [[0; L1]; 2] }
    }

    /// Add (`add` = true) or remove one piece, in both views.
    ///
    /// i16 rather than f32, and that is a correctness change as well as a speed
    /// one: these adds and subtracts must round-trip exactly through do_move /
    /// undo_move, which f32 does not guarantee.
    #[inline]
    fn edit(&mut self, table: &[i8], sq: usize, kind_i: usize, color: Color, add: bool) {
        for persp in 0..2 {
            let f = feat(persp, sq, kind_i, color);
            let row = &table[f * L1..(f + 1) * L1];
            let acc = &mut self.v[persp];
            if add {
                for (a, b) in acc.iter_mut().zip(row.iter()) {
                    *a += *b as i16;
                }
            } else {
                for (a, b) in acc.iter_mut().zip(row.iter()) {
                    *a -= *b as i16;
                }
            }
        }
    }
}

/// One piece edit: (square, kind, colour, add?).
pub type AccEdit = (usize, Kind, Color, bool);

/// Apply a whole move's edits under a SINGLE lock acquisition.
///
/// The first version took `NET.read()` per piece, so a move cost 2-3 lock
/// acquisitions and its undo another 2-3 — four to six per node on top of the
/// one `net_score` already pays. Measured: that version reached only 1.10x
/// against a 1.49x arithmetic ceiling, and batching is what closes the gap.
/// A move touches at most three squares (mover leaves, victim leaves, mover
/// arrives), so the array is fixed-size and never allocates.
pub fn acc_apply(acc: &mut Accumulator, edits: &[AccEdit]) {
    let guard = match NET.read() {
        Ok(g) => g,
        Err(_) => return,
    };
    let net = match guard.as_ref() {
        Some(n) => n,
        None => return,
    };
    for &(sq, kind, color, add) in edits {
        acc.edit(&net.table_i8, sq, kind_index(kind), color, add);
    }
}

/// Build an accumulator from scratch. Used on position setup, and by the
/// consistency test as the source of truth.
pub fn fresh_accumulator(game: &Game) -> Option<Accumulator> {
    let guard = NET.read().ok()?;
    let net = guard.as_ref()?;
    let mut a = Accumulator::zeroed();
    for (idx, cell) in game.board.squares.iter().enumerate() {
        if let Some(p) = cell {
            a.edit(&net.table_i8, idx, kind_index(p.kind), p.color, true);
        }
    }
    Some(a)
}

/// True when an accumulator should be maintained at all.
pub fn net_armed() -> bool {
    mode() == MODE_NET
}

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
    let m = MODE.load(Ordering::Acquire);
    if m != 0 {
        return m;
    }
    let want_net = std::env::var("MAKURUK_EVAL").map(|v| v == "net").unwrap_or(false);
    let want = if want_net { MODE_NET } else { MODE_CLASSIC };
    // MODE IS PUBLISHED LAST, AND THAT ORDER IS LOAD-BEARING. It used to be
    // stored before the weights were read, so for the length of a 204 KB load
    // plus a 768x256 dequantise any other caller saw "net armed" while `NET` was
    // still None — and `net_score` returning None means a SILENT fallback to the
    // classical eval. Single-threaded runs never hit the window; the accumulator
    // consistency test running in parallel with another test did, immediately.
    if want == MODE_NET {
        let path = std::env::var("MAKURUK_WEIGHTS").unwrap_or_else(|_| "makruk-tiny.bin".to_string());
        match std::fs::read(&path).map_err(|e| e.to_string()).and_then(|b| TinyNnue::from_bytes(&b)) {
            Ok(net) => {
                *NET.write().unwrap() = Some(net);
                *ARMED.write().unwrap() = format!("net {path}");
                MODE.store(MODE_NET, Ordering::Release);
            }
            Err(e) => {
                eprintln!("[nnue] failed to load {path}: {e} — falling back to classic eval");
                *ARMED.write().unwrap() = format!("classic fallback-from={path} reason={e}");
                MODE.store(MODE_CLASSIC, Ordering::Release);
            }
        }
    } else {
        *ARMED.write().unwrap() = "classic".to_string();
        MODE.store(MODE_CLASSIC, Ordering::Release);
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
    let ch = channels(game);
    // The incremental path. `v[persp]` already holds the summed feature
    // columns, so the whole 32x256 re-sum disappears and only the tail runs.
    if let Some(acc) = game.nnue_acc.as_deref() {
        let persp = (game.turn == Color::Black) as usize;
        return Some(net.eval_cp_acc(&acc.v[persp], &ch));
    }
    let mut buf = [0u32; MAX_FEATURES];
    let (n, _) = encode_into(game, &mut buf);
    Some(net.eval_cp(&buf[..n], &ch))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::Game;

    /// THE test this ticket owes (redraw ticket 08). An accumulator that drifts
    /// out of sync produces a wrong eval that nothing else catches — neither
    /// `cargo test` nor mirror-perft touches it, and the first version of this
    /// code silently shifted the eval by ~130 cp with every other test green.
    ///
    /// After every move, and again after undoing it, the incrementally
    /// maintained accumulator must equal a fresh rebuild EXACTLY.
    #[test]
    fn accumulator_matches_encode_through_do_and_undo() {
        // Only meaningful with a net loaded; the fixture net is optional.
        if !net_armed() {
            eprintln!("accumulator test skipped — no net armed (MAKURUK_EVAL/MAKURUK_WEIGHTS unset)");
            return;
        }
        use crate::movegen;
        let mut game = Game::startpos();
        game.nnue_acc = fresh_accumulator(&game).map(Box::new);
        assert!(game.nnue_acc.is_some(), "net armed but no accumulator built");

        let same = |g: &Game, when: &str| {
            let want = fresh_accumulator(g).expect("rebuild");
            let got = g.nnue_acc.as_deref().expect("maintained");
            for persp in 0..2 {
                for i in 0..L1 {
                    // EXACT now, not within 1e-3. The accumulator is i16, so
                    // add-then-subtract round-trips perfectly; any tolerance
                    // here would be hiding a real bug rather than absorbing
                    // float noise.
                    assert!(
                        want.v[persp][i] == got.v[persp][i],
                        "{when}: perspective {persp} channel {i} drifted: maintained {} vs rebuilt {}",
                        got.v[persp][i], want.v[persp][i]
                    );
                }
            }
        };

        // Walk a few plies deep, exercising captures and promotions by taking
        // every legal move at the first two plies rather than one sample line.
        fn walk(game: &mut Game, depth: u32, same: &dyn Fn(&Game, &str)) {
            if depth == 0 {
                return;
            }
            for mv in movegen::legal_moves(&game.board, game.turn) {
                let undo = game.do_move(mv);
                same(game, "after do_move");
                walk(game, depth - 1, same);
                game.undo_move(undo);
                same(game, "after undo_move");
            }
        }
        walk(&mut game, 3, &same);
    }

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
