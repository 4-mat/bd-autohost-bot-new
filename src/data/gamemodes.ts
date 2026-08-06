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
