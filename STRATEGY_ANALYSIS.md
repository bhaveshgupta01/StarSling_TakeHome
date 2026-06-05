# STRATEGY ANALYSIS — data-scientist view (for the next version)

Snapshot: best **701/1000** (14W/1L, ~2 ships lost/game). Dataset: 395 archived games (`analysis/games_archive.jsonl`), ~28–31 per opponent.

## Authoritative scoring (from live `/rules`, verbatim)
`per-game = 1×hits + Σ sinkBonusByClass(opp ships sunk) + winBonus − 2×(your ships lost) − Σ classLossPenaltyByClass(your ships sunk)`
- `agentHitPoints=1`; `sinkBonusByClass = classLossPenaltyByClass = {CARRIER10,BATTLESHIP8,CRUISER7,SUBMARINE6,DESTROYER4}`; `perShipLossPenalty=2`.
- **Win bonus = opponent roster `baseScore` (SCOUT 14 / WARSHIP 15).** NOTE the constant `opponentBaseScoreOnWin=0` is a red herring — proven by contradiction (601 run w/ 42 losses is impossible if win=0; max would be 780 < needed). Perfect = 1000.
- **Per-ship loss penalty (2 + class) → weight placement by this:** CARRIER **12**, BATTLESHIP **10**, CRUISER **9**, SUBMARINE **8**, DESTROYER **6**. Protect CARRIER/BATTLESHIP hardest.

## Roster (15 distinct, fixed order, no repeats)
SCOUT(14): Hydra Probe, Lyra Skiff, Orion Scout, Eridanus Drone, Pleiades Skimmer.
WARSHIP(15): Cygnus Stalker, Vega Marauder, Andromeda Cruiser, Tau Ceti Phantom, Rigel Reaver, Antares Predator, Betelgeuse Berserker, Polaris Warship, Sirius Dreadnought, **Centauri Battlecruiser (G15)**.
- **Fixed-layout (fingerprinted): Hydra, Eridanus, Andromeda.** Other 12 randomize fresh each attempt. No cross-attempt adaptation to us; all adaptive within a game.
- **🔴 GAP: G15 Centauri Battlecruiser was never logged** (logger off-by-one folds the last game's `GAME_COMPLETED` into `ATTEMPT_COMPLETED`). We have ZERO data on Centauri — fix the logger to capture G15, then check if it's a 4th fingerprint-able fixed layout (potential free win).

## Where the 299 missing points are
We win 14–15/15 every attempt, so the gap is **almost entirely ship-loss penalty** (per ship: 2 + classLoss 4–10). Ships lost ≈ 2/game. Ships lost is driven by **game length**: the opponent fires ~1:1 with us, is **adaptive** (next shot ortho-adjacent 60% after a hit vs 28% after a miss → once they contact a ship they sink it), so:

> ships lost per game ≈ number of our ship-cells the opponent *hunt-contacts* before we win.

## The dominant variable: our shot count (game length)
Random-opponent game length (our shots): **p10=32, p50=42, p90=56, max=61**. **25% of random games run >50 shots — those are the ship-loss games.** Fixed opponents finish in 16–17 (fingerprint) and lose ~0.

Per-opponent median our-shots (longest = most dangerous):
- **Polaris 54, Pleiades 49, Antares 49, Orion 47** ← worst offenders (cost the most ships)
- Cygnus/Lyra/Sirius 43–45, Tau Ceti/Vega/Rigel/Betelgeuse 33–39
- Hydra/Eridanus/Andromeda 16–17 (fingerprinted)

## What is and isn't exploitable (settled by data)
- **3 fixed-layout opponents** (Hydra, Eridanus, Andromeda) → fingerprint known cells → 16-shot wins, ~0 loss. **Solved.**
- **11 randomize placement truly uniformly** (edge 35.6%≈36%, rows/cols 8–12% each) → no shooting prior beats uniform density → **density is optimal, ~40 shots is near the floor.**
- Opponents **all open top-down**, but in long games cover the whole board (~30% of shots reach rows 7–9). So bottom placement *delays* contact, doesn't shield.
- **Smart per-opponent placement** (danger maps) halved expected contacted cells (Polaris 4.9→2.6, Vega 6.6→3.3) → ships-lost 42→30. Current best lever.

## Two levers left, ranked
1. **Reduce ship loss in the long random games** (the 25% >50 shots). Sub-ideas:
   - **Win-length-matched danger maps**: current map = P(fired within first **40** shots); but Polaris games run ~54. Build the map with K = that opponent's median win-length so it reflects the real exposure window.
   - **Per-ship "shield" objective**: a ship survives if the opponent never *hunt-contacts* any cell; protect the high-penalty ships (CARRIER 12, BATTLESHIP 10) hardest — weight `smartLayout` by class penalty, place the carrier in the single safest region.
   - **Re-extract danger maps from the larger/recent archive** (closed-loop refinement); watch for drift/overfit since opponent shooting is adaptive to our placement.
2. **Cut the shot-count tail** (fewer 50–61 shot games). Density is near-optimal on average; the tail is unlucky hunts. Possible: smarter tie-breaking among equal-density cells (prefer cells that also maximally split the remaining unknown region — information gain), or a small Monte-Carlo when few placements remain.

## Honest ceiling
1000 needs 0 ships lost across all 15. Against **adaptive + uniformly-randomizing** opponents in a 1:1 race, the ~40-shot random games guarantee ~2 contacts → ~2 ships lost. Realistic frontier ≈ **700–800**. 701 is in that band; the experiments above target the top of it, not 1000.
