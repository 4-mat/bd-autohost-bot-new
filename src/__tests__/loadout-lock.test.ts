import { describe, it, expect, beforeEach } from "bun:test";
import { Terrain, games, type Game, type Entity } from "../game/state.js";
import { buildPlayerPage } from "../html/pages.js";
import { hostCommand } from "../commands/host.js";
import { setWs } from "../utils.js";
import { loadGameData } from "../data/index.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";

setWs({ send() {} });

// Populate the class/weapon maps so positive-path loadout changes apply.
loadGameData();

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
    weaponName: "Tonfa",
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

function makeGame(opts: {
  modeChosen?: boolean;
  started?: boolean;
  host?: string;
} = {}): Game {
  const size = 4;
  const map = Array.from({ length: size }, () =>
    Array(size).fill(Terrain.Normal),
  );
  const entities = [
    makeEntity({ num: "P1", name: "Alice", pos: [1, 1], team: 0 }),
    makeEntity({ num: "P2", name: "Bob", pos: [2, 2], team: 1 }),
  ];
  return {
    id: "test",
    room: "battledome",
    host: opts.host ?? "Host",
    entities,
    map,
    mapName: "test",
    turnOrder: entities.map((e) => e.num),
    turnIndex: 0,
    round: 1,
    log: [],
    snapshots: [],
    mode: "FFA",
    modeChosen: opts.modeChosen ?? false,
    phase: "setup",
    started: opts.started ?? false,
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
const bob: User = { id: "bob", name: "Bob", rooms: {}, last: 0 };
const host: User = { id: "host", name: "Host", rooms: {}, last: 0 };

describe("loadout lock (issue #172)", () => {
  beforeEach(() => games.clear());

  it("renders the Change Loadout control while the game is not set", () => {
    const game = makeGame();
    games.set(game.id, game);
    const html = buildPlayerPage(game, game.entities[0]);
    expect(html).toContain("Change Loadout");
    expect(html).toContain('name="loadout"');
  });

  it("hides the Change Loadout control once the game is set (modeChosen)", () => {
    const game = makeGame({ modeChosen: true });
    games.set(game.id, game);
    const html = buildPlayerPage(game, game.entities[0]);
    expect(html).not.toContain("Change Loadout");
    expect(html).not.toContain('name="loadout"');
  });

  it("shows a 'Loadout locked' hint once the game is set", () => {
    const game = makeGame({ modeChosen: true });
    games.set(game.id, game);
    const html = buildPlayerPage(game, game.entities[0]);
    expect(html).toContain("Loadout locked");
  });

  it("hides the control once the game has started", () => {
    const game = makeGame({ started: true, modeChosen: true });
    games.set(game.id, game);
    const html = buildPlayerPage(game, game.entities[0]);
    expect(html).not.toContain("Change Loadout");
    expect(html).not.toContain("Loadout locked");
  });

  it("%sco is refused once the game is set", () => {
    const game = makeGame({ modeChosen: true });
    games.set(game.id, game);
    const entity = game.entities[1];

    hostCommand(room, bob, "sco", "Bard, Katana", "sco Bard, Katana");

    expect(entity.className).toBe("Monk");
    expect(entity.weaponName).toBe("Tonfa");
  });

  it("%sc is refused once the game is set", () => {
    const game = makeGame({ modeChosen: true });
    games.set(game.id, game);
    const entity = game.entities[1];

    hostCommand(room, bob, "sc", "Bard", "sc Bard");

    expect(entity.className).toBe("Monk");
  });

  it("%sw is refused once the game is set", () => {
    const game = makeGame({ modeChosen: true });
    games.set(game.id, game);
    const entity = game.entities[1];

    hostCommand(room, bob, "sw", "Katana", "sw Katana");

    expect(entity.weaponName).toBe("Tonfa");
  });

  it("self-service %sco still works before the game is set", () => {
    const game = makeGame();
    games.set(game.id, game);
    const entity = game.entities[1];

    hostCommand(room, bob, "sco", "Bard, Katana", "sco Bard, Katana");

    expect(entity.className).toBe("Bard");
    expect(entity.weaponName).toBe("Katana");
  });

  it("host %setclass still works after the game is set (no host trap)", () => {
    const game = makeGame({ modeChosen: true });
    games.set(game.id, game);
    const entity = game.entities[0];

    hostCommand(room, host, "setclass", "P1, Paladin", "setclass P1, Paladin");

    expect(entity.className).toBe("Paladin");
  });
});
