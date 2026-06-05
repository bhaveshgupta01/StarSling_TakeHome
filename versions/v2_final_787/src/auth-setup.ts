// One-time auth: connect the agent, trigger human approval, persist agentId.
// Run once with `npm run auth`. The approval is persisted server-side and the
// keypair is persisted locally (storage.ts), so `npm run play` reuses it.
//
// loginHint = the allowlisted account you approve with in the browser.
import { getClient, saveAgentId, SERVER, CAPS } from "./auth.ts";

const LOGIN_HINT = process.env.LOGIN_HINT ?? "bg2896@nyu.edu";

async function main() {
  const client = getClient();

  // discoverProvider appends /.well-known/agent-configuration to this URL, so
  // pass the SERVER ROOT (the doc lives there), not the /api/auth issuer.
  console.log("Discovering provider…");
  const provider = await client.discoverProvider(SERVER);
  console.log("  issuer:", provider.issuer);

  console.log("Connecting agent (will prompt for approval)…");
  const connected = await client.connectAgent({
    provider: provider.issuer,
    capabilities: CAPS.map((name) => ({ name })),
    loginHint: LOGIN_HINT,
    forceApproval: true,
  });

  await saveAgentId(connected.agentId);
  console.log("\n✅ Connected.");
  console.log("  agentId:", connected.agentId);
  console.log("  status :", connected.status);
  console.log("  grants :", JSON.stringify(connected.capabilityGrants));
  console.log("\nSaved. You can now run `npm run play`.");
}

main().catch((err) => {
  console.error("Auth setup failed:", err);
  process.exit(1);
});
