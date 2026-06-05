# DESIGN NOTES — architecture + guardrails

Design decisions for the agent, written before the clock. Driven by guide §13 (what Claude Code gets wrong) and §15 (anti-patterns). Read this before touching code in a new session.

## Module layout (plain functions, no classes)
```
src/
  storage.ts      file-backed KVStore  (persists agent keypair + agentId across runs)
  auth.ts         getClient(), getAgentId(), signed fetch helper (fresh JWT per call)
  auth-setup.ts   one-time: connectAgent → print verification URL → wait approval → save
  client.ts       getRules / createAttempt / placeShips / submitShot / getCurrentAttempt
  strategy.ts     chooseLayout(state) + chooseShot(state)  ← the part we iterate on
  logger.ts       games.jsonl + runlog + end-of-attempt summary
  agent.ts        main loop: switch on responseType
```
Not a single file, but every file is plain functions. Splitting auth/client/strategy keeps the part we iterate (strategy) isolated from plumbing we get right once.

## §13 — things to actively NOT do (Claude Code failure modes)
1. **No over-engineering** — no classes, minimal types, small files. zod only where it earns its keep.
2. **Strategy level order** — ship Level 2 (hunt+target) end-to-end FIRST. Verify. Then Level 3 (direction lock). Then Level 4 (probability density) only if time + everything green.
3. **Validate locally before sending** — every placement and every shot. Assert + crash early. An illegal move is a terminal DQ, not a retry.
4. **Fresh JWT every request** — never cache. `signJwt` per call inside the client helper.
5. **Single loop on `responseType`** — GAME_COMPLETED ⇒ unwrap `next` and continue the same loop. No nested per-game loops.
6. **Structured logs** — one JSON line per game to `games.jsonl`.

## §15 — anti-patterns to avoid
Reusing JWTs · no local validation · treating ATTEMPT_DISQUALIFIED as an HTTP error (it's 200) · looping per-game instead of on responseType · building Level 4 first · sparse/missing README · console-only logging (need artifacts) · hand-maintaining a game-state struct (trust server `state`) · writing tests in the window · forgetting the closed-loop framing in the README.

## Strategy ladder (what we iterate)
- **Level 2 — Hunt + Target.** HUNT: parity mask `(r+c)%2==0` (every ship ≥2 cells ⇒ one cell per parity ⇒ half-board search). TARGET: on an open (unsunk) HIT, fire its untried orthogonal neighbors.
- **Level 3 — Direction lock.** Two adjacent same-ship hits ⇒ lock axis, fire along it; on miss/edge, reverse from the first hit. Drop hits belonging to a sunk class from the open set.
- **Level 4 — Probability density.** For each unsunk ship class enumerate every legal (orientation,pos) consistent with misses+hits+sinks; tally per-cell coverage; fire the argmax. Handles hunt and target uniformly.

## Open-hit identification (the subtle bit)
`yourShots` gives outcome per cell but not which ship a HIT belongs to. A SINK tells us a class went down but not its cells. Track: maintain the set of HIT cells; when a SINK arrives, flood-fill the connected HIT component containing the sinking cell and mark those as resolved (sunk). Remaining HIT cells = open ⇒ drive targeting. This is the closed-loop state update.

## Validation (pre-flight, guide §10)
- Placements: exactly one ship per class; on-board (`startCol+len≤10` H / `startRow+len≤10` V); no overlap. Adjacency allowed.
- Shots: `0≤row<10 && 0≤col<10` and not in `yourShots`.

## Closed-loop framing (for README, guide §9)
OBSERVE `yourShots`/`sunkOpponentShipClasses` → REASON hunt vs target / density argmax → ACT POST /shots → MEASURE MISS|HIT|SINK → UPDATE internal belief. Same shape as StarSling Runners' CI agent: observe telemetry → hypothesize optimization → act via PR → measure timing → update memory.
