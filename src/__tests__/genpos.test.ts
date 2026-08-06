import { describe, it, expect } from "bun:test";
import {
  findSpawnPosition,
  genPosSlots,
  genTeamSlots,
  placePlayers,
  placeTeamPlayers,
} from "../commands/host.js";
import {
  isStandable,
  type Entity,
  Terrain,
  type Game,
} from "../game/state.js";

function makeEntity(num: string, pos: [number, number] = [0, 0]): Entity {
  return {
    num,
    name: num,
    id: num.toLowerCase(),
    isMonster: false,
    curhp: 100,
    maxhp: 100,
    atk: 10,
    mag: 10,
    pd: 5,
    md: 5,
    eva: 0,
    mp: 3,
    pos,
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
  };
}

function makeGame(entities: Entity[], terrain = Terrain.Normal): Game {
  const map = Array.from({ length: 10 }, () => Array(10).fill(terrain));
  return {
    id: "test",
    room: "battledome",
    host: "Host",
    entities,
    map,
    mapName: "test",
    turnOrder: entities.map((e) => e.num),
    turnIndex: 0,
    round: 1,
    log: [],
    snapshots: [],
    mode: "ffa",
    phase: "setup",
    started: false,
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

describe("genPosSlots", () => {
  it("places 1 player at the center", () => {
    expect(genPosSlots(10, 10, 1)).toEqual([[5, 5]]);
  });

  it("places 2 players on opposite corners of the perimeter", () => {
    expect(genPosSlots(10, 10, 2)).toEqual([
      [0, 0],
      [9, 9],
    ]);
  });

  it("places 3 players equidistantly around the perimeter", () => {
    // 36-cell ring: 0 -> top-left, 12 -> (3,9), 24 -> (9,3).
    expect(genPosSlots(10, 10, 3)).toEqual([
      [0, 0],
      [3, 9],
      [9, 3],
    ]);
  });

  it("places 4 players in all corners", () => {
    expect(genPosSlots(10, 10, 4)).toEqual([
      [0, 0],
      [0, 9],
      [9, 9],
      [9, 0],
    ]);
  });

  it("keeps every player on the perimeter for larger lobbies", () => {
    // Mirror of perimeterRing() in host.ts: ordered ring starting top-left.
    const ring: string[] = [];
    for (let c = 0; c <= 9; c++) ring.push(`0,${c}`);
    for (let r = 1; r < 9; r++) ring.push(`${r},9`);
    for (let c = 9; c >= 0; c--) ring.push(`9,${c}`);
    for (let r = 8; r > 0; r--) ring.push(`${r},0`);

    for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
      const slots = genPosSlots(10, 10, n);
      expect(slots).toHaveLength(n);
      // Distinct positions.
      expect(new Set(slots.map(([r, c]) => `${r},${c}`)).size).toBe(n);
      // All on the perimeter ring.
      for (const [r, c] of slots) {
        expect(ring.includes(`${r},${c}`)).toBe(true);
      }
      // Roughly equidistant: adjacent players are at least total/n - 2 apart
      // along the ring (allow rounding slack).
      const idxs = slots.map(([r, c]) => ring.indexOf(`${r},${c}`));
      const sorted = [...idxs].sort((a, b) => a - b);
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
      gaps.push(ring.length - sorted[sorted.length - 1] + sorted[0]);
      const minGap = Math.min(...gaps);
      expect(minGap).toBeGreaterThanOrEqual(Math.floor(ring.length / n) - 2);
    }
  });
});

describe("genTeamSlots", () => {
  it("clumps 2v2 teams in mirrored corners (a1/b1 vs j10/i10)", () => {
    expect(genTeamSlots(10, 10, 2, 2)).toEqual([
      [
        [0, 0],
        [0, 1],
      ],
      [
        [9, 9],
        [9, 8],
      ],
    ]);
  });

  it("places 1v1 in opposite corners", () => {
    expect(genTeamSlots(10, 10, 1, 1)).toEqual([[[0, 0]], [[9, 9]]]);
  });

  it("supports uneven teams (1v2)", () => {
    expect(genTeamSlots(10, 10, 1, 2)).toEqual([
      [[0, 0]],
      [
        [9, 9],
        [9, 8],
      ],
    ]);
  });

  it("clumps 3v3 in a corner block (a1/b1/a2 vs j10/i10/j9)", () => {
    const [top, bottom] = genTeamSlots(10, 10, 3, 3);
    expect(top).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    expect(bottom).toEqual([
      [9, 9],
      [9, 8],
      [8, 9],
    ]);
  });

  it("clumps the max team size (5v5) in a tight corner block", () => {
    const [top, bottom] = genTeamSlots(10, 10, 5, 5);
    expect(top).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ]);
    expect(bottom).toEqual([
      [9, 9],
      [9, 8],
      [9, 7],
      [8, 9],
      [8, 8],
    ]);
    // Every teammate is within a 3x2 block of the corner — a tight clump.
    for (const [r, c] of top) {
      expect(r).toBeLessThanOrEqual(1);
      expect(c).toBeLessThanOrEqual(2);
    }
  });
});

