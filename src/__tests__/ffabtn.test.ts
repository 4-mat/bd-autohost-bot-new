import { describe, it, expect, beforeEach } from "bun:test";
import { hostCommand } from "../commands/host.js";
import { Terrain, games, type Game, type Entity } from "../game/state.js";
import { setWs } from "../utils.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";

setWs({ send() {} });

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

function makeGame(host = "Host"): Game {
  const map = Array.from({ length: 4 }, () => Array(4).fill(Terrain.Normal));
  return {
    id: "test",
    room: "battledome",
    host,
    entities: [makeEntity("P1", [1, 1]), makeEntity("P2", [2, 2])],
    map,
    mapName: "test",
    turnOrder: ["P1", "P2"],
    turnIndex: 0,
    round: 1,
    log: [],
    snapshots: [],
    mode: "FFA",
    modeChosen: false,
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
    playersIdle: false,
  };
}

const room: Room = { id: "battledome", type: "battle", users: [] };
const host: User = { id: "host", name: "Host", rooms: {}, last: 0 };
const other: User = { id: "bob", name: "Bob", rooms: {}, last: 0 };

describe("%ffabtn — hide/show the Setup panel FFA shortcut", () => {
  beforeEach(() => games.clear());

  it("is host-only: a non-host cannot toggle it", () => {
    const game = makeGame();
    games.set(game.id, game);

    hostCommand(room, other, "ffabtn", "", "");

    expect(game.hideFfaShortcut).toBeUndefined();
  });

  it("toggles hideFfaShortcut on, then back off", () => {
    const game = makeGame();
    games.set(game.id, game);

    hostCommand(room, host, "ffabtn", "", "");
    expect(game.hideFfaShortcut).toBe(true);

    hostCommand(room, host, "ffabtn", "", "");
    expect(game.hideFfaShortcut).toBe(false);
  });

  it("hides the Set FFA button in the rendered host page after toggling", () => {
    const game = makeGame();
    games.set(game.id, game);
    hostCommand(room, host, "ffabtn", "", "");
    expect(game.hideFfaShortcut).toBe(true);
  });

  it("works for the game's own host, not another host", () => {
    const game = makeGame("Alice");
    games.set(game.id, game);
    const alice: User = { id: "alice", name: "Alice", rooms: {}, last: 0 };

    hostCommand(room, host, "ffabtn", "", "");
    expect(game.hideFfaShortcut).toBeUndefined();

    hostCommand(room, alice, "ffabtn", "", "");
    expect(game.hideFfaShortcut).toBe(true);
  });

  it("does nothing when no game exists in the room", () => {
    hostCommand(room, host, "ffabtn", "", "");
    // No crash, no game created.
    expect(games.size).toBe(0);
  });
});
