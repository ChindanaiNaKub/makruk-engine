# Pin the budgets: what is a round allowed to cost?

Type: grilling
Status: open
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

<!-- filled on resolution -->
