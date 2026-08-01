import { describe, it, expect, beforeEach } from "bun:test";
import { gameCommand } from "../commands/game.js";
import { games } from "../game/state.js";
import { setWs } from "../utils.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";
import {
  type Game,
  type Entity,
  type AbilityData,
  Terrain,
} from "../game/state.js";

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

function makeGame(opts: { entities?: Entity[]; mode?: string } = {}): Game {
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
    phase: "playing",
    started: true,
    kills: {},
    winner: null,
    chatLog: [],
    toasts: [],
  };
}

function makeAbility(
  overrides: Partial<AbilityData> & { name: string },
): AbilityData {
  return {
    level: 1,
    frequency: "Every Turn",
    mr: 10,
    roll: "2d6+3",
    damageType: "Physical",
    actionType: "Standard",
    targetAmount: 1,
    targetGroup: "Foe",
    range: "Melee",
    effect: "",
    ...overrides,
  };
}

const room: Room = { id: "battledome", type: "battle", users: [] };
const alice: User = { id: "alice", name: "Alice", rooms: {}, last: 0 };

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

describe("confirm", () => {
  beforeEach(() => games.clear());

  it("resolves a pending attack and deals damage", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [2, 3],
      team: 1,
    });
    const game = makeGame({ entities: [caster, target] });
    games.set(game.id, game);

    const ability = makeAbility({ name: "Punch", mr: 0 });
    caster.pendingAction = { type: "attack", ability, target: "P2" };
    caster.standardUsed = true;

    gameCommand(room, alice, "confirm", "", "");

    expect(caster.pendingAction).toBeNull();
    expect(target.curhp).toBeLessThan(100);
  });

  it("clears pendingAction even on miss", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [2, 3],
      team: 1,
      pd: 999,
      md: 999,
    });
    const game = makeGame({ entities: [caster, target] });
    games.set(game.id, game);

    const ability = makeAbility({
      name: "Weak Hit",
      mr: 0,
      roll: "1d1+0",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };
    caster.standardUsed = true;

    gameCommand(room, alice, "confirm", "", "");

    expect(caster.pendingAction).toBeNull();
  });

  it("does nothing when no action is pending", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const game = makeGame({ entities: [caster] });
    games.set(game.id, game);

    gameCommand(room, alice, "confirm", "", "");

    expect(caster.pendingAction).toBeNull();
  });

  it("kills target when confirm deals lethal damage", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
      atk: 999,
      pd: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [2, 3],
      team: 1,
      curhp: 1,
      maxhp: 100,
      pd: 0,
      md: 0,
      eva: 0,
    });
    const game = makeGame({ entities: [caster, target] });
    games.set(game.id, game);

    const ability = makeAbility({
      name: "Finishing Blow",
      mr: 0,
      roll: "1d1+0",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    gameCommand(room, alice, "confirm", "", "");

    expect(caster.pendingAction).toBeNull();
    expect(game.entities.some((e) => e.num === "P2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe("cancel", () => {
  beforeEach(() => games.clear());

  it("clears pendingAction without dealing damage", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [2, 3],
      team: 1,
    });
    const game = makeGame({ entities: [caster, target] });
    games.set(game.id, game);

    const ability = makeAbility({ name: "Punch" });
    caster.pendingAction = { type: "attack", ability, target: "P2" };
    caster.standardUsed = true;

    gameCommand(room, alice, "cancel", "", "");

    expect(caster.pendingAction).toBeNull();
    expect(target.curhp).toBe(100);
  });

  it("resets standardUsed for Standard ability", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const game = makeGame({ entities: [caster] });
    games.set(game.id, game);

    const ability = makeAbility({ name: "Slash", actionType: "Standard" });
    caster.pendingAction = { type: "attack", ability };
    caster.standardUsed = true;

    gameCommand(room, alice, "cancel", "", "");

    expect(caster.standardUsed).toBe(false);
  });

  it("resets swiftUsed for Swift ability", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const game = makeGame({ entities: [caster] });
    games.set(game.id, game);

    const ability = makeAbility({ name: "Quick Strike", actionType: "Swift" });
    caster.pendingAction = { type: "attack", ability };
    caster.swiftUsed = true;

    gameCommand(room, alice, "cancel", "", "");

    expect(caster.swiftUsed).toBe(false);
  });

  it("resets both flags for Full ability", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const game = makeGame({ entities: [caster] });
    games.set(game.id, game);

    const ability = makeAbility({ name: "Ultimate", actionType: "Full" });
    caster.pendingAction = { type: "attack", ability };
    caster.standardUsed = true;
    caster.movementUsed = true;

    gameCommand(room, alice, "cancel", "", "");

    expect(caster.standardUsed).toBe(false);
    expect(caster.movementUsed).toBe(false);
  });

  it("does nothing when no action is pending", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const game = makeGame({ entities: [caster] });
    games.set(game.id, game);

    gameCommand(room, alice, "cancel", "", "");

    expect(caster.pendingAction).toBeNull();
    expect(caster.standardUsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full select → confirm flow
// ---------------------------------------------------------------------------

describe("full select-confirm flow", () => {
  beforeEach(() => games.clear());

  it("use then confirm resolves the attack end-to-end", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [2, 3],
      team: 1,
    });
    const ability = makeAbility({ name: "Punch", mr: 0 });
    caster.abilities = [ability];

    const game = makeGame({ entities: [caster, target] });
    games.set(game.id, game);

    gameCommand(room, alice, "use", "Punch @ P2", "");
    expect(caster.pendingAction).not.toBeNull();
    expect(caster.pendingAction!.ability.name).toBe("Punch");
    expect(caster.standardUsed).toBe(true);

    gameCommand(room, alice, "confirm", "", "");
    expect(caster.pendingAction).toBeNull();
    expect(target.curhp).toBeLessThan(100);
  });

  it("use then cancel then use again replaces the action", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [2, 3],
      team: 1,
    });
    const punch = makeAbility({ name: "Punch", mr: 0 });
    const kick = makeAbility({
      name: "Kick",
      mr: 0,
      damageType: "Physical",
      roll: "1d1+0",
    });
    caster.abilities = [punch, kick];

    const game = makeGame({ entities: [caster, target] });
    games.set(game.id, game);

    gameCommand(room, alice, "use", "Punch @ P2", "");
    expect(caster.pendingAction!.ability.name).toBe("Punch");

    gameCommand(room, alice, "cancel", "", "");
    expect(caster.pendingAction).toBeNull();
    expect(caster.standardUsed).toBe(false);

    gameCommand(room, alice, "use", "Kick @ P2", "");
    expect(caster.pendingAction!.ability.name).toBe("Kick");

    const hpBefore = target.curhp;
    gameCommand(room, alice, "confirm", "", "");
    expect(target.curhp).toBeLessThan(hpBefore);
  });
});

