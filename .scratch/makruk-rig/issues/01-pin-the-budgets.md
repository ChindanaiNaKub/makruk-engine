# Pin the budgets: what is a round allowed to cost?

Type: grilling
Status: resolved (2026-08-02)
Blocked by:
Parent: map.md

## Question

Fix the three numbers every other ticket on this map is designed to:

- **N — wall-clock.** Minutes from "I have a candidate artifact" to "accept or reject". Is the unit a *gate* or a whole *round* (datagen + train + gate)? Those differ by ~90 minutes today and the answer decides whether *Does a round need new data at all?* is on the critical path.
- **X — CPU budget.** How much of the 16 cores the rig may take, and whether that is a hard cap (job count / `taskset`) or a soft one (`nice`, so it yields to foreground work). "I need my laptop back" and "never exceed 8 cores" are different mechanisms with different failure modes.
- **Y — thermal ceiling.** The temperature above which the rig must throttle itself, and *how* it finds out — poll `/sys/class/hwmon`, or just trust that X cores stays under Y and never measure? Self-throttling costs code; a static core cap costs headroom.

And the enforcement question that makes them real: **what does the rig do when a run would exceed a budget?** Refuse to start, degrade (fewer jobs, longer wall-clock), or run anyway and print a warning. A budget nothing enforces is a wish.

Measure before deciding — all three are observable on this machine in minutes:
- current thermal profile of `datagen.mjs --jobs 12` vs `--jobs 6` vs `--jobs 4` (throughput and °C)
- current wall-clock of a 32-game block, serial, and its actual core utilization
- idle and light-load baseline temps, so Y is set against something real

## Measurements (2026-08-02, before deciding)

**Arena wall-clock is movetime-bound, ~95% efficient.** A 4-game skill-3 smoke: plies 129/207/93/225 → 11/19/8/20 s, i.e. almost exactly `plies × 0.1 s`. There is no harness overhead to reclaim; the only levers are *fewer games* and *more games at once*. Derived: ~14.5 s/game average, so a 32-game block ≈ 7–8 min and a full Gate A + Gate B round (96 games) ≈ **23 min serial**, on 2 of 16 cores. Counting-rule games (200+ plies) cost 2.4× a decisive one.

**Datagen job count is a bad knob.** Each arm run to steady state (75 s), package temp sampled every 3 s, 30 s cooldown between arms:

| jobs | pos/s | steady °C | peak °C | pos/s per job | % of 12-job rate |
|---|---|---|---|---|---|
| 12 | 2897 | 83.6 | 97 | 241 | 100% |
| 8 | 2430 | 80.5 | 99 | 304 | 84% |
| 6 | 2142 | 78.2 | 93 | 357 | 74% |
| 4 | 1509 | 74.5 | 84 | 377 | 52% |

Dropping 12 → 4 jobs costs **48% of throughput and buys 9 °C**. Peak stays 84–99 °C at *every* job count. Idle baseline is 60 °C; cooldown floor is ~51 °C.

**The machine is throttling at any sustained load, and that is the real finding.** `package_throttle_count` on cpu0 reads **320,794**. Per-job throughput *rising* as jobs fall (241 → 377) is the throttling signature: the low-job arms run at higher clocks. Extrapolating the unthrottled per-job rate, 12 jobs should be ~4,500 pos/s rather than 2,897.

**Every power knob is at maximum** on this i5-12500H (4 P-cores + 8 E-cores, 16 threads):

| knob | current | options |
|---|---|---|
| `/sys/firmware/acpi/platform_profile` | `performance` | cool, quiet, balanced, performance |
| `scaling_governor` (intel_pstate) | `performance` | performance, powersave |
| `energy_performance_preference` | `performance` | default, balance_performance, balance_power, power |
| RAPL PL1 / PL2 | 45 W / 115 W | — |

**REFUTED — `platform_profile=balanced` does nothing here.** Hypothesis was that the firmware profile would lower PL1/PL2 and give back the throttled headroom. Set to `balanced` and re-ran the identical sweep:

