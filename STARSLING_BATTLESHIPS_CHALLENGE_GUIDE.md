# STARSLING TAKE-HOME: BATTLESHIPS AGENT — COMPLETE GUIDE

**Challenge URL**: https://challenge.starsling.dev/docs
**Server**: https://intern-battleship-game-server.vercel.app
**When**: Your 3-hour window (between 1 PM PT June 3 and 1 PM PT June 8)
**Tooling**: Claude Code
**Graded on**: Technical Judgment, Pragmatism, Observability
**Format**: Build an HTTP client that plays 15 Battleships games against fixed opponents

This guide covers everything you need to know specifically for THIS challenge. The earlier prep doc about closed-loop CI optimizers was based on a wrong assumption (that you picked your own domain). Throw that out. This is the real assignment.

The closed-loop concept still applies but it's INSIDE the game: each shot result updates your knowledge of where the opponent's ships are, which informs your next shot. Same architecture, more concrete domain.

---

# 1. WHAT YOU'RE BUILDING (PLAIN LANGUAGE)

A standalone agent that:

1. Authenticates with the server (one-time human approval, then fresh JWTs per request)
2. Reads the competition rules
3. Starts an "Attempt" (15 games back-to-back)
4. For each game: places 5 ships on a 10x10 board, then alternates shots with the opponent
5. When all 15 games finish, receives a `finalScore` (max 1000)

It's pure HTTP. No WebSockets, no polling. Every request gets an immediate response that includes the opponent's reply if it's the shooting phase.

Server-side, there are 15 built-in opponents you play against in fixed order:
- 5 SCOUT bots (baseScore 14 per win)
- 10 WARSHIP bots (baseScore 15 per win)

Perfect score = 1000 = win all 15 games + lose zero ships.

---

# 2. ARCHITECTURE AT 10,000 FEET

```
YOUR AGENT                          STARSLING SERVER
─────────                          ─────────────────
                                    
[1] Auth handshake ──discover──>   /.well-known/agent-configuration
                  ──device flow─>   OAuth device-auth + token endpoints
                  ──human approval->  /agents/approve  (one-time)
                  <─agentId────    
                                    
[2] Mint JWT per request  ──>      (in your SDK locally, signed with agent creds)
                                   
[3] GET rules             ──>      /competitions/{compId}/rules
                          <─JSON───
                                   
[4] POST createAttempt    ──>      /competitions/{compId}/attempts
                          <─MOVE_REQUIRED (PLACE_SHIPS, Game 1)
                                   
[5] POST placements       ──>      /competitions/{compId}/attempts/current/placements
                          <─MOVE_REQUIRED (SUBMIT_SHOT)
                                   
[6] POST shot             ──>      /competitions/{compId}/attempts/current/shots
                          <─MOVE_REQUIRED (next shot, opponent already replied)
                          
        ... loop until Game ends ...
                          <─GAME_COMPLETED (next game's first move embedded in `next`)
                          
        ... 15 games total ...
                          <─ATTEMPT_COMPLETED (result with finalScore)
```

Key insight: the response envelope is a **state machine driven by `responseType`**. Your code is literally a switch statement on that field.

---

# 3. THE FOUR ENVELOPE TYPES (THE STATE MACHINE)

Every gameplay response has a `responseType`. Your agent's loop is a dispatch on this field.

| responseType | Meaning | What you do |
|---|---|---|
| `MOVE_REQUIRED` | It's your turn. `state.nextRequiredMove` is `PLACE_SHIPS` or `SUBMIT_SHOT` | Submit that move |
| `GAME_COMPLETED` | Current game ended. Next game's first move is in `next` | Unwrap `next` and continue |
| `ATTEMPT_COMPLETED` | All 15 games done. `result` has your finalScore | Stop, print result |
| `ATTEMPT_DISQUALIFIED` | Ended early (timeout / illegal move / abandon). Unranked | Stop, log reason |

**Critical**: a rule-breaking move is NOT an HTTP error. It returns HTTP 200 with `ATTEMPT_DISQUALIFIED`. 4xx is reserved for malformed JSON, auth failures, missing resources. You don't get a second chance on an illegal shot or layout.

---

# 4. THE AUTH HANDSHAKE (CRITICAL TO GET RIGHT FIRST)

This is the trickiest plumbing piece. If you mess up auth, you can't make any progress. Spend 30-40 minutes on this and get it solid before anything else.

## What it actually is

OAuth 2.0 **device authorization grant**. The same flow CLI tools and TVs use to log you into accounts. You request access, get a URL, a human opens the URL in a browser and approves, then your code can mint tokens.

## The flow step-by-step

1. **Discovery**: GET `https://intern-battleship-game-server.vercel.app/.well-known/agent-configuration`. Returns issuer URL, device-authorization endpoint, token endpoint, and REST routes per capability.

2. **Connect**: Your agent SDK calls the device-authorization endpoint, requesting specific capabilities (createAttempt, placeShips, submitShot, etc.). Gets back a `verification_uri_complete` URL.

3. **Human approval**: A human (you) opens that URL in a browser, signs in, and approves the requested capabilities at `/agents/approve`. This is **one-time per agent**. The approval is persisted server-side.

