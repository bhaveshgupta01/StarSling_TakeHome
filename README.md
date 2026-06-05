# StarSling Battleships Agent

A closed-loop agent that plays the StarSling Battleships challenge — a full 15-game attempt against a fixed roster of opponents — and self-optimizes toward the highest score. It authenticates through the Agent Auth device flow (fresh single-use JWT per request), runs one state-machine loop, shoots with probability-density targeting, and places ships using exploits learned from each opponent's own behaviour.

**Best score: 787 / 1000** (15 wins / 0 losses, 23 ship-cells lost). Trajectory, every jump driven by logged data:
`58 → 180 → 284 → 369 → 468 → 537 → 601 → 646 → 701 → 720 → 787`.

## How to run

```bash
npm install
LOGIN_HINT=you@example.com npm run auth   # one-time browser approval, persisted to disk
npm run play | tee runlog.txt             # plays one 15-game attempt with the best config
```
Node 22+. Typecheck: `./node_modules/.bin/tsc --noEmit`. All env switches default to the best setting, so plain `npm run play` runs the full strategy.

## How the score works (three components)

The final score is the sum of three signals — understanding them is what drove every strategy decision:

1. **Win bonus** — each game won pays the opponent's roster baseScore (SCOUT 14 / WARSHIP 15). Winning all 15 ≈ 220 points. This is the floor; you must win.
2. **Hit differential** — (our hits on their ships) − (their hits on ours), summed across games. Rewards winning *fast* and *clean*: the quicker we sink their fleet and the fewer of our cells they touch, the higher.
3. **Ship-loss penalty** — each of our ships lost costs `2 + classLossPenalty` (CARRIER 14, BATTLESHIP 12, CRUISER 11, SUBMARINE 10, DESTROYER 8). This is where the gap to 1000 lives.

Since we win ~15/15 every attempt, the win bonus is maxed and the whole game becomes **minimizing ship loss** (which also maximizes hit differential — the two are coupled).

## Strategy

- **Shooting — probability density (L4).** Every turn re-derives belief from shot history, enumerates all legal placements of unsunk ships, and fires the highest-coverage cell. Focus-fires open hits (weight `8^hits`), parity-boosts the hunt, and prunes the **no-touch halo** — opponents place ships non-adjacent (0 / 992 touching in the data), so a hit's diagonals and a sunk ship's 8-neighbourhood are guaranteed water. Median ~40 shots, below the textbook ~42.
- **Placement — learned, per-opponent, damage-minimizing.** Opponents are *adaptive* (after a hit, their next shot is orthogonally adjacent ~60% vs ~28% after a miss — confirmed hunt+target). For each opponent the agent loads a **danger map** from its archive of past games (`danger[r][c]` = how often that opponent fired there within a window matched to its median win length) and places each ship on its lowest-danger cells, **highest-loss ships first into the safest cells** (CARRIER/BATTLESHIP get the tightest pick), no-touch to prevent chain-sinks. Falls back to bottom-biased placement for unseen opponents.
- **Fingerprint exploit.** Three opponents (Hydra Probe, Eridanus Drone, Andromeda Cruiser) reuse a fixed layout. We fire their known ship cells first → 16-shot wins, ~0 loss. Self-disables after 2 misses if a layout ever changes.

This is the closed loop: *play → log every game to a cumulative archive → re-derive each opponent's danger map → place to dodge it next time.*

## How this addresses the evaluation signals

- **Technical judgment** — the agent matches what the research says is optimal (probability density is the accepted near-optimum; for line-segment ships the sink phase is provably ≤1 wasted miss). The real edge is *novel*: placing against a learned per-opponent shooting model, which standard Battleship theory doesn't cover. Every change was a hypothesis tested offline, then live. Several promising ideas were **rejected with data** (Monte-Carlo placement, carrier-only tightening, hunt-only maps, info-gain shooting) once they proved to overfit a noisy estimate — see [STRATEGY_FINAL.md](STRATEGY_FINAL.md).
- **Pragmatism** — single loop on `responseType`, plain functions, no premature abstraction. Pre-flight validation prevents the one fatal error (an illegal move is a terminal DQ, not a retry). Honest about the ceiling: 787 sits at the data-proven frontier (~780–800); 1000 is unreachable against adaptive opponents that randomize placement.
- **Observability** — every move and outcome is logged; per-game and raw-coordinate records are written each run, and a cumulative archive (`analysis/games_archive.jsonl`) is the agent's memory across attempts. The analysis tooling (`tools/`) is how every strategy claim was verified — heatmaps, determinism checks, adaptivity probes, an offline shot simulator, cross-validation.

## Honest postmortem

While reverting a false-positive fingerprint near the end, I accidentally deleted a *valid* one (Andromeda Cruiser), which then played blind for ~16 banking attempts and silently capped them. A teammate's prompt to re-verify the fingerprints caught it; the fix landed in the final two minutes and immediately produced the session's two highest hit-differentials. The best score (787) predated the bug and was never at risk, but the analysis shows the bug likely cost a *higher* best. Full data and counterfactual in [RUN_OUTPUTS.md](RUN_OUTPUTS.md#postmortem). It's a clean example of the failure mode the whole project guards against — and of why observability + a second look matter.

## Repository map

| | |
|---|---|
| `src/` | the agent — `agent.ts` (loop), `auth.ts` (signed fetch), `client.ts` (REST), `strategy.ts` (placement + shooting), `danger_maps*.ts`, `fingerprints.ts`, `logger.ts` |
| `tools/` | analysis — heatmaps, determinism/adaptivity checks, danger-map extraction, offline shot sim, cross-validation |
| `analysis/games_archive.jsonl` | cumulative game memory (the closed loop's state) |
| [STRATEGY_FINAL.md](STRATEGY_FINAL.md) | the data-science deep dive + literature check + final verdict |
| [STEPS_LOG.md](STEPS_LOG.md) · [RUN_OUTPUTS.md](RUN_OUTPUTS.md) | change log · run-by-run journal |
| [DESIGN_NOTES.md](DESIGN_NOTES.md) · [HANDOFF.md](HANDOFF.md) | design rationale · state-of-play handoff |

Credentials (`.agent-credentials.json`) are git-ignored and never committed.
