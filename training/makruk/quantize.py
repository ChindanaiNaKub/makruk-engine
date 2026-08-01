"""Per-output-channel symmetric INT8 quantization (strength-spec v1 §2).

Training uses straight-through estimation (QAT) so the exported artifact is
what actually plays. Export quantization is exact round-to-nearest.
Mirrors Moka's scheme: int8 weights, f32 per-channel scales, f32 biases.
"""

import torch


def channel_scales(w: torch.Tensor, dim: int) -> torch.Tensor:
    """f32 scale per output channel of weight w along dim."""
    amax = w.detach().abs().amax(dim=dim, keepdim=True)
    return (amax / 127.0).clamp_min(1e-12)


def fake_quant(w: torch.Tensor, dim: int = 0) -> torch.Tensor:
    """Straight-through per-channel quantizer for QAT."""
    s = channel_scales(w, dim)
    q = torch.round(w / s).clamp(-127, 127)
    return w + (q * s - w).detach()


def quantize_tensor(w: torch.Tensor, dim: int = 0):
    """-> (int8 bytes tensor, f32 scales tensor) for export."""
    s = channel_scales(w, dim)
    q = torch.round(w / s).clamp(-127, 127).to(torch.int8)
    return q, s.squeeze(dim).to(torch.float32)
