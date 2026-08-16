import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { toId } from "./utils.js";

// Lifetime per-player records, accumulated across finished games. Persisted to
// `records.json` (repo root) so the leaderboard survives bot restarts.
export interface RecordEntry {
  name: string;
  kills: number;
  wins: number;
  games: number;
}

const records = new Map<string, RecordEntry>();

let file = join(fileURLToPath(new URL("..", import.meta.url)), "records.json");

// Point persistence at another file (used by tests and a future config option).
export function setRecordsFile(path: string): void {
  file = path;
}

// Fold a finished game into the leaderboard. Skips monsters; only human
// players accrue records. In-memory only — call saveRecords() to persist.
export function recordGame(game: {
  winner: string | null;
  kills: Record<string, number>;
  entities: { num: string; name: string; isMonster: boolean }[];
}): void {
  for (const e of game.entities) {
    if (e.isMonster) continue;
    const key = toId(e.name);
    const rec = records.get(key) ?? { name: e.name, kills: 0, wins: 0, games: 0 };
    rec.name = e.name;
    rec.kills += game.kills[e.num] ?? 0;
    rec.games += 1;
    if (e.num === game.winner) rec.wins += 1;
    records.set(key, rec);
  }
}

// Top N by wins, then kills, then games.
export function getRecords(limit = 10): RecordEntry[] {
  return [...records.values()]
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.kills - a.kills ||
        b.games - a.games ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

// One player's lifetime record (by name), or null.
export function getRecord(name: string): RecordEntry | null {
  return records.get(toId(name)) ?? null;
}

// Clear the leaderboard (dev `%records reset` and tests).
export function resetRecords(): void {
  records.clear();
}

// Load persisted records from disk; missing/corrupt files start fresh.
export function loadRecords(): void {
  if (!existsSync(file)) return;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as RecordEntry[];
    for (const r of data) {
      if (r && typeof r.name === "string") {
        records.set(toId(r.name), {
          name: r.name,
          kills: r.kills || 0,
          wins: r.wins || 0,
          games: r.games || 0,
        });
      }
    }
  } catch {
    // Ignore a corrupt records file rather than crash the bot on boot.
  }
}

// Write the leaderboard to disk.
export function saveRecords(): void {
  writeFileSync(file, JSON.stringify([...records.values()], null, 2));
}
