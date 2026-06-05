# StarSling Battleships Agent — 3-hour build

## Server
Base URL: https://intern-battleship-game-server.vercel.app
Standard competition v1 (10x10 board, 5 ships totaling 17 cells, adjacency allowed, 10s turn timeout)

## Stack
TypeScript + Node 22+. Single file ideally (`agent.ts`). Use:
- `@auth/agent` for device flow + JWT signing
- Native `fetch` for HTTP
- `zod` for response parsing if you want types, else `any`

## Architecture
Single loop driven by `responseType`:
- MOVE_REQUIRED → submit place_ships or shot
- GAME_COMPLETED → unwrap `next`, continue
- ATTEMPT_COMPLETED → log finalScore, exit
- ATTEMPT_DISQUALIFIED → log reason, exit

## Auth flow (CRITICAL)
1. discoverProvider(SERVER)
2. connectAgent with capabilities: createAttempt, getCurrentAttempt, placeShips, submitShot, abandonAttempt
3. onApprovalRequired: print verification_uri_complete, wait for human (Enter key)
4. Save agentId
5. Every request: await agent.signJwt({agentId, capabilities: [...]}) for a fresh single-use JWT

## Strategy

### Placement: random-but-legal
For each ship (CARRIER 5, BATTLESHIP 4, CRUISER 3, SUBMARINE 3, DESTROYER 2):
- Pick random orientation + position
- Compute cells, reject if overlap with `used`, retry
- adjacency is allowed; only enforce: on-board + no overlap

### Shooting: hunt + target with direction lock
- TARGET mode: any unsunk-ship hit has unexplored neighbors → fire there
- After 2 adjacent hits of same ship: lock direction, fire along the axis
- On miss while direction-locked: reverse from first hit
- HUNT mode (no open hits): parity-pruned random — fire only cells where (row+col)%2 == 0

### Hard rules
- Never repeat a shot. De-dupe against `state.yourShots` every turn.
- Never go off-board. Assert.
- Validate placements LOCALLY before sending.

## Deliverables
- agent.ts (the agent)
- games.jsonl (one JSON line per game: gameOrdinal, opponent, wins, score, hits, ships_lost, duration)
- README.md (1 page, sections: what/how-to-run/architecture/strategy/closed-loop-framing/tradeoffs/what-I-cut/what-next/StarSling-mapping)
- runlog.txt (stdout from a real run)

## DO NOT
- Use classes. Plain functions.
- Add tests. We have 3 hours.
- Add docstrings.
- Implement Level 4 probability density on the first pass. Only after Level 3 works.
- Cache JWTs. Every request gets a fresh one.

## Start order
1. auth.ts: device flow + signJwt helper
2. client.ts: HTTP calls with the auth header
3. agent.ts: the main loop on responseType
4. Run with hardcoded dumb placement + sequential shots, see DQ or low score
5. Replace with random placement
6. Replace with hunt + target
7. Upgrade to direction lock
8. Add logging
9. Write README
10. Submit