4. **Token**: Your SDK polls the token endpoint. Once approval lands, you get an `agentId`.

5. **Per-request JWT**: Every API call requires a fresh JWT signed with your agent credentials. The JWT carries a one-time `jti` (JWT ID) for replay protection. **Reusing a JWT returns 401.** Mint a new one for every request.

## Capabilities you'll request

```
- getCompetitionRules    (auto-granted, no human approval needed)
- createAttempt           (needs approval)
- getCurrentAttempt       (needs approval)
- placeShips              (needs approval)
- submitShot              (needs approval)
- abandonAttempt          (needs approval, optional)
```

## Language choice for auth

The docs say:
- **Node/TypeScript**: use `@auth/agent` SDK (handles device flow + JWT signing natively)
- **Any other language**: drive `@auth/agent-cli` (binary called `auth-agent`) OR run it as an MCP server

For your 3-hour budget, **TypeScript is the right choice** if you're at all comfortable with it. The SDK is purpose-built. In Python you'd be shelling out to a CLI for every JWT, which is slower and adds complexity.

If you stick with Python: the CLI returns a fresh JWT on stdout. You'd wrap it in a subprocess call. Workable but adds friction.

## Prerequisites

The docs mention:
- A user account on the server
- "The sign-up is gated by a closed-beta allowlist — make sure your email is admitted."

**Action item RIGHT NOW**: confirm your email (bg2896@nyu.edu) is on the allowlist. If you can't sign up, you can't even start. Ping Daniel BEFORE your 3-hour window opens to make sure access is provisioned.

---

# 5. THE COMPETITION (WHAT YOU'RE OPTIMIZING)

After auth, GET `/competitions/{compId}/rules`. Returns the constants you'll optimize against.

## Board rules

- **10×10 grid**, 0-indexed (rows 0..9, cols 0..9). `(0, 0)` is top-left.
- **Fleet**: 5 ships, 17 total cells:
  - CARRIER: length 5
  - BATTLESHIP: length 4
  - CRUISER: length 3
  - SUBMARINE: length 3
  - DESTROYER: length 2
- **allowAdjacency: true** — ships can touch.

## Scoring constants (the function you maximize)

For each game in your attempt, your score is:
```
+ agentHitPoints * (number of hits you landed)            [agentHitPoints = 1]
+ sinkBonusByClass[shipClass] for each opponent ship sunk [CARRIER 10, BATTLESHIP 8, CRUISER 7, SUBMARINE 6, DESTROYER 4]
+ baseScore (only if you WIN the game)                    [SCOUT 14, WARSHIP 15]
- perShipLossPenalty * (number of your ships sunk)        [perShipLossPenalty = 2]
- classLossPenaltyByClass[shipClass] for each of your ships sunk  [same values as sink bonus]
```

## Max possible per game

Assume you win without losing any ships:
- Hits: 17 (you hit all 17 cells of opponent ships)
- Sink bonus: 10 + 8 + 7 + 6 + 4 = 35
- Win bonus: 14 (SCOUT) or 15 (WARSHIP)
- Penalties: 0

Per-game max: 17 + 35 + 14 = 66 (vs SCOUT), 17 + 35 + 15 = 67 (vs WARSHIP)

Over 15 games (5 SCOUT + 10 WARSHIP):
5 × 66 + 10 × 67 = 330 + 670 = 1000. That's the perfect score.

## Insight from the scoring formula

- **Winning is huge**: baseScore (14-15) is added only on win. That's ~20% of a perfect game.
- **Hits matter even in a loss**: each hit = +1. So even if you can't win, fire smart shots, never give up.
- **Sinking the big ships hard-counts**: CARRIER sink = +10 bonus and avoiding CARRIER loss = -10 saved. The big ships dominate score.
- **Speed-to-win matters indirectly**: you don't get bonus for fast wins, but slower games give the opponent more chances to hit you and stack penalties.

## Turn timeout

**10 seconds per move.** Enforcement is lazy (the server notices on your next request). But don't push it — design your loop so each move is decided in well under 1 second.

---

# 6. STRATEGY: PLACEMENT

The docs give a baseline strategy in Step 7: random but legal. That's the floor. Here's what to actually do.

## Why random is the right baseline

The server's opponents are fixed. They presumably have their own placement and shooting strategies. If your placement is predictable (e.g., always corner-anchored, always horizontal), an opponent with even simple heuristics could exploit it. Random placement makes you uncorrelated.

## Random-but-smart improvements

1. **Truly random per game**: re-randomize every game, not just the first. The Game state shows you're playing a different opponent each time; varying placement avoids opponent-specific exploits if they do any cross-game tracking.

2. **Edge bias is a real thing in Battleships**: traditional Battleships rules don't allow adjacency, but THIS competition does (`allowAdjacency: true`). Most opponents are probably built assuming standard rules. Use the freedom: place ships touching each other or hugging edges/corners more than a naive uniform-random would.

3. **Spread the fleet**: even with adjacency allowed, fully clustering all 5 ships in one corner gives the opponent's hunt mode a fat target. Spread to reduce "found one, found them all" risk.

