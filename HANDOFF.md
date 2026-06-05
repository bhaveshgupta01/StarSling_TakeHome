# HANDOFF — StarSling Battleships Agent (read this first in a new session)

## TL;DR
Working TypeScript agent that plays the 15-game Battleships attempt. **Best score 787/1000** (15W/0L, ships-lost 23). Already authed, already strong, all deliverables written. The remaining time is for squeezing ships-lost down further (see [STRATEGY_ANALYSIS.md](STRATEGY_ANALYSIS.md)).

## ⚠️ SUBMISSION (from challenge.starsling.dev/start)
Deliverable = **push the codebase to GitHub and share it with `@dbworku`** (Daniel Worku). Evaluated on *technical judgment, pragmatism, observability, and game score*. Code deadline is the challenge close (June 8); the 3-hour limit is only on *playing*. `.gitignore` already excludes `.agent-credentials.json` (agentId/JWT — never push), `node_modules`, logs. Repo not yet `git init`'d. Suggested: `git init && git add -A && git commit` → create private GitHub repo → add `dbworku` as collaborator. Conclusion of all analysis: 787 is at the realistic frontier (~780–800); see [STRATEGY_FINAL.md](STRATEGY_FINAL.md). 850 is above the fair-race ceiling.

**Update 2026-06-04 ~21:40:** best 701 → 712 → 720 → **787 (15W/0L)**. Levers this session:
- **Win-length-matched danger maps** (`DANGER_V2=on`, default; `src/danger_maps_v2.ts`, K=per-opponent median win length; regen `tools/extract_danger.py`). → 720.
- **Penalty-weighted placement** (`PENALTY_PLACE=on`, default): high-loss ships (CARRIER 14…DESTROYER 8) placed first with tighter randomisation pool (ramp 4,5,6,7,8; `tools/eval_penalty.py`). → contributed to 787.
- **Logger fix: G15/Centauri Battlecruiser now captured** (was folded into ATTEMPT_COMPLETED, never logged → only 14/15 archived). Tested for fixed layout: **false positive — it RANDOMIZES** (2 samples Jaccard 0.938, 3rd sample 0.000; same small-sample trap as Antares/Betelgeuse). Logger fix kept. **Roster = 3 fixed (Hydra/Eridanus/Andromeda) + 12 randomizers.** `tools/check_fixed.py`.
- Negatives (left OFF): info-gain hunt tie-break (`INFO_GAIN`, `tools/shotsim.ts`) — density already optimal. No blind-shooter opponents to exploit by touching (`tools/adaptivity.py`) — all 13 randomizers chain-sink.

## State of play
- **Auth: DONE.** agentId `BxELedNF6PUcrXUyTbWVIDPnvqJUtIVr`, persisted in `.agent-credentials.json` (file-backed KVStorage). No re-approval needed. **3-hour window: approved 19:29 → ends 22:29.**
- **Run the agent:** `npm run play` (defaults are already the best config). Pipe to a log: `npm run play | tee runlog.txt`.
- **Rate limit:** rapid back-to-back attempts trigger a 401 cooldown (~100s to clear). **Space attempts ~120s.** A single attempt is safe. One attempt ≈ 2–3 min (~600 requests, fresh JWT each).
- Node 22+ (have v25). `./node_modules/.bin/tsc --noEmit` to typecheck. Run files via `node --experimental-strip-types`.

## Architecture (single loop on `responseType`)
`src/`: `storage.ts` (disk creds) · `auth.ts` (fresh-JWT signed fetch + 5xx retry; auth is PLAIN signJwt with FULL caps list) · `auth-setup.ts` (one-time approval) · `client.ts` (REST) · `strategy.ts` (placement + shooting) · `fingerprints.ts` (3 fixed layouts) · `danger_maps.ts` (per-opponent shot-frequency maps) · `logger.ts` (artifacts) · `agent.ts` (loop). Plain functions, no classes.

