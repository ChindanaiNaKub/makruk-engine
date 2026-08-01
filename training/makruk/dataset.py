"""JSONL corpus -> batched tensors, with whole-game 80/10/10 split (spec §3).

Never splits inside a game: bucket = crc32(game_id) % 10; bucket 0 = val,
bucket 1 = test, buckets 2..9 = train (research/01: correlated leakage between
plies of the same game is the silent killer of eval fidelity).
"""

import json
import zlib

import numpy as np
import torch

from .features import encode_row, N_CHANNELS

FLUSH_EVERY = 200_000  # rows per chunk (keeps python-list memory bounded)


def bucket_of(game: str) -> int:
    return zlib.crc32(game.encode()) % 10


def load_rows(path: str, buckets: set[int]):
    idx_list, offs, chans, evals, masks, wdls, ws = [], [], [], [], [], [], []
    idx_chunks, chan_chunks, eval_chunks, mask_chunks, wdl_chunks, w_chunks = [], [], [], [], [], []
    offset = 0
    seen = 0

    def flush():
        if wdls:
            idx_chunks.append(np.array(idx_list, dtype=np.int32))
            chan_chunks.append(np.array(chans, dtype=np.float32))
            eval_chunks.append(np.array(evals, dtype=np.float32))
            mask_chunks.append(np.array(masks, dtype=np.float32))
            wdl_chunks.append(np.array(wdls, dtype=np.int64))
            w_chunks.append(np.array(ws, dtype=np.float32))
            idx_list.clear()
            chans.clear()
            evals.clear()
            masks.clear()
            wdls.clear()
            ws.clear()

    with open(path) as f:
        for line in f:
            row = json.loads(line)
            if bucket_of(row["game"]) not in buckets:
                continue
            idxs, ch, ev, wdl, _game = encode_row(row)
            if not idxs:
                continue
            idx_list.extend(idxs)
            offs.append(offset)
            offset += len(idxs)
            chans.append(ch)
            if ev is None:
                evals.append(0.0)
                masks.append(0.0)
            else:
                evals.append(ev)
                masks.append(1.0)
            wdls.append(wdl)
            ws.append(float(row.get("w", 1.0)))
            seen += 1
            if seen % FLUSH_EVERY == 0:
                flush()
    flush()

    return {
        "indices": torch.from_numpy(np.concatenate(idx_chunks)),
        "offsets": torch.tensor(offs, dtype=torch.long),
        "channels": torch.from_numpy(np.concatenate(chan_chunks)),
        "eval": torch.from_numpy(np.concatenate(eval_chunks)),
        "eval_mask": torch.from_numpy(np.concatenate(mask_chunks)),
        "wdl": torch.from_numpy(np.concatenate(wdl_chunks)),
        "w": torch.from_numpy(np.concatenate(w_chunks)),
        "n": len(offs),
    }


def batch_tensors(data: dict, perm: torch.Tensor, i: int, bs: int, device):
    sel = perm[i : i + bs].tolist()
    indices, offsets = [], []
    off = 0
    for r in sel:
        start = int(data["offsets"][r])
        end = int(data["offsets"][r + 1]) if r + 1 < data["n"] else len(data["indices"])
        ids = data["indices"][start:end]
        indices.append(ids)
        offsets.append(off)
        off += len(ids)
    indices = torch.cat(indices).to(device)
    offsets = torch.tensor(offsets, dtype=torch.long, device=device)
    return {
        "indices": indices,
        "offsets": offsets,
        "channels": data["channels"][sel].to(device),
        "eval": data["eval"][sel].to(device),
        "eval_mask": data["eval_mask"][sel].to(device),
        "wdl": data["wdl"][sel].to(device),
        "w": data["w"][sel].to(device),
    }


def iter_batches(data: dict, bs: int, shuffle: bool, device):
    n = data["n"]
    perm = torch.randperm(n) if shuffle else torch.arange(n)
    for i in range(0, n, bs):
        yield batch_tensors(data, perm, i, bs, device)
