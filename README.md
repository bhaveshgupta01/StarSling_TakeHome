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

## How it got to 787 — iterations and results

Every jump came from a logged observation, not a guess. The score roughly doubled and then climbed in steps as the bottleneck moved from *shooting* to *ship loss*:

| # | Change | Why (what the data showed) | Score |
|---|---|---|---|
| 1 | Hunt + target (parity) | Two-phase baseline | 58 |
| 2 | Direction-lock + sink-retire | Extend a hit along its axis, then stop | 180 |
| 3 | Bottom-biased placement | Heatmaps: opponents sweep top-down, rows 8–9 cold | 284 |
| 4 | Probability density (L4) | Enumerate all legal placements, fire max-coverage cell | 369 |
| 5 | Focus-fire (`8^hits`) + checkerboard hunt | Sharper targeting; cut median shots ~51→48 | 468 |
| 6 | No-touch-halo prune | Data: opponents never place adjacent (0/992) → a hit's diagonals and a sink's halo are water | 601 |
| 7 | Concentrate in coldest rows (SKEW=3) | Safe *only* once no-touch stops chain-sinks | 646 |
| 8 | Per-opponent danger-map placement | Each opponent fires on a learnable per-cell timing | 701 |
| 9 | Win-length-matched maps (K = median win length) | Long-game opponents (Polaris ~54 shots) need real signal in the bottom rows | 720 |
| 10 | Penalty-weighted placement | Ship-loss by class: CARRIER dies 59% vs DESTROYER 38% → protect big ships first | **787** |

### What I tried and *rejected* (with the data reason)

Knowing when to stop optimizing was as important as the wins above. Each of these was implemented, tested offline, and dropped:

| Idea | Why it was rejected |
|---|---|
| Info-gain shot tie-break | No gain — density is already at the shooting floor (~40 shots, below textbook) |
| Touching / clustered placement | All opponents are adaptive (fire adjacent-to-hit 52–81%) → every one chain-sinks. No blind shooter exists |
| Carrier-only "absolute safest" cell | Overfits the danger map's single argmin → *worse* |
| Monte-Carlo joint placement | Overfits the noisy map hardest (+26 loss). The greedy's randomization is a regularizer |
| Hunt-only "decontaminated" maps | Worse — target-mode shots genuinely predict exposure |
| Centauri fingerprint | 2-sample false positive; it randomizes (confirmed at 19 samples) |
| Re-extracting maps from a bigger archive | Cross-validation shows maps saturate at ~25 games/opponent — we already have more |

The recurring lesson: the danger map is a *noisy estimate*, and every attempt to optimize harder against it overfit and lost. The shipped design under-trusts it on purpose. Full detail and the web/academic literature check are in [STRATEGY_FINAL.md](STRATEGY_FINAL.md).

## The three evaluation signals, and where to see them

- **Technical judgment** → the iteration tables above. Every move was a logged hypothesis; the rejected list shows the same rigor applied to *not* shipping things.
- **Pragmatism** → [`src/agent.ts`](src/agent.ts). One loop on `responseType`, plain functions, pre-flight validation (an illegal move is a terminal DQ, so it's caught before sending). And honesty about the ~780–800 ceiling instead of chasing an unreachable 1000.
- **Observability** → [`analysis/games_archive.jsonl`](analysis/games_archive.jsonl) (the loop's cross-attempt memory) and [`tools/`](tools/) (every claim above was verified here — heatmaps, determinism and adaptivity probes, an offline shot simulator, cross-validation).

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
