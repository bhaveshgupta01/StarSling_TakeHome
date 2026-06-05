# STRATEGY — FINAL (v2, best 787/1000) + data-science deep dive

Snapshot of the current best, the data behind it, and an honest map of what's
left. Stable config archived in `versions/v2_final_787/`. Prototyping continues
on the side; this is the documented "final" baseline for now.

## Headline
- **Best 787/1000 — 15W / 0L / 23 ship-cells lost.** Three consecutive clean
  15-0 sweeps this session (787 / 770 / 711); the config has **not lost a single
  game in 45 live games**. Variance is now *only* in ships-lost (23–30), never in
  wins — a decisive shift from the prior 14W/1L ~700 regime.
- Trajectory: 58 → 180 → 284 → 369 → 468 → 537 → 601 → 646 → 701 → 720 → **787**.

## The config (all default-on; `npm run play`)
1. **Shooting — L4 probability density** with focus-fire (8^hits), 20% hunt
   checkerboard boost, and the **no-touch halo prune** (opponents place
   non-adjacent → diagonals of any hit + 8-halo of any sunk ship are water).
   Offline median ~40 shots — beats the ~42 textbook optimum.
2. **Placement — per-opponent danger maps, win-length-matched** (`DANGER_V2`):
   `danger[r][c]` = P(opponent fires there within K shots), K = that opponent's
   median win length (not a fixed 40), so long-game opponents get real signal in
   the bottom rows where we place. Regenerate: `tools/extract_danger.py`.
3. **Placement — penalty-weighted** (`PENALTY_PLACE`): place highest-loss ships
   first on the coldest cells, with a randomisation pool that tightens with loss
   penalty (ramp 4,5,6,7,8). Loss cost per ship = 2 + classLoss (CARRIER 14 …
   DESTROYER 8).
4. **Fingerprint** (3 fixed opponents: Hydra/Eridanus/Andromeda) → 16-shot wins,
   0 loss.

## Data-science deep dive (565 games — `tools/deepdive.py`)

### The driver: game length → ships lost (clean, monotonic)
| our shots | mean ships lost |
|---|---|
| 10–19 | 0.52 |
| 20–29 | 1.52 |
| 30–39 | 2.55 |
| 40–49 | 3.16 |
| 50–59 | 3.83 |
| 60–69 | 4.00 |

~+0.7 ships per +10 shots. The 16-shot fingerprint games lose ~0.5; the 50+ shot
random games lose ~4. **Winning faster is the dominant lever — but our shooting
is already near-optimal** (info-gain tie-break tested → no gain; density is at
the floor). So the remaining handle is placement.

### Ship loss by class — bigger = deader
| class | loss rate |
|---|---|
| CARRIER (5) | 58.9% |
| BATTLESHIP (4) | 56.8% |
| SUBMARINE (3) | 52.2% |
| CRUISER (3) | 46.5% |
| DESTROYER (2) | 38.1% |

