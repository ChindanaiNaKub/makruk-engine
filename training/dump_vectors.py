"""Dump fixed eval vectors for the Rust NNUE agreement test (M3).

Loads the int8 artifact (manifest+bin), encodes the given rows, and writes
(fen, counting, ply, logits) so tests/nnue_agreement.rs can verify the Rust
encoder+forward pass matches bit-for-bit (within f32 reorder epsilon).

Usage: python -m training.dump_vectors --manifest out/v1/makruk-tiny-v1-*.json \
          --corpus tools/data/bootstrap-v1.jsonl --n-corpus 8 \
          --out tests/fixtures/nnue_vectors.jsonl
"""

import argparse
import json

import torch

from .makruk.dataset import load_rows  # noqa: F401  (keeps import path consistent)
from .makruk.features import encode_row
from .makruk.model import TinyMakrukNet
from .eval_gate import load_artifact

FIXED = [
    ("rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w", "none", 0),
    ("rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR b", "none", 1),
    # promoted bia (F folds to M) + black stm
    ("rnsmksnr/8/ppppp1pp/5p2/3P4/PPP2PPP/2F5/RNSKMSNR b", "none", 21),
    # pieces-honor active, black counting, near limit
    ("4k3/8/5n2/8/8/8/8/4K1N1 b", "pieces_honor,black,7,7,8,true,false", 120),
    # board-honor active early (auto-start), white counting
    ("4k3/8/8/8/8/8/8/4K2R w", "board_honor,white,2,2,64,true,false", 88),
    # final attack pending
    ("4k3/8/5n2/8/8/8/8/4K1N1 w", "pieces_honor,black,8,8,8,true,true", 121),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--corpus", default=None)
    ap.add_argument("--n-corpus", type=int, default=8)
    ap.add_argument("--out", default="tests/fixtures/nnue_vectors.jsonl")
    a = ap.parse_args()

    sd = load_artifact(a.manifest)
    net = TinyMakrukNet()
    net.qat = False
    net.load_state_dict(sd)
    net.eval()

    rows = [dict(zip(("fen", "counting", "ply"), t), eval=None, wdl="d", game="fix") for t in FIXED]
    # normalise to datagen row shape; eval/wdl unused by encoder
    rows = []
    for fen, counting, ply in FIXED:
        rows.append({"fen": fen, "counting": counting, "ply": ply, "eval": None, "wdl": "d", "game": "fix"})
    if a.corpus:
        seen = 0
        with open(a.corpus) as f:
            for line in f:
                r = json.loads(line)
                if r["ply"] < 20 or seen >= a.n_corpus:
                    continue
                rows.append(r)
                seen += 1
    import os

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w") as out:
        for r in rows:
            idxs, ch, _ev, _wdl, _game = encode_row(r)
            with torch.no_grad():
                log = net(
                    torch.tensor(idxs, dtype=torch.long),
                    torch.tensor([0], dtype=torch.long),
                    torch.tensor([ch], dtype=torch.float32),
                )[0]
            rec = {
                "fen": r["fen"],
                "counting": r.get("counting", "none"),
                "ply": r["ply"],
                "logits": [round(float(x), 6) for x in log.tolist()],
            }
            out.write(json.dumps(rec) + "\n")
    print(f"wrote {len(rows)} vectors to {a.out}")


if __name__ == "__main__":
    main()
