"""Makruk position encoding for the tiny NNUE (strength-spec v1 §1, §8).

768 piece-square features, side-to-move canonical perspective (rank-flip +
color-swap for black to move; makruk is symmetric under this transform).
Promoted bia (F/f) folds into met (spec §10 accepted risk).
~9 counting side-channels derived from the oracle's counting serialization.
This module is pure python (no engine dependency) and mirrors what
src/eval.rs will implement natively in M3.
"""

PIECE_ORDER = "KMSNRP"  # F folds into M
N_FEATURES = 768        # 64 squares * 12 piece-color types
N_CHANNELS = 9
WDL_INDEX = {"w": 0, "d": 1, "l": 2}


def _parse_board(board: str):
    """FEN board (rank8 .. rank1 rows) -> list of (square, color, kind).
    square = r*8+f, r=0 is rank1. color: 0=white(upper), 1=black(lower)."""
    squares = []
    for r_from_top, row in enumerate(board.split("/")):
        r = 7 - r_from_top
        f = 0
        for ch in row:
            if ch.isdigit():
                f += int(ch)
            else:
                color = 0 if ch.isupper() else 1
                kind = ch.upper()
                if kind == "F":
                    kind = "M"
                squares.append((r * 8 + f, color, kind))
                f += 1
    return squares


def encode_fen(fen: str):
    """-> (feature_indices, stm) in side-to-move canonical perspective."""
    board, side = fen.split()
    pieces = _parse_board(board)
    idxs = []
    for sq, color, kind in pieces:
        if side == "b":  # canonical: flip ranks, swap colors
            sq = (7 - sq // 8) * 8 + (sq % 8)
            color ^= 1
        # after the canonical swap, stm's pieces are always color 0
        own = 0 if color == 0 else 1
        t = PIECE_ORDER.index(kind) + own * 6
        idxs.append(sq * 12 + t)
    return idxs, side


def encode_counting(counting: str, ply: int, side: str):
    """-> N_CHANNELS floats; 'none' -> structural zeros (channels 6,8 carry ply/flags)."""
    ph = bh = prog = lim64 = stm_cnt = fin = 0.0
    if counting and counting != "none":
        # kind,countingColor,currentCount,startCount,limit,active,finalAttackPending
        kind, ccolor, cur, _start, limit, active, finalatk = counting.split(",")
        active = active == "true"
        if active:
            ph = 1.0 if kind == "pieces_honor" else 0.0
            bh = 1.0 if kind == "board_honor" else 0.0
            lim = float(limit)
            prog = float(cur) / lim if lim else 0.0
            lim64 = lim / 64.0
            stm_cnt = 1.0 if ccolor.startswith(side) else -1.0
            fin = 1.0 if finalatk == "true" else 0.0
    return [ph, bh, prog, lim64, stm_cnt, fin, min(ply, 400) / 200.0, 0.0, ph or bh]


def eval_target(cp) -> float | None:
    """Teacher eval (cp, stm perspective) -> squashed [-1,1]; None for in-check rows."""
    if cp is None:
        return None
    import math

    return math.tanh(cp / 400.0)


def encode_row(row: dict):
    """datagen JSONL row -> (feature_indices, channels, eval_t, wdl_t, game)."""
    idxs, side = encode_fen(row["fen"])
    ch = encode_counting(row.get("counting", "none"), row["ply"], side)
    return idxs, ch, eval_target(row["eval"]), WDL_INDEX[row["wdl"]], row["game"]
