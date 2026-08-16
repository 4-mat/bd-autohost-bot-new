import { toId } from "./utils.js";

// Lifetime per-player records, accumulated across finished games. In-memory
// only: the leaderboard resets when the bot restarts (see FEATURES-3.md for a
// disk-persistence follow-up).
export interface RecordEntry {
  name: string;
  kills: number;
  wins: number;
  games: number;
}

const records = new Map<string, RecordEntry>();

// Fold a finished game into the lifetime leaderboard. Skips monsters; only
// human players accrue records.
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

// Clear the leaderboard (used by tests and a future `%records reset`).
export function resetRecords(): void {
  records.clear();
}
