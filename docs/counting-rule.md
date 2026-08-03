# The counting rule (นับศักดิ์หมาก / นับกระดาน)

This is the part that makes it Makruk rather than chess, and the part a generic engine cannot borrow.

The sole rule authority is [markrukthai](https://github.com/ChindanaiNaKub/markrukthai)'s
`shared/engine.ts` + `shared/makrukRules.ts`, ported line by line — because **the adjudication order
changes outcomes**, and getting it in the wrong order produces games that look plausible and are wrong.

## Adjudication order

1. **Pieces-honor immediate draw** when pieces-on-board + 1 > limit. Checked **before** mate is
   awarded — so a mate delivered one move too late is a draw, not a win.
2. The count increments **only on the counting side's own moves**.
3. Reaching `count == limit` arms `final_attack_pending`. The stronger side gets **exactly one move**;
   no mate means draw.
4. **Board honor** (Sak Kradan) draws once the count passes 64.
5. *Then* mate, stalemate, bare kings.

## Defaults

Search-side, a fresh Sak Kradan begins **active** (`board_honor_auto_start = true`), treating the
weaker side as counting — the rational-play default. Game-level code can turn this off and drive
`start_counting()` / `stop_counting()` the way the UI does.

A null move must **never** tick the counting clock: `Game::do_null_move` deliberately leaves `counting`
and `outcome` alone. Null-move pruning is also disabled while a count is active and in king+bia
material, because makruk zugzwang is real (bia move one square forward).

## How it is verified

Movegen is verified **against fairy-stockfish**, not against itself.

- Startpos perft matches exactly: **23 / 529 / 12012 / 273026**.
- 29 mirrored random positions match exactly (`scripts/mirror-perft.mjs`, needs `FAIRY_DIR`).
- `cargo test --release` covers the counting rules directly: pieces-honor limits against the spec
  table, the final-attack window (both mate and miss), the immediate-draw ordering, bare kings, and
  that no count starts while unpromoted bia remain.

## Why it shows up in the eval

`eval::counting_term` nudges play toward converting before the count closes when this side is the
stronger party, and toward surviving it when it is the counting party.

It is **blind to a count that has not started yet** — `counting_term` returns 0 while `game.counting`
is `None`. Measured on this repo's own corpus, holding material edge *and* piece count fixed: at a
400–700 cp edge with 4–8 pieces on the board, the stronger side scores **92.3% while any unpromoted
bia remains** and **62.0% once they are gone** — a 30-point swing the eval cannot see. Fairy-Stockfish
has the same blindness; ianfab's Makruk-Stockfish fork does not, and scales the win score by the
remaining count.

Recorded as a known gap, not fixed — see §0 of [the strength spec](strength-spec-v1.md).
