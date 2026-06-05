// Main loop. Single switch on `responseType` (guide §8). Trusts the server
// `state` each turn; no per-game nested loop. Logs every move + outcome and
// writes per-game records for observability.
import { getAgentId } from "./auth.ts";
import { getRules, createAttempt, placeShips, submitShot, abandonAttempt } from "./client.ts";
import { chooseLayout, validatePlacements, chooseShot } from "./strategy.ts";
import { appendGame, appendDetail, summarizeGame, printSummary, resetGamesLog } from "./logger.ts";

const MAX_ITERS = 6000; // 15 games × ~hundreds of moves — generous safety cap

function outcomeOf(state: any, r: number, c: number): string {
  const shots = Array.isArray(state?.yourShots) ? state.yourShots : [];
  const s = shots.find((x: any) => x.row === r && x.col === c);
  return s ? (s.sunkShipClass ? `SINK ${s.sunkShipClass}` : s.outcome) : "?";
}

async function main() {
  const agentId = await getAgentId();
  console.log("agentId:", agentId);
  console.log("SHOT_LEVEL:", process.env.SHOT_LEVEL ?? "4");

  const rules = await getRules(agentId);
  console.log(
    "rules:",
    rules?.displayName,
    "| ships:",
    JSON.stringify(rules?.boardRules?.shipClasses ?? rules?.shipClasses),
    "| timeout:",
    rules?.turnTimeoutSeconds,
  );

  resetGamesLog();
  const games: any[] = [];
  let lastState: any = null;
  let lastPlacements: any[] = [];
  let pendingShot: { row: number; col: number } | null = null;

  let resp = await createAttempt(agentId);
  // A prior crash can leave a stale attempt open → abandon it and start clean.
  if (resp?.code === "ACTIVE_ATTEMPT_EXISTS") {
    console.log("Stale attempt found — abandoning and starting fresh.");
    await abandonAttempt(agentId);
    resp = await createAttempt(agentId);
  }

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const t = resp?.responseType;

    if (t === "MOVE_REQUIRED") {
      const state = resp.state;
      lastState = state;

      // Show the outcome of the shot we just fired (now visible in state).
      if (pendingShot) {
        console.log(
          `   → ${outcomeOf(state, pendingShot.row, pendingShot.col)}`,
        );
        pendingShot = null;
      }

      const move = state?.nextRequiredMove;
      if (move === "PLACE_SHIPS") {
        const layout = chooseLayout(state);
        validatePlacements(layout, state); // throws before sending if illegal
        lastPlacements = layout;
        console.log(
          `G${state.gameOrdinal}/${state.totalGames} vs ${state?.opponent?.displayName} (${state?.opponent?.opponentClass}) — placing ships`,
        );
        resp = await placeShips(agentId, layout);
      } else if (move === "SUBMIT_SHOT") {
        const shot = chooseShot(state);
        pendingShot = shot;
        process.stdout.write(
          `G${state.gameOrdinal} shot (${shot.row},${shot.col})`,
        );
        resp = await submitShot(agentId, shot.row, shot.col);
      } else {
        console.error("Unknown nextRequiredMove:", move, JSON.stringify(state));
        break;
      }
    } else if (t === "GAME_COMPLETED") {
      const finishState = resp?.state ?? lastState;
      const rec = summarizeGame(finishState?.gameOrdinal ?? games.length + 1, finishState, resp);
      appendGame(rec);
      appendDetail(rec.gameOrdinal, rec.opponentClass, finishState, lastPlacements);
      games.push(rec);
      console.log(
        `\n✓ Game ${rec.gameOrdinal} done — shots=${rec.shots} hits=${rec.hits} sunk=${rec.shipsSunk} shipsLost=${rec.shipsLost} in=${rec.incomingShots}`,
      );
      pendingShot = null;
      resp = resp.next;
      if (!resp) {
        console.error("GAME_COMPLETED had no `next` envelope");
        break;
      }
    } else if (t === "ATTEMPT_COMPLETED") {
      printSummary(resp.result, games);
      return;
    } else if (t === "ATTEMPT_DISQUALIFIED") {
      console.error(
        `\n✗ DISQUALIFIED reason=${resp.reason} context=${JSON.stringify(resp.context)}`,
      );
      printSummary(null, games);
      return;
    } else {
      console.error("Unknown responseType:", t, JSON.stringify(resp)?.slice(0, 500));
      break;
    }
  }
  console.error("Loop ended without ATTEMPT_COMPLETED (iter cap or break).");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
