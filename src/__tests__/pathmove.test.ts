import { describe, it, expect, beforeEach } from "bun:test";
import { gameCommand } from "../commands/game.js";
import {
  games,
  type Game,
  type Entity,
  type AbilityData,
  Terrain,
} from "../game/state.js";
import {
  buildHostPage,
  buildPlayerPage,
  pathState,
  reachPreview,
  dashMode,
  gridHidden,
  premoveSet,
  movementKey,
} from "../html/pages.js";
import { setWs } from "../utils.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";

setWs({ send() {} });

beforeEach(() => {
  pathState.clear();
  reachPreview.clear();
  dashMode.clear();
  gridHidden.clear();
  premoveSet.clear();
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

function makeGame(opts: { entities?: Entity[] } = {}): Game {
  const entities = opts.entities ?? [
    makeEntity({ num: "P1", name: "Alice", pos: [0, 0], team: 0 }),
    makeEntity({ num: "P2", name: "Bob", pos: [2, 2], team: 1 }),
  ];
  return {
    id: "test",
    room: "battledome",
    host: "Host",
    version: "4.4",
    entities,
    map: Array.from({ length: 5 }, () => Array(5).fill(Terrain.Normal)),
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

const room: Room = { id: "battledome", type: "battle", users: [] };
const alice: User = { id: "alice", name: "Alice", rooms: {}, last: 0 };

function freshGame(): Game {
  const g = makeGame();
  games.set(g.id, g);
  return g;
}

// Composite key for the first entity (P1) of a fresh game.
function key1(game: Game): string {
  return movementKey(game, game.entities[0]);
}

describe("interactive movement pathing", () => {
  it("builds a path with %pathstep and confirms it with %confirmmove", () => {
    const game = freshGame();
    const p1 = game.entities[0];

    gameCommand(room, alice, "pathstep", "a", "2,P1");
    gameCommand(room, alice, "pathstep", "b", "2,P1");

    expect(pathState.get(key1(game))).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(p1.movementUsed).toBe(false);

    gameCommand(room, alice, "confirmmove", "P1", "");
    expect(p1.pos).toEqual([1, 1]);
    expect(p1.movementUsed).toBe(true);
    expect(pathState.get(key1(game))).toBeUndefined();
  });

  it("rejects non-adjacent, occupied, and over-MP steps", () => {
    const game = freshGame();

    // [2,2] is far away -- must step adjacent tiles only.
    gameCommand(room, alice, "pathstep", "c", "3,P1");
    expect(pathState.get(key1(game))).toBeUndefined();

    // P2 occupies [2,2] ("c,3").
    gameCommand(room, alice, "pathstep", "a", "2,P1");
    gameCommand(room, alice, "pathstep", "b", "2,P1"); // [1,1], ok (2 MP)
    expect(pathState.get(key1(game))?.length).toBe(2);
    gameCommand(room, alice, "pathstep", "c", "3,P1"); // occupied
    expect(pathState.get(key1(game))?.length).toBe(2);
  });

  it("allows pathing back through the mover's own tile", () => {
    const game = freshGame();
    gameCommand(room, alice, "pathstep", "a", "2,P1"); // [0,1]
    expect(pathState.get(key1(game))?.length).toBe(1);
    // [0,0] is the mover's own start tile — not a foreign occupant, so the
    // path can pass back through it (PR-Agent on #188).
    gameCommand(room, alice, "pathstep", "a", "1,P1");
    expect(pathState.get(key1(game))?.length).toBe(2);
  });

  it("over-MP step is rejected and truncates back", () => {
    const game = freshGame();
    const p1 = game.entities[0];

    gameCommand(room, alice, "pathstep", "a", "2,P1");
    gameCommand(room, alice, "pathstep", "b", "2,P1");
    gameCommand(room, alice, "pathstep", "c", "2,P1");
    // mp=3, path [0,1],[1,1],[2,1] costs 3 -- the 4th would exceed budget
    gameCommand(room, alice, "pathstep", "d", "2,P1");
    expect(pathState.get(key1(game))?.length).toBe(3);
  });

  it("clicking a tile already in the path truncates it there", () => {
    const game = freshGame();

    gameCommand(room, alice, "pathstep", "a", "2,P1");
    gameCommand(room, alice, "pathstep", "b", "2,P1");
    gameCommand(room, alice, "pathstep", "c", "2,P1");
    expect(pathState.get(key1(game))?.length).toBe(3);
    // Clicking the middle tile (index 1) keeps it as the new end.
    gameCommand(room, alice, "pathstep", "b", "2,P1");
    expect(pathState.get(key1(game))).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it("clicking a tile two steps back truncates even though not adjacent to tip", () => {
    const game = freshGame();

    gameCommand(room, alice, "pathstep", "a", "2,P1");
    gameCommand(room, alice, "pathstep", "b", "2,P1");
    gameCommand(room, alice, "pathstep", "c", "2,P1");
    expect(pathState.get(key1(game))?.length).toBe(3);
    // Tip is [2,1], clicking [0,1] (manhattan 2) shortens the path to end there.
    gameCommand(room, alice, "pathstep", "a", "2,P1");
    expect(pathState.get(key1(game))).toEqual([[0, 1]]);
  });

  it("%cancelpath clears the path", () => {
    const game = freshGame();

    gameCommand(room, alice, "pathstep", "a", "2,P1");
    expect(pathState.get(key1(game))?.length).toBe(1);
    gameCommand(room, alice, "cancelpath", "P1", "");
    expect(pathState.get(key1(game))).toBeUndefined();
  });

  it("%dashmode toggles dash mode", () => {
    const game = freshGame();

    gameCommand(room, alice, "dashmode", "P1", "");
    expect(dashMode.has(key1(game))).toBe(true);
    gameCommand(room, alice, "dashmode", "P1", "");
    expect(dashMode.has(key1(game))).toBe(false);
  });

  it("%viewreach previews another character's reach", () => {
    const game = freshGame();

    gameCommand(room, alice, "viewreach", "P2", "P1");
    expect(reachPreview.get(key1(game))).toBe("P2");
    gameCommand(room, alice, "viewreach", "P2", "P1");
    expect(reachPreview.get(key1(game))).toBeUndefined();
  });

  it("renders gridlines and interactive overlays on the player page", () => {
    const game = freshGame();
    const p1 = game.entities[0];

    gameCommand(room, alice, "pathstep", "a", "2,P1");
    const html = buildPlayerPage(game, p1);
    expect(html).toContain("border:1px solid #888");
    expect(html).toContain("rgba(110,190,255,0.55)"); // reachable overlay
    expect(html).toContain("rgba(20,70,190,0.80)"); // path overlay
    expect(html).toContain("%pathstep a,3,Alice"); // reachable tile button
    expect(html).toContain("%confirmmove Alice");
    expect(html).toContain("%cancelpath Alice");
    expect(html).toContain("%viewreach P2,Alice");
    expect(html).toContain("width:34px");
  });

  it("host page shows the map with gridlines, no interactivity", () => {
    const game = freshGame();
    const html = buildHostPage(game);
    expect(html).toContain("border:1px solid #888");
    expect(html).not.toContain("%pathstep");
    expect(html).toContain("width:34px");
  });

  it("clears all movement state when an attack ends the game", () => {
    const p2 = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [0, 1],
      team: 1,
      curhp: 1,
    });
    const game = makeGame({
      entities: [
        makeEntity({ num: "P1", name: "Alice", pos: [0, 0], team: 0 }),
        p2,
      ],
    });
    games.set(game.id, game);
    const p1 = game.entities[0];

    // Seed movement UI state for P1 and the soon-to-die P2 (which gets removed
    // from game.entities during resolution, so a per-entity loop would leak it).
    pathState.set(key1(game), [[0, 1]]);
    dashMode.add(key1(game));
    reachPreview.set(key1(game), "P2");
    const k2 = movementKey(game, p2);
    pathState.set(k2, [[1, 1]]);

    const ability: AbilityData = {
      name: "Punch",
      level: 1,
      frequency: "Every Turn",
      mr: 0,
      roll: "2d6+3",
      damageType: "Physical",
      actionType: "Standard",
      targetAmount: 1,
      targetGroup: "Foe",
      range: "Melee",
      effect: "",
    };
    p1.pendingAction = { type: "attack", ability, target: "P2" };

    gameCommand(room, alice, "confirm", "", "");

    expect(game.phase).toBe("ended");
    expect(game.entities).not.toContain(p2);
    expect(pathState.get(key1(game))).toBeUndefined();
    expect(dashMode.has(key1(game))).toBe(false);
    expect(reachPreview.get(key1(game))).toBeUndefined();
    expect(pathState.get(k2)).toBeUndefined();
  });
});

describe("map grid toggle (%grid)", () => {
  // Exact map-table opening tags: with and without the grid border. The map
  // table is the only `<table align="center" ...>` without a class, so these
  // uniquely match it (the player-data/log tables carry their own borders
  // regardless of the grid toggle).
  const GRID_ON =
    '<table align="center" style="border-spacing:0px;border-collapse:collapse;border:1px solid #888;background:rgba(120,120,225,0.10)">';
  const GRID_OFF =
    '<table align="center" style="border-spacing:0px;border-collapse:collapse;background:rgba(120,120,225,0.10)">';

  it("defaults to the grid on and hides it per viewer via %grid", () => {
    const game = freshGame();
    const p1 = game.entities[0];

    // Default: gridlines present, button reads "Grid: on".
    let html = buildPlayerPage(game, p1);
    expect(html).toContain(GRID_ON);
    expect(html).toContain("Grid: on");

    gameCommand(room, alice, "grid", "Alice", "");
    expect(gridHidden.has(key1(game))).toBe(true);

    // Player page now renders the map without tile/table borders.
    html = buildPlayerPage(game, p1);
    expect(html).toContain(GRID_OFF);
    expect(html).not.toContain(GRID_ON);
    expect(html).toContain("Grid: off");

    // Toggling back restores the grid.
    gameCommand(room, alice, "grid", "Alice", "");
    expect(gridHidden.has(key1(game))).toBe(false);
    expect(buildPlayerPage(game, p1)).toContain(GRID_ON);
  });

  it("a player without a name toggles their own view", () => {
    const game = freshGame();
    const p1 = game.entities[0];

    gameCommand(room, alice, "grid", "", "");
    expect(gridHidden.has(key1(game))).toBe(true);
    expect(buildPlayerPage(game, p1)).toContain(GRID_OFF);
  });

  it("a player cannot toggle another player's grid", () => {
    const game = freshGame();
    const p2 = game.entities[1];

    gameCommand(room, alice, "grid", "Bob", "");
    expect(gridHidden.has(movementKey(game, p2))).toBe(false);
  });

  it("the host toggles the host-page view with no name and a named entity with one", () => {
    const game = freshGame();
    const p1 = game.entities[0];
    const host: User = { id: "host", name: game.host, rooms: {}, last: 0 };

    // Host page defaults to grid on; %grid (no name) hides the host view.
    expect(buildHostPage(game)).toContain(GRID_ON);
    gameCommand(room, host, "grid", "", "");
    expect(buildHostPage(game)).toContain(GRID_OFF);

    // Host may also toggle a named player's view.
    gameCommand(room, host, "grid", "Alice", "");
    expect(gridHidden.has(key1(game))).toBe(true);
    expect(buildPlayerPage(game, p1)).toContain(GRID_OFF);
  });
});
