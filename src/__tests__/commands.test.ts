import { describe, it, expect, beforeEach, beforeAll } from "bun:test";
import { hostCommand } from "../commands/host.js";
import {
  games,
  Terrain,
  type Game,
  type Entity,
} from "../game/state.js";
import { setWs } from "../utils.js";
import { loadGameData } from "../data/index.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";

setWs({ send() {} });

function makeEntity(overrides: Partial<Entity> & { num: string; name: string }): Entity {
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
    pos: [2, 2],
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

function makeGame(entities: Entity[]): Game {
  const size = 10;
  const map = Array.from({ length: size }, () =>
    Array(size).fill(Terrain.Normal),
  );
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
    version: "4.4",
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

const room: Room = { id: "battledome", type: "battle", users: [] };
const host: User = { id: "host", name: "Host", rooms: {}, last: 0 };

describe("host tools (batch 15)", () => {
  beforeEach(() => games.clear());

  it("%kill removes the target entity", () => {
    const game = makeGame([
      makeEntity({ num: "P1", name: "Alice" }),
      makeEntity({ num: "P2", name: "Bob" }),
      makeEntity({ num: "P3", name: "Cara" }),
    ]);
    games.set(game.id, game);

    hostCommand(room, host, "kill", "P2", "");

    expect(game.entities.map((e) => e.num)).toEqual(["P1", "P3"]);
    expect(game.phase).toBe("playing");
  });

  it("%kick removes the target entity and records it in the graveyard", () => {
    const game = makeGame([
      makeEntity({ num: "P1", name: "Alice" }),
      makeEntity({ num: "P2", name: "Bob" }),
      makeEntity({ num: "P3", name: "Cara" }),
    ]);
    games.set(game.id, game);

    hostCommand(room, host, "kick", "P3", "");

    expect(game.entities.map((e) => e.num)).toEqual(["P1", "P2"]);
    expect(game.graveyard).toEqual([{ num: "P3", name: "Cara" }]);
  });

  it("%heal restores HP up to max", () => {
    const bob = makeEntity({ num: "P2", name: "Bob", curhp: 40, maxhp: 100 });
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" }), bob]);
    games.set(game.id, game);

    hostCommand(room, host, "heal", "P2,25", "");

    expect(bob.curhp).toBe(65);
  });

  it("%heal clamps at maxhp", () => {
    const bob = makeEntity({ num: "P2", name: "Bob", curhp: 90, maxhp: 100 });
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" }), bob]);
    games.set(game.id, game);

    hostCommand(room, host, "heal", "P2,999", "");

    expect(bob.curhp).toBe(100);
  });

  it("%setpos relocates an entity", () => {
    const bob = makeEntity({ num: "P2", name: "Bob", pos: [1, 1] });
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" }), bob]);
    games.set(game.id, game);

    hostCommand(room, host, "setpos", "P2, b4", "");

    expect(bob.pos).toEqual([1, 3]);
  });

  it("%transfer hands off the host role", () => {
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" })]);
    games.set(game.id, game);

    hostCommand(room, host, "transfer", "Alice", "");

    expect(game.host).toBe("Alice");
  });

  it("%pause and %resume toggle the paused flag", () => {
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" })]);
    games.set(game.id, game);

    hostCommand(room, host, "pause", "", "");
    expect(game.paused).toBe(true);

    hostCommand(room, host, "resume", "", "");
    expect(game.paused).toBe(false);
  });
});

describe("host reset/clear (batch 17)", () => {
  beforeEach(() => games.clear());

  it("%fullheal restores HP to full", () => {
    const bob = makeEntity({ num: "P2", name: "Bob", curhp: 12, maxhp: 80 });
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" }), bob]);
    games.set(game.id, game);

    hostCommand(room, host, "fullheal", "P2", "");

    expect(bob.curhp).toBe(80);
  });

  it("%clearstatus clears all statuses", () => {
    const bob = makeEntity({
      num: "P2",
      name: "Bob",
      statuses: [{ name: "Bleed", damage: 2, rounds: 3, maxRounds: 3, removable: true }],
    });
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" }), bob]);
    games.set(game.id, game);

    hostCommand(room, host, "clearstatus", "P2", "");

    expect(bob.statuses).toEqual([]);
  });

  it("%clearbuffs clears all buffs", () => {
    const bob = makeEntity({
      num: "P2",
      name: "Bob",
      buffs: [{ stat: "atk", amount: 2, rounds: 2 }],
    });
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" }), bob]);
    games.set(game.id, game);

    hostCommand(room, host, "clearbuffs", "P2", "");

    expect(bob.buffs).toEqual([]);
  });

  it("%clearcooldowns clears cooldowns", () => {
    const bob = makeEntity({
      num: "P2",
      name: "Bob",
      cooldowns: { Fireball: 2, Heal: 1 },
    });
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" }), bob]);
    games.set(game.id, game);

    hostCommand(room, host, "clearcooldowns", "P2", "");

    expect(bob.cooldowns).toEqual({});
  });

  it("%clearuses resets ability uses", () => {
    const bob = makeEntity({
      num: "P2",
      name: "Bob",
      usesUsed: { Fireball: 1 },
    });
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" }), bob]);
    games.set(game.id, game);

    hostCommand(room, host, "clearuses", "P2", "");

    expect(bob.usesUsed).toEqual({});
  });

  it("%setterrain overrides a tile's terrain", () => {
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" })]);
    games.set(game.id, game);

    hostCommand(room, host, "setterrain", "b3, lava", "");

    expect(game.map[1][2]).toBe(Terrain.Lava);
  });

  it("%reset clears everything and restores full HP", () => {
    const bob = makeEntity({
      num: "P2",
      name: "Bob",
      curhp: 20,
      maxhp: 100,
      statuses: [{ name: "Bleed", damage: 2, rounds: 3, maxRounds: 3, removable: true }],
      buffs: [{ stat: "atk", amount: 2, rounds: 2 }],
      cooldowns: { Fireball: 2 },
      usesUsed: { Fireball: 1 },
      afk: true,
      damageDealt: 7,
      damageTaken: 5,
    });
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" }), bob]);
    games.set(game.id, game);

    loadGameData();
    hostCommand(room, host, "reset", "P2", "");

    expect(bob.curhp).toBe(bob.maxhp);
    expect(bob.statuses).toEqual([]);
    expect(bob.buffs).toEqual([]);
    expect(bob.cooldowns).toEqual({});
    expect(bob.usesUsed).toEqual({});
    expect(bob.afk).toBe(false);
    expect(bob.damageDealt).toBe(0);
    expect(bob.damageTaken).toBe(0);
  });
});

describe("host restoremp (batch 17)", () => {
  beforeAll(() => loadGameData());
  beforeEach(() => games.clear());

  it("%restoremp restores MP to the class+weapon max", () => {
    // Monk base MP is 2; weapon "Fist" is unknown so contributes 0.
    const bob = makeEntity({ num: "P2", name: "Bob", mp: 0 });
    const game = makeGame([makeEntity({ num: "P1", name: "Alice" }), bob]);
    games.set(game.id, game);

    hostCommand(room, host, "restoremp", "P2", "");

    expect(bob.mp).toBe(2);
  });
});