4. **Mix orientations**: some bots may be hardcoded to shoot horizontally first, then vertically. Random orientation per ship handles this.

## Placement algorithm (the safe baseline)

```python
def choose_layout(state):
    rules = state["board"]
    R, C = rules["gridRows"], rules["gridCols"]
    used = set()
    placements = []
    
    # Largest ships first (harder to place)
    for ship in rules["shipClasses"]:  # CARRIER(5) down to DESTROYER(2)
        for attempt in range(1000):  # cap retries
            horiz = random.random() < 0.5
            length = ship["length"]
            if horiz:
                r = random.randrange(R)
                c = random.randrange(C - length + 1)
                cells = {(r, c + i) for i in range(length)}
            else:
                r = random.randrange(R - length + 1)
                c = random.randrange(C)
                cells = {(r + i, c) for i in range(length)}
            
            if cells & used:
                continue  # overlap, retry
            
            used |= cells
            placements.append({
                "shipClass": ship["class"],
                "orientation": "HORIZONTAL" if horiz else "VERTICAL",
                "startRow": r, "startCol": c,
            })
            break
    
    return placements
```

## Smarter placement (optional, only if you have time)

After the basic version works:
- **Anti-checkerboard placement**: if you suspect opponents use parity hunts (every other cell), place your ships such that they minimize parity-cell coverage. Hard to do generically; probably not worth the time.
- **Avoid touching the edge with the CARRIER**: edges are common hunt patterns. Slight bias toward interior placement for the CARRIER.

**Recommendation for 3 hours**: ship the random-but-legal version. Move on to shooting strategy where the real point gain is.

---

# 7. STRATEGY: SHOOTING (THE REAL POINT GAIN)

Shooting strategy is where you separate from baseline scores. Three levels of sophistication:

## Level 1: Pure random (baseline floor, DO NOT SHIP)

Just shoot random unused cells. Will lose almost every game. Score in the 200-400 range. Don't even bother.

## Level 2: Hunt + Target (the docs' baseline)

Two modes:
- **Hunt**: search for ships. Shoot a parity pattern (cells where `(row + col) % 2 == 0`). Since the smallest ship is length 2, every ship has at least one cell on each parity. You only need to search HALF the board to find every ship.
- **Target**: once you HIT, switch to firing at the 4 neighbors of the hit until the ship sinks. When SINK happens, return to hunt.

This is what the docs give you in Step 7. Implement this version first. It scores in the 600-800 range.

```python
def choose_shot(state):
    R, C = state["board"]["gridRows"], state["board"]["gridCols"]
    tried = {(s["row"], s["col"]) for s in state["yourShots"]}
    
    # Open hits = HITs that aren't part of an already-sunk ship
    sunk_classes = set(state["sunkOpponentShipClasses"])
    # NOTE: yourShots gives outcomes per shot. Need to figure out which HITs
    # are part of unsunk ships. Simplification: any HIT whose neighbors haven't
    # all been explored = open.
    
    open_hits = [(s["row"], s["col"]) for s in state["yourShots"] 
                 if s["outcome"] == "HIT"]
    # ... filter out hits that belong to already-sunk ships if you can identify them
    
    if open_hits:  # TARGET mode
        for (r, c) in open_hits:
            for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nr, nc = r + dr, c + dc
                if 0 <= nr < R and 0 <= nc < C and (nr, nc) not in tried:
                    return {"row": nr, "col": nc}
    
    # HUNT mode: parity-pruned random
    candidates = [(r, c) for r in range(R) for c in range(C)
                  if (r + c) % 2 == 0 and (r, c) not in tried]
    if not candidates:
        candidates = [(r, c) for r in range(R) for c in range(C)
                      if (r, c) not in tried]
    return {"row": random.choice(candidates)[0], "col": random.choice(candidates)[1]}
```

## Level 3: Hunt + Target with direction inference (the smart version)

When you've hit two adjacent cells of the same ship, you know the ship's orientation. Fire along that axis only. When you miss going in one direction, switch to the other end.

State machine for targeting:
```
NEW_HIT          → fire at 4 neighbors (any order)
TWO_ADJACENT_HITS → orientation locked. Fire next cell in that direction.
THREE_PLUS_HITS  → same direction. If miss, reverse from the first hit.
SUNK             → return to hunt mode
```

This avoids wasting shots on the perpendicular axis when you already know the ship's orientation. Scores 800-900+.

## Level 4: Probability density mapping (the advanced version)

Best strategy in classical Battleships:

For each empty cell, count how many ways an unsunk ship could be placed such that it covers that cell, given current observations (misses, hits, sinks). Fire at the cell with the highest count.

How it works:
1. For each unsunk opponent ship class, enumerate all possible (orientation, position) placements
2. Filter out placements that conflict with known misses or known sunk cells
3. Filter out placements that don't match the constraint of any open hits
4. For each remaining placement, increment a count for each cell it covers
5. Fire at the cell with the highest count

This naturally handles hunt mode (with no hits, the density map biases toward central/uncovered cells where ships fit in more orientations) and target mode (with open hits, only placements covering those hits are valid).

