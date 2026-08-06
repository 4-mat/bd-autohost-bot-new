// Recommended curated maps per game mode.
//
// Hosts always pick maps freely via %setmap / %listmaps — these pools are
// suggestions surfaced by %listmaps so a host setting up a game for a
// particular mode can quickly find a fitting map. Every name must exist in
// `src/data/maps.ts` (enforced by src/__tests__/gamemodes.test.ts).

export type GameModeId = "ffa" | "ntr" | "jugg" | "pvp" | "1v1";

export const GAMEMODE_MAPS: Record<GameModeId, string[]> = {
  // Free-for-all: varied, open mid-size maps with fun terrain.
  ffa: [
    "arena",
    "battledome",
    "colosseum",
    "moshpit",
    "skytemple",
    "squiggle",
    "sunsets",
    "zonestelu",
    "tictactoe",
    "stonehenge",
  ],
  // NTR (hold the centre): maps with strong central features / rings.
  ntr: [
    "ntr",
    "realntr",
    "fusioncore",
    "clover",
    "donut",
    "ringoffire",
    "miniring",
    "pinering",
    "combatring",
  ],
  // Juggernaut: mid-size maps with cover so the field can hide from the jugg.
  jugg: [
    "madhouse",
    "volcano",
    "demonsheart",
    "lavaflows",
    "corridor",
    "hidenseek",
    "amazeing",
    "yggdrasil",
  ],
  // Team-vs-team: symmetric maps with clear lanes / halves.
  pvp: [
    "islands",
    "trench",
    "trenches",
    "frostbite",
    "valley",
    "canyon",
    "junction",
    "hallways",
    "fortress",
    "snowyvillage",
  ],
  // 1v1 duels: small, tight, symmetric maps.
  "1v1": [
    "duelingground",
    "duel",
    "arena",
    "miniarena",
    "minicrossroads",
    "combatring",
    "tinyring",
    "crossout",
  ],
};

const ALIASES: Record<string, GameModeId> = {
  ffa: "ffa",
  ntr: "ntr",
  jugg: "jugg",
  juggernaut: "jugg",
  pvp: "pvp",
  duel: "1v1",
  "1v1": "1v1",
};

/**
 * Resolve a free-form mode string (e.g. from `game.mode` or a `%listmaps`
 * argument) to one of the designated mode ids. Any "NvN" team mode (2v2, 3v3,
 * ...) maps to "pvp"; unrecognized modes return undefined.
 */
export function modeIdFor(mode: string): GameModeId | undefined {
  const key = mode.trim().toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  if (/^\d+v\d+$/.test(key)) return "pvp";
  return undefined;
}

/**
 * Recommended map-name pool for a mode string, or undefined when the mode has
 * no designated pool.
 */
export function recommendedMaps(mode: string): string[] | undefined {
  const id = modeIdFor(mode);
  return id ? [...GAMEMODE_MAPS[id]] : undefined;
}

/**
 * Pick a random map name from the designated pool for a mode string, or
 * undefined when the mode has no pool. Used by `%setmap <gamemode>`.
 */
export function randomMapForMode(mode: string): string | undefined {
  const id = modeIdFor(mode);
  if (!id) return undefined;
  const pool = GAMEMODE_MAPS[id];
  return pool[Math.floor(Math.random() * pool.length)];
}

// -- Game-mode voting --------------------------------------------------------
//
// Players vote on the game mode from the GUI after the host closes signups
// (%close). Options are filtered by the number of joined players so an
// impossible mode (e.g. 3v3 with 4 players) is never offered.

export interface VoteOption {
  /** Canonical mode string stored on the game (e.g. "FFA", "2v2"). */
  id: string;
  /** Friendly display label. */
  label: string;
  /** Minimum joined players for this option. */
  minPlayers: number;
  /** When set, this option requires EXACTLY this many players. */
  exactPlayers?: number;
}

export const VOTE_OPTIONS: VoteOption[] = [
  { id: "FFA", label: "Free For All", minPlayers: 2 },
  { id: "1v1", label: "1v1", minPlayers: 2, exactPlayers: 2 },
  { id: "2v2", label: "2v2", minPlayers: 4, exactPlayers: 4 },
  { id: "3v3", label: "3v3", minPlayers: 6, exactPlayers: 6 },
  { id: "NTR", label: "NTR", minPlayers: 2 },
  { id: "JUGG", label: "Juggernaut", minPlayers: 2 },
];

const VOTE_ALIASES: Record<string, string> = {
  ffa: "FFA",
  "free for all": "FFA",
  "1v1": "1v1",
  duel: "1v1",
  "2v2": "2v2",
  "3v3": "3v3",
  ntr: "NTR",
  jugg: "JUGG",
  juggernaut: "JUGG",
  jug: "JUGG",
};

/**
 * Resolve a free-form vote argument to a canonical vote-mode id, or undefined
 * when it matches nothing.
 */
export function normalizeVoteMode(arg: string): string | undefined {
  const key = arg.trim().toLowerCase().replace(/\s+/g, " ");
  return VOTE_ALIASES[key];
}

/**
 * Vote options valid for a given joined-player count: exact-count modes
 * (1v1/2v2/3v3) are only offered when the lobby matches exactly.
 */
export function voteOptionsFor(playerCount: number): VoteOption[] {
  return VOTE_OPTIONS.filter((o) => {
    if (playerCount < o.minPlayers) return false;
    if (o.exactPlayers !== undefined && playerCount !== o.exactPlayers)
      return false;
    return true;
  });
}

/**
 * Tally a votes map (entity num -> mode id) into a sorted list, highest first.
 */
export function tallyVotes(votes: Record<string, string>): {
  mode: string;
  count: number;
}[] {
  const counts = new Map<string, number>();
  for (const mode of Object.values(votes)) {
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => b.count - a.count);
}