| jobs | pos/s (performance → balanced) | steady °C (performance → balanced) |
|---|---|---|
| 12 | 2897 → 2932 | 83.6 → 79.2 |
| 8 | 2430 → 2546 | 80.5 → 80.4 |
| 6 | 2142 → 2090 | 78.2 → **83.0** |
| 4 | 1509 → 1684 | 74.5 → 73.8 |

RAPL limits were **identical before and after** (45 W / 115 W / 215 W), so the profile had no power-cap to change on this machine. Throughput moved 0–12%, temps moved ±5 in both directions.

**And that exposes the measurement's own noise floor: ~±4–5 °C.** The 6-job arm rose 4.8 °C while the 12-job arm fell 4.4 °C under a change that provably altered no power limit. This weakens the job-count table above as well — its 9 °C span across 12 → 4 jobs is only about two noise-widths, so *"48% of throughput for 9 °C"* should be read as *"48% of throughput for somewhere between nothing and 9 °C."* Any future thermal arm needs repeats, not a single 75 s run.

**Consequence for X and Y.** X (core budget) is a weak control variable: it costs throughput and buys little that survives the noise floor. Y (thermal ceiling) cannot be met by tuning at all — an i5-12500H at PL1 = 45 W in a laptop chassis sits at 74–83 °C under any sustained multicore load, with 81–99 °C peaks at every job count, and 320,794 accumulated package throttle events. **So the ceiling has to be met by not running the hot thing, or by running it when the machine is not needed** — which promotes *Does a round need new data at all?* from a blocked ticket to the one that actually decides whether this budget is achievable.

Untested knob remaining, if it is worth one more experiment: writing RAPL `constraint_0_power_limit_uw` directly (45 W → ~30 W, needs root). That is the only knob measured to be actually binding. Governor (`powersave`, which on intel_pstate is the normal adaptive mode, not a slow one) and EPP (`balance_performance`) are only honored together and are a second candidate.

Re-run the sweep with `scratchpad/thermal-sweep.mjs` — but add repeats per arm first, given the noise floor above.

## Answer

**The question was wrong, and the measurements are what showed it.** N, X and Y are not three
numbers for one rig — they are three numbers for *two* rigs that happen to share a repo, and the
budget only becomes enforceable once they are separated:

| class | what it is | currency | budget |
|---|---|---|---|
| **foreground** | arena blocks — you are sitting there waiting for a verdict | wall-clock | N |
| **background** | datagen, training — you walked away | heat and your laptop | consent |

The split is forced by the evidence: arena runs are **minutes**, datagen is **an hour**. No single
budget describes both, and the one that was implicitly being applied — "keep the whole rig under
some core count" — was the wrong instrument for either.

(The split was first justified as "the arena is cool and datagen is hot." That was wrong and this
ticket's own instrumentation disproved it within the hour — see *The instrumentation falsified an
inherited number* below. **Brevity**, not coolness, is what separates the classes.)

### N — wall-clock: **15 min, and the unit is Gate A**

Gate A is the accept/reject; Gate B is a ladder *measurement* that runs afterwards, a line rig
ticket 03 already drew. So Gate A carries N (15 min) and Gate B gets its own smaller ceiling
(5 min, against a measured 3.2 min at 64 games). A full round-verdict is ~7 min typical, ~17 worst.

**15 was set by the SPRT cap, not the other way round** — and that ordering is the whole finding.
`scripts/sprt-cap-sweep.mjs` (new, pure Monte-Carlo, no games) swept the cap:

| cap | games | worst wall | wrong-call | inconclusive at +150 | inconclusive at +100 |
|---|---|---|---|---|---|
| 48 | 96 | 6.2 min | 0.4% | 4.9% | 43.2% |
| 64 | 128 | 8.3 min | 0.6% | 0.4% | 19.4% |
| **96** | **192** | **12.5 min** | **1.0%** | **0.0%** | **2.3%** |
| 400 (old) | 800 | 52.0 min | 4.1% | 0.0% | 0.0% |