Computational cost: at most ~200 placements per ship × 5 ships = 1000 placements to enumerate. Fits in milliseconds.

**Recommendation**: Implement Level 3 first (smart targeting). If you have 30+ min left after end-to-end works, upgrade to Level 4.

## Hard rules (the docs hammer this)

**NEVER repeat a shot.** Always de-dupe against `yourShots` before deciding.
**ALWAYS stay on the board.** `0 ≤ row < gridRows, 0 ≤ col < gridCols`.

Either violation = instant disqualification. Add an assertion in your code:
```python
assert 0 <= row < R and 0 <= col < C, "off-board shot"
assert (row, col) not in tried, "duplicate shot"
```

---

# 8. THE OVERALL AGENT LOOP

```python
resp = create_attempt(comp_id)

while True:
    t = resp["responseType"]
    
    if t == "MOVE_REQUIRED":
        state = resp["state"]
        if state["nextRequiredMove"] == "PLACE_SHIPS":
            placements = choose_layout(state)
            resp = place_ships(comp_id, placements)
        else:  # SUBMIT_SHOT
            shot = choose_shot(state)
            resp = submit_shot(comp_id, shot)
    
    elif t == "GAME_COMPLETED":
        resp = resp["next"]  # next game's first move is already in here
    
    elif t == "ATTEMPT_COMPLETED":
        print("final score:", resp["result"]["finalScore"])
        print("wins:", resp["result"]["wins"])
        print("losses:", resp["result"]["losses"])
        break
    
    elif t == "ATTEMPT_DISQUALIFIED":
        print("disqualified:", resp["reason"], resp.get("context"))
        break
```

That's the entire game loop. Maybe 30 lines including helpers.

---

# 9. WHERE THE CLOSED-LOOP CONCEPT FITS

You were prepped on "closed-loop agents that self-optimize toward a goal." Here's where that maps in the Battleships challenge:

**The OBSERVE → REASON → ACT → MEASURE → UPDATE loop is WITHIN each game's shooting:**

| Stage | What it is in Battleships |
|---|---|
| OBSERVE | Read `state.yourShots`, `state.sunkOpponentShipClasses`, `state.incomingShots` |
| REASON | choose_shot: target mode (if open hits) or hunt mode |
| ACT | POST /shots with row, col |
| MEASURE | Outcome: MISS, HIT, or SINK (with `sunkShipClass`) |
| UPDATE | Implicit: the next iteration sees the updated state from the API |

The "self-optimization" is the agent's knowledge of the opponent's ship locations updating after each shot, narrowing the search space. By iteration 30 of a game, the agent has way more information than at iteration 1 and should be way more accurate.

This is the closed-loop. The goal is to win (or maximize score) within ~85 shots maximum on a 100-cell board.

## What "self-optimizes" means in your README

In your reflection writeup, name this explicitly:

> The agent runs a closed-loop within each game: observe the current shot history and outcomes, reason about the most likely opponent ship location, act by firing the shot, measure the result, and update the internal state for the next iteration. The cell most likely to contain a ship is computed by [hunt + target heuristic | probability density map]. This is the same architectural shape as StarSling Runners' CI agent: observe telemetry, hypothesize an optimization, act via a PR, measure timing impact, update memory.

That sentence connects the assignment to StarSling's actual product. Daniel will appreciate the framing.

---

# 10. ERRORS AND DISQUALIFICATION (DON'T MESS THESE UP)

## ATTEMPT_DISQUALIFIED — 3 reasons

| Reason | When it happens | How to avoid |
|---|---|---|
| `ILLEGAL_MOVE` | Illegal layout (overlap, off-board) or illegal shot (off-board, repeat) | Validate locally before sending. Assert in code. |
| `TIMEOUT` | Missed `nextMoveDeadlineAt` (10 sec budget) | Decide moves in milliseconds. Don't block on anything slow. |
| `ABANDONED` | You called `abandonAttempt` | Just don't call it |

DQ is **terminal and unranked**. You don't get to retry. Validate everything before sending.

## HTTP errors (the request was malformed, not gameplay)

| Status | Code | When |
|---|---|---|
| 401 | — | JWT missing/invalid/expired/reused jti |
| 403 | — | Token doesn't have the capability for this route |
| 404 | `NO_ACTIVE_ATTEMPT` | Move/read route called with no active Attempt |
| 404 | `COMPETITION_NOT_FOUND` | Wrong competitionId |
| 409 | `ACTIVE_ATTEMPT_EXISTS` | Tried createAttempt while one is active |
| 409 | `SHIPS_ALREADY_PLACED` | Called placeShips twice |
| 409 | `SHIPS_NOT_PLACED` | Called submitShot before placing |
| 422 | `VALIDATION` | JSON body failed schema |

Every response carries `x-request-id` header — log it for debugging.

## State recovery

If your agent crashes or you lose track of state mid-attempt: GET `/attempts/current` returns the active Public Game State. Returns 404 NO_ACTIVE_ATTEMPT if there's no live attempt.

## Pre-flight validation (do this BEFORE sending)

