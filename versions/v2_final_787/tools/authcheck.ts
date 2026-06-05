// Quick auth diagnostic: print agent status + try a single /rules call.
import { getClient, getAgentId, SERVER, COMP_ID, CAPS } from "../src/auth.ts";

const agentId = await getAgentId();
const client = getClient();
try {
  const st = await client.agentStatus(agentId);
  console.log("agentStatus:", JSON.stringify(st));
} catch (e) {
  console.log("agentStatus error:", (e as Error).message);
}
const { token } = await client.signJwt({ agentId, capabilities: CAPS });
const res = await fetch(`${SERVER}/competitions/${COMP_ID}/rules`, {
  headers: { Authorization: `Bearer ${token}` },
});
console.log("rules status:", res.status, "x-request-id:", res.headers.get("x-request-id"));
console.log("body:", (await res.text()).slice(0, 200));