More cells = bigger target, and one contact + opponent target-mode = a sunk ship.
This validated penalty-weighted placement. But the carrier still dies 59% of the
time — and tightening the carrier further **backfires** (k=1 over-bets the guide
map's argmin; guide≠honest). The carrier dies because it is *big*, not because
its placement is suboptimal. **Placement is at its useful limit.**

### Cold-region capacity — some opponents are unbeatable on placement
Ideal placement floor (expected ship-cells contacted, honest map):
- **Polaris 4.95, Sirius 5.67, Cygnus 3.80** — their fire covers the board; *no*
  placement saves us. These are the ship-bleed games.
- Everyone else ≈ 2.0–2.8. We are close to these floors already.

### Opening determinism — already exploited
Hydra (prefix 16), Lyra (10), Eridanus (9) fire deep deterministic openings; most
others fire a fixed first ~5 shots. But those opening cells *are* the
high-frequency cells the danger maps already dodge. Confirmed, not new headroom.

### Adaptivity — no touching exploit exists
Every randomizer fires orthogonally-adjacent to a hit 52–81% of the time (index
+0.23..+0.61 vs ~0.2 after a miss) → all chain-sink. `NO_TOUCH` spread is correct
roster-wide. No blind shooter to exploit by clustering. (`tools/adaptivity.py`.)

## Experiments tried this session
| idea | result | shipped? |
|---|---|---|
| Win-length-matched danger maps (`DANGER_V2`) | offline −1.6 contacts; live 712→720 | ✅ default |
| Penalty-weighted placement (`PENALTY_PLACE`, ramp 4,5,6,7,8) | offline −2.6%; live → 787/770/711 sweeps | ✅ default |
| G15/Centauri logger fix | captures the 15th game (was never logged) | ✅ |
| Centauri fingerprint | false positive (2-sample fluke; 3rd sample random) | ❌ reverted |
| Carrier-tightest ramps (k=1–2) | backfires (guide/honest mismatch) | ❌ |
| Hunt-only decontaminated map | worse +2.4 (target shots do predict exposure) | ❌ |
| Info-gain hunt tie-break (`INFO_GAIN`) | no gain (shooting already optimal) | ❌ off |
| Monte-Carlo joint placement (M=500) | worse +26.4 — overfits the noisy guide map | ❌ |

**The unifying lesson (carrier-k=1, hunt-only, Monte-Carlo all failed the same
way):** the danger map is a *noisy finite-sample estimate* of where the opponent
fires. Aggressively optimizing placement against it (argmin / joint search /
decontamination) overfits the noise and loses under the true (honest) exposure.
The greedy pick with a moderate randomisation pool is a **regularizer** — it
deliberately under-trusts the guide and is more robust. The current design is
near-optimal *because* it doesn't over-optimize.

## Honest ceiling
1000 needs 0 ships lost across all 15. Against adaptive opponents that randomize
placement uniformly and fire ~40 shots in a 1:1 race, contacts during the long
games are mathematically unavoidable — confirmed by the per-opponent placement
floors (Polaris ~5, Sirius ~5.7 expected cell-contacts even with ideal
placement). The realistic frontier is **~780–800**, and 787 sits at the top of
it. The three 15-0 sweeps show the config operates *at* that frontier reliably;
further gains are right-tail banking (lucky low-loss rolls), not strategy.

## Literature check (web research, 2026-06)
Confirms the design is at the known frontier; no missed technique.
- **Shooting is solved and we're at/below the floor.** Probability density wins in
  ~42–46 shots empirically (Rochford's Bayesian/Thompson study 45.9 avg, ~40–42
  optimistic floor; DataGenetics' 100M-sim ~42 median). Random ~95, parity-hunt
  ~65–72. The *sink* phase for a **line-segment ship is provably ≤1 wasted miss**
  (Crombez–da Fonseca–Gerard, *Efficient Algorithms for Battleship*, arXiv
  2004.07354) — all our ships are lines, so zero headroom there. The *search*
  phase is the open "hitting set" problem; density is the accepted near-optimum.
  Our ~40 (no-touch-halo prune exploits a data fact generic solvers don't assume)
  is slightly below textbook → **shooting cannot be improved** (matches our
  info-gain negative; Rochford notes max-info targeting isn't clearly better than
  max-probability in practice).
- **Placement vs a *known* shooting distribution is NOT a standard research
  topic.** Classic theory only says: vs an opponent with no model of you,
  uniform-random placement is optimal (why the 12 randomizers are unexploitable
  for shooting). Our per-opponent danger-map + penalty-greedy is a
  facility-location / minimize-expected-coverage approach the mainstream
  literature doesn't cover — it's where our real gains came from (646→787).
  Human-placement folklore (edges are "safe") doesn't apply: our opponents are
  algorithmic checkerboard sweepers, not humans.
- **Implication:** remaining gains are *data quality* (more games → less-noisy
  maps → greedy can trust them more), not algorithm.

## The data lever is also exhausted (cross-validation)
Built each opponent's matched-K map from N training games, scored greedy
placement on 6 held-out test games (honest map), averaged over splits:

| train games/opp | held-out weighted loss |
|---|---|
| 8 | 134.3 |
| 15 | 129.1 |
| 25 | **127.7** (min) |
| 35 | 129.4 |

**Maps saturate at ~25 games/opponent; we already have 28–45 each.** More data
does NOT lower real loss past saturation (and ticks up at 35 — closed-loop drift,
since later games were smart-placed and shifted the opponents' target-mode
incoming). So **re-extracting from the larger archive will not help** — the maps
are already as good as this data makes them. Monte-Carlo placement was also tested
and is worse (overfits the noisy guide; see the table above).

## Final verdict — every lever is closed
- Shooting: at the research frontier (line-ship sink provably ≤1 miss; density ≈
  optimal; our no-touch-halo runs *below* textbook). No headroom.
- Placement method: at the robustness limit (every more-aggressive optimizer
  overfits the noisy guide map and loses).
- Placement data: saturated (~25 games/opp; we have more). Re-extraction won't help.
**787 is at the achievable ceiling for this approach; the rest is irreducible
fair-race variance.** The only remaining score motion is right-tail banking.
