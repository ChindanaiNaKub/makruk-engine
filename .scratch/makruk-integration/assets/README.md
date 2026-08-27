# Assets — uci-bot-shim

The UCI shim that lets `match-arena.mjs` play against the site's heuristic bot
(tiers 1–7) through its FAIRY_BIN slot, with `OPP_LABEL=site-heuristic-bot-lN`
and `BOT_LEVEL=N`.

**Install** into `../markrukthai-1/scripts/`:

```sh
cp assets/uci-bot-shim.ts ../markrukthai-1/scripts/
cp assets/uci-bot-shim   ../markrukthai-1/scripts/
chmod +x ../markrukthai-1/scripts/uci-bot-shim
```

**Identity warning.** Ledger rows b0064 / b0069 / b0072 record the opponent's
engineId as `sha256:479ffc269f67`, which is the content hash of the *wrapper*
file the arena spawns. Any edit — even whitespace or comments — changes the
hash, and later blocks would cite a different engine than earlier ones. Edit
only with eyes open, and never between blocks you intend to compare.

**Behavioral contract** (kept identical by construction via tsx + site rules):
movetime is ignored by design (the bot's own persona maxMs governs); positions
rebuild through `shared/engine.ts`; promotions emit bare 4-char UCI.
