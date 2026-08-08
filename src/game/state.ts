/**
 * Game state management and core logic for bd-autohost-bot-new.
 *
 * Exports:
 * - Terrain enum + color/names lookups
 * - Entity, Game, AbilityData interfaces
 * - State functions (move, attack, turn management, pathfinding)
 * - Damage resolution, status effects, cooldowns
 * - Game-over detection and loot calculation
 *
 * Import: `import { games, Entity, Terrain } from "../game/state.js"`
 * or `import { rollDice, toId } from "../utils.js"`
 */
import { rollDice, posToStr, toId } from "../utils.js";
import { send, sendPm } from "../utils.js";
import { rooms } from "../rooms.js";
import type { GameVersion } from "../data/index.js";
import type {
  AttackPrompt,
  ResolutionResult,
  PromptResponse,
} from "./resolve.js";
import { matchesTargetGroup } from "./targeting.js";

// Terrain types from the game rules
export enum Terrain {
  Normal = 0,
  Stop = 1,
  Water = 2,
  Forest = 3,
  Ice = 4,
  Air = 5,
  Sticky = 6,
  Lava = 7,
  Broken = 8,
  Bone = 9,
  Stone = 10,
  Hearth = 11,
  Boost = 12,
}

export const TERRAIN_COLORS: Record<number, string> = {
  [Terrain.Normal]: "#A9F5A9",
  [Terrain.Stop]: "#A9A9A9",
  [Terrain.Water]: "#454FDF",
  [Terrain.Forest]: "#226622",
  [Terrain.Ice]: "#33E9E9",
  [Terrain.Air]: "#B8D3DE",
  [Terrain.Sticky]: "#CCCC00",
  [Terrain.Lava]: "#8B0000",
  [Terrain.Broken]: "#000000",
  [Terrain.Bone]: "#CCCCAA",
  [Terrain.Stone]: "#888888",
  [Terrain.Hearth]: "#FF6633",
  [Terrain.Boost]: "#A855F7",
};

export const TERRAIN_NAMES: Record<number, string> = {
  [Terrain.Normal]: "Normal",
  [Terrain.Stop]: "Stop",
  [Terrain.Water]: "Water",
  [Terrain.Forest]: "Forest",
  [Terrain.Ice]: "Ice",
  [Terrain.Air]: "Air",
  [Terrain.Sticky]: "Sticky",
  [Terrain.Lava]: "Lava",
  [Terrain.Broken]: "Broken",
  [Terrain.Bone]: "Bone",
  [Terrain.Stone]: "Stone",
  [Terrain.Hearth]: "Hearth",
  [Terrain.Boost]: "Boost",
};

// Per the BD 4.4 glossary (Map -> Obstructions): "Stop/Bone, Ice, Stone, and
// Hearth tiles, as well as foes, are considered obstructions." Obstructions
// block movement, targeting (Range Rule), and cannot be ended turns on.
// NOTE: Broken is NOT an obstruction — it is merely impassable to movement
// ("cannot be moved through, and turns cannot be ended on them").
export function isObstruction(t: Terrain): boolean {
  return (
    t === Terrain.Stop ||
    t === Terrain.Bone ||
    t === Terrain.Ice ||
    t === Terrain.Stone ||
    t === Terrain.Hearth
  );
}

// Tiles that cannot be moved through or stood on: obstructions (glossary) plus
// Broken (impassable per the glossary, though not itself an obstruction) and
// Lava (damages on entry — never a valid destination).
export function isStandable(t: Terrain): boolean {
  return !isObstruction(t) && t !== Terrain.Broken && t !== Terrain.Lava;
}

export function moveCost(t: Terrain, base = 1): number {
  if (t === Terrain.Sticky) return base + 1;
  if (t === Terrain.Boost) return Math.max(0, base - 1);
  return base;
}

export interface StatusEffect {
  name: string;
  damage: number;
  rounds: number;
  maxRounds: number;
  removable: boolean;
}

export interface AbilityCost {
  type: "HP" | "MP" | "Resource";
  amount: number;
  resource?: string;
  prompt?: boolean;
}

export interface AbilityChoice {
  id: string;
  label: string;
}

export interface AbilityData {
  name: string;
  level: number | "EX1" | "EX2";
  frequency: string;
  mr: number;
  roll: string;
  damageType: "Physical" | "Magical" | "Varies" | "";
  actionType:
    | "Standard"
    | "Full"
    | "Movement"
    | "Swift"
    | "Free"
    | "Trigger"
    | "Reaction"
    | "Passive";
  targetAmount: number | "AoE";
  targetGroup: string;
  range: string;
  effect: string;
  maxUses?: number;
  cost?: AbilityCost;
  choices?: AbilityChoice[];
  variants?: {
    id: string;
    label: string;
    damageType: "Physical" | "Magical";
    range?: string;
    effect?: string;
  }[];
}

