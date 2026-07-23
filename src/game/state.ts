import { rollDice, posToStr, toId } from "../utils.js";
import { send, sendPm } from "../utils.js";
import { rooms } from "../rooms.js";

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
  [Terrain.Normal]: "#b8d0a0",
  [Terrain.Stop]: "#444444",
  [Terrain.Water]: "#6688cc",
  [Terrain.Forest]: "#2d6b22",
  [Terrain.Ice]: "#a8d8ea",
  [Terrain.Air]: "#e8e8ff",
  [Terrain.Sticky]: "#cc9933",
  [Terrain.Lava]: "#dd3300",
  [Terrain.Broken]: "#666666",
  [Terrain.Bone]: "#ccccaa",
  [Terrain.Stone]: "#888888",
  [Terrain.Hearth]: "#ff6633",
  [Terrain.Boost]: "#aaffaa",
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

export function isObstruction(t: Terrain): boolean {
  return (
    t === Terrain.Stop ||
    t === Terrain.Bone ||
    t === Terrain.Ice ||
    t === Terrain.Stone ||
    t === Terrain.Broken
  );
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

export interface AbilityData {
  name: string;
  level: number;
  frequency: string;
  mr: number;
  roll: string;
  damageType: "Physical" | "Magical" | "";
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
}

export interface Entity {
  num: string; // P1, P2, M1, M2...
  name: string;
  id: string;
  isMonster: boolean;
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
}

export interface PendingAction {
  type: "move" | "dash" | "attack" | "ability" | "endturn";
  ability?: AbilityData;
  target?: string; // entity num
  targetPos?: [number, number];
  position?: [number, number];
}

export interface ActionLogEntry {
  turn: number;
  entity: string;
  description: string;
  snapshot: string;
}

export interface Game {
  id: string;
  room: string;
  host: string;
  entities: Entity[];
  map: Terrain[][];
  mapName: string;
  turnOrder: string[]; // entity nums in order
  turnIndex: number;
  round: number;
  log: ActionLogEntry[];
  snapshots: string[];
  mode: string;
  phase: "setup" | "playing" | "ended";
  started: boolean;
  kills: Record<string, number>; // entity num → kill count
  winner: string | null; // winning entity num or team
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
      statuses: e.statuses,
      buffs: e.buffs,
      cooldowns: e.cooldowns,
      usesUsed: e.usesUsed,
      dashUsed: e.dashUsed,
      standardUsed: e.standardUsed,
      movementUsed: e.movementUsed,
    })),
    turnIndex: game.turnIndex,
    round: game.round,
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
      ent.statuses = e.statuses;
      ent.buffs = e.buffs;
      ent.cooldowns = e.cooldowns;
      ent.usesUsed = e.usesUsed;
      ent.dashUsed = e.dashUsed;
      ent.standardUsed = e.standardUsed;
      ent.movementUsed = e.movementUsed;
    }
  }
  game.turnIndex = data.turnIndex;
  game.round = data.round;
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

