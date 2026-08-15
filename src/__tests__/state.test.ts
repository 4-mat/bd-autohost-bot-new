import { describe, it, expect } from "bun:test";
import {
  Terrain,
  isObstruction,
  isStandable,
  moveCost,
  chebyshev,
  manhattan,
  dist,
  hasLineOfSight,
  inRange,
  formatChatTime,
  getReachableTiles,
  getBurstTiles,
  getStarTiles,
  getConeTiles,
  getLineTiles,
  getPierceTiles,
  getBeamTiles,
  getAoETargets,
  getSplashTargets,
  pushEntity,
  pullEntity,
  dealDamage,
  rollAccuracy,
  checkGameOver,
  calculateLoot,
  nextTurn,
  processStartOfTurn,
  processEndOfTurn,
  pushSnapshot,
  popSnapshot,
  getCurrentEntity,
  getEntity,
  removeEntity,
  type Game,
  type Entity,
  type AbilityData,
} from "../game/state.js";
import { posToStr } from "../utils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(
  overrides: Partial<Entity> & { num: string; name: string },
): Entity {
  return {
    id: overrides.num.toLowerCase(),
    isMonster: false,
    curhp: 100,
    maxhp: 100,
    atk: 10,
    mag: 10,
    pd: 5,
    md: 5,
    eva: 0,
    mp: 3,
    pos: [0, 0],
    team: 0,
    className: "Monk",
    weaponName: "Fist",
    classLevel: 1,
    weaponLevel: 1,
    abilities: [],
    statuses: [],
    buffs: [],
    cooldowns: {},
    usesUsed: {},
    resources: {},
    pendingAction: null,
    dashUsed: false,
    standardUsed: false,
    movementUsed: false,
    swiftUsed: false,
    ...overrides,
  };
}

