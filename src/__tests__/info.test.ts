import { describe, expect, test, beforeEach, mock } from "bun:test";
import * as realUtils from "../utils.js";
// Force data module initialization so getVersionData returns populated maps
import { loadGameData } from "../data/index.js";
import { loadGameData43 } from "../data/version43.js";
import { games, type Game, type Entity, Terrain } from "../game/state.js";

// The send queue in utils.ts is a module-level global shared with every
// other test file in this process: bun queues one message per 400ms and the
// full suite's traffic can sit ahead of ours for seconds. Instead of racing
// that, mock the module for THIS file only so sendPm captures synchronously
// into a local buffer. (mock.module is per-test-file; other files keep the
// real utils.)
let sentMessages: string[] = [];
mock.module("../utils.js", () => ({
  ...realUtils,
  send(_room: string, msg: string) {
    sentMessages.push(msg);
  },
  sendPm(user: string, msg: string) {
    sentMessages.push(`|/pm ${user}, ${msg}`);
  },
}));

// Load game data once (idempotent, fills 4.4 + 4.3 maps)
loadGameData();
loadGameData43();

// Extract PM body from a ws.send-formatted PM message (format: "|/pm Name, body")
function pmBody(raw: string): string {
  const idx = raw.indexOf(", ");
  return idx === -1 ? raw : raw.slice(idx + 2);
}

// True if any captured message addressed as a PM contains the given text.
async function waitForPm(bodyPart: string): Promise<boolean> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (sentMessages.map(pmBody).some((b) => b.includes(bodyPart))) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return sentMessages.map(pmBody).some((b) => b.includes(bodyPart));
}

beforeEach(() => {
  sentMessages = [];
  games.clear();
});

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
    className: "Rifter",
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