// Parse an ability frequency into a per-battle use limit and a cooldown in turns.
// Handles both compact data forms ("Once", "Twice/EoT", "E3T") and spec forms
// ("Twice, Every Other Turn", "Once (Permanent)", "X per Game: 3").
export function parseFrequency(frequency: string) {
  const f = frequency.toLowerCase().replace(/\s*,\s*/g, "/");
  let uses: number | null = null;
  let cooldown: number | null = null;

  const perGame = f.match(/(\d+)\s*per game/);
  if (perGame) {
    uses = parseInt(perGame[1]);
  } else if (f.includes("once")) {
    uses = 1;
  } else if (f.includes("twice")) {
    uses = 2;
  } else if (f.includes("thrice")) {
    uses = 3;
  }

  // BD frequency semantics (do not "fix" E2T to 2):
  // "EoT" = every other turn (cooldown 2). In BD 4.3, "E2T" is equivalent to
  // BD 4.4's "E3T" (every 3rd turn) and shares the cooldown of 3, despite the
  // abbreviation. "every two turns" likewise maps to 3.
  if (f.includes("every other turn") || f.includes("eot")) {
    cooldown = 2;
  } else if (
    f.includes("every third turn") ||
    f.includes("every two turns") ||
    f.includes("e3t") ||
    f.includes("e2t")
  ) {
    cooldown = 3;
  }

  return { uses, cooldown };
}

/**
 * An attack queued by a Delay-N clause in an ability's effect text.
 *
 * BD 4.4 delay semantics (Clairvoyant): "Delay moves have their damage and
 * effects delayed for a specified number of rounds, landing at the start of
 * the user's turn. Damage is rolled when the move is used." So the damage
 * number is fixed at use time, the attack sits in `delayedAttacks` for N of
 * the user's own turn cycles, and at the start of the user's turn (the
 * `landDelayedAttacks` hook in the command layer) it deals the stored damage
 * and re-applies the ability's on-hit effects against the landing-time board.
 *
 * Stored on the caster — the queue is dropped if the caster dies (only the
 * Future Sight passive "Delay attacks always land ... even if the user is
 * dead" would preserve it, and that isn't modelled yet).
 */
export interface DelayedAttack {
  ability: AbilityData;
  targetNum: string;
  /** Damage rolled at use time (after crit + damage modifiers). */
  damage: number;
  /** Decremented each time the caster's turn starts; the attack lands at 0. */
  roundsLeft: number;
}

export interface Entity {
  num: string; // P1, P2, M1, M2...
  name: string;
  id: string;
  isMonster: boolean;
  isJuggernaut?: boolean;
  curhp: number;
  maxhp: number;
  atk: number;
  mag: number;
  pd: number;
  md: number;
  eva: number;
  mp: number;
  pos: [number, number];
  team: number;
  className: string;
  weaponName: string;
  classLevel: number;
  weaponLevel: number;
  abilities: AbilityData[];
  statuses: StatusEffect[];
  buffs: { stat: string; amount: number; rounds: number }[];
  cooldowns: Record<string, number>;
  usesUsed: Record<string, number>;
  pendingAction: PendingAction | null;
  dashUsed: boolean;
  standardUsed: boolean;
  movementUsed: boolean;
  swiftUsed: boolean;
  resources: Record<string, number>;
  /** Attacks queued by Delay-N clauses; landed by `landDelayedAttacks`. */
  delayedAttacks?: DelayedAttack[];
  triggered?: boolean;
  pendingResolution?: Generator<AttackPrompt, ResolutionResult, PromptResponse>;
  pendingPromptKind?: AttackPrompt["kind"];
  pendingPrompt?: AttackPrompt;
}

export interface PendingAction {
  type: "move" | "dash" | "attack" | "ability" | "endturn";
  ability?: AbilityData;
  target?: string; // entity num
  targetPos?: [number, number];
  position?: [number, number];
  direction?: string; // cardinal direction for cone/line/beam/pierce
}

export const DIRECTION_LABELS: Record<string, string> = {
  up: "\u2191 Up",
  down: "\u2193 Down",
  left: "\u2190 Left",
  right: "\u2192 Right",
};

export function needsDirection(ability: AbilityData): boolean {
  const r = ability.range.toLowerCase().trim();
  return /^(cone|line|beam|pierce)\b/.test(r);
}

export function getDirectionCandidates(): string[] {
  return ["up", "down", "left", "right"];
}

export function placeTerrain(
  map: number[][],
  pos: [number, number],
  terrain: number,
): void {
  const [r, c] = pos;
  if (r >= 0 && r < map.length && c >= 0 && c < map[0].length) {
    map[r][c] = terrain;
  }
}

export function entityOnTile(
  entities: Entity[],
  pos: [number, number],
): Entity | undefined {
  return entities.find(
    (e) => e.pos[0] === pos[0] && e.pos[1] === pos[1] && e.curhp > 0,
  );
}

export interface ActionLogEntry {
  turn: number;
  entity: string;
  description: string;
  snapshot: string;
}

export interface ChatEntry {
  user: string;
  message: string;
  /** Epoch ms when the message was received. Optional for snapshot compat. */
  time?: number;
}

/** Format an epoch-ms timestamp as "[HH:MM]" (empty string when missing). */
export function formatChatTime(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `[${hh}:${mm}]`;
}

export interface Game {
  id: string;
  room: string;
  host: string;
  version: GameVersion;
  entities: Entity[];
  map: Terrain[][];
  mapName: string;
  turnOrder: string[]; // entity nums in order
  turnIndex: number;
  round: number;
  log: ActionLogEntry[];
  snapshots: string[];
  mode: string;
  /** Whether the gamemode was explicitly chosen (%setgame, the vote, or %genpos). */
  modeChosen?: boolean;
  /** Host toggle: hide the Setup panel's always-available %setgame ffa shortcut. */
  hideFfaShortcut?: boolean;
  phase: "setup" | "playing" | "ended";
  started: boolean;
  kills: Record<string, number>; // entity num -> kill count
  winner: string | null; // winning entity num or team
  chatLog: ChatEntry[];
  toasts: ChatEntry[];
  signupsOpen: boolean;
  /** Gamemode votes: entity num -> voted mode id. Active between %close and %endvote. */
  votes: Record<string, string>;
  /** Whether gamemode voting is open (opened by %close, closed by %endvote). */
  voteOpen: boolean;
  /** Set by removeEntity when the current actor is removed mid-turn, so nextTurn skips no one. */
  removedCurrentActor?: boolean;
  /**
   * Modes allowed in a runoff after a tied %endvote (empty/null when no
   * runoff is active). Only these can be voted on while set.
   */
  voteRunoff: string[] | null;
  /** Active shot-clock/timer: the entity it's on (null = global) and when it ends. */
  timer?: { entity: string | null; endAt: number } | null;
}