function makeGame(
  opts: {
    size?: number;
    terrain?: Terrain[][];
    entities?: Entity[];
    mode?: string;
    turnOrder?: string[];
  } = {},
): Game {
  const size = opts.size ?? 5;
  const map =
    opts.terrain ??
    Array.from({ length: size }, () => Array(size).fill(Terrain.Normal));
  const entities = opts.entities ?? [
    makeEntity({ num: "P1", name: "Alice", pos: [0, 0], team: 0 }),
    makeEntity({ num: "P2", name: "Bob", pos: [2, 2], team: 1 }),
  ];
  const turnOrder = opts.turnOrder ?? entities.map((e) => e.num);
  return {
    id: "test",
    room: "battledome",
    host: "Host",
    entities,
    map,
    mapName: "test",
    turnOrder,
    turnIndex: 0,
    round: 1,
    log: [],
    snapshots: [],
    mode: opts.mode ?? "ffa",
    phase: "playing",
    started: true,
    kills: {},
    winner: null,
    chatLog: [],
    toasts: [],
    signupsOpen: false,
    votes: {},
    voteOpen: false,
    voteRunoff: null,
  };
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

describe("Terrain", () => {
  it("isObstruction returns true for Stop, Bone, Ice, Stone, Hearth (glossary)", () => {
    expect(isObstruction(Terrain.Stop)).toBe(true);
    expect(isObstruction(Terrain.Bone)).toBe(true);
    expect(isObstruction(Terrain.Ice)).toBe(true);
    expect(isObstruction(Terrain.Stone)).toBe(true);
    expect(isObstruction(Terrain.Hearth)).toBe(true);
  });

  it("isObstruction returns false for Broken and passable tiles", () => {
    // Broken is impassable to movement but is NOT an obstruction per the
    // glossary ("Broken tiles cannot be moved through...").
    expect(isObstruction(Terrain.Broken)).toBe(false);
    expect(isObstruction(Terrain.Normal)).toBe(false);
    expect(isObstruction(Terrain.Water)).toBe(false);
    expect(isObstruction(Terrain.Forest)).toBe(false);
    expect(isObstruction(Terrain.Lava)).toBe(false);
    expect(isObstruction(Terrain.Air)).toBe(false);
    expect(isObstruction(Terrain.Sticky)).toBe(false);
    expect(isObstruction(Terrain.Boost)).toBe(false);
  });

  it("isStandable excludes obstructions, Broken, and Lava", () => {
    expect(isStandable(Terrain.Stop)).toBe(false);
    expect(isStandable(Terrain.Bone)).toBe(false);
    expect(isStandable(Terrain.Ice)).toBe(false);
    expect(isStandable(Terrain.Stone)).toBe(false);
    expect(isStandable(Terrain.Hearth)).toBe(false);
    expect(isStandable(Terrain.Broken)).toBe(false);
    expect(isStandable(Terrain.Lava)).toBe(false);
    expect(isStandable(Terrain.Normal)).toBe(true);
    expect(isStandable(Terrain.Water)).toBe(true);
    expect(isStandable(Terrain.Forest)).toBe(true);
    expect(isStandable(Terrain.Sticky)).toBe(true);
    expect(isStandable(Terrain.Boost)).toBe(true);
  });

  it("moveCost returns base+1 for Sticky", () => {
    expect(moveCost(Terrain.Sticky)).toBe(2);
    expect(moveCost(Terrain.Sticky, 2)).toBe(3);
  });

  it("moveCost returns base-1 for Boost (min 0)", () => {
    expect(moveCost(Terrain.Boost)).toBe(0);
    expect(moveCost(Terrain.Boost, 3)).toBe(2);
    expect(moveCost(Terrain.Boost, 0)).toBe(0);
  });

  it("moveCost returns base for Normal terrain", () => {
    expect(moveCost(Terrain.Normal)).toBe(1);
    expect(moveCost(Terrain.Normal, 2)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

describe("Distance", () => {
  it("chebyshev for same tile is 0", () => {
    expect(chebyshev([3, 3], [3, 3])).toBe(0);
  });

  it("chebyshev for adjacent tiles is 1", () => {
    expect(chebyshev([0, 0], [0, 1])).toBe(1);
    expect(chebyshev([0, 0], [1, 0])).toBe(1);
    expect(chebyshev([0, 0], [1, 1])).toBe(1); // diagonal
  });

  it("chebyshev for diagonal 2 away is 2", () => {
    expect(chebyshev([0, 0], [2, 2])).toBe(2);
  });

  it("manhattan for same tile is 0", () => {
    expect(manhattan([3, 3], [3, 3])).toBe(0);
  });

  it("manhattan counts cardinal steps", () => {
    expect(manhattan([0, 0], [0, 3])).toBe(3);
    expect(manhattan([0, 0], [2, 0])).toBe(2);
    expect(manhattan([0, 0], [1, 1])).toBe(2); // diagonal = 2 manhattan
  });

  it("dist is same as manhattan", () => {
    expect(dist([0, 0], [3, 4])).toBe(manhattan([0, 0], [3, 4]));
    expect(dist([1, 2], [5, 6])).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// BFS Pathfinding
// ---------------------------------------------------------------------------

describe("getReachableTiles", () => {
  it("returns empty map for 0 MP", () => {
    const game = makeGame();
    const reachable = getReachableTiles(game, [0, 0], 0);
    expect(reachable.size).toBe(0);
  });

  it("finds 4 adjacent tiles with MP=1 on all-normal map", () => {
    const game = makeGame({ size: 5 });
    const reachable = getReachableTiles(game, [2, 2], 1);
    // Should reach up, down, left, right
    expect(reachable.has(posToStr(1, 2))).toBe(true); // up
    expect(reachable.has(posToStr(3, 2))).toBe(true); // down
    expect(reachable.has(posToStr(2, 1))).toBe(true); // left
    expect(reachable.has(posToStr(2, 3))).toBe(true); // right
    // Diagonal should NOT be reachable with 1 MP (no diagonal movement)
    expect(reachable.has(posToStr(1, 1))).toBe(false);
    expect(reachable.size).toBe(4);
  });

  it("finds diamond pattern with MP=2", () => {
    const game = makeGame({ size: 5 });
    const reachable = getReachableTiles(game, [2, 2], 2);
    // 4 adjacent (cost 1) + 8 more at distance 2
    expect(reachable.size).toBe(12);
    expect(reachable.get(posToStr(0, 2))).toBe(2); // 2 tiles up = cost 2
    expect(reachable.get(posToStr(2, 0))).toBe(2); // 2 tiles left = cost 2
  });

  it("avoids obstructions", () => {
    const map = Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal));
    map[0][1] = Terrain.Stone; // block right of [0,0]
    const game = makeGame({ terrain: map });
    const reachable = getReachableTiles(game, [0, 0], 3);
    // Can't go right through stone
    expect(reachable.has(posToStr(0, 1))).toBe(false);
    expect(reachable.has(posToStr(0, 2))).toBe(false);
    // Can go down then right
    expect(reachable.has(posToStr(1, 0))).toBe(true);
  });

  it("avoids lava", () => {
    const map = Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal));
    map[1][0] = Terrain.Lava;
    const game = makeGame({ terrain: map });
    const reachable = getReachableTiles(game, [0, 0], 5);
    expect(reachable.has(posToStr(1, 0))).toBe(false);
  });

  it("sticky terrain costs 2 MP", () => {
    const map = Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal));
    map[0][1] = Terrain.Sticky;
    const game = makeGame({ terrain: map });
    const reachable = getReachableTiles(game, [0, 0], 2);
    // Sticky at [0,1] costs 2 MP, so reachable but uses all MP
    expect(reachable.has(posToStr(0, 1))).toBe(true);
    expect(reachable.get(posToStr(0, 1))).toBe(2);
    // Can't go further right from sticky with 0 MP left
    expect(reachable.has(posToStr(0, 2))).toBe(false);
  });

  it("boost terrain costs 0 MP", () => {
    const map = Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal));
    map[0][1] = Terrain.Boost;
    const game = makeGame({ terrain: map });
    const reachable = getReachableTiles(game, [0, 0], 1);
    // Boost at [0,1] costs 0, so it's traversed but not stored in reachable (cost 0 excluded)
    expect(reachable.has(posToStr(0, 1))).toBe(false); // cost 0, excluded by design
    expect(reachable.has(posToStr(0, 2))).toBe(true); // 1 MP left after free pass
  });

  it("excludes tiles occupied by living entities (matches push/pull)", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [1, 2] });
    const foe = makeEntity({ num: "F1", name: "Foe", pos: [2, 2], team: 1 });
    const game = makeGame({ entities: [p1, foe], turnOrder: ["P1", "F1"] });
    const reachable = getReachableTiles(game, [1, 2], 1);
    expect(reachable.has(posToStr(1, 1))).toBe(true); // left
    expect(reachable.has(posToStr(0, 2))).toBe(true); // up
    expect(reachable.has(posToStr(1, 3))).toBe(true); // right
    expect(reachable.has(posToStr(2, 2))).toBe(false); // occupied by foe
    expect(reachable.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Line of Sight
// ---------------------------------------------------------------------------

describe("hasLineOfSight", () => {
  it("same tile has LOS", () => {
    const game = makeGame();
    expect(hasLineOfSight(game, [0, 0], [0, 0])).toBe(true);
  });

  it("cardinal line with no obstructions has LOS", () => {
    const game = makeGame({ size: 5 });
    expect(hasLineOfSight(game, [0, 0], [0, 4])).toBe(true);
    expect(hasLineOfSight(game, [0, 0], [4, 0])).toBe(true);
  });

  it("diagonal line with no obstructions has LOS", () => {
    const game = makeGame({ size: 5 });
    expect(hasLineOfSight(game, [0, 0], [4, 4])).toBe(true);
  });

  it("LOS blocked by stone wall", () => {
    const map = Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal));
    map[0][2] = Terrain.Stone;
    const game = makeGame({ terrain: map });
    expect(hasLineOfSight(game, [0, 0], [0, 4])).toBe(false);
    expect(hasLineOfSight(game, [0, 0], [0, 1])).toBe(true); // before wall
  });

  it("LOS blocked by bone wall", () => {
    const map = Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal));
    map[2][2] = Terrain.Bone;
    const game = makeGame({ terrain: map });
    expect(hasLineOfSight(game, [0, 0], [4, 4])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Range checking
// ---------------------------------------------------------------------------

describe("inRange", () => {
  const game = makeGame({ size: 10 });

  it("empty range returns false", () => {
    expect(inRange(game, [0, 0], [1, 1], "")).toBe(false);
  });

  it("varies range returns false", () => {
    expect(inRange(game, [0, 0], [1, 1], "varies")).toBe(false);
  });

  it("melee: adjacent tiles are in range", () => {
    expect(inRange(game, [5, 5], [5, 6], "melee")).toBe(true); // right
    expect(inRange(game, [5, 5], [6, 5], "melee")).toBe(true); // down
    expect(inRange(game, [5, 5], [6, 6], "melee")).toBe(true); // diagonal
    expect(inRange(game, [5, 5], [5, 7], "melee")).toBe(false); // 2 away
  });

  it("global: anything is in range", () => {
    expect(inRange(game, [0, 0], [9, 9], "global")).toBe(true);
  });

  it("range X: Manhattan distance with LOS", () => {
    expect(inRange(game, [5, 5], [5, 7], "range 3")).toBe(true); // manhattan 2
    expect(inRange(game, [5, 5], [5, 9], "range 3")).toBe(false); // manhattan 4
    expect(inRange(game, [5, 5], [3, 7], "range 3")).toBe(false); // manhattan 4
    expect(inRange(game, [5, 5], [5, 8], "range 4")).toBe(true); // manhattan 3
  });

  it("homing X: Manhattan distance, no LOS needed", () => {
    expect(inRange(game, [5, 5], [5, 9], "homing 5")).toBe(true); // manhattan 4
    expect(inRange(game, [5, 5], [5, 9], "homing 3")).toBe(false); // manhattan 4
  });

  it("burst X: Chebyshev distance", () => {
    expect(inRange(game, [5, 5], [7, 7], "burst 3")).toBe(true); // cheb 2
    expect(inRange(game, [5, 5], [5, 8], "burst 2")).toBe(false); // cheb 3
    expect(inRange(game, [5, 5], [5, 8], "burst 3")).toBe(true); // cheb 3
  });

  it("line X: cardinal or diagonal", () => {
    expect(inRange(game, [5, 5], [5, 9], "line 5")).toBe(true); // cardinal, dist 4
    expect(inRange(game, [5, 5], [9, 9], "line 5")).toBe(false); // diagonal, diagDist 4 > ceil(5/2)=3
    expect(inRange(game, [5, 5], [8, 8], "line 5")).toBe(true); // diagonal, diagDist 3 <= ceil(5/2)=3
    expect(inRange(game, [5, 5], [3, 7], "line 5")).toBe(true); // diagonal, diagDist 2 <= ceil(5/2)=3
  });
});

// ---------------------------------------------------------------------------
// AoE Tiles
// ---------------------------------------------------------------------------

describe("getBurstTiles", () => {
  it("burst 1 returns 8 tiles", () => {
    const tiles = getBurstTiles([2, 2], 1);
    expect(tiles.length).toBe(8);
    expect(tiles.some(([r, c]) => r === 1 && c === 2)).toBe(true); // up
    expect(tiles.some(([r, c]) => r === 3 && c === 2)).toBe(true); // down
    expect(tiles.some(([r, c]) => r === 1 && c === 1)).toBe(true); // diag
    // Should not include center
    expect(tiles.some(([r, c]) => r === 2 && c === 2)).toBe(false);
  });

  it("burst 2 returns 24 tiles", () => {
    const tiles = getBurstTiles([2, 2], 2);
    expect(tiles.length).toBe(24); // 5*5 - 1
  });
});

describe("getStarTiles", () => {
  it("star 1 returns 4 tiles (diamond shape)", () => {
    const tiles = getStarTiles([2, 2], 1);
    expect(tiles.length).toBe(4); // up, down, left, right only (no diagonal)
    expect(tiles.some(([r, c]) => r === 1 && c === 2)).toBe(true);
    expect(tiles.some(([r, c]) => r === 2 && c === 1)).toBe(true);
    expect(tiles.some(([r, c]) => r === 1 && c === 1)).toBe(false); // diagonal NOT in star
  });

  it("star 2 returns 12 tiles", () => {
    const tiles = getStarTiles([2, 2], 2);
    expect(tiles.length).toBe(12); // manhattan 1 (4) + manhattan 2 (8) = 12
  });
});

describe("getConeTiles", () => {
  it("cone generates tiles in all 4 cardinal directions", () => {
    const tiles = getConeTiles([5, 5], 1);
    // Cone 1: 3 tiles forward in each direction (1 forward + 1 to each side)
    // Up: [4,4], [4,5], [4,6]
    // Down: [6,4], [6,5], [6,6]
    // Left: [4,4], [5,4], [6,4]
    // Right: [4,6], [5,6], [6,6]
    // Total = 12 (with some overlap at corners)
    expect(tiles.length).toBe(12);
  });

  it("cone does not include origin", () => {
    const tiles = getConeTiles([5, 5], 3);
    expect(tiles.some(([r, c]) => r === 5 && c === 5)).toBe(false);
  });
});

describe("getLineTiles", () => {
  it("generates tiles in all 8 directions", () => {
    const tiles = getLineTiles([5, 5], 3);
    // 4 cardinal * 3 + 4 diagonal * ceil(3/2) = 12 + 8 = 20
    expect(tiles.length).toBe(20);
  });

  it("does not include origin", () => {
    const tiles = getLineTiles([5, 5], 5);
    expect(tiles.some(([r, c]) => r === 5 && c === 5)).toBe(false);
  });
});

describe("getPierceTiles", () => {
  it("same as getLineTiles", () => {
    const line = getLineTiles([5, 5], 3);
    const pierce = getPierceTiles([5, 5], 3);
    expect(pierce.length).toBe(line.length);
  });
});

describe("getBeamTiles", () => {
  it("generates 3-wide tiles in 4 cardinal directions", () => {
    const tiles = getBeamTiles([5, 5], 2);
    // 4 directions * 2 depth * 3 width = 24
    expect(tiles.length).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// AoE Targeting
// ---------------------------------------------------------------------------

describe("getAoETargets", () => {
  it("finds enemies in burst radius", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const p3 = makeEntity({ num: "P3", name: "C", pos: [4, 4], team: 1 });
    const game = makeGame({ entities: [p1, p2, p3] });
    const targets = getAoETargets(game, p1, "Burst 1", "Foe");
    expect(targets.map((t) => t.num)).toContain("P2");
    expect(targets.map((t) => t.num)).not.toContain("P3"); // too far
  });

  it("excludes dead entities", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const p2 = makeEntity({
      num: "P2",
      name: "B",
      pos: [2, 3],
      team: 1,
      curhp: 0,
    });
    const game = makeGame({ entities: [p1, p2] });
    const targets = getAoETargets(game, p1, "Burst 1", "Foe");
    expect(targets.length).toBe(0);
  });

  it("normalized group 'Self, Foes, Allies' targets allies and foes", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 1 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 2 });
    const p3 = makeEntity({ num: "P3", name: "C", pos: [2, 1], team: 1 });
    const game = makeGame({ entities: [p1, p2, p3] });
    const targets = getAoETargets(game, p1, "Burst 1", "Self, Foes, Allies");
    expect(targets.map((t) => t.num).sort()).toEqual(["P2", "P3"]);
  });

  it("group 'Self or Foe' targets foes but excludes allies", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 1 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 2 });
    const p3 = makeEntity({ num: "P3", name: "C", pos: [2, 1], team: 1 });
    const game = makeGame({ entities: [p1, p2, p3] });
    const targets = getAoETargets(game, p1, "Burst 1", "Self or Foe");
    expect(targets.map((t) => t.num)).toEqual(["P2"]);
  });

  it("legacy group 'Foe(s)' targets foes", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 1 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 2 });
    const p3 = makeEntity({ num: "P3", name: "C", pos: [2, 1], team: 1 });
    const game = makeGame({ entities: [p1, p2, p3] });
    const targets = getAoETargets(game, p1, "Burst 1", "Foe(s)");
    expect(targets.map((t) => t.num)).toEqual(["P2"]);
  });

  it("group 'Allies and Self' targets allies", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 1 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 2 });
    const p3 = makeEntity({ num: "P3", name: "C", pos: [2, 1], team: 1 });
    const game = makeGame({ entities: [p1, p2, p3] });
    const targets = getAoETargets(game, p1, "Burst 1", "Allies and Self");
    expect(targets.map((t) => t.num)).toEqual(["P3"]);
  });

  it("group 'Tile or Foe' targets foes", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 1 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 2 });
    const p3 = makeEntity({ num: "P3", name: "C", pos: [2, 1], team: 1 });
    const game = makeGame({ entities: [p1, p2, p3] });
    const targets = getAoETargets(game, p1, "Burst 1", "Tile or Foe");
    expect(targets.map((t) => t.num)).toEqual(["P2"]);
  });
});