Two things fell out. **A bigger cap is worse, not merely slower** — the wrong-call rate *rises*
with the cap, because a longer walk is more chances to cross the wrong bound. And the binding case
is not the +150 Elo round, which any cap ≥ 48 decides by 86 games; it is the merely-good one. A
cap of 64 fits a rounder 10-minute N and **throws away one good round in five**. That is this
project's signature failure — a number that makes the engine look worse than it is — wearing a
budget's clothes. So the cap is 96 pairs and N moved to fit it.

`DEFAULTS.maxPairs` 400 → **96**. Worst case drops 4.2× and the wrong-call rate drops 4×.

### X — CPU: two mechanisms, because there are two problems

**Foreground: concurrency pinned at 6, never niced.** Games are movetime-bound, so starving a
process changes how many nodes it searches in its fixed 100 ms — which changes the *result*, not
just the speed. `nice` on the arena is not a slow rig, it is a corrupt one. And because the whole
ladder was re-measured at concurrency 6, a different concurrency is effectively a different
opponent: **overriding it is a clause-(b) binding mechanism and owes a control block** (recorded on
rig ticket 07).

**Background: `nice 15`, and job count left at 12.** The measured curve says job count is a bad
knob — 12 → 4 costs 48% of throughput to buy ~9 °C, about two widths of the ±4–5 °C noise floor,
while peaks stay 84–99 °C regardless. Lowering it makes the run longer *and* still hot. The actual
complaint is responsiveness, not degrees, and scheduler priority buys that for free: at nice 15
datagen keeps the whole machine when nothing else wants it and yields within milliseconds when you
touch the laptop.

### Y — thermal: it protects the number, not your lap

An i5-12500H at PL1 = 45 W in this chassis sits at 74–83 °C under any sustained multicore load,
with 320,794 accumulated throttle events and every power knob already at maximum. A ceiling that
keeps the laptop comfortable is not available at any tuning. So Y was re-aimed at the thing it
*can* protect:

- ~~**80 °C start gate on the arena.**~~ **CORRECTED the same day — see the amendment below.** The
  gate is now on CPU contention, not temperature: refuses when >25% of the CPU is already busy;
  `--allow-busy` overrides.
- **95 °C / 60 s runaway guard on background work.** Steady state is 74–84 °C, so this never fires
  under normal load — it catches a blocked vent or a dead fan.
- **Every block now records `tempStartC` / `tempMeanC` / `tempPeakC` in the ledger,** so the 80 °C
  threshold can be *checked* against real scores later instead of trusted forever. Asserting a
  threshold and never validating it is the same move that cost this project five defects.

### Enforcement: announce, refuse, consent — never degrade

**Degrading is explicitly rejected.** Silently dropping concurrency to fit a budget would change
the measurement conditions mid-run, which is precisely the quiet corruption this map exists to
stop. A budget breach must change the *plan*, not the *conditions*.

1. **Announce.** Every run prints worst-case wall-clock, busy cores, thermal class and current
   package temperature *before* spawning anything. Cheapest mechanism on the map and the most
   directly aimed at the stated pain.
2. **Refuse** (foreground). Over N, or too hot to be comparable → exit 3, nothing played, with the
   flag that would make it legal. Refusal beats a warning; the prose-in-`AGENTS.md` convention
   failed exactly because it could be skimmed.
3. **Consent** (background). A background run over 5 min prompts, and *fails closed* without a TTY —
   an unattended caller must say `--yes` rather than inherit an hour of the machine by default.

### Shipped

- `scripts/budget.mjs` — the constants, the estimator, the sysfs thermometer, `announce` /
  `enforceForeground` / `confirmBackground` / `goBackground` / `ThermalGuard`.
- `scripts/sprt-cap-sweep.mjs` — the evidence for the cap, kept runnable so the number can be
  re-earned rather than inherited.
