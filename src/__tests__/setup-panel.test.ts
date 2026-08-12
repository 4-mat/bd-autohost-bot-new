import { describe, it, expect, beforeEach } from "bun:test";
import { Terrain, games, type Game, type Entity } from "../game/state.js";
import { buildHostPage } from "../html/pages.js";
import { setWs } from "../utils.js";

setWs({ send() {} });

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

function makeGame(opts: {
  entities?: Entity[];
  votes?: Record<string, string>;
  modeChosen?: boolean;
} = {}): Game {
  const size = 4;
  const map = Array.from({ length: size }, () =>
    Array(size).fill(Terrain.Normal),
  );
  const entities = opts.entities ?? [
    makeEntity({ num: "P1", name: "Alice", pos: [1, 1], team: 0 }),
    makeEntity({ num: "P2", name: "Bob", pos: [2, 2], team: 1 }),
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
    mode: "FFA",
    modeChosen: opts.modeChosen ?? false,
    phase: "setup",
    started: false,
    kills: {},
    winner: null,
    chatLog: [],
    toasts: [],
    signupsOpen: false,
    votes: opts.votes ?? {},
    voteOpen: false,
    voteRunoff: null,
  };
}

describe("host setup panel", () => {
  beforeEach(() => games.clear());

  it("applies the vote winner instead of hardcoded FFA", () => {
    const game = makeGame({
      votes: { p1: "2v2", p2: "2v2" },
      modeChosen: false,
    });
    const html = buildHostPage(game);
    // The Set Game button should carry the winning mode, not FFA.
    expect(html).toContain('%setgame 2V2');
    expect(html).toContain("(vote winner)");
    // No Start button yet: mode not chosen.
    expect(html).not.toContain("%start");
  });

  it("falls back to FFA when there are no votes", () => {
    const game = makeGame({ votes: {}, modeChosen: false });
    const html = buildHostPage(game);
    expect(html).toContain('%setgame FFA');
    expect(html).not.toContain("(vote winner)");
  });

  it("falls back to the already-chosen mode when a vote leader is tied", () => {
    const game = makeGame({
      votes: { p1: "ffa", p2: "ntr" },
      modeChosen: true,
      entities: [
        makeEntity({ num: "P1", name: "Alice", pos: [1, 1], team: 0 }),
        makeEntity({ num: "P2", name: "Bob", pos: [2, 2], team: 1 }),
        makeEntity({ num: "P3", name: "Carol", pos: [2, 1], team: 0 }),
      ],
    });
    const html = buildHostPage(game);
    // Tie → no "vote winner" tag; keep the chosen mode as the target.
    expect(html).not.toContain("(vote winner)");
    expect(html).toContain('%setgame FFA');
  });

  it("shows a Start button once the mode is chosen (after Set Game)", () => {
    const game = makeGame({ votes: { p1: "ffa" }, modeChosen: true });
    const html = buildHostPage(game);
    expect(html).toContain("%start");
    expect(html).toContain("Start Game");
  });

  it("hides the whole setup panel once the game has started", () => {
    const game = makeGame({ votes: { p1: "ffa" }, modeChosen: true });
    game.started = true;
    game.phase = "playing";
    const html = buildHostPage(game);
    expect(html).not.toContain(">Setup</summary>");
    expect(html).not.toContain("%setgame");
  });
});
