# Parallelize match-arena to the core budget

Type: task
Status: open
Blocked by: 01-pin-the-budgets.md
Parent: map.md

## Question

`scripts/match-arena.mjs:378` plays games **strictly serially** — a plain `for` loop with `await playGame(...)`, one engine process and one fairy process for the whole block. On 16 cores that means a 32-game block occupies about two of them. The predecessor map's benchmark ticket specified "extended to equal movetime **+ parallel workers**"; the equal-movetime half shipped and the parallel half never did. The 2026-08-02 ladder ran ~160 games one after another for this reason.

Run games concurrently up to the core budget X from *Pin the budgets*, then prove the parallel harness produces the same answers as the serial one.

Must survive the change — each of these is a defect the harness has already paid for once:

- **Seeded openings and color-reversed pairing.** `openings[g >> 1]` pairs game `2k` and `2k+1` on one opening with colors swapped. Concurrency must not break the pairing, and `--seed S` must still reproduce a block exactly.
- **Per-game process isolation.** Today one long-lived engine and one long-lived fairy carry all games. N concurrent games need N pairs — plus N oracles — and the eval-echo line printed before the block must still be true of every worker.
- **`MAKURUK_*` stripping and `OPP_WEIGHTS`** must apply per worker, or Gate A silently measures one engine against itself (this exact class of bug ate a day).
- **The max-plies / errors distinction** in the tally.

**Acceptance:** an r3-vs-r3 control block reads ~50% (the check that validated `OPP_WEIGHTS`), and a re-run of a recorded block at the same seed lands within its standard error of the serial number. Report the measured speed-up and the peak core count actually used.

## Answer

<!-- filled on resolution -->