export const games = new Map<string, Game>();

function serializeState(game: Game): string {
  return JSON.stringify({
    entities: game.entities.map((e) => ({
      num: e.num,
      name: e.name,
      curhp: e.curhp,
      maxhp: e.maxhp,
      pos: e.pos,
      team: e.team,
      statuses: e.statuses,
      buffs: e.buffs,
      cooldowns: e.cooldowns,
      usesUsed: e.usesUsed,
      dashUsed: e.dashUsed,
      standardUsed: e.standardUsed,
      movementUsed: e.movementUsed,
      swiftUsed: e.swiftUsed,
      triggered: e.triggered,
      delayedAttacks: e.delayedAttacks,
    })),
    turnIndex: game.turnIndex,
    round: game.round,
    log: game.log,
  });
}

export function pushSnapshot(game: Game) {
  game.snapshots.push(serializeState(game));
  if (game.snapshots.length > 20) game.snapshots.shift();
}

export function popSnapshot(game: Game): boolean {
  const snap = game.snapshots.pop();
  if (!snap) return false;
  const data = JSON.parse(snap);
  for (const e of data.entities) {
    const ent = game.entities.find((x) => x.num === e.num);
    if (ent) {
      ent.curhp = e.curhp;
      ent.maxhp = e.maxhp;
      ent.pos = e.pos;
      ent.team = e.team;
      ent.statuses = e.statuses;
      ent.buffs = e.buffs;
      ent.cooldowns = e.cooldowns;
      ent.usesUsed = e.usesUsed;
      ent.dashUsed = e.dashUsed;
      ent.standardUsed = e.standardUsed;
      ent.movementUsed = e.movementUsed;
      ent.swiftUsed = e.swiftUsed;
      ent.triggered = e.triggered;
      ent.delayedAttacks = e.delayedAttacks;
    }
  }
  game.turnIndex = data.turnIndex;
  game.round = data.round;
  if (data.log) game.log = data.log;
  return true;
}

export function getCurrentEntity(game: Game): Entity | null {
  if (game.turnOrder.length === 0) return null;
  const num = game.turnOrder[game.turnIndex];
  return game.entities.find((e) => e.num === num) ?? null;
}

export function getEntity(game: Game, ref: string): Entity | null {
  const id = toId(ref);
  return (
    game.entities.find((e) => toId(e.num) === id || toId(e.name) === id) ?? null
  );
}

/** All living non-monster entities (human players). */
export function getHumanPlayers(game: Game): Entity[] {
  return game.entities.filter((e) => !e.isMonster);
}

/** Check whether the given user is the game's host. */
export function isHostUser(game: Game, user: { name: string }): boolean {
  return toId(user.name) === toId(game.host);
}

/** Find the game active in a given room. */
export function findGameForRoom(roomid: string): Game | null {
  for (const game of games.values()) {
    if (game.room === roomid) return game;
  }
  return null;
}