```python
def validate_placements(placements, R=10, C=10):
    used = set()
    classes_seen = set()
    expected_classes = {"CARRIER", "BATTLESHIP", "CRUISER", "SUBMARINE", "DESTROYER"}
    lengths = {"CARRIER": 5, "BATTLESHIP": 4, "CRUISER": 3, "SUBMARINE": 3, "DESTROYER": 2}
    
    for p in placements:
        cls = p["shipClass"]
        if cls in classes_seen: raise ValueError(f"duplicate {cls}")
        classes_seen.add(cls)
        
        length = lengths[cls]
        r, c = p["startRow"], p["startCol"]
        if p["orientation"] == "HORIZONTAL":
            if c + length > C: raise ValueError(f"{cls} off-board horiz")
            cells = {(r, c + i) for i in range(length)}
        else:
            if r + length > R: raise ValueError(f"{cls} off-board vert")
            cells = {(r + i, c) for i in range(length)}
        
        if cells & used: raise ValueError(f"{cls} overlap")
        used |= cells
    
    if classes_seen != expected_classes:
        raise ValueError(f"missing classes: {expected_classes - classes_seen}")

def validate_shot(row, col, tried, R=10, C=10):
    assert 0 <= row < R, f"row off-board: {row}"
    assert 0 <= col < C, f"col off-board: {col}"
    assert (row, col) not in tried, f"duplicate shot: ({row}, {col})"
```

Call these before every API call. They'll save your Attempt.

---

# 11. LANGUAGE CHOICE FOR THE 3-HOUR BUILD

The docs strongly nudge toward TypeScript via `@auth/agent` SDK. Let me lay out the options honestly:

## Option A: TypeScript + @auth/agent SDK

**Pros**: native SDK does device flow and JWT signing. Reference implementation at `examples/agent/` in their repo (you can fork it). Path of least resistance.

**Cons**: if you're rusty on TypeScript, you spend setup time on tsconfig, types, package.json.

## Option B: Python + @auth/agent-cli subprocess

**Pros**: Python is your strongest language. Less syntactic overhead.

**Cons**: every JWT is a shell-out (subprocess call to `auth-agent`). Adds ~50-200ms latency per request. Still feasible within the 10s timeout, but you might end up doing the work twice (debugging the subprocess wrapping, debugging the game logic).

## Option C: Python + auth-agent MCP server

**Pros**: cleaner than subprocess. Treat auth-agent as a long-running MCP server, call into it via MCP protocol.

**Cons**: setup overhead for the MCP integration. Probably 30+ min just for this.

## Recommendation

**Use TypeScript with the @auth/agent SDK and the reference implementation as a starting point.**

Reasons:
1. The docs literally say "A complete, runnable TypeScript agent lives in the game server repo under examples/agent/ — auth.ts, client.ts, play.ts."
2. You can fork their example, replace the placement and shot logic with your own, and you have a working agent in 30 minutes.
3. The native SDK avoids the subprocess/MCP friction.
4. You have TypeScript in your stack (Bhavesh.ai uses Vite + React + TS). It's not new to you.

If you really, really prefer Python: Option B works, but budget 30+ min for the subprocess wrapper before you can start on strategy.

---

# 12. THE 3-HOUR TIME BUDGET (BATTLESHIPS VERSION)

Hour-by-hour plan.

## 0:00–0:30 (30 min) — Auth + plumbing

- Verify your email is on the allowlist (DO BEFORE STARTING)
- Clone or fork the reference example from the StarSling repo
- Install dependencies: `@auth/agent`, your HTTP client
- Run discovery: GET `/.well-known/agent-configuration` works
- Run device flow: get the verification URL, approve in browser
- Mint your first JWT, call `/competitions/{compId}/rules`, see the rules come back
- **Milestone**: you can authenticate and read rules

## 0:30–1:00 (30 min) — Game loop skeleton

- Implement the state machine on `responseType` (see Section 8)
- Hardcode the simplest possible placement (deterministic, all horizontal across rows 0, 2, 4, 6, 8)
- Hardcode the simplest possible shot (sequential: (0,0), (0,1), (0,2), ...)
- Run end-to-end: createAttempt, place ships, fire shots, watch responses scroll
- Make sure you handle MOVE_REQUIRED, GAME_COMPLETED, ATTEMPT_COMPLETED, ATTEMPT_DISQUALIFIED
- **Milestone**: agent completes (or DQs cleanly during) one full Attempt with a real score logged

This baseline will score badly (probably 100-300). That's fine. The plumbing works.

## 1:00–1:45 (45 min) — Real strategy

- Replace placement with random-but-legal (Section 6)
- Replace shooting with hunt + target (Section 7, Level 2)
- Add the validation functions (Section 10)
- Run end-to-end. Watch your score climb. Expect 500-700.

## 1:45–2:15 (30 min) — Smart targeting (Level 3)

- After two adjacent hits, lock orientation and fire along the axis only
- After miss in one direction, reverse from the first hit
- Track ship sinks to remove "done" hits from open_hits
- Run end-to-end. Expect 700-850.

If time remains AND you're confident: upgrade to Level 4 (probability density). If not, ship Level 3.

## 2:15–2:45 (30 min) — Observability + README

