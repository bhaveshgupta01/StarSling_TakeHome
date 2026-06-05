// Print the authoritative scoringConstants + opponentRoster from /rules.
import { getClient, getAgentId, SERVER, COMP_ID, CAPS } from "../src/auth.ts";
const agentId = await getAgentId();
const { token } = await getClient().signJwt({ agentId, capabilities: CAPS });
const res = await fetch(`${SERVER}/competitions/${COMP_ID}/rules`, {
  headers: { Authorization: `Bearer ${token}` },
});
const r: any = await res.json();
console.log("status", res.status);
console.log("displayName:", r.displayName);
console.log("turnTimeoutSeconds:", r.turnTimeoutSeconds);
console.log("boardRules.shipClasses:", JSON.stringify(r.boardRules?.shipClasses));
console.log("scoringConstants:", JSON.stringify(r.scoringConstants, null, 2));
const roster = r.opponentRoster ?? [];
console.log("opponentRoster length:", roster.length);
console.log(
  "roster:",
  JSON.stringify(roster.map((o: any) => [o.displayName, o.opponentClass, o.baseScore])),
);
const names = roster.map((o: any) => o.displayName);
console.log("distinct opponents:", new Set(names).size, "of", names.length);