export function dist(a: [number, number], b: [number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

export function manhattan(a: [number, number], b: [number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

// BFS pathfinding considering terrain costs
// If entity is provided, uses effective MP (accounting for Slow status)
export function getReachableTiles(
  game: Game,
  start: [number, number],
  mp: number,
  entity?: Entity,
): Map<string, number> {
  // Apply Slow MP reduction if entity is provided
  const effectiveMp = entity ? getEffectiveMp(entity) : mp;
  const finalMp = Math.min(mp, effectiveMp);
  const reachable = new Map<string, number>();
  const queue: Array<{ pos: [number, number]; cost: number }> = [
    { pos: start, cost: 0 },
  ];
  const visited = new Map<string, number>();
  visited.set(posToStr(start[0], start[1]), 0);

  while (queue.length > 0) {
    const { pos, cost } = queue.shift()!;
    const key = posToStr(pos[0], pos[1]);
    if (cost > 0) reachable.set(key, cost);

    const dirs: [number, number][] = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];
    for (const [dr, dc] of dirs) {
      const nr = pos[0] + dr;
      const nc = pos[1] + dc;
      if (nr < 0 || nr >= game.map.length || nc < 0 || nc >= game.map[0].length)
        continue;

      const terrain = game.map[nr][nc];
      // Obstructions + Broken (impassable) + Lava (damages on entry).
      if (!isStandable(terrain)) continue;
      // Exclude tiles occupied by a living entity from move/dash reachability.
      if (
        game.entities.some(
          (e) => e.curhp > 0 && e.pos[0] === nr && e.pos[1] === nc,
        )
      )
        continue;

      const tileCost = moveCost(terrain);
      const newCost = cost + tileCost;
      if (newCost > finalMp) continue;

      const nk = posToStr(nr, nc);
      const prev = visited.get(nk);
      if (prev !== undefined && prev <= newCost) continue;

      visited.set(nk, newCost);
      queue.push({ pos: [nr, nc], cost: newCost });
    }
  }

  return reachable;
}

// Line of sight check for range rule
export function hasLineOfSight(
  game: Game,
  from: [number, number], // [row, col]
  to: [number, number],
): boolean {
  const dx = to[1] - from[1];
  const dy = to[0] - from[0];
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return true;

  const sx = dx / steps;
  const sy = dy / steps;

  for (let i = 1; i <= steps; i++) {
    const x = Math.round(from[1] + sx * i);
    const y = Math.round(from[0] + sy * i);
    if (x < 0 || y < 0 || y >= game.map.length || x >= game.map[0].length)
      return false;
    const t = game.map[y][x];
    if (isObstruction(t)) return false;
  }
  return true;
}

type RangeChecker = (
  game: Game,
  from: [number, number],
  to: [number, number],
  n: number,
) => boolean;

// Numeric range types, keyed by their leading word. Non-numeric types
// (melee/global) are handled before the map is consulted.
const RANGE_CHECKERS: Record<string, RangeChecker> = {
  burst: (g, f, t, n) => chebyshev(f, t) <= n,
  star: (g, f, t, n) => manhattan(f, t) <= n && hasLineOfSight(g, f, t),
  range: (g, f, t, n) => manhattan(f, t) <= n && hasLineOfSight(g, f, t),
  homing: (_g, f, t, n) => manhattan(f, t) <= n,
  line: (g, f, t, n) => onLine(f, t, n) && hasLineOfSight(g, f, t),
  pierce: (g, f, t, n) => onLine(f, t, n) && hasLineOfSight(g, f, t),
  beam: (g, f, t, n) => inBeam(g, f, t, n),
  cone: (_g, f, t, n) => inCone(f, t, n),
};

// Check if target is in range of ability
export function inRange(
  game: Game,
  from: [number, number],
  to: [number, number],
  range: string,
): boolean {
  const rangeStr = range.toLowerCase().trim();

  if (rangeStr === "" || rangeStr === "varies") return false;
  if (rangeStr === "melee") return chebyshev(from, to) <= 1;
  if (rangeStr === "global") return true;

  const n = parseInt(rangeStr.match(/(\d+)/)?.[1] ?? "");
  if (isNaN(n)) return false;

  const checker = RANGE_CHECKERS[rangeStr.split(/\s|\d/)[0]];
  return checker ? checker(game, from, to, n) : false;
}

// Chebyshev distance (max of row diff, col diff) -- diagonal counts as 1
export function chebyshev(a: [number, number], b: [number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

// Check if target is on a line (cardinal or diagonal) from origin within range
function onLine(
  from: [number, number],
  to: [number, number],
  range: number,
): boolean {
  const dr = to[0] - from[0];
  const dc = to[1] - from[1];

  // Cardinal: same row or same col
  if (dr === 0 || dc === 0) {
    return Math.abs(dr) + Math.abs(dc) <= range;
  }

  // Diagonal: abs(dr) === abs(dc)
  if (Math.abs(dr) === Math.abs(dc)) {
    // Diagonal range = X/2 rounded up per the glossary
    const diagDist = Math.abs(dr);
    return diagDist <= Math.ceil(range / 2);
  }

  return false;
}

// Check if target is in a Beam (3 tiles wide, X tiles deep)
function inBeam(
  game: Game,
  from: [number, number],
  to: [number, number],
  range: number,
): boolean {
  const dr = to[0] - from[0];
  const dc = to[1] - from[1];

  if (dr === 0 && dc === 0) return false;

  // Horizontal beam: perpendicular (row) offset <= 1, column distance 1..range
  if (Math.abs(dr) <= 1 && dc !== 0) {
    const colDist = Math.abs(dc);
    return colDist >= 1 && colDist <= range;
  }

  // Vertical beam: perpendicular (col) offset <= 1, row distance 1..range
  if (Math.abs(dc) <= 1 && dr !== 0) {
    const rowDist = Math.abs(dr);
    return rowDist >= 1 && rowDist <= range;
  }

  // Diagonal beams: center line where |dr| = |dc|, width where they differ by 1
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);
  if (Math.abs(absDr - absDc) <= 1 && absDr >= 1 && absDc >= 1) {
    return Math.max(absDr, absDc) <= range;
  }

  return false;
}

// Check if target is in a Cone (triangle in front, cardinal direction)
function inCone(
  from: [number, number],
  to: [number, number],
  range: number,
): boolean {
  const dr = to[0] - from[0];
  const dc = to[1] - from[1];

  if (dr === 0 && dc === 0) return false;

  // Cone X: triangle area in a cardinal direction
  // Cone 1 = 3 tiles in front (1 tile forward, 3 wide at base)
  // Cone 2 = Cone 1 + 5 more tiles behind = 2 deep, widening by 1 each row
  // General: at distance d forward, the width is 2*d+1

  // Determine cardinal direction (pick dominant axis)
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  if (absDr > absDc) {
    // Vertical cone (up or down)
    const forward = dr; // positive = down, negative = up
    const sideways = absDc;

    // Must be in the correct direction
    if (Math.sign(forward) === 0) return false;

    const d = Math.abs(forward);
    if (d < 1 || d > range) return false;

    // At distance d, width extends d tiles to each side (Cone X pattern)
    return sideways <= d;
  } else if (absDc > absDr) {
    // Horizontal cone (left or right)
    const forward = dc;
    const sideways = absDr;

    const d = Math.abs(forward);
    if (d < 1 || d > range) return false;

    return sideways <= d;
  }

  // Pure diagonal -- not a cardinal cone
  return false;
}

// Get all entity positions in a Burst X pattern from a center
export function getBurstTiles(
  center: [number, number],
  radius: number,
): [number, number][] {
  const tiles: [number, number][] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr === 0 && dc === 0) continue;
      tiles.push([center[0] + dr, center[1] + dc]);
    }
  }
  return tiles;
}

// Get all entity positions in a Star X pattern from a center (Manhattan <= X)
export function getStarTiles(
  center: [number, number],
  radius: number,
): [number, number][] {
  const tiles: [number, number][] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (Math.abs(dr) + Math.abs(dc) <= radius) {
        tiles.push([center[0] + dr, center[1] + dc]);
      }
    }
  }
  return tiles;
}