- Log every game's score, wins/losses, hit ratio, time per move
- Save to a JSONL file (one line per game)
- Plot finalScore breakdown (or at least print a clean summary table)
- Write README:
  - What it does (2 sentences)
  - How to run (single command)
  - Architecture (the state-machine diagram)
  - Strategy: placement (random) + shooting (hunt + target + direction lock)
  - Closed-loop framing (Section 9)
  - Tradeoffs I made
  - What I cut
  - What I'd do next (probability density, opponent-specific tuning if you saw any patterns)
  - How this maps to StarSling's actual product

## 2:45–3:00 (15 min) — Submit

- Push to GitHub
- Record a 90-second Loom: intro, run, watch the score, README walk-through
- Submit per Daniel's instructions

---

# 13. WHAT CLAUDE CODE CAN DO WELL AND WHAT TO DRIVE

Claude Code will handle the plumbing quickly. The strategy and the constraints are where you need to drive.

## What Claude Code is good at

- Setting up the TypeScript project (tsconfig, package.json, dependencies)
- Writing the HTTP client with proper error handling
- Implementing the state machine dispatch
- Writing the validation functions
- Wrapping the auth SDK calls
- Boilerplate for logging and reading from stdin

## What Claude Code will get wrong if you don't direct it

1. **Over-engineering**: it'll add classes, interfaces, types beyond what's needed. Tell it: "Single file, ~200 lines, no classes, minimal types."

2. **Choosing the wrong strategy level**: it'll suggest a clever-but-untested probability density map first. Tell it: "Level 2 (hunt + target) first. Verify it works. Then upgrade to Level 3."

3. **Skipping validation**: it'll trust the LLM-generated moves. Tell it: "Validate every placement and every shot LOCALLY before sending. Assert. Crash early."

4. **Forgetting to mint fresh JWTs**: it might cache the first JWT. Tell it: "Every request mints a fresh JWT via `agent.signJwt()`."

5. **Wrong loop structure**: it might write nested loops by game and shot. Tell it: "Single loop driven by `responseType`. GAME_COMPLETED means unwrap `next` and continue the same loop."

6. **Not logging structured data**: tell it: "Append a JSON line per game outcome to `games.jsonl`."

## The Claude Code starter prompt (paste this at 0:00)

Save as `STARSLING_BRIEF.md` before tomorrow:

```markdown
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
```

---

# 14. OBSERVABILITY (THE THIRD GRADED SIGNAL)

What Daniel will look for in your repo to judge Observability:

## In the code

- Structured logging: every API call logs request id, latency, response type. Every move logs the chosen action and the outcome.
- A run summary at the end: total games, wins, losses, total score, hit/miss/sink counts.

## In artifacts

- `games.jsonl`: one line per game with finalScore, opponent class, your ships lost, opponent ships sunk
- `runlog.txt`: stdout from a real run
- A summary table or chart (optional): per-game score over the 15 games

## In the README

- Clear narrative: what the agent did, where it succeeded, where it failed
- A specific failure case called out: "in Game 7 the agent's hunt phase wasted 4 shots in a row in a sparse region; if I had probability density, those would have been higher-EV cells"
- A "what I learned" paragraph

You're not just shipping code. You're shipping an OBSERVABLE system someone else can understand.

---

# 15. ANTI-PATTERNS THAT WILL SINK YOUR SCORE

1. **Reusing JWTs**: instant 401 storm. Always mint fresh.
2. **No local validation of placements/shots**: one bug = instant DQ on game 1.
3. **Treating ATTEMPT_DISQUALIFIED as an HTTP error**: it's HTTP 200. Check responseType.
4. **Looping per game instead of on responseType**: GAME_COMPLETED handling will be wrong.
5. **Building Level 4 strategy first**: you'll run out of time before anything works.
6. **No README or sparse README**: fails Technical Judgment signal.
7. **Logging just to console with print**: not observable artifacts.
8. **Holding onto a game state struct manually**: redundant. Trust the state from each response.
9. **Trying to write tests in 3 hours**: skip.
10. **Forgetting the "closed-loop" framing in the README**: leave that point on the table and you lose easy signal.

---

# 16. README STRUCTURE (CRITICAL FOR SCORING)

```markdown
# StarSling Battleships Agent

A TypeScript agent that plays a complete Attempt of Standard Competition v1
against 15 fixed opponents, using a hunt-and-target shooting strategy with
direction inference.

## How to run

```bash
npm install
export ANTHROPIC_API_KEY=... # not needed for this challenge actually
node --experimental-strip-types agent.ts
```

## Architecture

Single loop driven by the response `responseType` field:

```
START
  │
  └─ createAttempt ──> MOVE_REQUIRED (PLACE_SHIPS)
        │
        └─ placeShips ──> MOVE_REQUIRED (SUBMIT_SHOT) ←──┐
              │                                          │
              └─ submitShot ──> MOVE_REQUIRED ───────────┘
                            └─ GAME_COMPLETED ──> unwrap next ──┐
                            └─ ATTEMPT_COMPLETED ──> exit       │
                            └─ ATTEMPT_DISQUALIFIED ──> exit    │
                                                                │
                                       (continue 14 more games) │
                                                                └──...
