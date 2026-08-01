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
    const user = makeEntity({
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
    const game = makeGame({ entities: [user, target] });
    games.set(game.id, game);

    const ability = makeAbility({ name: "Punch", mr: 0 });
    user.pendingAction = { type: "attack", ability, target: "P2" };
    user.standardUsed = true;

    gameCommand(room, alice, "confirm", "", "");

    expect(user.pendingAction).toBeNull();
    expect(target.curhp).toBeLessThan(100);
  });

  it("clears pendingAction even on miss", () => {
    const user = makeEntity({
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
    const game = makeGame({ entities: [user, target] });
    games.set(game.id, game);

    const ability = makeAbility({
      name: "Weak Hit",
      mr: 0,
      roll: "1d1+0",
    });
    user.pendingAction = { type: "attack", ability, target: "P2" };
    user.standardUsed = true;

    gameCommand(room, alice, "confirm", "", "");

    expect(user.pendingAction).toBeNull();
  });

  it("does nothing when no action is pending", () => {
    const user = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const game = makeGame({ entities: [user] });
    games.set(game.id, game);

    gameCommand(room, alice, "confirm", "", "");

    expect(user.pendingAction).toBeNull();
  });

  it("kills target when confirm deals lethal damage", () => {
    const user = makeEntity({
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
    const game = makeGame({ entities: [user, target] });
    games.set(game.id, game);

    const ability = makeAbility({
      name: "Finishing Blow",
      mr: 0,
      roll: "1d1+0",
    });
    user.pendingAction = { type: "attack", ability, target: "P2" };

    gameCommand(room, alice, "confirm", "", "");

    expect(user.pendingAction).toBeNull();
    expect(game.entities.some((e) => e.num === "P2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe("cancel", () => {
  beforeEach(() => games.clear());

  it("clears pendingAction without dealing damage", () => {
    const user = makeEntity({
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
    const game = makeGame({ entities: [user, target] });
    games.set(game.id, game);

    const ability = makeAbility({ name: "Punch" });
    user.pendingAction = { type: "attack", ability, target: "P2" };
    user.standardUsed = true;

    gameCommand(room, alice, "cancel", "", "");

    expect(user.pendingAction).toBeNull();
    expect(target.curhp).toBe(100);
  });

  it("resets standardUsed for Standard ability", () => {
    const user = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const game = makeGame({ entities: [user] });
    games.set(game.id, game);

    const ability = makeAbility({ name: "Slash", actionType: "Standard" });
    user.pendingAction = { type: "attack", ability };
    user.standardUsed = true;

    gameCommand(room, alice, "cancel", "", "");

    expect(user.standardUsed).toBe(false);
  });

  it("resets swiftUsed for Swift ability", () => {
    const user = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const game = makeGame({ entities: [user] });
    games.set(game.id, game);

    const ability = makeAbility({ name: "Quick Strike", actionType: "Swift" });
    user.pendingAction = { type: "attack", ability };
    user.swiftUsed = true;

    gameCommand(room, alice, "cancel", "", "");

    expect(user.swiftUsed).toBe(false);
  });

  it("resets both flags for Full ability", () => {
    const user = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const game = makeGame({ entities: [user] });
    games.set(game.id, game);

    const ability = makeAbility({ name: "Ultimate", actionType: "Full" });
    user.pendingAction = { type: "attack", ability };
    user.standardUsed = true;
    user.movementUsed = true;

    gameCommand(room, alice, "cancel", "", "");

    expect(user.standardUsed).toBe(false);
    expect(user.movementUsed).toBe(false);
  });

  it("does nothing when no action is pending", () => {
    const user = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const game = makeGame({ entities: [user] });
    games.set(game.id, game);

    gameCommand(room, alice, "cancel", "", "");

    expect(user.pendingAction).toBeNull();
    expect(user.standardUsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full select → confirm flow
// ---------------------------------------------------------------------------

describe("full select-confirm flow", () => {
  beforeEach(() => games.clear());

  it("use then confirm resolves the attack end-to-end", () => {
    const user = makeEntity({
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
    user.abilities = [ability];

    const game = makeGame({ entities: [user, target] });
    games.set(game.id, game);

    gameCommand(room, alice, "use", "Punch @ P2", "");
    expect(user.pendingAction).not.toBeNull();
    expect(user.pendingAction!.ability.name).toBe("Punch");
    expect(user.standardUsed).toBe(true);

    gameCommand(room, alice, "confirm", "", "");
    expect(user.pendingAction).toBeNull();
    expect(target.curhp).toBeLessThan(100);
  });

  it("use then cancel then use again replaces the action", () => {
    const user = makeEntity({
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
    user.abilities = [punch, kick];

    const game = makeGame({ entities: [user, target] });
    games.set(game.id, game);

    gameCommand(room, alice, "use", "Punch @ P2", "");
    expect(user.pendingAction!.ability.name).toBe("Punch");

    gameCommand(room, alice, "cancel", "", "");
    expect(user.pendingAction).toBeNull();
    expect(user.standardUsed).toBe(false);

    gameCommand(room, alice, "use", "Kick @ P2", "");
    expect(user.pendingAction!.ability.name).toBe("Kick");

    const hpBefore = target.curhp;
    gameCommand(room, alice, "confirm", "", "");
    expect(target.curhp).toBeLessThan(hpBefore);
  });
});