// ---------------------------------------------------------------------------
// %choose / %target prompts
// ---------------------------------------------------------------------------

describe("choose and target prompts", () => {
  beforeEach(() => games.clear());

  it("responds to a selection prompt with %choose", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [2, 3],
      team: 1,
    });
    const ability = makeAbility({
      name: "Rising Hope",
      mr: 0,
      choices: [
        { id: "atk_mag", label: "+3 ATK/MAG" },
        { id: "def", label: "+4 DEF" },
      ],
    });
    caster.abilities = [ability];

    const game = makeGame({ entities: [caster, target] });
    games.set(game.id, game);

    gameCommand(room, alice, "use", "Rising Hope", "");
    expect(caster.pendingAction).not.toBeNull();

    gameCommand(room, alice, "confirm", "", "");
    expect(caster.pendingPromptKind).toBe("selection");

    gameCommand(room, alice, "choose", "atk_mag", "");
    expect(caster.pendingPromptKind).toBe("target");

    gameCommand(room, alice, "target", "P2", "");
    expect(caster.pendingAction).toBeNull();
    expect(caster.pendingPromptKind).toBeUndefined();
    expect(target.curhp).toBeLessThan(100);
  });

  it("responds to a target prompt with %target", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [2, 3],
      team: 1,
    });
    const punch = makeAbility({ name: "Punch", mr: 0 });
    caster.abilities = [punch];

    const game = makeGame({ entities: [caster, target] });
    games.set(game.id, game);

    gameCommand(room, alice, "use", "Punch", "");
    gameCommand(room, alice, "confirm", "", "");
    expect(caster.pendingPromptKind).toBe("target");

    gameCommand(room, alice, "target", "P2", "");
    expect(caster.pendingAction).toBeNull();
    expect(target.curhp).toBeLessThan(100);
  });

  it("rejects %choose with no pending action without crashing", () => {
    const caster = makeEntity({ num: "P1", name: "Alice", pos: [2, 2] });
    const game = makeGame({ entities: [caster] });
    games.set(game.id, game);

    expect(() => {
      gameCommand(room, alice, "choose", "atk_mag", "");
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Pass movement (Issue #23)
// ---------------------------------------------------------------------------

describe("passmove", () => {
  beforeEach(() => games.clear());

  it("skips movement and enters the action phase", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const game = makeGame({ entities: [caster] });
    games.set(game.id, game);

    gameCommand(room, alice, "passmove", "", "");

    expect(caster.movementUsed).toBe(true);
    expect(caster.pos).toEqual([2, 2]);
    expect(caster.dashUsed).toBe(false);
  });

  it("allows a Standard after passing movement", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const punch = makeAbility({ name: "Punch", mr: 0 });
    caster.abilities = [punch];
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [2, 3],
      team: 1,
    });
    const game = makeGame({ entities: [caster, target] });
    games.set(game.id, game);

    gameCommand(room, alice, "passmove", "", "");
    gameCommand(room, alice, "use", "Punch @ P2", "");

    expect(caster.pendingAction).not.toBeNull();
    expect(caster.pendingAction!.ability.name).toBe("Punch");
  });
});

// ---------------------------------------------------------------------------
// Frequency / uses enforcement (issues #25, #26)
// ---------------------------------------------------------------------------

describe("frequency and uses", () => {
  beforeEach(() => games.clear());

  function setup(frequency: string, name = "Strike") {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [2, 3],
      team: 1,
    });
    const ability = makeAbility({
      name,
      frequency,
      mr: 0,
      roll: "1d1+0",
    });
    caster.abilities = [ability];
    const game = makeGame({ entities: [caster, target] });
    games.set(game.id, game);
    return { caster, target, ability };
  }

  it("blocks a Once ability after a single resolved use (#26)", () => {
    const { caster } = setup("Once", "Maelstrom");

    gameCommand(room, alice, "use", "Maelstrom @ P2", "");
    gameCommand(room, alice, "confirm", "", "");
    expect(caster.usesUsed["Maelstrom"]).toBe(1);

    caster.standardUsed = false;
    gameCommand(room, alice, "use", "Maelstrom @ P2", "");
    expect(caster.pendingAction).toBeNull();
    expect(caster.usesUsed["Maelstrom"]).toBe(1);
  });

  it("allows a Twice ability exactly twice per battle", () => {
    const { caster } = setup("Twice");

    gameCommand(room, alice, "use", "Strike @ P2", "");
    gameCommand(room, alice, "confirm", "", "");
    expect(caster.usesUsed["Strike"]).toBe(1);

    caster.standardUsed = false;
    gameCommand(room, alice, "use", "Strike @ P2", "");
    gameCommand(room, alice, "confirm", "", "");
    expect(caster.usesUsed["Strike"]).toBe(2);

    caster.standardUsed = false;
    gameCommand(room, alice, "use", "Strike @ P2", "");
    expect(caster.pendingAction).toBeNull();
    expect(caster.usesUsed["Strike"]).toBe(2);
  });

  it("sets a cooldown for a plain EoT ability", () => {
    const { caster } = setup("EoT");

    gameCommand(room, alice, "use", "Strike @ P2", "");
    gameCommand(room, alice, "confirm", "", "");

    expect(caster.cooldowns["Strike"]).toBe(2);
  });

  it("sets a cooldown for a Twice/EoT ability and blocks an immediate repeat (#25)", () => {
    const { caster } = setup("Twice/EoT", "Chase Arrow");

    gameCommand(room, alice, "use", "Chase Arrow @ P2", "");
    gameCommand(room, alice, "confirm", "", "");
    expect(caster.usesUsed["Chase Arrow"]).toBe(1);
    expect(caster.cooldowns["Chase Arrow"]).toBe(2);

    caster.standardUsed = false;
    gameCommand(room, alice, "use", "Chase Arrow @ P2", "");
    expect(caster.pendingAction).toBeNull();
  });
});
