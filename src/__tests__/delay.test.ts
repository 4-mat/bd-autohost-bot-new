import { describe, it, expect, beforeEach } from "bun:test";
import {
  games,
  type Game,
  type Entity,
  type AbilityData,
  Terrain,
} from "../game/state.js";
import {
  startAttack,
  landDelayedAttacks,
  respondToChoice,
} from "../game/resolve.js";
import { gameCommand } from "../commands/game.js";
import { buildHostPage, buildPlayerPage } from "../html/pages.js";
import { setWs } from "../utils.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";

setWs({ send() {} });

const room: Room = { id: "battledome", type: "battle", users: [] };
const host: User = { id: "host", name: "Host", rooms: {}, last: 0 };
const alice: User = { id: "alice", name: "Alice", rooms: {}, last: 0 };

// ---------------------------------------------------------------------------
// Helpers (same shape as effects.test.ts)
// ---------------------------------------------------------------------------

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
    className: "Clairvoyant",
    weaponName: "Orb",
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
  size?: number;
  terrain?: Terrain[][];
  entities?: Entity[];
} = {}): Game {
  const size = opts.size ?? 10;
  const map =
    opts.terrain ??
    Array.from({ length: size }, () => Array(size).fill(Terrain.Normal));
  const entities = opts.entities ?? [
    makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 }),
    makeEntity({ num: "P2", name: "Bob", pos: [5, 6], team: 1 }),
  ];
  return {
    id: "test",
    room: "battledome",
    host: "Host",
    version: "4.4",
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

function makeAbility(
  overrides: Partial<AbilityData> & { name: string },
): AbilityData {
  return {
    level: 1,
    frequency: "Every Turn",
    mr: 1, // 1d20 >= 1 -> always hits in tests
    roll: "2d6",
    damageType: "Physical",
    actionType: "Standard",
    targetAmount: 1,
    targetGroup: "Foe",
    range: "Range 5",
    effect: "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Delay-N attacks
// ---------------------------------------------------------------------------

describe("Delay-N attacks", () => {
  it("queues a delayed attack instead of dealing damage immediately", () => {
    const ability = makeAbility({
      name: "Requite",
      effect:
        "This move has Delay-1 and a Delay bonus of +10 damage if the user dies before this attack lands.",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "B", pos: [0, 1], team: 1 });
    const game = makeGame({ entities: [user, target] });

    const step = startAttack(game, user, ability, target.num);
    expect(step.done).toBe(true);

    // Target untouched now, attack parked on the caster.
    expect(target.curhp).toBe(100);
    expect(user.delayedAttacks).toHaveLength(1);
    expect(user.delayedAttacks?.[0].roundsLeft).toBe(1);
    expect(user.delayedAttacks?.[0].targetNum).toBe("P2");
  });

  it("lands the stored damage at the start of the user's turn (Delay-2)", () => {
    const ability = makeAbility({
      name: "Dawn Break",
      roll: "1d8+9",
      effect: "This ability has Delay-2.",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "B", pos: [0, 1], team: 1 });
    const game = makeGame({ entities: [user, target] });

    const step = startAttack(game, user, ability, target.num);
    expect(step.done).toBe(true);
    expect(target.curhp).toBe(100);

    // First turn cycle: 2 -> 1, still queued.
    const messages1 = landDelayedAttacks(game, user);
    expect(user.delayedAttacks).toHaveLength(1);
    expect(user.delayedAttacks?.[0].roundsLeft).toBe(1);
    expect(target.curhp).toBe(100);
    expect(messages1.some((m) => m.includes("lands"))).toBe(false);

    // Second cycle: 1 -> 0, lands.
    const messages2 = landDelayedAttacks(game, user);
    expect(user.delayedAttacks).toHaveLength(0);
    expect(target.curhp).toBeLessThan(100);
    expect(target.curhp).toBeGreaterThan(0);
    expect(messages2.some((m) => m.includes("lands"))).toBe(true);
  });

  it("applies on-hit effects when the delayed attack lands", () => {
    const ability = makeAbility({
      name: "Corruption",
      effect: "Delay-1. inflict 2 Poison/1",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "B", pos: [0, 1], team: 1 });
    const game = makeGame({ entities: [user, target] });

    startAttack(game, user, ability, target.num);
    expect(target.statuses).toHaveLength(0);

    landDelayedAttacks(game, user);

    const poison = target.statuses.find((s) => s.name === "Poison");
    expect(poison).toBeDefined();
    expect(poison?.damage).toBe(2);
    expect(poison?.rounds).toBe(1);
  });

  it("does not delay attacks without a Delay clause", () => {
    const ability = makeAbility({
      name: "Plain Strike",
      effect: "inflict 3 Bleed/1",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "B", pos: [0, 1], team: 1 });
    const game = makeGame({ entities: [user, target] });

    const step = startAttack(game, user, ability, target.num);
    expect(step.done).toBe(true);

    expect(user.delayedAttacks ?? []).toHaveLength(0);
    expect(target.curhp).toBeLessThan(100); // damage dealt immediately
    expect(target.statuses.find((s) => s.name === "Bleed")).toBeDefined();
  });

  it("fizzles when the target is gone by landing time", () => {
    const ability = makeAbility({
      name: "Slow Burn",
      effect: "Delay-1. inflict 3 Bleed/1",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "B", pos: [0, 1], team: 1 });
    const game = makeGame({ entities: [user, target] });

    startAttack(game, user, ability, target.num);
    expect(user.delayedAttacks).toHaveLength(1);

    // Target leaves the fight before the attack lands.
    game.entities = game.entities.filter((e) => e.num !== "P2");
    const messages = landDelayedAttacks(game, user);

    expect(user.delayedAttacks).toHaveLength(0);
    expect(messages.some((m) => m.includes("fizzles"))).toBe(true);
  });

  it("credits a kill to the caster when the landed damage kills the target", () => {
    const ability = makeAbility({
      name: "Executioner",
      roll: "50d6", // guaranteed lethal
      effect: "Delay-1",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "B", pos: [0, 1], team: 1, curhp: 1 });
    const game = makeGame({ entities: [user, target] });

    startAttack(game, user, ability, target.num);
    expect(target.curhp).toBe(1);

    landDelayedAttacks(game, user);
    expect(game.kills["P1"]).toBe(1);
  });
});

describe("choice-gated delays", () => {
  it("prompts before resolving and queues the attack when the delay is accepted", () => {
    const ability = makeAbility({
      name: "Augur",
      effect: "Before accuracy, the user may choose to give this move Delay-1.",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "B", pos: [0, 1], team: 1 });
    const game = makeGame({ entities: [user, target] });

    const step = startAttack(game, user, ability, target.num);
    expect(step.done).toBe(false);
    if (step.done) return;
    expect(step.prompt.kind).toBe("selection");

    const step2 = respondToChoice(user, "add_delay");
    expect(step2.done).toBe(true);
    expect(user.delayedAttacks).toHaveLength(1);
    expect(user.delayedAttacks?.[0].roundsLeft).toBe(1);
    expect(target.curhp).toBe(100); // no immediate damage

    // An accepted choice-gated delay lands through the normal cycle.
    landDelayedAttacks(game, user);
    expect(user.delayedAttacks).toHaveLength(0);
    expect(target.curhp).toBeLessThan(100);
  });

  it("resolves immediately when the delay is declined", () => {
    const ability = makeAbility({
      name: "Augur",
      effect: "Before accuracy, the user may choose to give this move Delay-1.",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "B", pos: [0, 1], team: 1 });
    const game = makeGame({ entities: [user, target] });

    startAttack(game, user, ability, target.num);
    const step2 = respondToChoice(user, "no_delay");
    expect(step2.done).toBe(true);
    expect(user.delayedAttacks ?? []).toHaveLength(0);
    expect(target.curhp).toBeLessThan(100);
  });

  it("does not prompt for abilities without a delay choice", () => {
    const ability = makeAbility({
      name: "Plain Strike",
      effect: "inflict 3 Bleed/1",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "B", pos: [0, 1], team: 1 });
    const game = makeGame({ entities: [user, target] });

    const step = startAttack(game, user, ability, target.num);
    expect(step.done).toBe(true); // no prompt, resolved straight through
    expect(target.curhp).toBeLessThan(100);
  });

  it("resolves Delay-X to the number of targets hit", () => {
    const ability = makeAbility({
      name: "Prismatic Burst",
      range: "Burst 1",
      targetAmount: "AoE",
      targetGroup: "Foes",
      effect: "The user may choose to add Delay-X to this ability.",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5], team: 0 });
    const target1 = makeEntity({ num: "P2", name: "B", pos: [6, 5], team: 1 });
    const target2 = makeEntity({ num: "P3", name: "C", pos: [6, 6], team: 1 });
    const game = makeGame({ entities: [user, target1, target2] });

    const step = startAttack(game, user, ability);
    expect(step.done).toBe(false);
    if (step.done) return;
    expect(step.prompt.kind).toBe("selection");
    if (step.prompt.kind !== "selection") return;
    expect(step.prompt.options.some((o) => o.label.includes("Delay-X"))).toBe(
      true,
    );

    const step2 = respondToChoice(user, "add_delay");
    expect(step2.done).toBe(true);
    // Two targets -> two queued delayed attacks, each Delay-2 (X = 2).
    expect(user.delayedAttacks).toHaveLength(2);
    expect(user.delayedAttacks?.[0].roundsLeft).toBe(2);
    expect(target1.curhp).toBe(100);
    expect(target2.curhp).toBe(100);
  });
});

describe("delayed attacks GUI", () => {
  it("shows queued delayed attacks on the host and player pages", () => {
    const ability = makeAbility({ name: "Augur", effect: "Delay-1" });
    const user = makeEntity({ num: "P1", name: "Alice", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "Bob", pos: [0, 1], team: 1 });
    user.delayedAttacks = [
      { ability, targetNum: "P2", damage: 12, roundsLeft: 2 },
    ];
    const game = makeGame({ entities: [user, target] });

    const hostHtml = buildHostPage(game);
    expect(hostHtml).toContain("Augur");
    expect(hostHtml).toContain("Bob");
    expect(hostHtml).toContain(">12</b> dmg");
    expect(hostHtml).toContain("in 2 turns");

    const playerHtml = buildPlayerPage(game, user);
    expect(playerHtml).toContain("DELAYED ATTACKS");
    expect(playerHtml).toContain("Augur");
    expect(playerHtml).toContain("in 2 turns");
  });

  it("says 'next turn' for a Delay-1 attack and hides the block when empty", () => {
    const ability = makeAbility({ name: "Requite", effect: "Delay-1" });
    const user = makeEntity({ num: "P1", name: "Alice", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "Bob", pos: [0, 1], team: 1 });
    user.delayedAttacks = [
      { ability, targetNum: "P2", damage: 8, roundsLeft: 1 },
    ];
    const game = makeGame({ entities: [user, target] });

    expect(buildHostPage(game)).toContain("next turn");

    // No queued attacks anywhere -> no delay UI at all.
    user.delayedAttacks = [];
    const html = buildHostPage(game);
    expect(html).not.toContain("DELAYED ATTACKS");
    expect(html).not.toContain("⏳");
  });

  it("falls back to the raw target num when the target has left the fight", () => {
    const ability = makeAbility({ name: "Prophecy", effect: "Delay-1" });
    const user = makeEntity({ num: "P1", name: "Alice", pos: [0, 0] });
    user.delayedAttacks = [
      { ability, targetNum: "P9", damage: 15, roundsLeft: 1 },
    ];
    const game = makeGame({ entities: [user] });

    const html = buildHostPage(game);
    expect(html).toContain("P9");
  });
});

describe("Delay-N landing through the turn cycle", () => {
  beforeEach(() => games.clear());

  it("host %endturn lands the queued attack at the start of the caster's next turn", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
      abilities: [],
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [2, 3],
      team: 1,
      curhp: 100,
    });
    const game = makeGame({ entities: [caster, target] });
    games.set(game.id, game);

    // Simulate the caster having fired a Delay-1 attack on their current turn.
    caster.delayedAttacks = [
      {
        ability: makeAbility({ name: "Time Rift", roll: "8d6", effect: "Delay-1" }),
        targetNum: "P2",
        damage: 20,
        roundsLeft: 1,
      },
    ];

    // P1's turn ends -> P2's turn starts (no landing for P2).
    gameCommand(room, host, "endturn", "", "");
    expect(target.curhp).toBe(100);
    expect(caster.delayedAttacks).toHaveLength(1);

    // P2's turn ends -> P1's turn starts: the delayed attack lands.
    gameCommand(room, host, "endturn", "", "");
    expect(caster.delayedAttacks).toHaveLength(0);
    expect(target.curhp).toBe(80);
  });
});
