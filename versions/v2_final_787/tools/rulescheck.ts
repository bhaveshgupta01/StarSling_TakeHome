// Minimal: mint one fresh JWT, call /rules, print status only.
import { getClient, getAgentId, SERVER, COMP_ID, CAPS } from "../src/auth.ts";
const agentId = await getAgentId();
const { token } = await getClient().signJwt({ agentId, capabilities: CAPS });
const res = await fetch(`${SERVER}/competitions/${COMP_ID}/rules`, {
  headers: { Authorization: `Bearer ${token}` },
});
console.log("RULES_STATUS", res.status);
