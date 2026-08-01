"""Train the tiny makruk NNUE (strength-spec v1 §4).

From-scratch v1: AdamW lr 1e-3, batch 1024, ~15 epochs, QAT from epoch 1,
50% WDL cross-entropy (oracle result) + 50% masked MSE on squashed teacher
eval, whole-game splits, validation-loss checkpoint selection.

Usage: python -m training.train --data tools/data/bootstrap-v1.jsonl --epochs 15 --out out/v1
"""

import argparse
import os
import time

import torch
import torch.nn as nn
import torch.nn.functional as F

from .makruk.dataset import load_rows, iter_batches
from .makruk.model import TinyMakrukNet, param_count


def evaluate(model, data, bs, device):
    model.eval()
    tot_wdl = tot_ev = n = 0.0
    correct = 0
    with torch.no_grad():
        for b in iter_batches(data, bs, False, device):
            logits = model(b["indices"], b["offsets"], b["channels"])
            tot_wdl += F.cross_entropy(logits, b["wdl"], reduction="sum").item()
            tot_ev += ((model.value_logit(logits) - b["eval"]) ** 2 * b["eval_mask"]).sum().item()
            correct += (logits.argmax(1) == b["wdl"]).sum().item()
            n += b["wdl"].numel()
    model.train()
    return 0.5 * (tot_wdl / n) + 0.5 * (tot_ev / max(data["eval_mask"].sum().item(), 1)), correct / n


def batch_loss(model, b, preserve=None, preserve_w=0.0):
    logits = model(b["indices"], b["offsets"], b["channels"])
    w = b["w"]
    wdl_ce = (F.cross_entropy(logits, b["wdl"], reduction="none") * w).sum() / w.sum().clamp_min(1e-9)
    ev_mask = b["eval_mask"] * w
    ev = ((model.value_logit(logits) - b["eval"]) ** 2 * ev_mask).sum() / ev_mask.sum().clamp_min(1)
    loss = 0.5 * wdl_ce + 0.5 * ev
    if preserve is not None and preserve_w > 0:
        with torch.no_grad():
            frozen = preserve(b["indices"], b["offsets"], b["channels"])
        loss = loss + preserve_w * F.mse_loss(logits, frozen)
    return loss, b["wdl"].numel()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="primary corpus (dagger rounds: the on-policy file)")
    ap.add_argument("--epochs", type=int, default=None)
    ap.add_argument("--bs", type=int, default=1024)
    ap.add_argument("--lr", type=float, default=None)
    ap.add_argument("--l1", type=int, default=256)
    ap.add_argument("--qat", action=argparse.BooleanOptionalAction, default=True)
    ap.add_argument("--out", default="out/v1")
    ap.add_argument("--resume", default=None, help="checkpoint to continue from (DAgger rounds)")
    ap.add_argument("--preserve", default=None, help="frozen incumbent ckpt for preservation penalty")
    ap.add_argument("--preserve-w", type=float, default=0.25)
    ap.add_argument("--replay", default=None, help="bootstrap corpus for anti-forgetting replay")
    ap.add_argument("--replay-n", type=int, default=20_000)
    a = ap.parse_args()

    continuing = a.resume is not None
    epochs = a.epochs if a.epochs is not None else (1 if continuing else 15)
    lr = a.lr if a.lr is not None else (2e-5 if continuing else 1e-3)

    os.makedirs(a.out, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"device: {device}  epochs={epochs} lr={lr} resume={continuing}")

    print("loading rows (whole-game split: crc32(game)%10; 0=val,1=test)")
    train = load_rows(a.data, {2, 3, 4, 5, 6, 7, 8, 9})
    val = load_rows(a.data, {0})
    test = load_rows(a.data, {1})
    print(f"train {train['n']} / val {val['n']} / test {test['n']} rows")

    replay = None
    if a.replay:
        replay = load_rows(a.replay, {2, 3, 4, 5, 6, 7, 8, 9})
        if 0 < a.replay_n < replay["n"]:
            keep = torch.randperm(replay["n"])[: a.replay_n]
            # rebuild a subsampled view (offsets are per-row start indices)
            rows_idx, rows_off, rows_ch, rows_ev, rows_m, rows_y, rows_w = [], [], [], [], [], [], []
            off = 0
            for r in keep.tolist():
                s = int(replay["offsets"][r])
                e = int(replay["offsets"][r + 1]) if r + 1 < replay["n"] else len(replay["indices"])
                ids = replay["indices"][s:e]
                rows_idx.append(ids)
                rows_off.append(off)
                off += len(ids)
                rows_ch.append(replay["channels"][r])
                rows_ev.append(replay["eval"][r])
                rows_m.append(replay["eval_mask"][r])
                rows_y.append(replay["wdl"][r])
                rows_w.append(replay["w"][r])
            replay = {
                "indices": torch.cat(rows_idx),
                "offsets": torch.tensor(rows_off, dtype=torch.long),
                "channels": torch.stack(rows_ch),
                "eval": torch.stack(rows_ev),
                "eval_mask": torch.stack(rows_m),
                "wdl": torch.stack(rows_y),
                "w": torch.stack(rows_w),
                "n": len(rows_y),
            }
        print(f"replay: {replay['n']} rows")

    model = TinyMakrukNet(l1=a.l1, qat=a.qat).to(device)
    if a.resume:
        model.load_state_dict(torch.load(a.resume, map_location=device))
    preserve = None
    if a.preserve:
        preserve = TinyMakrukNet(l1=a.l1, qat=False).to(device)
        preserve.load_state_dict(torch.load(a.preserve, map_location=device))
        preserve.eval()
    print(f"params: {param_count(model)} (~{param_count(model)/1024:.0f} KB int8)")
    opt = torch.optim.AdamW(model.parameters(), lr=lr)

    def cycled(gen_fn):
        while True:
            yield from gen_fn()

    best = float("inf")
    for ep in range(1, epochs + 1):
        t0 = time.time()
        tot = n = 0.0
        rep_iter = cycled(lambda: iter_batches(replay, a.bs, True, device)) if replay else None
        every = max(1, (train["n"] // a.bs) // max(1, (replay["n"] // a.bs))) if replay else 0
        for i, b in enumerate(iter_batches(train, a.bs, True, device)):
            for bb in ([b] + ([next(rep_iter)] if rep_iter and i % every == 0 else [])):
                loss, bn = batch_loss(model, bb, preserve, a.preserve_w)
                opt.zero_grad(set_to_none=True)
                loss.backward()
                opt.step()
                tot += loss.item() * bn
                n += bn
        vloss, vacc = evaluate(model, val, a.bs, device)
        marker = ""
        if vloss < best:
            best = vloss
            torch.save(model.state_dict(), os.path.join(a.out, "last.pt"))
            marker = "  <- saved"
        print(f"epoch {ep:2d}: train {tot/max(n,1):.4f}  val {vloss:.4f}  acc {vacc:.3f}  ({time.time()-t0:.1f}s){marker}")

    model.load_state_dict(torch.load(os.path.join(a.out, "last.pt"), map_location=device))
    tloss, tacc = evaluate(model, test, a.bs, device)
    print(f"TEST: loss {tloss:.4f}  acc {tacc:.3f}")


if __name__ == "__main__":
    main()