```

## Closed-loop framing

The agent runs a closed-loop within each game's shooting phase:
1. OBSERVE: read `state.yourShots`, `state.sunkOpponentShipClasses`
2. REASON: decide hunt vs target mode; pick the best cell
3. ACT: POST /shots
4. MEASURE: read the outcome (MISS, HIT, SINK)
5. UPDATE: the next iteration sees the updated state, narrowing the search space

This is the same architectural shape as StarSling Runners' CI agent: observe
telemetry, hypothesize an optimization, act via a PR, measure timing impact,
update memory.

## Strategy

### Placement
Random-but-legal. Each game re-randomizes orientation and position per ship.
Adjacency is allowed (per rules) so we don't enforce no-touch.

### Shooting
- HUNT mode: parity-pruned random. We fire only cells where (row + col) % 2 == 0
  because every ship has length ≥ 2 and thus covers at least one cell on each
  parity. This halves the search space.
- TARGET mode: triggered when there's an unsunk HIT. Fire neighbors of the hit.
  After 2 adjacent hits of the same ship, lock the direction and fire along the
  axis only. On miss while locked, reverse from the first hit.

## Observability

- `games.jsonl`: structured per-game record (opponent, score, hits, misses,
  ships lost, duration in shots)
- `runlog.txt`: stdout from the latest run

## Tradeoffs I made

- Random placement instead of probability-defensive placement: ship-quickly call.
- Hunt+target+direction-lock instead of full probability density: density would
  add 30+ min for ~50 score gain in my estimation. Ship over polish.
- Single-file architecture: 3-hour budget. Classes and tests are cuts.
- No retry layer on HTTP errors: 401 is fatal (auth bug) and shouldn't be
  recovered, 500s I'd let propagate to a top-level catch + abandon.

## What I cut

- Level 4 probability density (would maximize expected score per shot)
- Opponent-specific tuning (no time to analyze per-opponent patterns)
- Real-time visualization
- Tests

## What I'd build next given more time

- Probability density: enumerate all valid (ship × orientation × position)
  configurations consistent with current observations, score each cell by
  count, fire the max. Expected +50-100 score.
- Opponent fingerprinting: log incoming-shot patterns to detect if specific
  opponents have biases (e.g., always start hunt at (0,0), or use rows-only
  hunt). Tailor placement against detected patterns.
- Memoize the parity-hunt sequence to deterministically achieve maximum
  search-space coverage with the first N hunts.

## How this maps to StarSling's actual product

StarSling Runners' agent observes real CI run telemetry, hypothesizes
optimizations, opens PRs, and watches whether timings improved post-merge.
This take-home is the same architectural shape at smaller scale: observe
state, hypothesize the best next action under uncertainty, act, measure,
update internal knowledge. The closing of the loop is what makes it
self-optimizing.
```

That's ~400 words of substance. Don't go longer.

---

# 17. INTERVIEW PREP: Q&A (THIS IS WHERE YOU EARN THE OFFER)

After the take-home, Daniel will do a follow-up technical interview. Prepare for these questions.

## Q1: Walk me through the architecture.

> "Single loop on `responseType`. createAttempt returns MOVE_REQUIRED with placement state. placeShips returns MOVE_REQUIRED with shot state. submitShot can return MOVE_REQUIRED (continue), GAME_COMPLETED (unwrap `next`), ATTEMPT_COMPLETED (read finalScore and exit), or ATTEMPT_DISQUALIFIED (log reason and exit). The agent doesn't maintain its own game-state struct; it trusts the state echoed by each API response."

## Q2: Where's the closed-loop?

> "Inside the shooting phase of each game. Each shot result narrows the hypothesis space about opponent ship locations. The next shot's decision uses the cumulative shot history (`state.yourShots`) to either continue targeting (open hit unexplored) or hunt (no open hits). The history feeding into the next decision is the closing of the loop."

## Q3: Why this shooting strategy and not probability density?

> "I picked hunt+target+direction-lock as a deliberate Technical Judgment + Pragmatism call. Level 4 probability density would maximize expected info per shot but adds enumeration code (every valid ship placement consistent with observations) that I estimated at 30-40 minutes. With 3 hours total I'd rather ship a strong Level 3 than a half-finished Level 4. Probability density is the first item in my 'what I'd build next' section."

## Q4: How did you handle placement?

> "Random-but-legal. Re-randomized every game because each opponent is different and the rules allow adjacency. I considered edge-bias and clustering tactics but they require modeling opponent behavior, which I had no data on. The random baseline is uncorrelated with whatever the opponents are doing, which is its main strength."

## Q5: What was the hardest part?

> "Two things. First, auth — getting the device flow and per-request JWT minting right took ~30 minutes and was the most fragile part of the build. Reusing a JWT returns 401, so any caching breaks everything. Second, direction inference after a hit. Knowing when two hits belong to the same ship vs two adjacent ships of different classes required tracking which hit cells had been associated with a sunk class."

## Q6: What was the failure case?

> "On run #N my agent's hunt phase wasted 4 consecutive shots in a sparse region because the parity mask was uniform. Probability density would have biased toward central cells where more ship configurations fit. I called this out in the README."

