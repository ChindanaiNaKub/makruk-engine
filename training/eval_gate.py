"""M2 gate (strength-spec v1 §Execution): probe report + quantized-vs-float agreement.

1. WDL accuracy on the test split overall AND on the counting-active slice
   (channels[8]>0) — the counting-rule bleed probe (KMITL-bases replacement for
   v1; corpus rows carry oracle-adjudicated counting outcomes).
2. Exact-int8 artifact vs float checkpoint: WDL-argmax agreement (target >=99%)
   + scalar MAE, computed on a fixed probe slice (first 50k test rows).

Usage: python -m training.eval_gate --ckpt out/v1/last.pt --data tools/data/bootstrap-v1.jsonl --manifest out/v1/makruk-tiny-v1-<hash>.json
"""

import argparse
import hashlib
import json

import numpy as np
import torch

from .makruk.dataset import load_rows, iter_batches
from .makruk.model import TinyMakrukNet
from .makruk.features import N_CHANNELS


def load_artifact(manifest_path: str):
    man = json.load(open(manifest_path))
    blob = open(manifest_path.replace(".json", ".bin"), "rb").read()
    assert hashlib.sha256(blob).hexdigest() == man["sha256"], "sha256 mismatch"
    sd = {}
    for t in man["tensors"]:
        if t["dtype"] == "int8":
            q = np.frombuffer(blob, dtype=np.int8, count=int(np.prod(t["shape"])), offset=t["dataOffset"]).reshape(t["shape"])
            s = np.frombuffer(blob, dtype="<f4", count=t["scaleCount"], offset=t["scaleOffset"])
            key = t["name"]
            w = torch.from_numpy(q.astype(np.float32))
            s = torch.from_numpy(s.copy())
            if key == "ft.weight":  # per-L1-output-channel scales (dim 0 reduced)
                w = w * s[None, :]
            else:  # Linear (out, in): per-output-row scales
                w = w * s[:, None]
        else:
            arr = np.frombuffer(blob, dtype="<f4", count=int(np.prod(t["shape"])), offset=t["dataOffset"]).reshape(t["shape"])
            w = torch.from_numpy(arr.copy())
        sd[t["name"].replace("ft.bias", "ft_bias").replace(".bias", ".bias")] = w
    return sd


def run_forward(model, data, device, limit=None):
    logits_all = []
    n = data["n"] if limit is None else min(limit, data["n"])
    sub = {**data, "n": n}
    with torch.no_grad():
        for b in iter_batches(sub, 4096, False, device):
            logits_all.append(model(b["indices"], b["offsets"], b["channels"]).cpu())
    return torch.cat(logits_all), data["wdl"][:n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--manifest", required=True)
    a = ap.parse_args()
    device = "cuda" if torch.cuda.is_available() else "cpu"

    test = load_rows(a.data, {1})
    print(f"test rows: {test['n']}")

    float_net = TinyMakrukNet().to(device)
    float_net.qat = False
    float_net.load_state_dict(torch.load(a.ckpt, map_location=device))
    float_net.eval()
    fl, wdl = run_forward(float_net, test, device)
    pred = fl.argmax(1)
    acc = (pred == wdl).float().mean().item()

    counting = test["channels"][: pred.numel(), N_CHANNELS - 1] > 0.5
    cacc = (pred[counting] == wdl[counting]).float().mean().item()
    print(f"[float] WDL acc: {acc:.3f}   counting-slice acc: {cacc:.3f}  (n_counting={counting.sum().item()})")

    sd8 = load_artifact(a.manifest)
    int8_net = TinyMakrukNet().to(device)
    int8_net.qat = False
    int8_net.load_state_dict(sd8)
    int8_net.eval()
    limit = 50_000
    f8, wdl8 = run_forward(int8_net, test, device, limit)
    fF, _ = run_forward(float_net, test, device, limit)
    agree = (f8.argmax(1) == fF.argmax(1)).float().mean().item()
    mae = (f8 - fF).abs().mean().item()
    print(f"[gate] int8-vs-float argmax agreement: {agree:.4f} (target >=0.99)  logit MAE {mae:.4f}")
    c8 = test["channels"][:limit, N_CHANNELS - 1] > 0.5
    cacc8 = (f8.argmax(1)[c8] == wdl8[c8]).float().mean().item()
    print(f"[int8 ] WDL acc on probe slice: {(f8.argmax(1)==wdl8).float().mean().item():.3f}  counting-slice: {cacc8:.3f}")


if __name__ == "__main__":
    main()
