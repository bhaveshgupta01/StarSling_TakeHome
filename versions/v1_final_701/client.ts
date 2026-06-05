// REST wrappers. Each mints its own fresh JWT via signedFetch. Return the raw
// parsed body (the gameplay envelope) so agent.ts can switch on responseType.
import { signedFetch, SERVER, COMP_ID } from "./auth.ts";

const BASE = `${SERVER}/competitions/${COMP_ID}`;

export async function getRules(agentId: string) {
  const r = await signedFetch("GET", `${BASE}/rules`, "getCompetitionRules", agentId);
  return r.body;
}

export async function createAttempt(agentId: string) {
  // NO body — a JSON content-type on an empty body returns 422 MALFORMED_REQUEST.
  const r = await signedFetch("POST", `${BASE}/attempts`, "createAttempt", agentId);
  return r.body;
}

export async function getCurrentAttempt(agentId: string) {
  const r = await signedFetch(
    "GET",
    `${BASE}/attempts/current`,
    "getCurrentAttempt",
    agentId,
  );
  return r.body;
}

export async function placeShips(agentId: string, placements: unknown[]) {
  const r = await signedFetch(
    "POST",
    `${BASE}/attempts/current/placements`,
    "placeShips",
    agentId,
    { placements },
  );
  return r.body;
}

export async function submitShot(agentId: string, row: number, col: number) {
  const r = await signedFetch(
    "POST",
    `${BASE}/attempts/current/shots`,
    "submitShot",
    agentId,
    { row, col },
  );
  return r.body;
}

export async function abandonAttempt(agentId: string) {
  const r = await signedFetch(
    "POST",
    `${BASE}/attempts/current/abandon`,
    "abandonAttempt",
    agentId,
  );
  return r.body;
}
