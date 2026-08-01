"""Tiny makruk NNUE (strength-spec v1 §1): 768 -> L1(256) clipped ReLU,
concat counting side-channels -> 32 -> 32 -> WDL3.

The feature layer is an EmbeddingBag at train time; at export it becomes the
accumulator table the engine updates incrementally through do_move/undo_move.
Quantization of every weight tensor is per-output-channel int8 (see quantize.py):
for the embedding table (768, l1) the channels are the l1 outputs (dim=1).
"""

import torch
import torch.nn as nn

from .features import N_FEATURES, N_CHANNELS
from .quantize import fake_quant


class TinyMakrukNet(nn.Module):
    def __init__(self, l1: int = 256, l2: int = 32, l3: int = 32, qat: bool = True):
        super().__init__()
        self.qat = qat
        self.ft = nn.EmbeddingBag(N_FEATURES, l1, mode="sum")
        self.ft_bias = nn.Parameter(torch.zeros(l1))
        self.fc1 = nn.Linear(l1 + N_CHANNELS, l2)
        self.fc2 = nn.Linear(l2, l3)
        self.out = nn.Linear(l3, 3)

    def _q(self, w: torch.Tensor, dim: int) -> torch.Tensor:
        return fake_quant(w, dim) if self.qat else w

    def forward(self, indices, offsets, channels):
        table = self._q(self.ft.weight, dim=1)
        a = nn.functional.embedding_bag(indices, table, offsets, mode="sum")
        a = torch.clamp(a + self.ft_bias, 0.0, 1.0)  # clipped ReLU accumulator
        x = torch.cat([a, channels], dim=1)
        x = torch.relu(self._q(self.fc1.weight, 0) @ x.T).T + self.fc1.bias
        x = torch.relu(self._q(self.fc2.weight, 0) @ x.T).T + self.fc2.bias
        logits = (self._q(self.out.weight, 0) @ x.T).T + self.out.bias
        return logits

    def value_logit(self, logits):
        """WDL logits -> scalar in [-1,1] (W-L on soft probs); used for eval MSE."""
        p = torch.softmax(logits, dim=1)
        return p[:, 0] - p[:, 2]


def param_count(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())
