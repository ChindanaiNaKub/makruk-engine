# Where do results live so a future session can't read a retracted number?

Type: grilling
Status: open
Blocked by:
Parent: map.md

## Question

The user's stated pain, verbatim: outdated markdown conflicting with new updates, and hours lost to numbers that were wrong. That is not only a harness problem — it is a **record** problem, and the record is currently three incompatible things at once:

- **`AGENTS.md`** (~9 KB of running prose) mixes operational instructions, current measurements, superseded measurements, and explicit retractions in the same paragraphs. An agent reading it fresh has to parse which numbers are live. It has already been edited three times in one day to retract or supersede a figure in place.
- **`docs/strength-spec-v1.md`** carries an append-only execution log now ~270 lines deep, written as narrative, with `**RETRACTED**` blocks inline. Excellent as history, unusable as a lookup.
- **Raw logs** — the ladder that decided today's direction lived in a `/tmp` scratchpad belonging to a dead session, and would have been lost on reboot.

Decide the shape of the record:

- **Is there a single machine-readable results ledger** (one row per block: artifact, opponent, skill, games, W/L/D, max-plies, seed, movetime, harness commit, timestamp) that the arena *writes itself*, so a result cannot be transcribed wrong or lost in `/tmp`? What is the minimum row that makes a block reproducible and comparable?
- **What does `AGENTS.md` keep?** Argument for: it is what an agent loads first, so the operational one-liners and the traps belong there. Argument against: every measurement in it is a copy that can go stale. Where is the line?
- **What retires a superseded number?** Today the convention is to leave it in place with a caveat ("pre-randomization, suspect"), which is why the file keeps growing and why a hurried read picks up the wrong figure. Deletion loses the provenance the spec's execution log exists to hold. Decide the rule and where each half lives.
- **Where does an in-flight run write?** Not a session-scoped `/tmp` directory. Decide the location and whether it is gitignored.

## Answer

<!-- filled on resolution -->
