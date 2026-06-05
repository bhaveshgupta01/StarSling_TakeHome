# RUN OUTPUTS — StarSling Battleships Agent

One entry per agent run. Records what code/strategy was active, the observed result, and what we changed because of it. Pairs with [STEPS_LOG.md](STEPS_LOG.md) (the change log).

Template per run:

```
## Run N — <date/time> — <strategy level>
- Code state: <commit / files changed since last run>
- Command: <how it was run>
- Result: finalScore=__ wins=__ losses=__ hitDiff=__ shipsLost=__ DQ?=__
- Per-game highlights: <notable games, sparse-region waste, fast sinks>
- What changed next: <the iteration this run motivated>
```

---

## Run 1 — 2026-06-04 — Level 2 (hunt parity + target neighbors)
- Code state: full scaffold + live-auth fixes (full-caps JWT, no-body createAttempt, plain signing, discover from SERVER root).
- Command: `SHOT_LEVEL=2 npm run play`
- Result: **finalScore=58 wins=4 losses=11** hitDiff=−29 oppSunk=56(cells) agentShipsLost=68 DQ=no, isNewBest=true
- Live validation: auth + all 4 envelope types + placement + shooting worked first try after the 3 prompt-driven fixes. Zero DQ, zero HTTP errors across ~700 requests.
- Diagnosis: losing **~4.5 ships/game** → penalties (~−45/game) dominate. It's a race to sink 17 first; slow Level-2 hunt (~47 shots/game) loses 11/15 races → few win-bonuses + max penalties.
- Server quirks found: comp displayName is "Standard Competition v2 (varied roster)"; server marks ALL cells of a sunk ship as outcome SINK (so SINK-cell count ≠ ships sunk — logger fixed to count distinct sunkShipClass); per-game table captured 14/15 (final game's GAME_COMPLETED folded into ATTEMPT_COMPLETED).
- What changed next: → Level 3 direction lock (win races faster). Logger now also records `incomingShots` to gauge opponent strength for evasive placement.

## Run 2 — 2026-06-04 — Level 3 (direction lock), random placement
- `SHOT_LEVEL=3` (first try aborted at G12 on a transient HTTP 500 → added 5xx retry; re-run hit ACTIVE_ATTEMPT_EXISTS → added stale-attempt abandon+recreate).
- Result (clean): **finalScore=180 wins=6 losses=9** hitDiff=+1 agentShipsLost=65.
- Read: it's a strict 1:1 race (our shots ≈ incoming each game). We repeatedly stall at 16 hits and lose the race to 17. Ships lost still ~4/game.
- Next: heatmaps to find an exploit.

## Run 3 — 2026-06-04 — Level 3 + bottom-biased placement
- Heatmaps (`tools/heatmap.py`): opponents sweep **top-down parity**; rows 0–6 saturated, rows 8–9 nearly untouched; almost all open at (0,0). → place our fleet in the bottom rows so they're hit last.
- `SHOT_LEVEL=3 PLACEMENT=bottom`.
- Result: **finalScore=284 wins=9 losses=6** hitDiff=+21 shipsLost=58. (+104 from placement alone.)

## Run 4 — 2026-06-04 — Level 4 (probability density) + bottom
- Implemented density: per unsunk ship, tally legal placements per untried cell; open hits get ×50 weight so one map does hunt+target. Offline: ~50 turns vs L3 ~52.6 against random fleets; all legal.
- `SHOT_LEVEL=4 PLACEMENT=bottom`.
- Result: **finalScore=369 wins=10 losses=5** hitDiff=+43 shipsLost=51. Several WARSHIPs won in ~33 shots; G1 lost 0 ships.
- Trajectory: 58 → 180 → 284 → 369.
- Next: cross-attempt data analysis (`tools/analyze.py`) — is enemy placement/shooting deterministic per opponent? If so, shoot their ships' known cells first (win ~20 shots) + place in their coldest cells (lose ~0).

## Runs 5–7 — 2026-06-04 — cross-attempt data gathering (L4+bottom)
- Ran 3 attempts to test determinism. a1=113; a2/a3 cut short by a **401 storm** (rate-limit cooldown after ~3000 rapid requests; recovers in ~100s; mitigation = space attempts ~2 min).
- `analyze.py`: enemy SHOOTING still bottom-cold (no adaptation). Enemy PLACEMENT determinism (3 samples): **FIXED = Hydra, Eridanus, Andromeda, Antares** (+Betelgeuse partial); rest random. Know 16/17 cells for each fixed one.

## Run 8 — 2026-06-04 — SKEW=3 (stronger bottom)
- finalScore **235**, ships-lost 59 — WORSE. Concentrating clusters ships → chain-sinks. Reverted skew→2.

## Run 9 — 2026-06-04 — Fingerprint exploit (L4+bottom, known-cell shooting)
- `src/fingerprints.ts`: fire known cells of fixed opponents first; self-disable after 2 known-cell misses.
- Result: finalScore **202** (variance in random games), but the exploit landed: **G1 Hydra 18 shots/0 lost, G4 Eridanus 16 shots, G8 Andromeda 16 shots**. G11 Antares fell back to density (guard tripped). Fixed games now near-perfect & low-variance.
- Insight: ~10 random opponents dominate score variance. Graded = best attempt → run several spaced attempts, bank best.

## Runs 10–14 — 2026-06-04 — fingerprint cleanup, no-touch, banking
- Full archive (93 games, 7 samples/opp): only **3 opponents truly fixed** (Hydra, Eridanus, Andromeda, Jaccard 1.0); Antares/Betelgeuse were small-sample false positives. Tightened `fingerprints.ts` to the 3.
- **No-touch placement** (spread fleet, no 8-neighbour touching) added — random SCOUTs dropped to ~2 ships lost.
- Spaced batches (120s cooldown between attempts → zero 401s). Scores: 317, 208, 143, 268, 357, **468**, 312.
- **Run 13 = NEW BEST 468 / 12 wins / 3 losses**, hitDiff +72, ships-lost 46. Fingerprint games near-perfect (G1 Hydra 18 shots/0 lost; G4 Eridanus, G8 Andromeda 16 shots).

## Web research + density v2 — 2026-06-04
- Confirmed best-practice (Towards Data Science 100M sim): probability density median ~42 shots; placement = spread + avoid edges/center + dodge sweep (we already do all). Our density measured ~51 turns → gap.
- **Density v2**: focus-fire targeting (count only placements covering an open hit, weight 8^hits) + 20% checkerboard boost in hunt. Offline median 48 (was ~51). Cleaner than the old flat ×50 smear.
- Honest ceiling: 11/15 opponents randomize placement → fair 1:1 race guarantees some ship losses; a perfect 1000 is not reachable against this roster. Best realistic ≈ 450–500.

## Runs 15–18 — 2026-06-04 — NO-TOUCH HALO density (v3) — the breakthrough
- Data: opponents place every ship non-adjacent (0 of 992 ship components touch across 208 games). → a ship cell's diagonals + a sunk ship's 8-halo are guaranteed water. Fed into the density solver (`ENEMY_NOTOUCH=on`). Offline median shots 48 → **40** (beats the ~42 textbook optimum).
- Live v3 batch: **537, 601, 540, 552** — all 12–15 wins.
- **Run 16 = 601 / 15 wins / 0 losses**, all 75 opponent ships sunk, hitDiff +92, ships-lost 42. NEW BEST.
- Trajectory: 369 → 468 → 537 → **601**. Remaining gap to 1000 = ships lost only (the fair-race floor).

## Runs 19–22 — 2026-06-04 — adaptivity check + cold-zone placement
- **Opponents are adaptive**: next incoming shot is ortho-adjacent 60.4% after a HIT vs 27.9% after a MISS → hunt+target. So 0-loss requires winning before first contact ⇒ only the 3 fast fingerprint wins manage it. 1000 = not strictly impossible but astronomically unlikely (adaptive + 11 randomizers).
- With NO_TOUCH now preventing chain-sinks, re-tested **SKEW=3** (concentrate in coldest rows 8–9): 625, 536, 585, **646**. Best **646 / 14 wins / ships-lost 35** (was 42). Adopted SKEW=3 as default.
- Best at this stage: 646. Trajectory 58 → … → 625 → **646**.

## Code review + Runs 23+ — 2026-06-04 — per-opponent smart placement
- **Review caught a real defect**: default `SHOT_LEVEL` was 3, so `npm run play` wasn't using density/halo. Fixed default → 4. Verified over-engineering minimal (L2/L3 dormant-but-documented fallback).
- **Per-opponent analysis** (93+ games): all opponents open top-down; random 11 place truly uniformly (edge 35.6% ≈ uniform 36%, no regional bias) → unexploitable for shooting. But shot *timing* differs sharply — e.g. Polaris fires ~0 shots in rows 7–9 within 40 turns; Vega spreads evenly.
- **Smart placement** (`src/danger_maps.ts` + `smartLayout`): place each ship on the current opponent's lowest-danger cells (no-touch, light randomness). Offline expected-danger ~halved vs bottom (Polaris 4.9→2.6, Vega 6.6→3.3).
- **Run = 701 / 14 wins / 1 loss / ships-lost 30** (was 42). NEW BEST. Most games now lose 0–1 ships.
- **Full trajectory: 58 → 180 → 284 → 369 → 468 → 537 → 601 → 646 → 701.** Remaining gap to 1000 = the fair-race floor (adaptive opponents + 11 randomizers).








## Runs 24+ — 2026-06-04 — win-length-matched danger maps (DANGER_V2)
- Banked baseline variance roll: **712 / 14W / ships-lost 30** (new best over 701).
- **Win-length-matched danger maps** (`tools/extract_danger.py` → `src/danger_maps_v2.ts`): K = per-opponent median win length (not fixed 40), rebuilt from the 434-game archive. Offline honest-exposure metric: total expected contacted ship-cells **52.3 → 50.7**, gains on the long-game bleeders (Polaris 7.05→5.57, Antares 4.99→4.39, Pleiades 4.96→4.66, Sirius 6.03→5.75).
- **v2 live: 720 / 14W / 1L / ships-lost 27. NEW BEST.** Promoted `DANGER_V2=on` to default. Trajectory …701 → 712 → **720**.
- **Info-gain hunt tie-break (negative):** built faithful offline shot harness `tools/shotsim.ts` (reproduces median ~40, p90 ~50). Dispersion tie-break among equal-density cells: mean 40.4→40.5, >50-shot 10.1→9.8% — within noise. Density is already near-optimal; the tail is variance, not a fixable choice. Flag `INFO_GAIN` left OFF.
- **Design note (re: "make the loop more agentic"):** shooting is already fully online (density recomputed every turn); placement memory is correctly *precomputed* because each attempt is 15 distinct opponents (one game each) → no within-attempt repeat to learn from; the only useful memory is cross-attempt, which the danger maps already are. Confirmed: the in-loop tail lever yields nothing.

## Adaptivity probe (touching-placement question) — 2026-06-04
- `tools/adaptivity.py`: per-opponent index = P(next shot ortho-adj | prev HIT) − P(... | prev MISS).
- **All 13 randomizers are adaptive targeters** (index +0.23 to +0.61; fire adjacent-to-hit 52–81% vs 15–30% after a miss) → every one chain-sinks touching ships. **No blind shooter to exploit; NO_TOUCH spread is correct across the whole roster.**
- Hydra (index −0.03) = false positive: adj 0.91 after hit AND 0.93 after miss → fixed-pattern sweeper (marches in order), not blind. Fingerprint-won in 16 anyway.
- Confirms earlier history: clustering without no-touch (SKEW=3 alone) lost to chain-sinks; only safe once NO_TOUCH enforced.

## Banking streak + deep-dive — 2026-06-04 (best 787)
- Penalty placement + v2 maps produce **4 consecutive 15-0 sweeps**: 787, 770, 711, 715 (60 games, 0 losses). Variance now only in ships-lost (23–32), never wins — clear distributional shift from the old 14W/1L ~700.
- **Deep-dive (`tools/deepdive.py`, 565 games):** (C) ship loss by class — CARRIER 59% > BATTLESHIP 57% > SUB 52% > CRUISER 47% > DESTROYER 38% (bigger=deader). (D) game-length drives loss, monotonic (+0.7 ships per +10 shots). (B) placement floors: Polaris ~5.0 / Sirius ~5.7 / Cygnus ~3.8 expected cell-contacts even with ideal placement — unavoidable loss there. (A) opening determinism already captured by danger maps.
- **More placement ideas — all NEGATIVE (overfit the noisy guide map):** carrier-tightest ramp (k=1) +9; Monte-Carlo joint placement (M=500) +26; hunt-only decontaminated map +2.4. Greedy+moderate-randomisation is a regularizer → robust. Documented in [STRATEGY_FINAL.md](STRATEGY_FINAL.md).
- **Conclusion: 787 is at the realistic frontier (~780–800).** Remaining gains are right-tail banking, not strategy. Snapshot: `versions/v2_final_787/`.

## Postmortem — the Andromeda fingerprint regression (2026-06-04)
**What happened.** After testing a Centauri Battlecruiser fingerprint (a 2-sample false positive — it actually randomizes, confirmed later at 19 samples, Jaccard 0.00–0.22), I reverted it. The revert edit's match region started one line too high and **also deleted the valid Andromeda Cruiser fingerprint.** Andromeda then played *blind* for the next ~16 banking attempts.

**Impact (measured).** Andromeda's per-game line across the session:

| phase | Andromeda | score avg | hitDiff range |
|---|---|---|---|
| pre-bug (fingerprinted) — 787, 713, 712 | 16 shots / 0 lost | ~737 | 146–164 |
| **post-bug (blind)** — 16 banks (620–770) | **24 shots, lost a ship in 11/16 runs** | **694** | 119–155 |
| post-fix (restored) — 763, 769 | 17 shots / 0 lost | **766** | **163–170** |

The blind Andromeda game cost ~0.7 ships/attempt (`2 + classLoss` each) plus a depressed hit differential (8 extra opponent turns/game). The tell: post-fix runs posted the session's **two highest hit-differentials (163, 170)** — higher than 787's own 164 — and `sb_final2` scored **769 while going 14W/1L** (it lost the Polaris game entirely), i.e. a fixed-Andromeda 14/1 ≈ a blind-Andromeda 15/0. The fingerprint was worth roughly a full win.

**Counterfactual — if the fix had been in from the start of banking.** The 16 post-bug rolls would have centered ~15–30 pts higher; the 15-0 rolls (770, 711, 715, 723) would have been ~785–800, and the best-of-16 at the corrected distribution would very likely have **beaten 787 (~795–810)**.

**Conclusion.** 787 predated the bug and was never at risk, but the regression kneecapped 16 rolls during exactly the window we were hunting for a new best, and the fix only landed in the final two minutes. 

**Fix + safeguard.** All fingerprints re-validated against the full 52–56-sample archive (Hydra/Eridanus 100% stable; Andromeda restored *and improved* — dropped the only unreliable cell (7,0), 70%, where its destroyer flips to (5,0)). Lesson: an edit that removes one entry should be verified against the whole structure, and fingerprints should be re-validated on every change. This is the same failure mode the project guards against everywhere else (don't trust a small sample; verify) — caught by a second look.
