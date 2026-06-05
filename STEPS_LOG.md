# STEPS LOG — StarSling Battleships Agent

Running journal of every change. Newest phase appended at bottom. Pairs with [RUN_OUTPUTS.md](RUN_OUTPUTS.md) (run results) so future sessions can pick up cleanly.

Legend: ✅ done · 🔜 next · ⏸ deferred

---

## Phase 0 — Environment setup (pre-clock)

**Goal:** TypeScript project + deps + docs ready BEFORE the 3-hour clock starts. No auth, no server calls yet.

| # | Step | Status |
|---|------|--------|
| 0.1 | Read brief, challenge guide, fetched official docs + OpenAPI shapes | ✅ |
| 0.2 | Verified Node v25.2.1 / npm 11.6.2 (need ≥22) | ✅ |
| 0.3 | `package.json` — ESM, `type:module`, scripts `auth` + `play`, deps `@auth/agent@0.5.1`, `zod@4`, `@types/node` | ✅ |
| 0.4 | `tsconfig.json` — NodeNext, strict, `allowImportingTsExtensions`, noEmit (run via `node --experimental-strip-types`) | ✅ |
| 0.5 | `.gitignore` — node_modules, `.agent-credentials.json`, logs | ✅ |
| 0.6 | `npm install` — 5 packages, 0 vulns | ✅ |
| 0.7 | Inspected `@auth/agent` types: `AgentAuthClient.{discoverProvider,connectAgent,signJwt}`, `KVStorage`/`MemoryStorage`, `ApprovalInfo.verification_uri_complete` | ✅ |
| 0.8 | Decision: **file-backed `KVStorage`** (not `MemoryStorage`) so one-time approval + agent keypair persist across runs | ✅ |
| 0.9 | Created docs: this file, RUN_OUTPUTS.md, DESIGN_NOTES.md | ✅ |

### Key facts locked in (from docs)
- **Base URL:** `https://intern-battleship-game-server.vercel.app`
- **competitionId (Standard v1):** `295cccc9137b5335cc581d67d655d6fa3b41dac6610dad0e7ed201625523ad8c`
- **Capabilities:** getCompetitionRules (auto), createAttempt, getCurrentAttempt, placeShips, submitShot, abandonAttempt
- **Endpoints:** `GET /competitions/{id}/rules` · `POST .../attempts` · `POST .../attempts/current/placements` · `POST .../attempts/current/shots` · `GET .../attempts/current` · `POST .../attempts/current/abandon`
- **Envelope `responseType`:** MOVE_REQUIRED · GAME_COMPLETED (unwrap `next`) · ATTEMPT_COMPLETED (`result.finalScore`) · ATTEMPT_DISQUALIFIED (`reason`)
- **Hard rules:** fresh single-use JWT per request; validate placements/shots locally; never repeat a shot; never off-board.

---

## Phase 1 — Full scaffold (pre-clock, code written defensively)

User authorized writing the full agent now since shapes are well-documented — coded defensively, raw envelopes logged, every server-side assumption flagged so a live mismatch is caught, not hallucinated.

| # | Step | Status |
|---|------|--------|
| 1.1 | `src/storage.ts` — file-backed KVStore (object literal, no class) persists keypair+agentId | ✅ |
| 1.2 | `src/auth.ts` — shared `AgentAuthClient`, `signedFetch()` mints fresh JWT/call; `AUTH_AUD_MODE` switch (url\|issuer); logs status+x-request-id on non-2xx | ✅ |
| 1.3 | `src/auth-setup.ts` — one-time connectAgent, `LOGIN_HINT=bg2896@nyu.edu`, prints approval URL, saves agentId | ✅ |
| 1.4 | `src/client.ts` — REST wrappers (rules/create/place/shot/current/abandon) | ✅ |
| 1.5 | `src/strategy.ts` — validate+placement+shooting; `SHOT_LEVEL` env; L2 hunt(parity)+target, L3 direction-lock + sink-retire, L4 stub→falls back | ✅ |
| 1.6 | `src/logger.ts` — games.jsonl + per-game summarize + attempt summary | ✅ |
| 1.7 | `src/agent.ts` — single loop on responseType, per-move + outcome logging | ✅ |
| 1.8 | Installed `typescript@5.9`; `tsc --noEmit` clean | ✅ |
| 1.9 | Offline simulator: 1000/1000 legal layouts; 500 games all sink 17 cells, no dup/off-board; **avg 52.8 turns** (random≈95, perfect=17) | ✅ |
| 1.10 | README.md drafted (run/arch/closed-loop/strategy/observability/tradeoffs) | ✅ |

