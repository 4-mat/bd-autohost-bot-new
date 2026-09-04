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
  voteOpen?: boolean;
  mode?: string;
  modeChosen?: boolean;
  hideFfaShortcut?: boolean;
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
    mode: opts.mode ?? "FFA",
    modeChosen: opts.modeChosen ?? false,
    phase: "setup",
    started: false,
    kills: {},
    winner: null,
    chatLog: [],
    toasts: [],
    signupsOpen: false,
    votes: opts.votes ?? {},
    voteOpen: opts.voteOpen ?? false,
    voteRunoff: null,
    playersIdle: false,
    hideFfaShortcut: opts.hideFfaShortcut ?? false,
  };
}

describe("host setup panel", () => {
  beforeEach(() => games.clear());

  it("ends the vote (applying the leader) instead of %setgame while voting is open", () => {
    const game = makeGame({ votes: { p1: "2v2", p2: "2v2" }, voteOpen: true });
    const html = buildHostPage(game);
    // The button should end the vote and label the winning leader.
    expect(html).toContain('value="%endvote"');
    expect(html).toContain("End Vote: Set 2V2");
  });

  it("ends the vote without claiming a leader when tied", () => {
    const game = makeGame({
      votes: { p1: "ffa", p2: "ntr" },
      voteOpen: true,
    });
    const html = buildHostPage(game);
    expect(html).toContain('value="%endvote"');
    // Button label is HTML-escaped (& -> &amp;) by the page renderer.
    expect(html).toContain("End Vote &amp; Apply Winner");
  });

  it("always renders the %setgame ffa shortcut, even mid-vote with a non-FFA leader", () => {
    const game = makeGame({ votes: { p1: "2v2", p2: "2v2" }, voteOpen: true });
    const html = buildHostPage(game);
    expect(html).toContain('value="%setgame ffa"');
    expect(html).toContain("Set FFA");
  });

  it("hides the %setgame ffa shortcut when hideFfaShortcut is set, showing the toggle", () => {
    const game = makeGame({ voteOpen: true, hideFfaShortcut: true });
    const html = buildHostPage(game);
    expect(html).not.toContain('value="%setgame ffa"');
    // Toggle is still there to bring it back.
    expect(html).toContain('value="%ffabtn"');
    expect(html).toContain("Show FFA shortcut");
  });

  it("shows the hide toggle when the ffa shortcut is visible", () => {
    const game = makeGame({ voteOpen: true, hideFfaShortcut: false });
    const html = buildHostPage(game);
    expect(html).toContain('value="%ffabtn"');
    expect(html).toContain("Hide FFA shortcut");
  });

  it("falls back to %setgame FFA when no vote is open and no mode chosen", () => {
    const game = makeGame({ votes: {}, voteOpen: false, modeChosen: false });
    const html = buildHostPage(game);
    expect(html).toContain('value="%setgame FFA"');
    expect(html).not.toContain("End Vote");
  });

  it("keeps the chosen mode on the Set Game button once voting closed", () => {
    const game = makeGame({
      votes: {},
      voteOpen: false,
      mode: "NTR",
      modeChosen: true,
    });
    const html = buildHostPage(game);
    expect(html).toContain('value="%setgame NTR"');
  });

  it("shows a Start button once the mode is chosen (after Set Game)", () => {
    const game = makeGame({
      votes: {},
      voteOpen: false,
      mode: "FFA",
      modeChosen: true,
    });
    const html = buildHostPage(game);
    expect(html).toContain('value="%start"');
    expect(html).toContain("Start Game");
  });

  it("renders the main setup buttons visible (no collapsed Setup wrapper)", () => {
    const game = makeGame({ votes: {}, voteOpen: false, modeChosen: false });
    const html = buildHostPage(game);
    // The Setup header is a plain label, not a collapsible summary (no
    // outer <details> wrapper around the whole panel).
    expect(html).not.toContain(">Setup</summary>");
    // The Set Game button comes BEFORE the FFA details arrow, proving the
    // main buttons are not tucked behind any collapse.
    const setGameIdx = html.indexOf('value="%setgame FFA"');
    const ffaArrowIdx = html.indexOf("▸ FFA</summary>");
    expect(setGameIdx).toBeGreaterThan(-1);
    expect(ffaArrowIdx).toBeGreaterThan(-1);
    expect(setGameIdx).toBeLessThan(ffaArrowIdx);
    // Main buttons are present without needing to expand anything.
    expect(html).toContain('value="%setgame FFA"');
    expect(html).toContain('value="%setlevel all, 10"');
  });

  it("tucks the Set FFA shortcut behind a small arrow instead of hiding the panel", () => {
    const game = makeGame({ votes: {}, voteOpen: false, modeChosen: false });
    const html = buildHostPage(game);
    expect(html).toContain("▸ FFA</summary>");
    expect(html).toContain('value="%setgame ffa"');
  });

  it("hides the whole setup panel once the game has started", () => {
    const game = makeGame({ voteOpen: false, modeChosen: true });
    game.started = true;
    game.phase = "playing";
    const html = buildHostPage(game);
    expect(html).not.toContain("▸ FFA");
    expect(html).not.toContain("%setgame");
    expect(html).not.toContain("Level All");
  });
});