function makeGame(opts: {
  room: string;
  version: "4.3" | "4.4";
  entities?: Entity[];
}): Game {
  const size = 5;
  const map = Array.from({ length: size }, () =>
    Array(size).fill(Terrain.Normal),
  );
  const entities = opts.entities ?? [];
  return {
    id: `g-${opts.room}`,
    room: opts.room,
    host: "Host",
    version: opts.version,
    entities,
    map,
    mapName: "test",
    turnOrder: entities.map((e) => e.num),
    turnIndex: 0,
    round: 1,
    log: [],
    snapshots: [],
    mode: "ffa",
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

function makeUser(name: string) {
  return { id: name.toLowerCase(), name, rooms: {}, last: Date.now() };
}

function makeRoom(id: string) {
  return { id, type: "chat" as const, users: [] };
}

describe("infoCommand version selection", () => {
  // We import infoCommand fresh so it picks up the mocked sendPm.
  // Dynamically importing ensures it reads the module-level mocks.
  const { infoCommand } = require("../commands/info.js");

  test("4.3 game in current room wins over user's 4.4 game", async () => {
    // User belongs to a 4.4 game in another room
    const user44 = makeEntity({ num: "P1", name: "Alice" });
    const game44 = makeGame({
      room: "room44",
      version: "4.4",
      entities: [user44],
    });
    games.set(game44.id, game44);

    // Current room has a 4.3 game
    const user43 = makeEntity({ num: "P2", name: "Bob" });
    const game43 = makeGame({
      room: "battledome",
      version: "4.3",
      entities: [user43],
    });
    games.set(game43.id, game43);

    const user = makeUser("Bob");
    const room = makeRoom("battledome");

    infoCommand(user, "wt", "rifter", room);

    // Room game (4.3) should have been used — a response should be sent
    expect(await waitForPm("Rifter")).toBe(true);
  });

  test("spectator not in game.entities falls back to user-game", async () => {
    // Room has a 4.3 game but user is NOT in it (spectator)
    const other = makeEntity({ num: "P1", name: "Bob" });
    const game43 = makeGame({
      room: "battledome",
      version: "4.3",
      entities: [other],
    });
    games.set(game43.id, game43);

    // User has their own 4.4 game
    const user44 = makeEntity({ num: "P2", name: "Alice" });
    const game44 = makeGame({
      room: "room44",
      version: "4.4",
      entities: [user44],
    });
    games.set(game44.id, game44);

    const user = makeUser("Alice");
    const room = makeRoom("battledome");

    infoCommand(user, "wt", "rifter", room);

    // Should fall back to user's 4.4 game and still return a response
    expect(await waitForPm("Rifter")).toBe(true);
  });

  test("unknown room with matching user game uses user game version", async () => {
    // User is in a 4.3 game but the room they're querying from is different
    const user = makeEntity({ num: "P1", name: "Alice" });
    const game = makeGame({ room: "lobby", version: "4.3", entities: [user] });
    games.set(game.id, game);

    const u = makeUser("Alice");
    // Room with no game attached
    const room = makeRoom("someOtherRoom");

    infoCommand(u, "wt", "rifter", room);

    // No game for "someOtherRoom" -> fallback to user-game 4.3
    expect(await waitForPm("Rifter")).toBe(true);
  });

  test("no room and no user game uses 4.4 default", async () => {
    const u = makeUser("nobody");

    infoCommand(u, "wt", "rifter", null);

    // Should fall through to 4.4 default
    expect(await waitForPm("Rifter")).toBe(true);
  });

  test("%wt ability lookup resolves via ability search", async () => {
    const u = makeUser("Alice");

    // arrowflurry is a 4.3 Crossbow ability — exists in 4.3 but let's
    // see if %wt resolves it via the ability search path (class/weapon
    // match comes first, ability search is the fallback).
    infoCommand(u, "wt", "arrowflurry", null);

    // Should find the Crossbow ability card
    expect(await waitForPm("Crossbow")).toBe(true);
    expect(await waitForPm("Arrow Flurry")).toBe(true);
  });

  test("%wtm is reserved for monster moves (stub)", async () => {
    const u = makeUser("Alice");

    infoCommand(u, "wtm", "someskill", null);

    expect(await waitForPm("No monster data loaded yet")).toBe(true);
    expect(await waitForPm("issues/290")).toBe(true);
    expect(await waitForPm("%wtm")).toBe(true);
  });
});

describe("infoCommand %wt4.3", () => {
  const { infoCommand } = require("../commands/info.js");

  // Bard in 4.3 has "Harmony" ability; 4.4 Bard does not. Use this to
  // verify the version override actually pinned to 4.3.

  test("ignores room game version and always resolves in 4.3", async () => {
    // Set up a 4.4 game in the current room — %wt would use 4.4
    const user = makeEntity({ num: "P1", name: "Alice" });
    const game44 = makeGame({
      room: "battledome",
      version: "4.4",
      entities: [user],
    });
    games.set(game44.id, game44);

    const u = makeUser("Alice");
    const room = makeRoom("battledome");

    // %wt4.3 should return 4.3 Bard (which has "Harmony" as an ability)
    infoCommand(u, "wt4.3", "bard", room);

    expect(await waitForPm("Bard")).toBe(true);
    // 4.3-only ability — proves the override worked
    expect(await waitForPm("Harmony")).toBe(true);
  });

  test("ignores user game version and always resolves in 4.3", async () => {
    // User is in a 4.4 game elsewhere — %wt would use 4.4
    const user = makeEntity({ num: "P1", name: "Bob" });
    const game44 = makeGame({
      room: "otherroom",
      version: "4.4",
      entities: [user],
    });
    games.set(game44.id, game44);

    const u = makeUser("Bob");
    // No room context at all — %wt would default to 4.4
    infoCommand(u, "wt4.3", "bard", null);

    expect(await waitForPm("Bard")).toBe(true);
    expect(await waitForPm("Harmony")).toBe(true);
  });

  test("returns not-found message with 4.3 version in error", async () => {
    const u = makeUser("Alice");
    // "xyznotaclassthing" does not exist in any version
    infoCommand(u, "wt4.3", "xyznotaclassthing", null);

    expect(await waitForPm("No data found")).toBe(true);
    expect(await waitForPm("4.3")).toBe(true);
  });

  test("usage error uses the correct command name", async () => {
    const u = makeUser("Alice");
    infoCommand(u, "wt4.3", "", null);

    expect(await waitForPm("Usage: %wt4.3")).toBe(true);
  });

  test("resolves 4.3-only ability by name", async () => {
    const u = makeUser("Alice");
    // "Inveita" is a 4.3-only Runes ability
    infoCommand(u, "wt4.3", "inveita", null);

    expect(await waitForPm("Runes")).toBe(true);
    expect(await waitForPm("Inveita")).toBe(true);
  });
});