describe("getSplashTargets", () => {
  it("finds nearby enemies around primary target", () => {
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0], team: 0 });
    const primary = makeEntity({ num: "P2", name: "B", pos: [2, 2], team: 1 });
    const p3 = makeEntity({ num: "P3", name: "C", pos: [2, 3], team: 1 });
    const p4 = makeEntity({ num: "P4", name: "D", pos: [4, 4], team: 1 });
    const game = makeGame({ entities: [user, primary, p3, p4] });
    const splash = getSplashTargets(game, user, primary, 1, "Foe");
    expect(splash.map((t) => t.num)).toContain("P3");
    expect(splash.map((t) => t.num)).not.toContain("P4");
  });

  it("excludes the primary target itself", () => {
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0], team: 0 });
    const primary = makeEntity({ num: "P2", name: "B", pos: [2, 2], team: 1 });
    const game = makeGame({ entities: [user, primary] });
    const splash = getSplashTargets(game, user, primary, 2, "Foe");
    expect(splash.some((t) => t.num === "P2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Push / Pull
// ---------------------------------------------------------------------------

describe("pushEntity", () => {
  it("pushes target away from source", () => {
    const game = makeGame();
    const target = makeEntity({ num: "P1", name: "T", pos: [2, 2], team: 0 });
    game.entities = [target];
    const { moved, path } = pushEntity(game, target, [2, 0], 2);
    expect(moved).toBe(2);
    expect(target.pos[1]).toBe(4); // pushed right
    expect(path.length).toBe(2);
  });

  it("stops at obstruction", () => {
    const map = Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal));
    map[2][3] = Terrain.Stone;
    const game = makeGame({ terrain: map });
    const target = makeEntity({ num: "P1", name: "T", pos: [2, 2], team: 0 });
    game.entities = [target];
    const { moved } = pushEntity(game, target, [2, 0], 5);
    expect(moved).toBe(0); // stone at [2,3] blocks the first push tile
  });

  it("stops at map edge", () => {
    const game = makeGame({ size: 5 });
    const target = makeEntity({ num: "P1", name: "T", pos: [2, 4], team: 0 });
    game.entities = [target];
    const { moved } = pushEntity(game, target, [2, 0], 5);
    expect(moved).toBe(0); // already at right edge
  });
});