### Live-unknowns to confirm on first auth/run (flagged, not assumed)
- **JWT binding for REST routes** — default `AUTH_AUD_MODE=url` (aud+htu=URL, htm=method). Fallback `issuer`. Watch first request for 401.
- **Envelope nesting** — parsed loosely; raw bodies logged. Confirm `state`/`next`/`result`/`reason` field names match docs on first real envelope.
- **Per-game result on GAME_COMPLETED** — summarizer reads `resp.state ?? lastState`; adjust once we see the real shape.

### Codex review attempt (1.11)
- `/codex-review` invoked. **Codex unavailable on this ChatGPT plan** — every model (gpt-5.4/5.2/5.1, all codex variants, o4-mini) returns `400 not supported when using Codex with a ChatGPT account`, via both the MCP tool and the `codex exec` CLI. The plan has no Codex model access; re-auth (device flow) didn't change it. Only an OpenAI API key (`codex login --with-api-key`) would unlock it. **Decision: dropped codex-review for this assignment; rely on self-review + offline sim.**
- Self-review done instead. Findings:
  - ✅ Fixed: `huntShot` could deref an empty pool → now throws a clear error (1.11).
  - ⚠️ Watch at runtime (deferred — depends on live shapes): re-running after a crash hits `409 ACTIVE_ATTEMPT_EXISTS` on `createAttempt`; resume via `GET /attempts/current` once we confirm its envelope shape. Current behavior: prints the raw body + breaks (no DQ, just stops).
  - ✅ Verified no duplicate/off-board path: `assertShot` gates every shot; `validatePlacements` gates every layout; offline sim confirmed across 500 games.

## Phase 2 — Live auth + iterate levels (CLOCK STARTED)

