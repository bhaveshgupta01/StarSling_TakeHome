// Observability artifacts (guide §14). One JSON line per game to games.jsonl,
// plus a human summary at attempt end. runlog.txt is captured by piping stdout
// (`npm run play | tee runlog.txt`).
import { appendFileSync, writeFileSync } from "node:fs";

const GAMES_PATH = new URL("../games.jsonl", import.meta.url).pathname;
const DETAIL_PATH = new URL("../games_detail.jsonl", import.meta.url).pathname;
// Never reset — accumulates across every attempt so we can test whether each
// opponent's placement/shooting is deterministic across attempts.
const ARCHIVE_PATH = new URL("../analysis/games_archive.jsonl", import.meta.url).pathname;
const RUN_LABEL = process.env.RUN_LABEL ?? `L${process.env.SHOT_LEVEL ?? "3"}-${process.env.PLACEMENT ?? "bottom"}`;

let started = false;
export function resetGamesLog(): void {
  writeFileSync(GAMES_PATH, "");
  writeFileSync(DETAIL_PATH, "");
  started = true;
}

export function appendGame(record: Record<string, unknown>): void {
  if (!started) resetGamesLog();
  appendFileSync(GAMES_PATH, JSON.stringify(record) + "\n");
}

// Raw coords for heatmap analysis: our placements, our shots, opponent's shots.
export function appendDetail(
  gameOrdinal: number,
  opponentClass: string | null,
  state: any,
  placements: any[],
): void {
  if (!started) resetGamesLog();
  const rec = {
    runLabel: RUN_LABEL,
    gameOrdinal,
    opponent: state?.opponent?.displayName ?? state?.opponent?.opponentId ?? null,
    opponentClass,
    placements,
    yourShots: (state?.yourShots ?? []).map((s: any) => [s.row, s.col, s.outcome, s.sunkShipClass ?? null]),
    incomingShots: (state?.incomingShots ?? []).map((s: any) => [s.row, s.col, s.outcome]),
  };
  appendFileSync(DETAIL_PATH, JSON.stringify(rec) + "\n");
  appendFileSync(ARCHIVE_PATH, JSON.stringify(rec) + "\n"); // cumulative, never reset
}

// Derive a per-game record from the last state seen before the game completed.
export function summarizeGame(gameOrdinal: number, state: any, completed: any) {
  const shots = Array.isArray(state?.yourShots) ? state.yourShots : [];
  const hits = shots.filter((s: any) => s.outcome === "HIT" || s.outcome === "SINK").length;
  const misses = shots.filter((s: any) => s.outcome === "MISS").length;
  // The server marks every cell of a sunk ship as SINK, so count DISTINCT
  // sunk classes, not SINK-outcome cells.
  const shipsSunk = new Set(
    shots.filter((s: any) => s.sunkShipClass).map((s: any) => s.sunkShipClass),
  ).size;
  const fleet = Array.isArray(state?.yourFleet) ? state.yourFleet : [];
  const shipsLost = fleet.filter((f: any) => f?.sunk === true).length;
  const incoming = Array.isArray(state?.incomingShots) ? state.incomingShots.length : null;
  return {
    gameOrdinal,
    opponent: state?.opponent?.displayName ?? state?.opponent?.opponentId ?? null,
    opponentClass: state?.opponent?.opponentClass ?? null,
    shots: shots.length,
    hits,
    misses,
    shipsSunk,
    sunkOpponentShipClasses: state?.sunkOpponentShipClasses ?? [],
    shipsLost,
    incomingShots: incoming,
    result: completed?.result ?? completed?.outcome ?? null,
  };
}

export function printSummary(result: any, games: any[]): void {
  console.log("\n================= ATTEMPT SUMMARY =================");
  if (result) {
    console.log(`finalScore : ${result.finalScore}`);
    console.log(`wins/losses: ${result.wins}/${result.losses}`);
    console.log(`hitDiff    : ${result.hitDifferential ?? "?"}`);
    console.log(`oppSunk    : ${result.opponentShipsSunk ?? "?"}`);
    console.log(`shipsLost  : ${result.agentShipsLost ?? "?"}`);
    console.log(`newBest    : ${result.isNewBest ?? "?"}`);
  }
  console.log("\nper-game:");
  console.log("  ord  opponent              cls      shots hits sunk lost  in");
  for (const g of games) {
    console.log(
      `  ${String(g.gameOrdinal).padStart(3)}  ${String(g.opponent ?? "?").padEnd(20)} ${String(g.opponentClass ?? "?").padEnd(8)} ${String(g.shots).padStart(5)} ${String(g.hits).padStart(4)} ${String(g.shipsSunk).padStart(4)} ${String(g.shipsLost).padStart(4)} ${String(g.incomingShots ?? "?").padStart(3)}`,
    );
  }
  console.log("==================================================\n");
}
