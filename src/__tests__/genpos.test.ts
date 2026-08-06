import { describe, it, expect } from "bun:test";
import { genPosSlots, placePlayers } from "../commands/host.js";
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

  it("avoids occupied tiles and places on distinct open tiles", () => {
    const blocker = makeEntity("P1", [0, 0]);
    const players = [blocker, makeEntity("P2")];
    const game = makeGame(players);
    const out = placePlayers(game, players);
    expect(out).not.toBeNull();
    const keys = out!.map(([, p]) => `${p[0]},${p[1]}`);
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain("9,9");
  });

  it("returns null when no open tiles exist", () => {
    const players = [makeEntity("P1"), makeEntity("P2")];
    const game = makeGame(players, Terrain.Stop);
    expect(placePlayers(game, players)).toBeNull();
  });
});