describe("pullEntity", () => {
  it("pulls target towards source", () => {
    const game = makeGame();
    const target = makeEntity({ num: "P1", name: "T", pos: [2, 4], team: 0 });
    game.entities = [target];
    const { moved } = pullEntity(game, target, [2, 0], 2);
    expect(moved).toBe(2);
    expect(target.pos[1]).toBe(2); // pulled left
  });
});

// ---------------------------------------------------------------------------
// Deal Damage
// ---------------------------------------------------------------------------

describe("dealDamage", () => {
  it("reduces HP by damage amount", () => {
    const e = makeEntity({ num: "P1", name: "T", curhp: 100, maxhp: 100 });
    const result = dealDamage(e, 30);
    expect(result.actual).toBe(30);
    expect(result.shieldAbsorbed).toBe(0);
    expect(e.curhp).toBe(70);
  });

  it("clamps to 0", () => {
    const e = makeEntity({ num: "P1", name: "T", curhp: 10 });
    const result = dealDamage(e, 50);
    expect(result.actual).toBe(50);
    expect(e.curhp).toBe(0);
  });

  it("negative damage is clamped to 0", () => {
    const e = makeEntity({ num: "P1", name: "T", curhp: 100 });
    const result = dealDamage(e, -5);
    expect(result.actual).toBe(0);
    expect(e.curhp).toBe(100);
  });

  it("shield absorbs damage before HP", () => {
    const e = makeEntity({
      num: "P1",
      name: "T",
      curhp: 50,
      statuses: [
        {
          name: "Shield",
          damage: 20,
          rounds: 3,
          maxRounds: 3,
          removable: true,
        },
      ],
    });
    const result = dealDamage(e, 30);
    expect(result.shieldAbsorbed).toBe(20);
    expect(result.actual).toBe(10);
    expect(e.curhp).toBe(40);
    expect(e.statuses.length).toBe(0); // shield broken
    expect(result.shieldBreaks).toBe(true);
  });

  it("shield fully absorbs damage", () => {
    const e = makeEntity({
      num: "P1",
      name: "T",
      curhp: 50,
      statuses: [
        {
          name: "Shield",
          damage: 100,
          rounds: 3,
          maxRounds: 3,
          removable: true,
        },
      ],
    });
    const result = dealDamage(e, 30);
    expect(result.shieldAbsorbed).toBe(30);
    expect(result.actual).toBe(0);
    expect(e.curhp).toBe(50);
    expect(e.statuses[0].damage).toBe(70); // 100 - 30
    expect(result.shieldBreaks).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Accuracy
// ---------------------------------------------------------------------------

describe("rollAccuracy", () => {
  it("returns hit/miss and crit info", () => {
    const result = rollAccuracy(10, 5);
    expect(typeof result.hit).toBe("boolean");
    expect(typeof result.roll).toBe("number");
    expect(typeof result.crit).toBe("boolean");
    expect(result.roll).toBeGreaterThanOrEqual(1);
    expect(result.roll).toBeLessThanOrEqual(25); // 1d20 + 0 bonuses
  });

  it("crit happens on natural 20", () => {
    // We can't guarantee a 20, but we can check the structure
    // Run many times and check that at least some crit
    let sawCrit = false;
    for (let i = 0; i < 1000; i++) {
      if (rollAccuracy(0, 0, 0).crit) {
        sawCrit = true;
        break;
      }
    }
    expect(sawCrit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Game Over
// ---------------------------------------------------------------------------

describe("checkGameOver", () => {
  it("returns null when 2+ entities alive in FFA", () => {
    const game = makeGame({
      entities: [
        makeEntity({ num: "P1", name: "A", curhp: 100 }),
        makeEntity({ num: "P2", name: "B", curhp: 50 }),
      ],
    });
    expect(checkGameOver(game)).toBeNull();
  });

  it("returns winner when 1 alive in FFA", () => {
    const p1 = makeEntity({ num: "P1", name: "A", curhp: 100 });
    const p2 = makeEntity({ num: "P2", name: "B", curhp: 0 });
    const game = makeGame({ entities: [p1, p2] });
    const winner = checkGameOver(game);
    expect(winner?.num).toBe("P1");
    expect(game.phase).toBe("ended");
  });

  it("zero survivors: phase ends with null winner (a draw)", () => {
    const p1 = makeEntity({ num: "P1", name: "A", curhp: 0 });
    const p2 = makeEntity({ num: "P2", name: "B", curhp: 0 });
    const game = makeGame({ entities: [p1, p2] });
    const winner = checkGameOver(game);
    expect(winner).toBeNull();
    expect(game.phase).toBe("ended");
    expect(game.winner).toBeNull();
  });

  it("returns null in team mode when both teams alive", () => {
    const game = makeGame({
      mode: "2v2",
      entities: [
        makeEntity({ num: "P1", name: "A", curhp: 100, team: 0 }),
        makeEntity({ num: "P2", name: "B", curhp: 100, team: 0 }),
        makeEntity({ num: "P3", name: "C", curhp: 50, team: 1 }),
        makeEntity({ num: "P4", name: "D", curhp: 50, team: 1 }),
      ],
    });
    expect(checkGameOver(game)).toBeNull();
  });

  it("returns winner in team mode when one team wiped", () => {
    const game = makeGame({
      mode: "2v2",
      entities: [
        makeEntity({ num: "P1", name: "A", curhp: 100, team: 0 }),
        makeEntity({ num: "P2", name: "B", curhp: 100, team: 0 }),
        makeEntity({ num: "P3", name: "C", curhp: 0, team: 1 }),
        makeEntity({ num: "P4", name: "D", curhp: 0, team: 1 }),
      ],
    });
    const winner = checkGameOver(game);
    expect(winner).not.toBeNull();
    expect(winner?.team).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------

describe("calculateLoot", () => {
  it("returns loot for each entity", () => {
    const game = makeGame({
      entities: [
        makeEntity({ num: "P1", name: "A", curhp: 100 }),
        makeEntity({ num: "P2", name: "B", curhp: 50 }),
      ],
    });
    game.kills = { P1: 2, P2: 0 };
    game.winner = "P1";
    const loot = calculateLoot(game);
    expect(loot.length).toBe(2);
    const p1Loot = loot.find((l) => l.entity.num === "P1");
    const p2Loot = loot.find((l) => l.entity.num === "P2");
    expect(p1Loot).toBeDefined();
    expect(p2Loot).toBeDefined();
    // Winner gets 1.5x
    expect(p1Loot!.xp).toBeGreaterThan(p2Loot!.xp);
  });

  it("gem count scales with player count", () => {
    const game4 = makeGame({
      entities: Array.from({ length: 4 }, (_, i) =>
        makeEntity({ num: `P${i + 1}`, name: `P${i + 1}`, curhp: 100 }),
      ),
    });
    const loot4 = calculateLoot(game4);
    expect(loot4[0].gems).toBe(1);

    const game6 = makeGame({
      entities: Array.from({ length: 6 }, (_, i) =>
        makeEntity({ num: `P${i + 1}`, name: `P${i + 1}`, curhp: 100 }),
      ),
    });
    const loot6 = calculateLoot(game6);
    expect(loot6[0].gems).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

describe("Snapshots", () => {
  it("pushSnapshot and popSnapshot restore state", () => {
    const p1 = makeEntity({ num: "P1", name: "A", curhp: 100, pos: [0, 0] });
    const game = makeGame({ entities: [p1] });

    pushSnapshot(game);
    expect(game.snapshots.length).toBe(1);

    // Mutate
    p1.curhp = 20;
    p1.pos = [3, 3];
    expect(p1.curhp).toBe(20);

    // Pop restores
    popSnapshot(game);
    expect(p1.curhp).toBe(100);
    expect(p1.pos).toEqual([0, 0]);
  });

  it("popSnapshot removes action log entries added after the snapshot", () => {
    const p1 = makeEntity({ num: "P1", name: "A", curhp: 100, pos: [0, 0] });
    const game = makeGame({ entities: [p1] });

    pushSnapshot(game);
    game.log.push({
      turn: 1,
      entity: "P1",
      description: "A punches B",
      snapshot: "",
    });
    expect(game.log.length).toBe(1);

    popSnapshot(game);
    expect(game.log.length).toBe(0);
  });

  it("returns false when no snapshots", () => {
    const game = makeGame();
    expect(popSnapshot(game)).toBe(false);
  });

  it("caps snapshots at 20", () => {
    const game = makeGame();
    for (let i = 0; i < 25; i++) pushSnapshot(game);
    expect(game.snapshots.length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Turn Management
// ---------------------------------------------------------------------------

describe("Turn Management", () => {
  it("getCurrentEntity returns the active entity", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({
      entities: [p1, p2],
      turnOrder: ["P1", "P2"],
    });
    game.turnIndex = 0;
    expect(getCurrentEntity(game)?.num).toBe("P1");
  });

  it("getEntity finds by num or name", () => {
    const game = makeGame();
    expect(getEntity(game, "P1")?.num).toBe("P1");
    expect(getEntity(game, "p1")?.num).toBe("P1");
    expect(getEntity(game, "Alice")?.num).toBe("P1");
  });

  it("nextTurn advances turnIndex", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({
      entities: [p1, p2],
      turnOrder: ["P1", "P2"],
    });
    game.turnIndex = 0;
    const next = nextTurn(game);
    expect(next.entity?.num).toBe("P2");
    expect(game.turnIndex).toBe(1);
  });

  it("nextTurn wraps to round 2", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({
      entities: [p1, p2],
      turnOrder: ["P1", "P2"],
    });
    game.turnIndex = 1;
    game.round = 1;
    nextTurn(game);
    expect(game.turnIndex).toBe(0);
    expect(game.round).toBe(2);
  });

  it("nextTurn resets per-turn flags", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({
      entities: [p1, p2],
      turnOrder: ["P1", "P2"],
    });
    p1.dashUsed = true;
    p1.standardUsed = true;
    nextTurn(game);
    // p1 is not the current entity anymore, check p2
    expect(p2.dashUsed).toBe(false);
    expect(p2.standardUsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Start-of-Turn Processing
// ---------------------------------------------------------------------------

describe("processStartOfTurn", () => {
  it("applies status damage", () => {
    const e = makeEntity({
      num: "P1",
      name: "A",
      curhp: 100,
      statuses: [
        { name: "Bleed", damage: 10, rounds: 3, maxRounds: 3, removable: true },
      ],
    });
    const game = makeGame();
    const { messages, died } = processStartOfTurn(game, e);
    expect(e.curhp).toBe(90);
    expect(died).toBe(false);
    expect(messages.some((m) => m.includes("Bleed"))).toBe(true);
  });

  it("applies lava damage at end of turn", () => {
    const map = Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal));
    map[2][2] = Terrain.Lava;
    const game = makeGame({ terrain: map });
    const e = makeEntity({ num: "P1", name: "A", curhp: 100, pos: [2, 2] });
    const { died } = processEndOfTurn(game, e);
    expect(e.curhp).toBe(70); // 30 lava damage
    expect(died).toBe(false);
  });

  it("ticks cooldowns and removes expired ones at end of turn", () => {
    const e = makeEntity({
      num: "P1",
      name: "A",
      cooldowns: { Fireball: 2, Heal: 1 },
    });
    const game = makeGame();
    processEndOfTurn(game, e);
    expect(e.cooldowns["Fireball"]).toBe(1);
    expect(e.cooldowns["Heal"]).toBeUndefined();
  });

  it("ticks buff durations and removes expired at end of turn", () => {
    const e = makeEntity({
      num: "P1",
      name: "A",
      buffs: [
        { stat: "atk", amount: 5, rounds: 2 },
        { stat: "pd", amount: 3, rounds: 1 },
      ],
    });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({
      entities: [e, p2],
      turnOrder: ["P1", "P2"],
    });
    game.turnIndex = 0;
    const result = nextTurn(game);
    expect(e.buffs.length).toBe(1);
    expect(e.buffs[0].stat).toBe("atk");
    expect(e.buffs[0].rounds).toBe(1);
    expect(result.entity?.num).toBe("P2");
  });

  it("ticks status durations and removes expired at end of turn", () => {
    const e = makeEntity({
      num: "P1",
      name: "A",
      statuses: [
        { name: "Bleed", damage: 5, rounds: 3, maxRounds: 3, removable: true },
        { name: "Burn", damage: 3, rounds: 1, maxRounds: 1, removable: true },
      ],
    });
    const game = makeGame();
    processEndOfTurn(game, e);
    // Burn has 1 round, gets ticked to 0 and removed. Bleed goes from 3 to 2.
    expect(e.statuses.length).toBe(1);
    expect(e.statuses[0].name).toBe("Bleed");
    expect(e.statuses[0].rounds).toBe(2);
  });

  it("returns died=true when status damage kills entity", () => {
    const e = makeEntity({
      num: "P1",
      name: "A",
      curhp: 5,
      statuses: [
        { name: "Bleed", damage: 10, rounds: 2, maxRounds: 2, removable: true },
      ],
    });
    const game = makeGame();
    const { died, messages } = processStartOfTurn(game, e);
    expect(e.curhp).toBe(0);
    expect(died).toBe(true);
    expect(messages.some((m) => m.includes("defeated"))).toBe(true);
    // Entity should be removed from game
    expect(game.entities.find((x) => x.num === "P1")).toBeUndefined();
  });

  it("returns died=true when lava damage kills entity at end of turn", () => {
    const map = Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal));
    map[2][2] = Terrain.Lava;
    const game = makeGame({ terrain: map });
    const e = makeEntity({ num: "P1", name: "A", curhp: 20, pos: [2, 2] });
    const { died } = processEndOfTurn(game, e);
    expect(e.curhp).toBe(0);
    expect(died).toBe(true);
    expect(game.entities.find((x) => x.num === "P1")).toBeUndefined();
  });
});

describe("processEndOfTurn", () => {
  it("returns died=false when status remains active", () => {
    const e = makeEntity({
      num: "P1",
      name: "A",
      statuses: [
        { name: "Bleed", damage: 10, rounds: 3, maxRounds: 3, removable: true },
      ],
    });
    const game = makeGame();
    const { died } = processEndOfTurn(game, e);
    expect(died).toBe(false);
  });

  it("deals no status damage at end of turn", () => {
    const e = makeEntity({
      num: "P1",
      name: "A",
      curhp: 100,
      statuses: [
        { name: "Bleed", damage: 10, rounds: 3, maxRounds: 3, removable: true },
      ],
    });
    const game = makeGame();
    const { messages } = processEndOfTurn(game, e);
    expect(e.curhp).toBe(100);
    expect(messages.some((m) => m.includes("damage"))).toBe(false);
  });
});

describe("nextTurn end-of-turn death", () => {
  it("skips the entity that died at end of turn", () => {
    const map = Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal));
    map[1][1] = Terrain.Lava;
    const p1 = makeEntity({ num: "P1", name: "A", curhp: 20, pos: [1, 1] });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const p3 = makeEntity({ num: "P3", name: "C" });
    const game = makeGame({
      entities: [p1, p2, p3],
      turnOrder: ["P1", "P2", "P3"],
      terrain: map,
    });
    game.turnIndex = 0;
    const result = nextTurn(game);
    expect(result.died).toBe(true);
    expect(result.entity?.num).toBe("P2");
    expect(game.turnIndex).toBe(0);
  });

  it("does not skip when the ending entity survives", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const p3 = makeEntity({ num: "P3", name: "C" });
    const game = makeGame({
      entities: [p1, p2, p3],
      turnOrder: ["P1", "P2", "P3"],
    });
    game.turnIndex = 0;
    const result = nextTurn(game);
    expect(result.died).toBe(false);
    expect(result.entity?.num).toBe("P2");
  });

  it("hands the turn to the shifted-in entity when the active actor died mid-turn", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B", curhp: 1 });
    const p3 = makeEntity({ num: "P3", name: "C" });
    const game = makeGame({
      entities: [p1, p2, p3],
      turnOrder: ["P1", "P2", "P3"],
    });
    game.turnIndex = 1; // P2 is acting
    // P2 dies mid-turn (recoil/confusion) and is removed; P3 shifts into
    // index 1. nextTurn must hand the turn to P3, not skip it.
    removeEntity(game, p2);
    const result = nextTurn(game, { actorDied: true });
    expect(result.entity?.num).toBe("P3");
    expect(game.turnIndex).toBe(1);
  });

  it("wraps to the first entity when the last actor dies mid-turn", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const p3 = makeEntity({ num: "P3", name: "C", curhp: 1 });
    const game = makeGame({
      entities: [p1, p2, p3],
      turnOrder: ["P1", "P2", "P3"],
    });
    game.turnIndex = 2; // P3 is acting (last in order)
    removeEntity(game, p3); // P3 dies mid-turn; removal clamps turnIndex to 0
    const result = nextTurn(game, { actorDied: true });
    expect(result.entity?.num).toBe("P1");
    expect(game.turnIndex).toBe(0);
  });

  it("advances the round when the last actor dies mid-turn (round wrap)", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const p3 = makeEntity({ num: "P3", name: "C", curhp: 1 });
    const game = makeGame({
      entities: [p1, p2, p3],
      turnOrder: ["P1", "P2", "P3"],
    });
    game.turnIndex = 2; // P3 (last slot) is acting
    game.round = 1;
    removeEntity(game, p3); // dies mid-turn; removal wraps turnIndex to 0
    const result = nextTurn(game, { actorDied: true });
    expect(result.entity?.num).toBe("P1");
    expect(game.turnIndex).toBe(0);
    expect(game.round).toBe(2); // removeEntity advanced the round for the completed cycle
  });

  it("does not advance the round when a mid-slot actor dies mid-turn", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B", curhp: 1 });
    const p3 = makeEntity({ num: "P3", name: "C" });
    const game = makeGame({
      entities: [p1, p2, p3],
      turnOrder: ["P1", "P2", "P3"],
    });
    game.turnIndex = 1; // P2 (mid-slot) is acting
    game.round = 1;
    removeEntity(game, p2); // dies mid-turn; P3 shifts into slot 1 (no wrap)
    const result = nextTurn(game, { actorDied: true });
    expect(result.entity?.num).toBe("P3");
    expect(game.turnIndex).toBe(1);
    expect(game.round).toBe(1); // cycle NOT complete
  });

  it("advances the round when a start-of-turn death in the final slot wraps the turn pointer", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const p3 = makeEntity({ num: "P3", name: "C", curhp: 0 }); // dead but still present
    const game = makeGame({
      entities: [p1, p2, p3],
      turnOrder: ["P1", "P2", "P3"],
    });
    game.turnIndex = 1; // P2 is acting; P3 is next in the final slot
    game.round = 1;
    const result = nextTurn(game);
    expect(result.entity?.num).toBe("P1"); // P3 removed at start, pointer wrapped to P1
    expect(game.turnIndex).toBe(0);
    expect(game.round).toBe(2); // full cycle completed via the start-of-turn wrap
  });

  it("removes a dead-but-present entity instead of handing it the turn", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B", curhp: 0 }); // dead but still present
    const p3 = makeEntity({ num: "P3", name: "C" });
    const game = makeGame({
      entities: [p1, p2, p3],
      turnOrder: ["P1", "P2", "P3"],
    });
    game.turnIndex = 1; // P2 was the actor but died and its corpse was missed
    const result = nextTurn(game, { actorDied: true });
    expect(result.entity?.num).toBe("P3");
    expect(game.entities.find((e) => e.num === "P2")).toBeUndefined();
  });

  it("advances past an entity that dies at the start of its turn", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({
      num: "P2",
      name: "B",
      curhp: 5,
      statuses: [
        { name: "Bleed", damage: 99, rounds: 3, maxRounds: 3, removable: true },
      ],
    });
    const p3 = makeEntity({ num: "P3", name: "C" });
    const game = makeGame({
      entities: [p1, p2, p3],
      turnOrder: ["P1", "P2", "P3"],
    });
    game.turnIndex = 0; // P1's turn is ending; P2's turn begins and bleeds out
    const result = nextTurn(game);
    expect(result.entity?.num).toBe("P3");
    expect(result.died).toBe(true);
    expect(game.entities.find((x) => x.num === "P2")).toBeUndefined();
  });

  it("ends the game when the last survivors die across the turn transition", () => {
    const map = Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal));
    map[0][0] = Terrain.Lava;
    const p1 = makeEntity({ num: "P1", name: "A", curhp: 20, pos: [0, 0] });
    const p2 = makeEntity({
      num: "P2",
      name: "B",
      curhp: 5,
      pos: [2, 2],
      statuses: [
        { name: "Bleed", damage: 99, rounds: 3, maxRounds: 3, removable: true },
      ],
    });
    const game = makeGame({
      entities: [p1, p2],
      turnOrder: ["P1", "P2"],
      terrain: map,
    });
    // P1 ends its turn on lava and dies; P2's turn begins and bleeds out.
    game.turnIndex = 0;
    const result = nextTurn(game);
    expect(result.entity).toBeNull();
    expect(result.died).toBe(true);
    expect(game.phase).toBe("ended");
    expect(game.entities.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Remove Entity
// ---------------------------------------------------------------------------

describe("removeEntity", () => {
  it("removes entity from game", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({
      entities: [p1, p2],
      turnOrder: ["P1", "P2"],
    });
    removeEntity(game, p1);
    expect(game.entities.length).toBe(1);
    expect(game.entities[0].num).toBe("P2");
    expect(game.turnOrder).toEqual(["P2"]);
  });

  it("drops the removed entity's gamemode vote", () => {
    const p1 = makeEntity({ num: "P1", name: "A" });
    const p2 = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [p1, p2] });
    game.votes = { p1: "FFA", p2: "2v2" };
    removeEntity(game, p1);
    expect(game.votes).toEqual({ p2: "2v2" });
  });
});

describe("formatChatTime", () => {
  it("formats an epoch timestamp as [HH:MM]", () => {
    // 09:05 local time (any timezone)
    const ts = new Date();
    ts.setHours(9, 5, 0, 0);
    expect(formatChatTime(ts.getTime())).toBe("[09:05]");
  });

  it("returns an empty string when no timestamp is present (old snapshots)", () => {
    expect(formatChatTime(undefined)).toBe("");
    expect(formatChatTime(0)).toBe("");
  });
});


describe("getAoETargets FFA (team 0 = no teams)", () => {
  it("hits every in-range player except the user", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 0 });
    const p3 = makeEntity({ num: "P3", name: "C", pos: [3, 2], team: 0 });
    const game = makeGame({ entities: [p1, p2, p3] });
    const targets = getAoETargets(game, p1, "Burst 1", "Foe");
    expect(targets.map((t) => t.num).sort()).toEqual(["P2", "P3"]);
    expect(targets.some((t) => t.num === "P1")).toBe(false);
  });

  it("finds no allies in FFA", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 0 });
    const game = makeGame({ entities: [p1, p2] });
    const targets = getAoETargets(game, p1, "Burst 1", "Ally");
    expect(targets.length).toBe(0);
  });

  it("Self and Ally AoE hits only the user in FFA (no others in-range qualify)", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 0 });
    const p3 = makeEntity({ num: "P3", name: "C", pos: [3, 2], team: 0 });
    const game = makeGame({ entities: [p1, p2, p3] });
    const targets = getAoETargets(game, p1, "Burst 1", "Self and Ally");
    // The user is the only valid target and AoE results exclude the user.
    expect(targets.length).toBe(0);
    // Sanity: without the new branch this group would hit everyone in range.
    expect(getAoETargets(game, p1, "Burst 1", "Any").map((t) => t.num).sort()).toEqual(["P2", "P3"]);
  });

  it("Allies and Self AoE hits nobody else in FFA (Weaver's Whirl)", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 0 });
    const game = makeGame({ entities: [p1, p2] });
    const targets = getAoETargets(game, p1, "Burst 1", "Allies and Self");
    expect(targets.length).toBe(0);
  });

  it("Allies and Self AoE hits allies in team mode (user excluded from results)", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 1 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const p3 = makeEntity({ num: "P3", name: "C", pos: [3, 2], team: 2 });
    const game = makeGame({ entities: [p1, p2, p3] });
    const targets = getAoETargets(game, p1, "Burst 1", "Allies and Self");
    expect(targets.map((t) => t.num)).toEqual(["P2"]);
    // Before the fix this fell through to the default true: everyone in range.
    expect(targets.some((t) => t.num === "P3")).toBe(false);
  });

  it("Self or Allies AoE hits allies in team mode (never foes)", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 1 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const p3 = makeEntity({ num: "P3", name: "C", pos: [3, 2], team: 2 });
    const game = makeGame({ entities: [p1, p2, p3] });
    const targets = getAoETargets(game, p1, "Burst 1", "Self or Allies");
    expect(targets.map((t) => t.num)).toEqual(["P2"]);
    // Before the fix the plural form fell through to default true.
    expect(targets.some((t) => t.num === "P3")).toBe(false);
  });

  it("Self or Allies AoE hits nobody else in FFA", () => {
    const p1 = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const p2 = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 0 });
    const game = makeGame({ entities: [p1, p2] });
    const targets = getAoETargets(game, p1, "Burst 1", "Self or Allies");
    expect(targets.length).toBe(0);
  });
});
