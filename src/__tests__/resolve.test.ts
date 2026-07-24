import { describe, it, expect } from "bun:test";
import { resolveAction } from "../game/resolve.js";
import {
  type Game,
  type Entity,
  type AbilityData,
  Terrain,
} from "../game/state.js";

// ---------------------------------------------------------------------------
// Helpers
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
    className: "Monk",
    weaponName: "Fist",
    classLevel: 1,
    weaponLevel: 1,
    abilities: [],
    statuses: [],
    buffs: [],
    cooldowns: {},
    usesUsed: {},
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
    size?: number;
    terrain?: Terrain[][];
    entities?: Entity[];
    mode?: string;
  } = {},
): Game {
  const size = opts.size ?? 10;
  const map =
    opts.terrain ??
    Array.from({ length: size }, () => Array(size).fill(Terrain.Normal));
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

// ---------------------------------------------------------------------------
// Basic attack resolution
// ---------------------------------------------------------------------------

describe("resolveAction", () => {
  it("returns empty result with no pending action", () => {
    const game = makeGame();
    const caster = game.entities[0];
    const result = resolveAction(game, caster);
    expect(result.messages.length).toBe(0);
    expect(result.deaths.length).toBe(0);
    expect(result.gameOver).toBe(false);
  });

  it("clears pendingAction after resolution", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({ name: "Punch" });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    resolveAction(game, caster);
    expect(caster.pendingAction).toBeNull();
  });

  it("generates /me message for attack", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({ name: "Punch" });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    const result = resolveAction(game, caster);
    // First message should be the /me action
    expect(result.messages[0]).toContain("/me");
    expect(result.messages[0]).toContain("Punch");
    expect(result.messages[0]).toContain("P2");
  });

  it("reports no valid targets when target is out of range", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [0, 0], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [9, 9], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({ name: "Punch", range: "Melee" });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    const result = resolveAction(game, caster);
    expect(result.messages.some((m) => m.includes("no valid targets"))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Damage calculation
// ---------------------------------------------------------------------------

describe("Damage calculation", () => {
  it("Physical attack adds ATK and subtracts PD", () => {
    const caster = makeEntity({
      num: "P1",
      name: "A",
      pos: [2, 2],
      team: 0,
      atk: 15,
      mag: 5,
      pd: 5,
      md: 5,
    });
    const target = makeEntity({
      num: "P2",
      name: "B",
      pos: [2, 3],
      team: 1,
      atk: 5,
      mag: 5,
      pd: 10,
      md: 5,
      curhp: 200,
      maxhp: 200,
    });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Strike",
      damageType: "Physical",
      roll: "1d6+0", // fixed low roll for predictability
      mr: 0, // guaranteed hit (1d20 always >= 0)
      targetGroup: "Foe",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    const result = resolveAction(game, caster);
    // Should have damage message with ATK and PD breakdown
    const dmgMsg = result.messages.find((m) => m.includes("**Damage**"));
    expect(dmgMsg).toBeDefined();
    expect(dmgMsg).toContain("ATK(15)");
    expect(dmgMsg).toContain("PD(10)");
  });

  it("Magical attack adds MAG and subtracts MD", () => {
    const caster = makeEntity({
      num: "P1",
      name: "A",
      pos: [2, 2],
      team: 0,
      atk: 5,
      mag: 20,
      pd: 5,
      md: 5,
    });
    const target = makeEntity({
      num: "P2",
      name: "B",
      pos: [2, 3],
      team: 1,
      atk: 5,
      mag: 5,
      pd: 5,
      md: 8,
      curhp: 200,
      maxhp: 200,
    });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Fireball",
      damageType: "Magical",
      roll: "1d6+0",
      mr: 0,
      targetGroup: "Foe",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    const result = resolveAction(game, caster);
    const dmgMsg = result.messages.find((m) => m.includes("**Damage**"));
    expect(dmgMsg).toBeDefined();
    expect(dmgMsg).toContain("MAG(20)");
    expect(dmgMsg).toContain("MD(8)");
  });

  it("damage is clamped to 0 minimum", () => {
    const caster = makeEntity({
      num: "P1",
      name: "A",
      pos: [2, 2],
      team: 0,
      atk: 1,
      pd: 0,
      md: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "B",
      pos: [2, 3],
      team: 1,
      pd: 100,
      md: 100, // massive defense
      curhp: 200,
      maxhp: 200,
    });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Weak Punch",
      damageType: "Physical",
      roll: "1d1+0",
      mr: 0,
      targetGroup: "Foe",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    const result = resolveAction(game, caster);
    const dmgMsg = result.messages.find((m) => m.includes("**Damage**"));
    expect(dmgMsg).toContain("**0**");
    expect(target.curhp).toBe(200); // no damage
  });
});

// ---------------------------------------------------------------------------
// Multi-hit
// ---------------------------------------------------------------------------

describe("Multi-hit", () => {
  it("Double Hit resolves twice", () => {
    const caster = makeEntity({
      num: "P1",
      name: "A",
      pos: [2, 2],
      team: 0,
      atk: 0,
      pd: 0,
      md: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "B",
      pos: [2, 3],
      team: 1,
      pd: 0,
      md: 0,
      eva: 0,
      curhp: 500,
      maxhp: 500,
    });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Double Slash",
      damageType: "Physical",
      roll: "1d1+0\n(Double Hit)",
      mr: 1,
      targetGroup: "Foe",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    const result = resolveAction(game, caster);
    // Each hit produces 2 messages with "(Hit": accuracy + damage
    const hitMsgs = result.messages.filter((m) => m.includes("(Hit"));
    expect(hitMsgs.length).toBe(4);
  });

  it("Triple Hit resolves three times", () => {
    const caster = makeEntity({
      num: "P1",
      name: "A",
      pos: [2, 2],
      team: 0,
      atk: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "B",
      pos: [2, 3],
      team: 1,
      pd: 0,
      md: 0,
      eva: 0,
      curhp: 500,
      maxhp: 500,
    });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Triple Strike",
      damageType: "Physical",
      roll: "1d1+0\n(Triple Hit)",
      mr: 1,
      targetGroup: "Foe",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    const result = resolveAction(game, caster);
    // Each hit produces 2 messages with "(Hit": accuracy + damage
    const hitMsgs = result.messages.filter((m) => m.includes("(Hit"));
    expect(hitMsgs.length).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Death detection
// ---------------------------------------------------------------------------

describe("Death detection", () => {
  it("kills entity when HP drops to 0", () => {
    const caster = makeEntity({
      num: "P1",
      name: "A",
      pos: [2, 2],
      team: 0,
      atk: 100,
      pd: 0,
    });
    const target = makeEntity({
      num: "P2",
      name: "B",
      pos: [2, 3],
      team: 1,
      pd: 0,
      md: 0,
      eva: 0,
      curhp: 1,
      maxhp: 100, // 1 HP
    });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Finishing Blow",
      damageType: "Physical",
      roll: "1d1+0",
      mr: 1,
      targetGroup: "Foe",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    const result = resolveAction(game, caster);
    expect(result.deaths.length).toBe(1);
    expect(result.deaths[0].num).toBe("P2");
    // Entity removed from game
    expect(game.entities.some((e) => e.num === "P2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Non-damaging abilities (buffs, debuffs, statuses)
// ---------------------------------------------------------------------------

describe("Non-damaging abilities", () => {
  it("applies +ATK buff from effect text", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Battle Cry",
      damageType: "",
      actionType: "Standard",
      roll: "",
      mr: 5,
      targetGroup: "Self and Allies",
      range: "Melee",
      effect: "Gain +5 ATK/3",
    });
    caster.pendingAction = { type: "attack", ability, target: "P1" };

    const result = resolveAction(game, caster);
    const buffMsg = result.messages.find((m) => m.includes("+5 ATK"));
    expect(buffMsg).toBeDefined();
    // "Self and Allies" targets caster (P1), not P2
    expect(
      caster.buffs.some(
        (b) => b.stat === "atk" && b.amount === 5 && b.rounds === 3,
      ),
    ).toBe(true);
  });

  it("applies -PD debuff from effect text", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Expose Armor",
      damageType: "",
      actionType: "Standard",
      roll: "",
      mr: 5,
      targetGroup: "Foe",
      range: "Melee",
      effect: "Inflict -3 PD/2",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    const result = resolveAction(game, caster);
    const debuffMsg = result.messages.find((m) => m.includes("-3 PD"));
    expect(debuffMsg).toBeDefined();
    expect(
      target.buffs.some(
        (b) => b.stat === "pd" && b.amount === -3 && b.rounds === 2,
      ),
    ).toBe(true);
  });

  it("applies Bleed status from effect text", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Slash",
      damageType: "",
      actionType: "Standard",
      roll: "",
      mr: 5,
      targetGroup: "Foe",
      range: "Melee",
      effect: "Inflict 3 Bleed/2",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    const result = resolveAction(game, caster);
    expect(
      target.statuses.some(
        (s) => s.name === "Bleed" && s.damage === 3 && s.rounds === 2,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cooldown tracking
// ---------------------------------------------------------------------------

describe("Cooldown tracking", () => {
  it("sets EoT cooldown (2 turns)", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Power Strike",
      damageType: "Physical",
      roll: "1d6+0",
      mr: 5,
      frequency: "EoT",
      targetGroup: "Foe",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    resolveAction(game, caster);
    expect(caster.cooldowns["Power Strike"]).toBe(2);
  });

  it("sets E3T cooldown (3 turns)", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Ultimate",
      damageType: "Physical",
      roll: "1d6+0",
      mr: 5,
      frequency: "E3T",
      targetGroup: "Foe",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    resolveAction(game, caster);
    expect(caster.cooldowns["Ultimate"]).toBe(3);
  });

  it("no cooldown for Every Turn abilities", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Basic Attack",
      damageType: "Physical",
      roll: "1d6+0",
      mr: 5,
      frequency: "Every Turn",
      targetGroup: "Foe",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    resolveAction(game, caster);
    expect(caster.cooldowns["Basic Attack"]).toBeUndefined();
  });

  it("no cooldown for Passive abilities", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Passive Skill",
      damageType: "Physical",
      roll: "1d6+0",
      mr: 5,
      frequency: "Passive",
      actionType: "Passive",
      targetGroup: "Foe",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    resolveAction(game, caster);
    expect(caster.cooldowns["Passive Skill"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Use tracking
// ---------------------------------------------------------------------------

describe("Use tracking", () => {
  it("increments usesUsed for limited-use abilities", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Limit Break",
      damageType: "Physical",
      roll: "1d6+0",
      mr: 5,
      maxUses: 3,
      targetGroup: "Foe",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    resolveAction(game, caster);
    expect(caster.usesUsed["Limit Break"]).toBe(1);

    // Use again
    caster.pendingAction = { type: "attack", ability, target: "P2" };
    resolveAction(game, caster);
    expect(caster.usesUsed["Limit Break"]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Healing
// ---------------------------------------------------------------------------

describe("Healing", () => {
  it("heals target HP with dice roll", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({
      num: "P2",
      name: "B",
      pos: [2, 3],
      team: 0,
      curhp: 50,
      maxhp: 100,
    });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Heal",
      damageType: "",
      actionType: "Standard",
      roll: "2d6+3",
      mr: 5,
      targetGroup: "Self and Allies",
      range: "Melee",
      effect: "Heal",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    const result = resolveAction(game, caster);
    const healMsg = result.messages.find((m) => m.includes("**Heal**"));
    expect(healMsg).toBeDefined();
    expect(target.curhp).toBeGreaterThan(50);
    expect(target.curhp).toBeLessThanOrEqual(100);
  });

  it("heal is capped at maxhp", () => {
    const caster = makeEntity({ num: "P1", name: "A", pos: [2, 2], team: 0 });
    const target = makeEntity({
      num: "P2",
      name: "B",
      pos: [2, 3],
      team: 0,
      curhp: 95,
      maxhp: 100,
    });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Big Heal",
      damageType: "",
      actionType: "Standard",
      roll: "10d6+3",
      mr: 5,
      targetGroup: "Self and Allies",
      range: "Melee",
      effect: "Heal",
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };

    resolveAction(game, caster);
    expect(target.curhp).toBe(100); // capped at maxhp
  });
});
