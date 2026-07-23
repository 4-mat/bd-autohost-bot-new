import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const STATE_DIR = join(import.meta.dirname, "../../.sheets-state");

interface StoredState {
  hash: string;
  timestamp: string;
  sheets: Record<string, string>;
}

function ensureDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

function statePath(name: string) {
  return join(STATE_DIR, `${name}.json`);
}

export function loadState(name: string): StoredState | null {
  const p = statePath(name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

export function saveState(name: string, data: Record<string, string>) {
  ensureDir();
  const hash = createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
  const state: StoredState = {
    hash,
    timestamp: new Date().toISOString(),
    sheets: data,
  };
  writeFileSync(statePath(name), JSON.stringify(state, null, 2) + "\n");
}

export function stateHash(data: Record<string, string>): string {
  return createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
}