// Get all entity positions in a Cone from user in a cardinal direction
export function getConeTiles(
  from: [number, number],
  range: number,
): [number, number][] {
  const tiles: [number, number][] = [];
  const dirs: [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (const [dr, dc] of dirs) {
    for (let d = 1; d <= range; d++) {
      // At distance d, width extends d tiles perpendicular
      for (let w = -d; w <= d; w++) {
        let tr: number, tc: number;
        if (dr !== 0) {
          // Vertical cone
          tr = from[0] + dr * d;
          tc = from[1] + w;
        } else {
          // Horizontal cone
          tr = from[0] + w;
          tc = from[1] + dc * d;
        }
        tiles.push([tr, tc]);
      }
    }
  }
  return tiles;
}

// Get all tiles in a Line from user in the closest matching direction
export function getLineTiles(
  from: [number, number],
  range: number,
): [number, number][] {
  const tiles: [number, number][] = [];
  const dirs: [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [dr, dc] of dirs) {
    for (let d = 1; d <= range; d++) {
      if (dr !== 0 && dc !== 0) {
        // Diagonal: max distance is ceil(range/2)
        if (d > Math.ceil(range / 2)) break;
      }
      tiles.push([from[0] + dr * d, from[1] + dc * d]);
    }
  }
  return tiles;
}

// Get all tiles in a Pierce from user (same as Line)
export function getPierceTiles(
  from: [number, number],
  range: number,
): [number, number][] {
  return getLineTiles(from, range);
}

// Get all tiles in a Beam (3 wide, X deep in each cardinal direction)
export function getBeamTiles(
  from: [number, number],
  range: number,
): [number, number][] {
  const tiles: [number, number][] = [];
  const dirs: [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (const [dr, dc] of dirs) {
    for (let d = 1; d <= range; d++) {
      // 3 wide perpendicular
      for (let w = -1; w <= 1; w++) {
        let tr: number, tc: number;
        if (dr !== 0) {
          tr = from[0] + dr * d;
          tc = from[1] + w;
        } else {
          tr = from[0] + w;
          tc = from[1] + dc * d;
        }
        tiles.push([tr, tc]);
      }
    }
  }
  return tiles;
}

// Get all valid entities in an AoE pattern
export function getAoETargets(
  game: Game,
  user: Entity,
  range: string,
  group: string,
): Entity[] {
  const rangeStr = range.toLowerCase().trim();
  let tiles: [number, number][] = [];

  const burstMatch = rangeStr.match(/^burst\s*(\d+)/);
  if (burstMatch) {
    tiles = getBurstTiles(user.pos, parseInt(burstMatch[1]));
  }

  const starMatch = rangeStr.match(/^star\s*(\d+)/);
  if (starMatch) {
    tiles = getStarTiles(user.pos, parseInt(starMatch[1]));
  }

  const coneMatch = rangeStr.match(/^cone\s*(\d+)/);
  if (coneMatch) {
    tiles = getConeTiles(user.pos, parseInt(coneMatch[1]));
  }

  const lineMatch = rangeStr.match(/^line\s*(\d+)/);
  if (lineMatch) {
    tiles = getLineTiles(user.pos, parseInt(lineMatch[1]));
  }

  const pierceMatch = rangeStr.match(/^pierce\s*(\d+)/);
  if (pierceMatch) {
    tiles = getPierceTiles(user.pos, parseInt(pierceMatch[1]));
  }

  const beamMatch = rangeStr.match(/^beam\s*(\d+)/);
  if (beamMatch) {
    tiles = getBeamTiles(user.pos, parseInt(beamMatch[1]));
  }

  if (tiles.length === 0) return [];

  const tileSet = new Set(tiles.map(([r, c]) => posToStr(r, c)));
  const groupLower = group.toLowerCase();

  return game.entities.filter((e) => {
    if (e.curhp <= 0) return false;
    if (!isValidGroupTarget(user, e, groupLower)) return false;
    return tileSet.has(posToStr(e.pos[0], e.pos[1]));
  });
}

// Get Splash targets around a primary target (Burst X from the target)
export function getSplashTargets(
  game: Game,
  user: Entity,
  primary: Entity,
  splashRadius: number,
  group: string,
): Entity[] {
  const tiles = getBurstTiles(primary.pos, splashRadius);
  const tileSet = new Set(tiles.map(([r, c]) => posToStr(r, c)));
  const groupLower = group.toLowerCase();

  return game.entities.filter((e) => {
    if (e.curhp <= 0) return false;
    if (e.num === primary.num) return false; // primary is already targeted
    if (!isValidGroupTarget(user, e, groupLower)) return false;
    return tileSet.has(posToStr(e.pos[0], e.pos[1]));
  });
}

// Check if entity is valid for a target group
function isValidGroupTarget(
  user: Entity,
  target: Entity,
  group: string,
): boolean {
  return matchesTargetGroup(user, target, group);
}

// Push an entity X tiles away from a source in a straight line
export function pushEntity(
  game: Game,
  target: Entity,
  source: [number, number],
  amount: number,
): { moved: number; path: [number, number][] } {
  return moveEntityInLine(game, target, source, amount, true);
}

// Pull an entity X tiles towards a source in a straight line
export function pullEntity(
  game: Game,
  target: Entity,
  source: [number, number],
  amount: number,
): { moved: number; path: [number, number][] } {
  return moveEntityInLine(game, target, source, amount, false);
}

function moveEntityInLine(
  game: Game,
  target: Entity,
  source: [number, number],
  amount: number,
  away: boolean,
): { moved: number; path: [number, number][] } {
  const path: [number, number][] = [];
  const dr = target.pos[0] - source[0];
  const dc = target.pos[1] - source[1];

  let dirR = 0;
  let dirC = 0;
  if (dr !== 0) dirR = dr > 0 ? 1 : -1;
  if (dc !== 0) dirC = dc > 0 ? 1 : -1;
  if (!away) {
    dirR = -dirR;
    dirC = -dirC;
  }

  // For diagonal, normalize to unit diagonal
  if (dirR !== 0 && dirC !== 0) {
    // Diagonal: move diagonally
    let moved = 0;
    for (let i = 0; i < amount; i++) {
      const nr = target.pos[0] + dirR;
      const nc = target.pos[1] + dirC;
      if (!isPassable(game, nr, nc)) break;
      target.pos = [nr, nc];
      path.push([nr, nc]);
      moved++;
    }
    return { moved, path };
  }

  // Cardinal
  let moved = 0;
  for (let i = 0; i < amount; i++) {
    const nr = target.pos[0] + dirR;
    const nc = target.pos[1] + dirC;
    if (!isPassable(game, nr, nc)) break;
    target.pos = [nr, nc];
    path.push([nr, nc]);
    moved++;
  }
  return { moved, path };
}

function isPassable(game: Game, r: number, c: number): boolean {
  if (r < 0 || r >= game.map.length || c < 0 || c >= game.map[0].length)
    return false;
  if (!isStandable(game.map[r][c])) return false;
  // A tile occupied by a living entity is not passable — push/pull and
  // line movement must stop there instead of sliding through.
  return !game.entities.some(
    (e) => e.curhp > 0 && e.pos[0] === r && e.pos[1] === c,
  );
}

// Roll accuracy check
export function rollAccuracy(
  mr: number,
  eva: number,
  bonuses = 0,
): { hit: boolean; roll: number; crit: boolean } {
  const roll = rollDice("1d20").total + bonuses;
  const hit = roll >= mr + eva;
  const crit = roll >= 20;
  return { hit, roll, crit };
}

// -- Status check helpers ------------------------------------------------------

export function hasStatus(entity: Entity, name: string): boolean {
  return entity.statuses.some((s) => toId(s.name) === toId(name));
}

export function isStunned(entity: Entity): boolean {
  return hasStatus(entity, "stun");
}

export function isRooted(entity: Entity): boolean {
  return hasStatus(entity, "root");
}

export function isSealed(entity: Entity): boolean {
  return hasStatus(entity, "seal");
}

export function isSlowed(entity: Entity): boolean {
  return hasStatus(entity, "slow");
}

export function isConfused(entity: Entity): boolean {
  return hasStatus(entity, "confusion");
}

export function getSlowMpReduction(entity: Entity): number {
  let reduction = 0;
  for (const s of entity.statuses) {
    if (toId(s.name) === "slow") reduction += s.damage || 1;
  }
  return reduction;
}

export function getEffectiveMp(entity: Entity): number {
  return Math.max(0, entity.mp - getSlowMpReduction(entity));
}

// Apply damage to entity — Shield absorbs first if present
export function dealDamage(
  entity: Entity,
  damage: number,
): {
  actual: number;
  shieldAbsorbed: number;
  shieldBreaks: boolean;
} {
  let remaining = Math.max(0, damage);
  let shieldAbsorbed = 0;
  let shieldBreaks = false;

  // Shield absorbs damage before HP
  const shield = entity.statuses.find((s) => toId(s.name) === "shield");
  if (shield && remaining > 0) {
    const absorbed = Math.min(shield.damage, remaining);
    shield.damage -= absorbed;
    remaining -= absorbed;
    shieldAbsorbed = absorbed;
    if (shield.damage <= 0) {
      shieldBreaks = true;
      entity.statuses = entity.statuses.filter((s) => s !== shield);
    }
  }

  const actual = remaining;
  entity.curhp = Math.max(0, entity.curhp - remaining);
  return { actual, shieldAbsorbed, shieldBreaks };
}

// Damage statuses deal damage just before the affected entity's turn
export function processStartOfTurn(
  game: Game,
  entity: Entity,
): { messages: string[]; died: boolean } {
  const messages: string[] = [];

  // Apply status damage (DoT)
  for (const status of [...entity.statuses]) {
    if (status.damage > 0) {
      dealDamage(entity, status.damage);
      messages.push(
        `  ${entity.num} takes **${status.damage}** ${status.name} damage (${entity.curhp}/${entity.maxhp} HP).`,
      );
    }
  }

  // Announce status restrictions
  if (isStunned(entity)) {
    messages.push(`  **${entity.num} is stunned and cannot act!**`);
  }
  if (isConfused(entity)) {
    messages.push(`  **${entity.num} is confused!**`);
  }
  if (isRooted(entity)) {
    messages.push(`  **${entity.num} is rooted and cannot move!**`);
  }
  if (isSealed(entity)) {
    messages.push(`  **${entity.num} is sealed and cannot use abilities!**`);
  }

  const died = checkTurnDeath(game, entity, messages);

  return { messages, died };
}

/**
 * If the entity ran out of HP at a turn boundary, announce the defeat and
 * remove it from the game. Returns whether the entity died.
 */
function checkTurnDeath(
  game: Game,
  entity: Entity,
  messages: string[],
): boolean {
  const died = entity.curhp <= 0;
  if (died) {
    messages.push(`  **${entity.num} (${entity.name}) has been defeated!**`);
    removeEntity(game, entity);
  }
  return died;
}

// Cooldowns, status durations, and lava resolve at the end of the entity's turn
export function processEndOfTurn(
  game: Game,
  entity: Entity,
): { messages: string[]; died: boolean } {
  const messages: string[] = [];

  // Tick cooldowns
  for (const [name, turns] of Object.entries(entity.cooldowns)) {
    entity.cooldowns[name] = turns - 1;
    if (entity.cooldowns[name] <= 0) delete entity.cooldowns[name];
  }

  // Tick status durations
  for (const status of [...entity.statuses]) {
    status.rounds--;
    if (status.rounds <= 0) {
      messages.push(`  ${entity.num}'s ${status.name} wore off.`);
      entity.statuses = entity.statuses.filter((s) => s !== status);
    }
  }

  // Lava damage
  const terrain = game.map[entity.pos[0]]?.[entity.pos[1]];
  if (terrain === Terrain.Lava) {
    dealDamage(entity, 30);
    messages.push(
      `  ${entity.num} takes **30** lava damage (${entity.curhp}/${entity.maxhp} HP).`,
    );
  }

  const died = checkTurnDeath(game, entity, messages);

  return { messages, died };
}

export function removeEntity(game: Game, entity: Entity): boolean {
  const removedNum = entity.num;
  const oldIdx = game.turnOrder.indexOf(removedNum);
  // Removing the CURRENT actor mid-turn (%leave, %remp, %hp, a no-dice
  // Free/Swift finishStep): the entity that was next shifts into this slot,
  // so the pointer already rests on the upcoming actor. Tell the next
  // nextTurn() to treat it as an actor-death transition (no buff tick of
  // the shifted-in entity, no double advance) — otherwise its turn is
  // silently skipped.
  if (game.phase === "playing" && oldIdx === game.turnIndex) {
    game.removedCurrentActor = true;
  }
  game.entities = game.entities.filter((e) => e.num !== removedNum);
  game.turnOrder = game.turnOrder.filter((n) => n !== removedNum);
  if (oldIdx !== -1 && oldIdx < game.turnIndex) {
    game.turnIndex--;
  }
  // Drop the removed entity's gamemode vote on EVERY path — including the
  // wrap below, which returns early.
  delete game.votes[entity.id];
  if (game.turnIndex >= game.turnOrder.length) {
    // The entity occupying the final slot was removed, so the turn pointer
    // wrapped back to slot 0: a full cycle completed. Advance the round
    // counter here so it can't go stale or get missed — this covers
    // mid-turn actor deaths, start-of-turn deaths in the final slot, and
    // removals of the current entity (%leave/%remp) during play.
    game.turnIndex = 0;
    if (game.phase === "playing") {
      game.round++;
      return true;
    }
  }
  return false;
}

/** Check if the game is over. Returns the winner entity or null. */
export function checkGameOver(game: Game): Entity | null {
  const alive = game.entities.filter((e) => e.curhp > 0);
  if (alive.length <= 1) {
    game.phase = "ended";
    game.winner = alive[0]?.num ?? null;
    return alive[0] ?? null;
  }

  // Team mode: check if all members of any team are dead
  const modeLower = game.mode.toLowerCase();
  if (modeLower.includes("v")) {
    // Team modes (2v2, 3v3, etc)
    const teams = new Map<number, Entity[]>();
    for (const e of alive) {
      const list = teams.get(e.team) ?? [];
      list.push(e);
      teams.set(e.team, list);
    }

    const aliveTeams = [...teams.entries()].filter(
      ([, members]) => members.length > 0,
    );
    if (aliveTeams.length <= 1) {
      game.phase = "ended";
      // Winner is the surviving team -- pick first survivor
      const winner = aliveTeams[0]?.[1][0] ?? null;
      game.winner = winner?.num ?? null;
      return winner;
    }
  }

  return null;
}

/** Calculate loot for all surviving players. */
export function calculateLoot(
  game: Game,
): { entity: Entity; xp: number; gold: number; gems: number }[] {
  const pl = game.entities.length;
  const modeLower = game.mode.toLowerCase();
  const base = baseLootFor(pl, modeLower.includes("ffa"));

  // Kill bonus: +1 per kill
  // Winner bonus: x1.5 in FFA/PvP (surviving player)
  const results: { entity: Entity; xp: number; gold: number; gems: number }[] =
    [];

  for (const e of game.entities) {
    const kills = game.kills[e.num] ?? 0;
    let xp = base + kills;
    let gold = base + kills;
    if (e.num === game.winner) {
      xp = Math.floor(xp * 1.5);
      gold = Math.floor(gold * 1.5);
    }

    results.push({ entity: e, xp, gold, gems: gemsFor(pl) });
  }

  return results;
}

/** Base xp/gold for a player count; team modes pay slightly higher. */
function baseLootFor(pl: number, isFfa: boolean): number {
  if (isFfa) {
    if (pl <= 3) return 5;
    if (pl <= 4) return 6;
    if (pl <= 5) return 7;
    if (pl <= 6) return 8;
    if (pl <= 7) return 9;
    return 10;
  }
  if (pl <= 3) return 7;
  if (pl <= 5) return 9;
  return 11;
}

/** Gem payout scales with player count. */
function gemsFor(pl: number): number {
  if (pl >= 7) return 3;
  if (pl >= 5) return 2;
  if (pl >= 3) return 1;
  return 0;
}

/**
 * Tick down the buffs on the entity whose turn is ending, dropping any
 * that reach 0 rounds and reporting their expiry. Extracted from nextTurn
 * to keep that function's cyclomatic complexity within the gate threshold.
 */
function tickEndingBuffs(prev: Entity, messages: string[]) {
  prev.buffs = prev.buffs.filter((b) => {
    b.rounds--;
    if (b.rounds <= 0) {
      messages.push(
        `  ${prev.num}'s ${b.amount > 0 ? "+" : ""}${b.amount} ${b.stat.toUpperCase()} buff expired.`,
      );
      return false;
    }
    return true;
  });
}

/**
 * Start the turn of the entity at turnIndex, advancing past any entity that
 * dies when its turn starts (e.g. start-of-turn DoT), so a corpse is never
 * returned as the current actor. Returns the entity to act (null when every
 * remaining entity died during the transition). Extracted from nextTurn to
 * keep that function's cyclomatic complexity within the gate threshold.
 */
function startCurrentEntityTurn(
  game: Game,
  messages: string[],
  died: boolean,
): { entity: Entity | null; died: boolean } {
  let entity = getCurrentEntity(game);
  while (entity) {
    if (entity.curhp <= 0) {
      // Dead but still present (its removal was missed): never hand a
      // corpse the turn — remove it and advance to the next entity.
      // Report the removal through `died` so the caller re-checks game
      // over even when a living entity follows.
      removeEntity(game, entity);
      died = true;
      // The shift-in is handled right here (the loop starts the next
      // entity's turn), so don't let removeEntity's current-actor flag
      // leak into a FUTURE nextTurn call and skip that entity.
      game.removedCurrentActor = false;
      entity = getCurrentEntity(game);
      continue;
    }
    // Reset per-turn flags
    entity.dashUsed = false;
    entity.standardUsed = false;
    entity.movementUsed = false;
    entity.swiftUsed = false;
    entity.triggered = false;
    entity.pendingAction = null;

    const { messages: startMessages, died: startDied } = processStartOfTurn(
      game,
      entity,
    );
    messages.push(...startMessages);
    died = died || startDied;
    if (startDied) {
      // entity was removed; the next entity shifted into this slot
      entity = getCurrentEntity(game);
      continue;
    }
    break;
  }
  return { entity, died };
}

export function nextTurn(
  game: Game,
  opts: { actorDied?: boolean } = {},
): {
  entity: Entity | null;
  messages: string[];
  died: boolean;
} {
  const { actorDied = false } = opts;
  // If the CURRENT actor was removed mid-turn (removeEntity set this), the
  // pointer already rests on the entity that shifted into its slot — treat
  // it exactly like an actor-death transition: no buff tick of a "prev"
  // that never had its turn, no extra advance.
  const actorRemoved = game.removedCurrentActor === true;
  game.removedCurrentActor = false;
  const skipAdvance = actorDied || actorRemoved;
  if (game.entities.length <= 1) {
    game.phase = "ended";
    return { entity: null, messages: [], died: false };
  }

  const messages: string[] = [];
  let died = false;

  if (!skipAdvance) {
    // Tick buffs of the entity whose turn is ending
    const prev = getCurrentEntity(game);
    const prevIndex = game.turnIndex;
    if (prev) {
      tickEndingBuffs(prev, messages);
    }

    game.turnIndex++;
    if (game.turnIndex >= game.turnOrder.length) {
      game.turnIndex = 0;
      game.round++;
    }

    // Resolve end-of-turn effects for the entity whose turn just ended
    if (prev) {
      const end = processEndOfTurn(game, prev);
      messages.push(...end.messages);
      died = end.died;
      if (end.died) {
        // prev was removed from turnOrder; keep the pointer on the next entity
        game.turnIndex = prevIndex >= game.turnOrder.length ? 0 : prevIndex;
      }
    }
  }
  // When the actor died mid-turn it was already removed from turnOrder and
  // turnIndex now points at the entity that shifted into its slot, so we must
  // NOT advance past it again (that would skip that entity's turn). If the
  // removal wrapped the pointer (actor held the final slot), removeEntity
  // already advanced the round for the completed cycle.

  // Start the turn of the entity at turnIndex, advancing past any entity
  // that dies when its turn starts (e.g. start-of-turn DoT), so a dead
  // entity is never returned as the current actor.
  const started = startCurrentEntityTurn(game, messages, died);
  const entity = started.entity;
  died = started.died;

  if (!entity) {
    // Every entity died during the transition (end-of-turn and
    // start-of-turn deaths consumed the last survivors): end the game.
    game.phase = "ended";
    return { entity: null, messages, died };
  }
  return { entity, messages, died };
}
