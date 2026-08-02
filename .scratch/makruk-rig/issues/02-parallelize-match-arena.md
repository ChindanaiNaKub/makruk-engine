# Parallelize match-arena to the core budget

Type: task
Status: resolved (2026-08-02)
Blocked by:
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

**Done: 5.4–5.9× measured, `--concurrency N` (default 6 → ~12 busy cores of 16). And it surfaced harness defect #6, which is worth more than the speed-up.**

### The parallelism

A work-stealing pool of N slots, each owning its **own** engine pair — a UCI engine is a single conversation, so two games sharing a process would interleave `go`/`bestmove` and corrupt both. `playGame` already spawned its oracle per game.

Everything the ticket required to survive, survived:

- **Seeded openings and colour-reversed pairing.** Game `g` takes `openings[g >> 1]` and colour `g % 2` — a property of the game *index*, not of execution order, so it is untouched by out-of-order play. `--seed S` still reproduces.
- **Tally in game order, not completion order**, so the recorded row is deterministic.
- **`MAKURUK_*` stripping / `OPP_WEIGHTS`** apply per slot, since each slot builds its opponent through the same `startFairyProcessEngine`.
- **max-plies / errors** distinction untouched.

Progress prints as `[k/N] game g: …` on completion, so an interleaved log is still readable.

### Acceptance, and the failure that mattered

Reproducing recorded block b0002 (r3 vs fairy skill 3, seed 7, serial: **53.1%**) returned **68.8%** — 1.8 SE out, a **fail** against "within one SE". Two things had changed at once, so the block was re-run through the new code at `--concurrency 1`:

| harness | concurrency | score |
|---|---|---|
| old code (b0002) | 1 | 53.1% |
| new code | 1 | 62.5% |
| new code | 6 | 68.8% |

Parallelism was innocent — new-serial vs new-parallel is 6.3 points, 0.7 SE, same code. The 9.4-point move came from the *other* change: clearing transposition tables per game.

### Harness defect #6 — the TT was dead for every game after the first

At n=32 that was 1.07 SE and unresolvable. Blocks were now 5× cheaper, so it was settled properly at n=128 (SE 4.4), seed 7, r3 vs fairy skill 3:

| | score |
|---|---|
| TT cleared per game | **67.6%** |
| TT carried across games | **50.0%** |

**17.6 points, 4.0σ.** Cause: `src/search.rs:214` replaces on depth alone with **no generation counter**. The probe validates the key (`search.rs:210`), so stale entries were never *wrong* — they were **un-evictable**. After one game the table saturates with high-depth entries that no shallower store can replace, and every later game runs with an effectively dead TT.

Same signature as the other five defects: **it made the engine look worse than it is.** `match-arena` now sends `ucinewgame` before every game, which also makes a block independent of how work was distributed across slots — the property a reproducible harness needs. `--keep-tt` restores the old behaviour for diagnosis only.

**The site is unaffected** — `browserEngineBotWorker.ts:118` sends `ucinewgame`. Adding TT aging would help real play and is engine work, so it belongs to the parked strength map, not here.

### A second bug, caught by the ledger

`oppIsOurs` was decided by `FAIRY_BIN.includes("makruk-engine")` — and the repository directory is itself named `makruk-engine`, so **every** path matched and blocks against the real fairy binary were labelled as head-to-head against our classical eval. Harmless while it only coloured a console line; actively corrupting once the ledger began recording it. Now compares resolved paths. The three affected rows are retracted with the cause.

Also added: blocks under 8 games are filed as `smoke` regardless of requested kind (SE > 17 points — calling that a gate puts a number in the ledger that cannot mean what its kind implies), and `smoke`/`diag` are excluded from the default view and from the generated AGENTS.md block.

### The clean ladder, n=64 (SE 6.25)

Every prior arena number was measured with a dead TT, so the whole ladder was re-run:

| ours | fairy skill | W–L–D | score | was (corrupt) |
|---|---|---|---|---|
| classic | 3 | 33–4–26 (1 mp) | **72.7%** | 37.5% |
| r3 net | 3 | 41–13–7 (3 mp) | **71.9%** | 53.1% |
| r3 net | 5 | 14–34–9 (7 mp) | **34.4%** | 35.9% |
| r3 net | 8 | 5–49–9 (1 mp) | **15.6%** | — |
| r3 net | 10 | 0–64–0 | **0.0%** | 0.0% |
| r3 net | 20 | 0–64–0 | **0.0%** | 0.0% |

Three consequences:

1. **Skill 3 no longer discriminates** — classic 72.7%, net 71.9%. Gate at 5–8 now.
2. **Skill 8 is a real rung** (15.6%), so the ladder is a gradient up to 8 and a wall at 10. The earlier "10/15/20 are one wall" stands; "there is nothing between 5 and 10" does not.
3. **Classic gained more from the fix than the net did** (+35 vs +19). It searches to depth 8 against the net's depth 5, so it leaned on the TT harder and lost more when it was dead — which means past *comparisons* between classic and the net were biased, not just past absolute numbers.

`bash scripts/ladder.sh 64` re-runs the whole thing in ~15 minutes across three chunks. Peak package temp during a block: **69 °C**, well under datagen's 83 °C — the arena is not what heats this machine, confirming the ticket could safely ship ahead of *Pin the budgets*.
