import { describe, it, expect, beforeEach } from "bun:test";
import { gameCommand } from "../commands/game.js";
import { setWs } from "../utils.js";
import { games } from "../game/state.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";
import {
  type Game,
  type Entity,
  Terrain,
} from "../game/state.js";
import type { GameVersion } from "../data/index.js";


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
    entities?: Entity[];
    mode?: string;
    version?: GameVersion;
    playersIdle?: boolean;
    phase?: string;
  } = {},
): Game {
  const size = 10;
  const map = Array.from({ length: size }, () =>
    Array(size).fill(Terrain.Normal),
  );
  const entities = opts.entities ?? [
    makeEntity({ num: "P1", name: "Alice", pos: [2, 2], team: 0 }),
    makeEntity({ num: "P2", name: "Bob", pos: [2, 3], team: 1 }),
  ];
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
    mode: opts.mode ?? "ffa",
    version: opts.version ?? "4.4",
    phase: (opts.phase ?? "playing") as Game["phase"],
    started: true,
    kills: {},
    winner: null,
    chatLog: [],
    toasts: [],
    signupsOpen: false,
    votes: {},
    voteOpen: false,
    voteRunoff: null,
    playersIdle: opts.playersIdle ?? false,
  };
}

setWs({ send() {} });

const room: Room = { id: "battledome", type: "battle", users: [] };
const host: User = { id: "host", name: "Host", rooms: {}, last: 0 };
const alice: User = { id: "alice", name: "Alice", rooms: {}, last: 0 };
const bob: User = { id: "bob", name: "Bob", rooms: {}, last: 0 };

// ---------------------------------------------------------------------------
// %endturn authorization
// ---------------------------------------------------------------------------
// Rules:
//  - A player may only end their OWN turn (and only when the host enabled
//    %toggleidle, i.e. game.playersIdle).
//  - The host (or a host who is also a player) may end anyone's turn, any
//    time, regardless of playersIdle.

describe("%endturn authorization", () => {
  beforeEach(() => {
    games.clear();
  });

  it("host can end anyone's turn even when it's not their entity", () => {
    const game = makeGame(); // turnIndex 0 -> P1 (Alice)
    games.set(game.id, game);

    gameCommand(room, host, "endturn", "", "");

    expect(game.turnIndex).toBe(1); // advanced to P2
    expect(game.turnOrder[game.turnIndex]).toBe("P2");
  });

  it("host can end a turn while playersIdle is disabled", () => {
    const game = makeGame({ playersIdle: false });
    games.set(game.id, game);

    gameCommand(room, host, "endturn", "", "");

    expect(game.turnIndex).toBe(1);
  });

  it("host who is also a player can end anyone's turn", () => {
    // Host is also a player (P2); P1's turn is active. Host may still end it.
    const game = makeGame({
      entities: [
        makeEntity({ num: "P1", name: "Alice", pos: [2, 2], team: 0 }),
        makeEntity({ num: "P2", name: "Host", pos: [2, 3], team: 1 }),
      ],
      playersIdle: false,
    });
    games.set(game.id, game);

    gameCommand(room, host, "endturn", "", "");

    expect(game.turnIndex).toBe(1); // advanced from P1 to P2 (Host's entity)
  });

  it("player can end their own turn when playersIdle is enabled", () => {
    const game = makeGame({ playersIdle: true });
    games.set(game.id, game);

    gameCommand(room, alice, "endturn", "", "");

    expect(game.turnIndex).toBe(1); // Alice ended her own turn
  });

  it("player cannot end their own turn when playersIdle is disabled", () => {
    const game = makeGame({ playersIdle: false });
    games.set(game.id, game);

    gameCommand(room, alice, "endturn", "", "");

    expect(game.turnIndex).toBe(0); // unchanged: player can't end their turn
  });

  it("player cannot end someone else's turn", () => {
    const game = makeGame({ playersIdle: true });
    games.set(game.id, game);

    // Bob is not the current actor (P1 is), so he can't end the turn.
    gameCommand(room, bob, "endturn", "", "");

    expect(game.turnIndex).toBe(0); // unchanged: not Bob's turn
  });

  it("rejects endturn when there is no active turn", () => {
    const game = makeGame({ phase: "ended" });
    games.set(game.id, game);

    gameCommand(room, host, "endturn", "", "");

    expect(game.phase).toBe("ended"); // unchanged: rejected before advancing
  });
});
