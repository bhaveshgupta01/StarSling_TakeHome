// Auth core: one shared AgentAuthClient + a signed-fetch helper that mints a
// FRESH single-use JWT for every request (guide §15 anti-pattern #1: never reuse).
//
// JWT signing (confirmed by the official challenge prompt):
//  - Sign PLAIN: signJwt({ agentId, capabilities: CAPS }) — no audience/DPoP
//    binding. Server intersects JWT caps with grants, so we MUST pass the FULL
//    capability list every request, or any omitted cap → 403 (bites getRules).
//  - AUTH_AUD_MODE=url is kept only as an emergency fallback (adds aud+htm/htu).
// Non-2xx responses log status + x-request-id so any mismatch is visible.
import { AgentAuthClient, KVStorage } from "@auth/agent";
import { fileKVStore } from "./storage.ts";

export const SERVER = "https://intern-battleship-game-server.vercel.app";
export const ISSUER = `${SERVER}/api/auth`;
export const COMP_ID =
  "295cccc9137b5335cc581d67d655d6fa3b41dac6610dad0e7ed201625523ad8c";

// Capabilities requested at connect time (getCompetitionRules is auto-granted).
export const CAPS = [
  "getCompetitionRules",
  "createAttempt",
  "getCurrentAttempt",
  "placeShips",
  "submitShot",
  "abandonAttempt",
];

const AGENT_ID_KEY = "battleships:agentId";
const AUD_MODE = process.env.AUTH_AUD_MODE ?? "plain"; // "plain" | "url"

let _client: AgentAuthClient | null = null;

export function getClient(): AgentAuthClient {
  if (_client) return _client;
  _client = new AgentAuthClient({
    storage: new KVStorage(fileKVStore),
    hostName: "StarSling Battleships Agent",
    allowDirectDiscovery: true,
    onApprovalRequired: async (info) => {
      console.log("\n================ HUMAN APPROVAL REQUIRED ================");
      console.log("Open this URL in a browser and approve the agent:\n");
      console.log("  " + (info.verification_uri_complete ?? info.verification_uri));
      if (info.user_code) console.log("\n  user_code: " + info.user_code);
      console.log("\nWaiting for approval (polling)…");
      console.log("========================================================\n");
    },
  });
  return _client;
}

export async function saveAgentId(agentId: string): Promise<void> {
  await fileKVStore.set(AGENT_ID_KEY, agentId);
}

export async function getAgentId(): Promise<string> {
  const id = await fileKVStore.get(AGENT_ID_KEY);
  if (!id) {
    throw new Error(
      "No agentId found. Run `npm run auth` first to connect + approve the agent.",
    );
  }
  return id;
}

export interface SignedResponse {
  status: number;
  requestId: string | null;
  body: any;
}

// Mint a fresh JWT and make one authenticated request. Returns parsed body
// loosely (never throws on shape) so the caller's state machine sees raw data.
export async function signedFetch(
  method: "GET" | "POST",
  url: string,
  capability: string,
  agentId: string,
  body?: unknown,
): Promise<SignedResponse> {
  const client = getClient();

  // Always sign with the FULL capability list (server intersects with grants).
  const signOpts: any = { agentId, capabilities: CAPS };
  if (AUD_MODE === "url") {
    signOpts.audience = url;
    signOpts.htm = method;
    signOpts.htu = url;
  }

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  // Retry only transient failures (5xx or network error). The JWT is single-use
  // and minted fresh per attempt above-on-retry; a 5xx means the request was not
  // applied server-side, so re-firing the same shot is safe. 4xx never retries.
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { token } = await client.signJwt(signOpts); // fresh single-use JWT
      headers.Authorization = `Bearer ${token}`;
      res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status < 500) break; // success or a 4xx we must not retry
    } catch (err) {
      lastErr = err;
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  if (!res) throw lastErr ?? new Error("request failed after retries");

  const requestId = res.headers.get("x-request-id");
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* leave as raw text */
  }

  if (!res.ok) {
    console.error(
      `[HTTP ${res.status}] ${method} ${url} cap=${capability} x-request-id=${requestId}`,
    );
    console.error("  body:", typeof parsed === "string" ? parsed : JSON.stringify(parsed));
  }

  return { status: res.status, requestId, body: parsed };
}
