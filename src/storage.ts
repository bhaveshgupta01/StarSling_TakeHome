// File-backed KVStore so the agent keypair + agentId survive process exit.
// MemoryStorage would force a fresh human approval on every run; this does not.
// Plain object literal satisfying @auth/agent's KVStore interface — no classes.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { KVStore } from "@auth/agent";

const CREDS_PATH = new URL("../.agent-credentials.json", import.meta.url).pathname;

function load(): Record<string, string> {
  if (!existsSync(CREDS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CREDS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function save(data: Record<string, string>): void {
  writeFileSync(CREDS_PATH, JSON.stringify(data, null, 2));
}

export const fileKVStore: KVStore = {
  async get(key) {
    return load()[key] ?? null;
  },
  async set(key, value) {
    const data = load();
    data[key] = value;
    save(data);
  },
  async del(key) {
    const data = load();
    delete data[key];
    save(data);
  },
};

export const CREDS_FILE = CREDS_PATH;