| # | Step | Status |
|---|------|--------|
| 2.1 | First `npm run auth` → **discovery_failed**. Cause: passed `/api/auth` issuer to `discoverProvider`, which appends `/.well-known/agent-configuration` → wrong path. Fix: discover from `SERVER` root (doc lives there; `provider.issuer` still resolves to `/api/auth`). | ✅ fixed |
| 2.2 | Re-run auth → discovery OK, approval URL printed, approved → agentId `BxELedNF6PUcrXUyTbWVIDPnvqJUtIVr` active, all 6 caps granted, creds persisted | ✅ |
| 2.3 | **Official site prompt** surfaced 3 must-fixes (applied before any live call): (a) `signJwt` must carry FULL cap list else 403; (b) empty POSTs (createAttempt/abandon) send NO body/Content-Type else 422; (c) sign PLAIN (no audience/DPoP). `AUTH_AUD_MODE` default → `plain` | ✅ |
| 2.4 | **Run 1: Level 2** → finalScore 58, 4W/11L. Pipeline solid (0 DQ, 0 HTTP err). Diagnosis: ~4.5 ships lost/game → penalties dominate. (see RUN_OUTPUTS) | ✅ |
| 2.5 | Logger fix: server marks every cell of a sunk ship `SINK` → count DISTINCT `sunkShipClass` (`shipsSunk`), add `incomingShots` count | ✅ |
| 2.6 | **Run 2: Level 3** aborted at G12 on a transient **HTTP 500** (Vercel hiccup). Fix: retry 5xx/network 3× w/ backoff, fresh JWT per try (4xx never retried) | ✅ |
| 2.7 | Re-run hit **ACTIVE_ATTEMPT_EXISTS** (stale attempt from the 500 crash). Fix: on 409, `abandonAttempt` then re-`createAttempt` (clean per-level runs) | ✅ |
| 2.8 | Added detail log `games_detail.jsonl` (raw placements/your-shots/incoming-shots) + `tools/heatmap.py` ASCII heatmaps incl. opening-sequence determinism probe | ✅ |
| 2.9 | **Run 2 L3=180, Run 3 L3+bottom=284, Run 4 L4+bottom=369** (trajectory 58→180→284→369). Best banked server-side (isNewBest). | ✅ |
| 2.10 | Heatmap exploit: opponents sweep top-down, rows 8–9 cold (row9=32 shots vs row5=128) even after many bottom attempts → they don't adapt. Bottom placement valid. | ✅ |
| 2.11 | `tools/analyze.py`: enemy PLACEMENT reconstructed from our hits. **Determinism mixed** — fixed-placement (Jaccard~1.0): Hydra, Eridanus, Vega, Andromeda; randomized: Lyra, Orion, Cygnus, Tau Ceti. | ✅ |
| 2.12 | **401 UNAUTHENTICATED storm** after 4 rapid attempts (~3000 req). Agent still `active`, local creds intact → server-side rate cooldown. Recovered in ~100s once traffic dropped. **Mitigation: space attempts ~2 min; one attempt's rate is safe.** | ✅ |
| 2.13 | SKEW=3 (stronger bottom) → **worse: 235**, ships-lost 59 (clustering chain-sinks). Reverted default skew to 2. | ✅ |
| 2.14 | 3-sample determinism: **FIXED-placement opponents = Hydra, Eridanus, Andromeda, Antares (+Betelgeuse partial)**; we reliably know 16/17 of their cells. (Vega was a 2-sample false positive, actually random.) | ✅ |
| 2.15 | Built `src/fingerprints.ts` (known cells) + `chooseShot` fires known cells first, self-disables after 2 known-cell misses (stale layout) → density fallback. Offline regression clean. | ✅ |
| 2.16 | Fingerprint attempt: G1 Hydra 18 shots/0 lost, G4/G8 won in 16 shots. Works. | ✅ |
| 2.17 | Full-archive determinism (7 samples): only **3 fixed** (Hydra/Eridanus/Andromeda). Tightened `fingerprints.ts`. | ✅ |
| 2.18 | **No-touch** placement (spread to avoid chain-sinks) added; offline 0 touching layouts. | ✅ |
| 2.19 | Spaced batches (120s cooldown → 0 × 401). **NEW BEST 468 / 12W / ships-lost 46.** | ✅ |
| 2.20 | Web research: confirmed density (~42 median) + spread/dodge placement are best-practice. **Density v2**: focus-fire (8^hits) + 20% checkerboard hunt boost. Offline median 51→48. | ✅ |
| 2.21 | Banking best: density v2 batch consistent (~384 mean, floor 358); single new best **468 / 12W**. | ✅ |
| 2.22 | **Key data find: opponents place NO-TOUCH** (0 of 992 ship components touch / 208 games), despite allowAdjacency. → diagonals of any hit + 8-halo of any sunk ship are water. | ✅ |
| 2.23 | **Density v3 (no-touch halo)** `ENEMY_NOTOUCH=on`: prune water cells from enumeration. Offline median 48→**40** (beats ~42 optimum). | ✅ |
| 2.24 | **v3 live: 537, 601, 540, 552 — all 12–15 wins. NEW BEST 601 / 15 wins / 0 losses / ships-lost 42.** Trajectory 369→468→537→**601**. | ✅ |
| 2.25 | Web research validated approach (density > RL; place-where-they-neglect + shoot-where-they-place = opponent modeling we already do). | ✅ |
| 2.26 | SKEW=3+no-touch (safe now that no-touch blocks chain-sinks): **646 / 14W / ships-lost 35**. Adopted SKEW=3 default. | ✅ |
| 2.27 | **Code review** (user-requested): caught default `SHOT_LEVEL=3` → `npm run play` wasn't using density/halo. Fixed default→4. Over-engineering minimal (L2/L3 dormant fallback). | ✅ |
| 2.28 | Per-opponent analysis: all open top-down; 11 randomizers place uniformly (edge 35.6%≈36%) — unexploitable for shooting. Shot TIMING differs (Polaris ~0 in rows 7-9/40 shots; Vega spread). | ✅ |
| 2.29 | **Smart placement** `src/danger_maps.ts` + `smartLayout`: place each ship on the opponent's lowest-danger cells (no-touch, light random). Offline danger ~halved. | ✅ |
| 2.30 | **Run = 701 / 14W / 1L / ships-lost 30** (was 42). NEW BEST. Trajectory …646 → **701**. | ✅ |
| 2.31 | Auth window: approved 19:29 → ends 22:29. Banking best over spaced attempts; agent + deliverables complete. | ✅ |
| 2.32 | Banking baseline: run = **712 / 14W / 1L / ships-lost 30**. NEW BEST (variance roll on the 701 config). | ✅ |
| 2.33 | **Win-length-matched danger maps** `tools/extract_danger.py` + `src/danger_maps_v2.ts` (K = per-opponent median win length, larger 434-game archive). Offline expected contacts 52.3→50.7, gains on long-game bleeders (Polaris 7.05→5.57, Antares 4.99→4.39). `DANGER_V2` env flag. | ✅ |
| 2.34 | **v2 live: 720 / 14W / 1L / ships-lost 27** (was 30). NEW BEST. Promoted `DANGER_V2=on` to default. Trajectory …701 → 712 → **720**. | ✅ |
| 2.35 | **Info-gain tie-break (`INFO_GAIN`)** — hunt-mode dispersion among equal-density cells, to shorten the long-hunt tail. Built faithful offline harness `tools/shotsim.ts` (reproduces median ~40). Result: mean 40.4→40.5, >50-shot 10.1%→9.8% — **within noise. NEGATIVE: density is already near-optimal; the tail is genuine variance, not a fixable tie-break.** Left flag-gated OFF. | ✅ |
| 2.36 | **Adaptivity probe (`tools/adaptivity.py`)**: answers "any blind shooters to exploit by touching ships?" — **NO.** All 13 randomizers fire adjacent-to-hit 52–81% (index +0.23..+0.61) → all chain-sink. NO_TOUCH spread is correct roster-wide. Hydra (−0.03) = fixed sweeper, not blind. | ✅ |
| 2.37 | **Logger fix (G15/Centauri)**: final game arrives as ATTEMPT_COMPLETED directly (no trailing GAME_COMPLETED) → never archived (14/15 logged). Now capture it from `lastState` before printSummary, dedup via `loggedOrdinals`. Centauri Battlecruiser finally gets data. | ✅ |
| 2.38 | **Penalty-weighted placement (`PENALTY_PLACE`, default on)**: weights = perShipLossPenalty 2 + classLoss (CARRIER 14…DESTROYER 8, from other session). High-penalty ships placed first + tighter randomisation pool (ramp 4,5,6,7,8 — swept; aggressive k=1 over-concentrated). Offline penalty-weighted loss −2.6% (Polaris −3.6, Pleiades −2.8, Orion −2.3), near-zero regressions. `tools/eval_penalty.py`. | ✅ |
| 2.39 | **Live (v2 maps + penalty placement + logger fix): 787 / 15W / 0L / ships-lost 23. NEW BEST.** First clean 15-0 sweep; lowest ship-loss yet. G15 Centauri captured for the first time. Trajectory …720 → **787**. | ✅ |
| 2.41 | **Fingerprint regression caught + fixed.** The Centauri revert (2.40) accidentally deleted the **Andromeda Cruiser** fingerprint too → Andromeda played blind (24 shots, occasional −1 ship) in every bank after 787, silently capping them. Re-validated all fingerprints vs full archive (52–56 samples): Hydra ✅ (all 16 cells 100%), Eridanus ✅ (all 16 100%), Andromeda **restored + improved** (15 cells 100%; dropped (7,0) — its destroyer flips (7,0)~70%/(5,0)~30%, density finishes it), Centauri ✅ confirmed random (19 samples, Jaccard 0.00–0.22). Post-fix banks 763/769 (top of band, Andromeda 17sh/0lost) vs degraded 640–727. Best 787 stands. | ✅ |
| 2.40 | **Centauri probe → FALSE POSITIVE, reverted.** Looked fixed at 2 samples (Jaccard 0.938) so added to fingerprints; 3rd sample was a totally different layout (Jaccard 0.000) → it RANDOMIZES (same small-sample trap as Antares/Betelgeuse). Removed from `src/fingerprints.ts`. 2-miss self-disable guard meant the bad fingerprint cost nothing live (G15 35sh/4lost, normal). **Roster: 3 fixed + 12 randomizers.** Logger fix kept (G15 now archived for future). Lesson: need ≥3 samples before declaring fixed. | ✅ |