## Q7: How does this map to your CI agent at StarSling?

> "Same shape: observe state, hypothesize the highest-EV action, act, measure outcome, update memory. The difference is the action space (YAML diffs vs board cells) and the feedback signal (post-merge timing vs HIT/MISS/SINK). The closed-loop architecture is identical."

## Q8: What would you do with another week?

> "Three things. One, probability density for higher per-shot EV. Two, opponent fingerprinting from incoming-shot patterns so the placement strategy adapts. Three, a proper observability layer with LangSmith-style tracing so I could replay any game shot-by-shot."

## Q9: Why TypeScript over Python? You're stronger in Python.

> "The reference implementation is TypeScript with the @auth/agent SDK that handles the device flow natively. In Python I'd have to either shell out to the CLI on every JWT or wrap the MCP server, both of which add real friction. Pragmatic call: pick the language that has the lowest setup tax for this specific challenge."

## Q10: How would you scale this to a real production agent at StarSling?

> "The shape transfers cleanly. Replace the game loop's observe phase with telemetry ingestion (workflow_run webhook + log retrieval). Replace the shoot decision with an LLM call to propose a YAML optimization. Replace the API submission with opening a PR. The feedback signal becomes 'did the PR get merged and did timings improve.' Memory persists per-repo. The reciprocal customer relationship with Mastra gives you a strong eval channel: their CI is your test set."

---

# 18. WHAT TO DO BEFORE TOMORROW (PRE-FLIGHT)

## TONIGHT (Wed June 3)

- [ ] Verify your email is on the StarSling allowlist. Sign up at the challenge server right now. If you can't, ping Daniel immediately.
- [ ] Read the official docs at https://challenge.starsling.dev/docs end-to-end. The page you pasted is the deep reference; skim the OpenAPI spec at https://intern-battleship-game-server.vercel.app/openapi if you want even more.
- [ ] Read this guide.
- [ ] Check that the reference example actually exists: look in the StarSling repo for `examples/agent/`. If it does, plan to fork or copy from it.
- [ ] Make sure Node.js 22+ is installed locally. Verify with `node --version`.
- [ ] Pre-write your `STARSLING_BRIEF.md` (the Claude Code starter prompt from Section 13).
- [ ] Sketch on paper: the state machine, the hunt+target logic, the validation rules.
- [ ] Sleep 7+ hours.

## TOMORROW MORNING (Thu June 4) before your 9 AM PT window

- [ ] Coffee, water, snack, bathroom
- [ ] Quiet room, all notifications off
- [ ] Have this guide and the official docs open in tabs
- [ ] Open Claude Code in a clean directory
- [ ] At 9:00 sharp: paste your STARSLING_BRIEF.md into Claude Code, start

## DURING THE 3 HOURS

- [ ] Block timer: set alerts for 0:30, 1:00, 1:45, 2:15, 2:45 to enforce phase changes
- [ ] After auth works: actually look at a rule response from the server, confirm constants match what you expected
- [ ] After random placement works: run ONE full attempt and watch the score. Even if it's 300, the plumbing is real.
- [ ] After hunt+target works: run another attempt, expect 600-800
- [ ] DO NOT GO DOWN RABBIT HOLES. If something takes more than 10 min unexpected, cut it.
- [ ] At 2:30 minimum: stop iterating on strategy, start writing the README

## AFTER

- [ ] Push to GitHub. Make repo public OR add Daniel as collaborator.
- [ ] Record 90-sec Loom: intro the agent, run it, show the final score, walk through the README.
- [ ] Submit per Daniel's instructions.
- [ ] Walk away. You're done.

---

# 19. THE THREE SCORING SIGNALS RESTATED FOR THIS CHALLENGE

## Technical Judgment

You demonstrate this by:
- Picking the right strategy level (Level 3 hunt+target+direction is the sweet spot)
- Picking TypeScript over Python given the SDK availability
- Implementing local validation before sending
- Not over-engineering (no classes, no tests, no premature abstractions)
- Calling out tradeoffs explicitly in README

## Pragmatism

You demonstrate this by:
- Working end-to-end agent before any strategy polish
- Cutting Level 4 strategy that doesn't fit in budget
- Cutting tests in a 3-hour build
- Forking the reference implementation instead of building from scratch
- README's "What I cut" section being non-empty

## Observability

You demonstrate this by:
- Structured JSONL per-game logs
- Run summary at end of attempt
- README narrative walking through one full game
- A failure case explicitly called out
- Clear stdout output so the live run is followable

---

# 20. THE ONE THING TO REMEMBER

Two things actually:

1. **Mint a fresh JWT for every request. ALWAYS.** Cached JWT = 401 storm = no progress.

2. **Validate every move LOCALLY before sending.** Illegal move = instant disqualification = lost Attempt. Server doesn't tell you "that's invalid, try again." It tells you "Attempt over."

Get those two right and the rest is iteration on strategy. The plumbing is template; the strategy is craft. You have all the tools you need.

Walk in informed. Ship the loop. Iterate the strategy. Write a tight README. Submit.

Good luck.
