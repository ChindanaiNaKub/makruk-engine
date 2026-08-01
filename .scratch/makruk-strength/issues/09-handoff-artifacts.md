# What does the spec hand off to thatichess.dev?

Type: grilling
Status: resolved
Blocked by:
Parent: map.md

## Question

The map's destination promises a spec that defines artifacts + protocol contract for engine-repo delivery to the site (site work itself is out of scope). Decide the handoff shape: single weights file + the existing worker protocol, or a **ladder of bot strengths** (e.g. casual / club / expert) — and if a ladder, how rungs are produced: same net with depth/nodes caps, same net with deliberate-noise injection, or separately trained/earlier-gate checkpoints. Also: the weights format contract (INT8 manifest like Moka's bin+json, versioning/fingerprinting) and how the ladder maps onto the existing fairy-skill UI vocabulary (0/5/10/20) the user already thinks in.

## Answer

Locked by grilling (2026-08-01):

1. **One net, throttled rungs.** The site ships a single weights file; difficulty rungs are search config (node/depth caps + movetime jitter), not separate nets. Rungs are **anchored to measured dev-gate results**, not vibes — e.g. "Club" = first checkpoint that sweeps the skill-10 dev tier, "Expert" = the full-strength claim-tier artifact. Named rungs map 1:1 onto the fairy-skill vocabulary the user already thinks in. Multi-checkpoint ladders rejected (each its own quantize/gate surface, inconsistent calibration); single-strength rejected (product needs human-level variety; noise-injected weakeners read fake).
2. **Weights contract: Moka-style flat `.bin` + JSON manifest.** Manifest: `{name, version, sha256, architecture {768 piece-square features, L1 width, side-channel spec, WDL head}, tensors [{name, dtype, shape, dataOffset, scaleOffset}]}`. Worker fetches manifest + bin, engine verifies sha256, dequantizes once at load. Filenames content-fingerprinted → immutable cache headers on the site. Rust-struct-only rejected (opaque, skew-prone); wasm-embedded rejected (couples weights releases to wasm rebuilds, kills A/B weight swaps).
3. **Protocol unchanged** (hard invariant holds): the wire stays uci/uciok/position/go/bestmove with `m` promotion suffix — the weights path is worker-side config. No `browserEngineBotWorker.ts` changes required by this spec.