- `sprt.mjs` `maxPairs` 400 → 96; `match-arena.mjs` announce + refuse + hot gate + ledger thermals
  + `--budget-min` / `--allow-busy`; `datagen.mjs` announce + consent + nice + runaway guard.

Verified: all six enforcement paths unit-tested (over-budget → exit 3, `--budget-min` allows,
busy-start → exit 3, `--allow-busy` allows, latency floor, datagen estimate); a 4-game arena block
and a 4,305-row datagen run end-to-end; `cargo test --release` 9/9, mirror-perft and preflight
green. One bug found and fixed in the process: the first estimator ignored the latency-bound
regime and announced 12 s for a block that took 34 s.

### The instrumentation falsified an inherited number within two blocks

The first two arena blocks recorded through the new `ThermalGuard` came back **63 °C start → 88 °C
mean → 97 °C peak, in 34 seconds** (b0030, b0031). [Parallelize match-arena](02-parallelize-match-arena.md)
recorded **69 °C peak** for the parallel arena. Both cannot be right, and the new figure is from a
sampler that runs on every block rather than from one hand-run measurement.

This does not change the decision, but it does change its *justification*, so the justification was
rewritten rather than quietly kept. The foreground/background split is **not** "the arena is cool
and datagen is hot" — nothing on this machine is cool under load. It is **"the arena is over in a
minute and datagen is not."** Brevity is the property that makes wall-clock the right currency for
one and consent the right currency for the other.

Two candidate explanations, unresolved: the 69 °C may have been a steady-state mean rather than a
peak, or measured on a colder machine. Left in the map's *Not yet specified* rather than guessed at —
every block now carries its own thermals, so this settles itself with data instead of argument.

### Amendment 2026-08-02 — the 80 °C start gate was wrong, and the rig caught it

Fixing [the control-block trigger](07-control-block-trigger.md) produced the first back-to-back run
this rig has ever done: a mandated control block, then the block it was clearing. The control ran,
passed — and the main block was then **refused at 91 °C by this ticket's own hot-start gate.**

The gate rejects the normal case. Ledger rows say every arena block runs at **88–89 °C mean**, so an
80 °C start gate refuses *every* consecutive block, including Gate A followed by Gate B in an
ordinary round. The reasoning was inverted: the ladder was itself calibrated by blocks run back to
back, so **hot is the calibrated condition and a cold start is the anomaly.**

What actually threatens a movetime-bound measurement is **contention** — another process taking
cores our engines needed inside their fixed 100 ms. So the gate now measures that directly, and
specifically *not* by load average: immediately after one of our own blocks, `loadavg[0]` read
**3.51** (a 1-minute exponential decay of our own finished work) while instantaneous utilisation
from `/proc/stat` read **3.1%**. A load-average gate would have reproduced the same false refusal.

**Now: refuse when >25% of the CPU is already busy** (`BUDGET.busyStartFraction`, `--allow-busy` to
override). Temperature recording stays exactly as it was — it was shipped so this could be settled
with data instead of belief, and it settled it within the hour. The relevant fog patch on the map
("Is the 80 °C hot-start gate real?") is closed by this amendment rather than left to age.

### Consequences for the rest of the map

- **[Does a round need new data at all?](05-does-a-round-need-new-data.md) is unblocked, and its
  second half is already answered here** — the throughput/°C curve was measured and the "6 jobs
  might be 70% of throughput at 60% of the heat" hypothesis is refuted (74% of throughput for ~5%
  less heat, inside the noise floor). Only "when does a round earn a new corpus" remains, and it is
  no longer a *budget* question: background work has no wall-clock ceiling, so the question is
  about label staleness, not minutes.
- **Arena concurrency is now a named binding mechanism** for rig ticket 07's clause (b).
- **RAPL PL1 (45 W → ~30 W, needs root) stays untested and is now optional rather than required.**
  The ceiling is met by class-splitting and consent; RAPL would make background work more pleasant,
  not make the rig meet its budget. Recorded in the map's *Not yet specified*.
