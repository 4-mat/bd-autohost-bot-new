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
  // BD 4.4 modes: Juggernaut-family modes use jugg (cover) maps, team NTR
  // uses ntr (central-feature) maps, and PvP-family modes use pvp maps.
  "2vj": "jugg",
  "3vj": "jugg",
  "4vj": "jugg",
  pvpj: "pvp",
  "pvp juggernaut": "pvp",
  pvpntr: "ntr",
  "pvp ntr": "ntr",
  "2v2v2": "pvp",
  "4v4": "pvp",
  "2v2v2v2": "pvp",
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
  /** Canonical mode string stored on the game (e.g. "FFA", "2v2", "PvPJ"). */
  id: string;
  /** Friendly display label. */
  label: string;
  /** Short one-line explanation shown in the GUI and via %wt modes. */
  description: string;
  /** Minimum joined players for this option. */
  minPlayers: number;
  /**
   * When set, this option requires EXACTLY this many players — either a single
   * count or a list of allowed counts (e.g. PvPJ supports 5 or 7).
   */
  exactPlayers?: number | number[];
}

export const VOTE_OPTIONS: VoteOption[] = [
  {
    id: "FFA",
    label: "Free For All",
    description: "Everyone for themselves — last player standing wins.",
    minPlayers: 2,
  },
  {
    id: "1v1",
    label: "1v1",
    description: "A one-on-one duel — the match ends when one player dies.",
    minPlayers: 2,
    exactPlayers: 2,
  },
  {
    id: "2v2",
    label: "2v2",
    description: "Two teams of two — last team standing wins.",
    minPlayers: 4,
    exactPlayers: 4,
  },
  {
    id: "3v3",
    label: "3v3",
    description: "Two teams of three — last team standing wins.",
    minPlayers: 6,
    exactPlayers: 6,
  },
  {
    id: "4v4",
    label: "4v4",
    description: "Two teams of four — last team standing wins.",
    minPlayers: 8,
    exactPlayers: 8,
  },
  {
    id: "2v2v2",
    label: "2v2v2",
    description: "Three teams of two — last team standing wins.",
    minPlayers: 6,
    exactPlayers: 6,
  },
  {
    id: "2v2v2v2",
    label: "2v2v2v2",
    description: "Four teams of two — last team standing wins.",
    minPlayers: 8,
    exactPlayers: 8,
  },
  {
    id: "NTR",
    label: "NTR",
    description: "Nowhere To Run — players must stay near the centre of the map.",
    minPlayers: 2,
  },
  {
    id: "JUGG",
    label: "Juggernaut",
    description: "One player is a super-powered Juggernaut; everyone else works together to take them down.",
    minPlayers: 2,
  },
  {
    id: "2vJ",
    label: "2vJ",
    description: "Two players vs a Juggernaut.",
    minPlayers: 3,
    exactPlayers: 3,
  },
  {
    id: "3vJ",
    label: "3vJ",
    description: "Three players vs a Juggernaut.",
    minPlayers: 4,
    exactPlayers: 4,
  },
  {
    id: "4vJ",
    label: "4vJ",
    description: "Four players vs a Juggernaut.",
    minPlayers: 5,
    exactPlayers: 5,
  },
  {
    id: "PvPJ",
    label: "PvPJ",
    description: "PvP + Juggernaut — two teams fight and one team gets a Juggernaut character (2v3 or 3v4).",
    minPlayers: 5,
    exactPlayers: [5, 7],
  },
  {
    id: "PvPNTR",
    label: "PvP NTR",
    description: "Team-based NTR — teams fight to hold the centre (2v2, 3v3, 2v2v2 or 4v4).",
    minPlayers: 4,
    exactPlayers: [4, 6, 8],
  },
];

/**
 * Human-readable blurb for a single mode, or undefined when the argument
 * doesn't resolve to a known vote mode. Used by `%wt <mode>`.
 */
export function modeDescription(arg: string): string | undefined {
  const id = normalizeVoteMode(arg);
  const opt = VOTE_OPTIONS.find((o) => o.id === id);
  return opt ? `**${opt.id}** (${opt.label}): ${opt.description}` : undefined;
}

/**
 * Formatted list of every known mode with its description, used by
 * `%wt modes` so players can learn what they are voting on.
 */
export function describeModes(): string {
  return VOTE_OPTIONS.map((o) => `**${o.id}** (${o.label}) — ${o.description}`).join(
    "\n",
  );
}

const VOTE_ALIASES: Record<string, string> = {
  ffa: "FFA",
  "free for all": "FFA",
  "1v1": "1v1",
  duel: "1v1",
  "2v2": "2v2",
  "3v3": "3v3",
  "4v4": "4v4",
  "2v2v2": "2v2v2",
  "2v2v2v2": "2v2v2v2",
  ntr: "NTR",
  jugg: "JUGG",
  juggernaut: "JUGG",
  jug: "JUGG",
  "2vj": "2vJ",
  "3vj": "3vJ",
  "4vj": "4vJ",
  pvpj: "PvPJ",
  "pvp juggernaut": "PvPJ",
  pvpntr: "PvPNTR",
  "pvp ntr": "PvPNTR",
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
 * (1v1/2v2/PvPJ...) are only offered when the lobby matches exactly.
 */
export function voteOptionsFor(playerCount: number): VoteOption[] {
  return VOTE_OPTIONS.filter((o) => {
    if (playerCount < o.minPlayers) return false;
    if (o.exactPlayers !== undefined) {
      const allowed = Array.isArray(o.exactPlayers)
        ? o.exactPlayers
        : [o.exactPlayers];
      if (!allowed.includes(playerCount)) return false;
    }
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