## Current strategy (all default-on)
- **Shooting — L4 probability density** (`SHOT_LEVEL` default 4): enumerate legal placements per unsunk ship, tally per-cell coverage; **focus-fire** (count only placements covering an open hit, weight `8^hits`) in target mode; **20% checkerboard boost** in hunt; **no-touch halo** (`ENEMY_NOTOUCH`): opponents place non-adjacent (0/992 touch), so diagonals of any hit + the 8-halo of any sunk ship are water and get pruned. Offline median ~40 shots.
- **Placement — per-opponent smart** (`SMART_PLACE`): load the opponent's danger map (P it fired at each cell within 40 shots, from the archive) and greedily place each ship (largest first, no-touch) on its lowest-danger cells with top-8 randomness. Falls back to bottom-biased (`PLACEMENT=bottom`, `PLACEMENT_SKEW=3`) + `NO_TOUCH` for unseen opponents.
- **Fingerprint** (`FINGERPRINT`): 3 opponents reuse a fixed layout (Hydra Probe, Eridanus Drone, Andromeda Cruiser) → fire their known cells first → 16-shot wins, ~0 loss. Self-disables after 2 misses on known cells.

## Key data findings (settled)
- 3 fixed-layout opponents (fingerprinted); **11 randomize placement uniformly** (unexploitable for shooting — density is optimal).
- Opponents are **adaptive** (hunt+target: 60% ortho-adjacent after a hit vs 28% after miss) and **all open top-down**.
- Score gap to 1000 is ~entirely **ships lost (~2/game)** in the long random games; **25% of random games run >50 shots** and that's where losses happen. Worst (longest) opponents: Polaris 54, Pleiades/Antares 49, Orion 47.
- **1000 is not realistically reachable** (adaptive + uniform randomizers guarantee some loss in 40-shot games). Realistic frontier ~700–800.

## Trajectory (every jump was data-driven)
58 (L2) → 180 (L3) → 284 (+bottom placement) → 369 (+L4 density) → 468 (+density v2) → 537/601 (+no-touch-halo) → 646 (+SKEW3) → 701 (+per-opponent smart placement) → 720 (+win-length-matched maps) → **787 (+penalty-weighted placement; 15W/0L)**.

## Next experiments (NOT yet done — see STRATEGY_ANALYSIS.md for detail)
1. **Win-length-matched danger maps** (K = per-opponent median win length, not fixed 40).
2. **Penalty-weighted placement** — protect CARRIER/BATTLESHIP hardest (highest loss penalty) in the safest cells.
3. **Re-extract danger maps** from the larger archive after more runs (closed loop; watch for drift).
4. **Cut the shot-count tail** (info-gain tie-breaking in density) to shorten the 50–61 shot games.
- Stable baseline snapshot: `versions/v1_final_701/` (don't break it; prototype on the side).

## Tools / artifacts
- `python3 tools/analyze.py` — enemy placement/shooting heatmaps + per-opponent determinism.
- `python3 tools/heatmap.py` — incoming/our-shot heatmaps + opening-sequence determinism.
- `tools/authcheck.ts`, `tools/rulescheck.ts` — auth diagnostics (single signed call).
- `analysis/games_archive.jsonl` — cumulative raw game data (never reset; the memory).
- `games.jsonl` (per-game summary), `games_detail.jsonl` (raw coords, reset per run), `runlog.txt` (best run stdout).
- Regenerate `src/danger_maps.ts` / `src/fingerprints.ts` from the archive with the python one-liners recorded in STEPS_LOG / RUN_OUTPUTS.

## Gotchas (learned the hard way)
- Fresh single-use JWT **per request**, signed PLAIN with the FULL capability list (omitting any → 403).
- Empty POSTs (createAttempt/abandon) send **no body / no Content-Type** (else 422).
- `discoverProvider(SERVER)` from the **root** (it appends `/.well-known/agent-configuration`).
- Illegal move = terminal DQ (HTTP 200 `ATTEMPT_DISQUALIFIED`), not a 4xx — validate locally before sending.
- Logger off-by-one: per-game `hits=16` vs 17 because the final winning shot isn't in the captured `state` (cosmetic).
- Scores swing ~470–701/attempt (random opponents); server records the **best** attempt.

## Docs map
[README.md](README.md) (deliverable) · [STRATEGY_ANALYSIS.md](STRATEGY_ANALYSIS.md) (data-science next steps) · [RUN_OUTPUTS.md](RUN_OUTPUTS.md) (run journal) · [STEPS_LOG.md](STEPS_LOG.md) (change log) · [DESIGN_NOTES.md](DESIGN_NOTES.md) (design rationale).
