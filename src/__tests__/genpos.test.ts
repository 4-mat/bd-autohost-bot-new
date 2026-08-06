import { describe, it, expect } from "bun:test";
import {
  genPosSlots,
  genTeamSlots,
  placePlayers,
  placeTeamPlayers,
} from "../commands/host.js";
import { type Entity, Terrain, type Game } from "../game/state.js";

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

  it("places 2 players in opposite corners", () => {
    expect(genPosSlots(10, 10, 2)).toEqual([
      [0, 0],
      [9, 9],
    ]);
  });

  it("places 3 players in a balanced triangle (top corners + bottom-center)", () => {
    expect(genPosSlots(10, 10, 3)).toEqual([
      [0, 0],
      [0, 9],
      [9, 5],
    ]);
  });

  it("places 4 players in all corners", () => {
    expect(genPosSlots(10, 10, 4)).toEqual([
      [0, 0],
      [9, 9],
      [0, 9],
      [9, 0],
    ]);
  });

  it("places 5 players in corners plus center", () => {
    const slots = genPosSlots(10, 10, 5);
    expect(slots).toHaveLength(5);
    expect(slots[4]).toEqual([5, 5]);
    expect(new Set(slots.map(([r, c]) => `${r},${c}`)).size).toBe(5);
  });
});

describe("genTeamSlots", () => {
  it("spreads 2v2 so all four players sit in corners", () => {
    expect(genTeamSlots(10, 10, 2, 2)).toEqual([
      [
        [0, 0],
        [0, 9],
      ],
      [
        [9, 9],
        [9, 0],
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
        [9, 0],
      ],
    ]);
  });

  it("fans larger teams out along their own side (3v3)", () => {
    const [top, bottom] = genTeamSlots(10, 10, 3, 3);
    expect(top).toEqual([
      [0, 0],
      [0, 5],
      [0, 9],
    ]);
    expect(bottom).toEqual([
      [9, 9],
      [9, 4],
      [9, 0],
    ]);
    // Teammates on the same side are never adjacent.
    for (let i = 1; i < top.length; i++) {
      expect(Math.abs(top[i][1] - top[i - 1][1])).toBeGreaterThan(1);
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

    // 2v2: every player lands in a corner (max spread, equidistant pairs).
    const corners = new Set(["0,0", "0,9", "9,0", "9,9"]);
    for (const [, pos] of [...out![0], ...out![1]]) {
      expect(corners.has(`${pos[0]},${pos[1]}`)).toBe(true);
    }
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
    const teamA = [makeEntity("P1", [0, 0]), makeEntity("P2", [0, 9])];
    const teamB = [makeEntity("P3", [9, 9]), makeEntity("P4", [9, 0])];
    const game = makeGame([...teamA, ...teamB]);
    const out = placeTeamPlayers(game, teamA, teamB);
    expect(out).not.toBeNull();
    const corners = new Set(["0,0", "0,9", "9,0", "9,9"]);
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
});