export function dist(a: [number, number], b: [number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

export function manhattan(a: [number, number], b: [number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

// BFS pathfinding considering terrain costs
export function getReachableTiles(
  game: Game,
  start: [number, number],
  mp: number,
): Map<string, number> {
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
      if (isObstruction(terrain)) continue;
      if (terrain === Terrain.Lava) continue; // don't pathfind through lava

      const tileCost = moveCost(terrain);
      const newCost = cost + tileCost;
      if (newCost > mp) continue;

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
  from: [number, number],
  to: [number, number],
): boolean {
  const dx = to[1] - from[1];
  const dy = to[0] - from[0];
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return true;

  const sx = dx / steps;
  const sy = dy / steps;

  for (let i = 1; i < steps; i++) {
    const x = Math.round(from[1] + sx * i);
    const y = Math.round(from[0] + sy * i);
    if (x < 0 || y < 0 || y >= game.map.length || x >= game.map[0].length)
      return false;
    const t = game.map[y][x];
    if (isObstruction(t)) return false;
  }
  return true;
}

// Check if target is in range of ability
export function inRange(
  game: Game,
  from: [number, number],
  to: [number, number],
  range: string,
): boolean {
  const rangeStr = range.toLowerCase();
  if (rangeStr === "melee") {
    return dist(from, to) <= 2; // adjacent tiles including diagonal
  }
  if (rangeStr === "global") return true;

  const match = rangeStr.match(/range\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1]);
    const d = manhattan(from, to);
    return d <= r && hasLineOfSight(game, from, to);
  }

  const homing = rangeStr.match(/homing\s*(\d+)/);
  if (homing) {
    const r = parseInt(homing[1]);
    return manhattan(from, to) <= r;
  }

  return false;
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

// Apply damage to entity
export function dealDamage(entity: Entity, damage: number): number {
  const actual = Math.max(0, damage);
  entity.curhp -= actual;
  return actual;
}

// Process end-of-turn effects: decrement status durations, etc
export function processEndOfTurn(game: Game, entity: Entity) {
  // Decrement statuses
  entity.statuses = entity.statuses.filter((s) => {
    s.rounds--;
    return s.rounds > 0;
  });

  // Decrement buffs
  entity.buffs = entity.buffs.filter((b) => {
    b.rounds--;
    return b.rounds > 0;
  });

  // Decrement cooldowns
  for (const key of Object.keys(entity.cooldowns)) {
    entity.cooldowns[key]--;
    if (entity.cooldowns[key] <= 0) delete entity.cooldowns[key];
  }
}

// Damage statuses deal damage before entity's turn
export function processStartOfTurn(game: Game, entity: Entity) {
  for (const status of entity.statuses) {
    if (status.damage > 0) {
      dealDamage(entity, status.damage);
    }
  }

  // Lava damage check
  const terrain = game.map[entity.pos[0]]?.[entity.pos[1]];
  if (terrain === Terrain.Lava) {
    dealDamage(entity, 30);
  }

  // Check death
  if (entity.curhp <= 0) {
    removeEntity(game, entity);
  }
}

export function removeEntity(game: Game, entity: Entity) {
  game.entities = game.entities.filter((e) => e.num !== entity.num);
  game.turnOrder = game.turnOrder.filter((n) => n !== entity.num);
  if (game.turnIndex >= game.turnOrder.length) {
    game.turnIndex = 0;
  }
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
      // Winner is the surviving team — pick first survivor
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

  // Base loot from loot table
  let base = 5;
  if (modeLower.includes("ffa")) {
    if (pl <= 3) base = 5;
    else if (pl <= 4) base = 6;
    else if (pl <= 5) base = 7;
    else if (pl <= 6) base = 8;
    else if (pl <= 7) base = 9;
    else base = 10;
  } else {
    // Team modes use higher base
    if (pl <= 3) base = 7;
    else if (pl <= 5) base = 9;
    else base = 11;
  }

  // Kill bonus: +1 per kill
  // Winner bonus: ×1.5 in FFA/PvP (surviving player)
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

    // Gems: based on player count
    let gems = 0;
    if (pl >= 3 && pl <= 4) gems = 1;
    else if (pl >= 5 && pl <= 6) gems = 2;
    else if (pl >= 7) gems = 3;

    results.push({ entity: e, xp, gold, gems });
  }

  return results;
}

export function nextTurn(game: Game): Entity | null {
  if (game.entities.length <= 1) {
    game.phase = "ended";
    return null;
  }

  game.turnIndex++;
  if (game.turnIndex >= game.turnOrder.length) {
    game.turnIndex = 0;
    game.round++;
  }

  const entity = getCurrentEntity(game);
  if (!entity) return null;

  // Reset per-turn flags
  entity.dashUsed = false;
  entity.standardUsed = false;
  entity.movementUsed = false;
  entity.pendingAction = null;

  processStartOfTurn(game, entity);
  return entity;
}