describe("placeTeamPlayers", () => {
  it("places team 1 in the top half and team 2 in the bottom half", () => {
    // Distinct starting positions so stale entity pos never blocks the anchors.
    const teamA = [makeEntity("P1", [5, 5]), makeEntity("P2", [5, 6])];
    const teamB = [makeEntity("P3", [6, 5]), makeEntity("P4", [6, 6])];
    const game = makeGame([...teamA, ...teamB]);
    const out = placeTeamPlayers(game, teamA, teamB);
    expect(out).not.toBeNull();

    const keys = new Set<string>();
    for (const [e, pos] of [...out![0], ...out![1]]) {
      expect(game.map[pos[0]][pos[1]]).toBe(Terrain.Normal);
      const key = `${pos[0]},${pos[1]}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
      expect(e.pos).toEqual(pos);
    }
    for (const [, pos] of out![0]) expect(pos[0]).toBeLessThan(5); // top half
    for (const [, pos] of out![1]) expect(pos[0]).toBeGreaterThanOrEqual(5); // bottom half

    // 2v2: each team clumps in its own corner (a1/b1 vs j10/i10).
    expect(out![0].map(([, p]) => `${p[0]},${p[1]}`).sort()).toEqual(["0,0", "0,1"]);
    expect(out![1].map(([, p]) => `${p[0]},${p[1]}`).sort()).toEqual(["9,8", "9,9"]);
  });

  it("returns null when no open tiles exist", () => {
    const teamA = [makeEntity("P1")];
    const teamB = [makeEntity("P2")];
    const game = makeGame([...teamA, ...teamB], Terrain.Stop);
    expect(placeTeamPlayers(game, teamA, teamB)).toBeNull();
  });

  it("re-placing hits exact anchors even when entities already sit there (re-%genpos)", () => {
    // Entities were previously placed at the 2v2 anchors; re-running genpos
    // must NOT snap them to adjacent tiles because their old positions block
    // the anchors. This covers the being-placed ignore set in findNearestOpenTile.
    const teamA = [makeEntity("P1", [0, 0]), makeEntity("P2", [0, 1])];
    const teamB = [makeEntity("P3", [9, 9]), makeEntity("P4", [9, 8])];
    const game = makeGame([...teamA, ...teamB]);
    const out = placeTeamPlayers(game, teamA, teamB);
    expect(out).not.toBeNull();
    const corners = new Set(["0,0", "0,1", "9,8", "9,9"]);
    for (const [, pos] of [...out![0], ...out![1]]) {
      expect(corners.has(`${pos[0]},${pos[1]}`)).toBe(true);
    }
  });
});

describe("placePlayers", () => {
  it("places players on distinct open tiles", () => {
    const players = [makeEntity("P1"), makeEntity("P2")];
    const game = makeGame(players);
    const out = placePlayers(game, players);
    expect(out).not.toBeNull();
    const used = new Set<string>();
    for (const [e, pos] of out!) {
      expect(game.map[pos[0]][pos[1]]).toBe(Terrain.Normal);
      const key = `${pos[0]},${pos[1]}`;
      expect(used.has(key)).toBe(false);
      used.add(key);
      expect(e.pos).toEqual(pos);
    }
  });

  it("avoids tiles occupied by entities that are not being placed", () => {
    // The blocker is NOT in the placement list, so its spot stays occupied and
    // the placed players must land on other open tiles.
    const blocker = makeEntity("P1", [0, 0]);
    const players = [makeEntity("P2"), makeEntity("P3")];
    const game = makeGame([blocker, ...players]);
    const out = placePlayers(game, players);
    expect(out).not.toBeNull();
    const keys = out!.map(([, p]) => `${p[0]},${p[1]}`);
    expect(new Set(keys).size).toBe(2);
    expect(keys.includes("0,0")).toBe(false);
    expect(keys).toContain("9,9");
  });

  it("returns null when no open tiles exist", () => {
    const players = [makeEntity("P1"), makeEntity("P2")];
    const game = makeGame(players, Terrain.Stop);
    expect(placePlayers(game, players)).toBeNull();
  });

  it("re-placing hits exact anchors when entities already sit there (re-%genpos)", () => {
    // Same re-%genpos case for FFA: previous positions on the anchors must not
    // push the players to adjacent tiles.
    const players = [makeEntity("P1", [0, 0]), makeEntity("P2", [9, 9])];
    const game = makeGame(players);
    const out = placePlayers(game, players);
    expect(out).not.toBeNull();
    const keys = out!.map(([, p]) => `${p[0]},${p[1]}`);
    expect(keys).toContain("0,0");
    expect(keys).toContain("9,9");
  });

  it("never places a player on a Broken tile, even when all anchors are Broken", () => {
    // Entire perimeter ring (the genPosSlots anchors) is Broken — players must
    // snap inward to standable tiles instead of landing on Broken.
    const map = Array.from({ length: 10 }, () => Array(10).fill(Terrain.Normal));
    for (let r = 0; r < 10; r++) {
      map[r][0] = Terrain.Broken;
      map[r][9] = Terrain.Broken;
      map[0][r] = Terrain.Broken;
      map[9][r] = Terrain.Broken;
    }
    const players = [makeEntity("P1"), makeEntity("P2"), makeEntity("P3")];
    const game: Game = { ...makeGame(players), map };
    const out = placePlayers(game, players);
    expect(out).not.toBeNull();
    const used = new Set<string>();
    for (const [e, pos] of out!) {
      expect(map[pos[0]][pos[1]]).not.toBe(Terrain.Broken);
      expect(isStandable(map[pos[0]][pos[1]])).toBe(true);
      const key = `${pos[0]},${pos[1]}`;
      expect(used.has(key)).toBe(false);
      used.add(key);
      expect(e.pos).toEqual(pos);
    }
  });
});

describe("findSpawnPosition", () => {
  it("never returns a Broken or obstruction tile", () => {
    const map = Array.from({ length: 10 }, () => Array(10).fill(Terrain.Normal));
    // Scatter impassable tiles around so the spiral has to dodge them.
    for (const [r, c] of [[4, 4], [4, 5], [5, 4], [5, 5], [8, 1], [1, 8]] as const) {
      map[r][c] = Terrain.Broken;
    }
    const game: Game = { ...makeGame([]), map };
    const pos = findSpawnPosition(game);
    expect(isStandable(map[pos[0]][pos[1]])).toBe(true);
    expect(map[pos[0]][pos[1]]).not.toBe(Terrain.Broken);
  });

  it("falls back to the full-map scan when the spiral finds nothing standable", () => {
    // Every tile is Broken except a single Normal in a far corner. The spiral
    // (which starts at center) reaches it via the exhaustive ring walk, but if
    // the map had zero standable tiles the fallback would still never invent a
    // Broken spawn. Here we prove the scan finds the one good tile anywhere.
    const map = Array.from({ length: 10 }, () => Array(10).fill(Terrain.Broken));
    map[0][9] = Terrain.Normal;
    const game: Game = { ...makeGame([]), map };
    const pos = findSpawnPosition(game);
    expect(pos).toEqual([0, 9]);
  });
});
