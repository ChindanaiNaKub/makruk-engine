"""Export a trained TinyMakrukNet checkpoint -> Moka-style bin + JSON manifest
(strength-spec v1 §2, §8). Per-output-channel int8 weights, f32 scales + biases,
4-byte aligned, sha256-verified, fingerprinted filename.

Usage: python -m training.export --ckpt out/last.pt --out out/
"""

import argparse
import hashlib
import json
import os

import torch

from .makruk.model import TinyMakrukNet
from .makruk.quantize import quantize_tensor
from .makruk.features import N_CHANNELS

TENSORS = [
    # (name, state_dict key, dim whose index is the OUTPUT channel, dtype)
    # ft.weight (768 features, l1 outputs): output channel = l1 neuron -> amax over dim 0
    # Linear (out, in): output channel = out row -> amax over dim 1
    ("ft.weight", "ft.weight", 0, "int8"),
    ("ft.bias", "ft_bias", None, "f32"),
    ("fc1.weight", "fc1.weight", 1, "int8"),
    ("fc1.bias", "fc1.bias", None, "f32"),
    ("fc2.weight", "fc2.weight", 1, "int8"),
    ("fc2.bias", "fc2.bias", None, "f32"),
    ("out.weight", "out.weight", 1, "int8"),
    ("out.bias", "out.bias", None, "f32"),
]


def export(ckpt_path: str, out_dir: str, version: str = "v1"):
    sd = torch.load(ckpt_path, map_location="cpu")
    model = TinyMakrukNet()
    model.qat = False
    model.load_state_dict(sd)
    model.eval()

    blob = bytearray()
    manifest_tensors = []

    def align():
        while len(blob) % 4:
            blob.append(0)

    with torch.no_grad():
        for name, key, dim, dtype in TENSORS:
            t = sd[key].detach().clone()
            align()
            data_off = len(blob)
            if dtype == "int8":
                q, scales = quantize_tensor(t, dim)
                blob.extend(q.numpy().astype("int8").tobytes())
                align()
                scale_off = len(blob)
                blob.extend(scales.numpy().astype("<f4").tobytes())
                entry = {
                    "name": name,
                    "dtype": "int8",
                    "shape": list(t.shape),
                    "dataOffset": data_off,
                    "scaleOffset": scale_off,
                    "scaleCount": scales.numel(),
                }
            else:
                blob.extend(t.float().numpy().astype("<f4").tobytes())
                entry = {"name": name, "dtype": "f32", "shape": list(t.shape), "dataOffset": data_off}
            manifest_tensors.append(entry)

    digest = hashlib.sha256(bytes(blob)).hexdigest()[:12]
    shard = f"makruk-tiny-{version}-{digest}"
    bin_path = os.path.join(out_dir, shard + ".bin")
    with open(bin_path, "wb") as f:
        f.write(bytes(blob))

    l1 = sd["ft.weight"].shape[1]
    manifest = {
        "name": shard,
        "version": version,
        "sha256": hashlib.sha256(bytes(blob)).hexdigest(),
        "architecture": {
            "features": 768,
            "l1": l1,
            "channels": N_CHANNELS,
            "head": "wdl3",
            "perspective": "stm-canonical-rankflip",
            "folds": {"promoted_bia": "met"},
            "quantization": "int8-per-output-channel + f32 scales/biases",
        },
        "weightsBytes": len(blob),
        "weightsKB": round(len(blob) / 1024, 1),
        "tensors": manifest_tensors,
    }
    json_path = os.path.join(out_dir, shard + ".json")
    with open(json_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"exported {shard}: {manifest['weightsKB']} KB ({len(blob)} B), manifest {json_path}")
    return bin_path, json_path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--out", default="out")
    ap.add_argument("--version", default="v1")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    export(a.ckpt, a.out, a.version)
