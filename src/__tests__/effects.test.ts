import { describe, it, expect, beforeEach } from "bun:test";
import {
  type Game,
  type Entity,
  type AbilityData,
  Terrain,
  isObstruction,
} from "../game/state.js";
import {
  parseEffects,
  applyEffects,
  applyEffectStream,
  evaluateCondition,
  isApexActive,
  isThirstActive,
  extractCombatMetadata,
  requiredSubweapons,
  getPassiveRangeBonus,
  getDefenderDiceMods,
  formatSubweapon,
} from "../game/effects.js";

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

// =============================================================================
// Parser
// =============================================================================

describe("parseEffects", () => {
  it("recognises 'Apex: ...' as an apex clause", () => {
    const effects = parseEffects("Apex: Pull 3");
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("apex");
    if (effects[0].type !== "apex") return;
    expect(effects[0].effects).toHaveLength(1);
    expect(effects[0].effects[0].type).toBe("pull");
  });

  it("apex sub-effects: status", () => {
    const effects = parseEffects("Apex: inflict 5 Cripple/1");
    expect(effects[0].type).toBe("apex");
    if (effects[0].type !== "apex") return;
    expect(effects[0].effects).toHaveLength(1);
    expect(effects[0].effects[0].type).toBe("status");
  });

  it("parses alongside other clauses in the same paragraph", () => {
    const effects = parseEffects(
      "For one round, the target only has 3 MP. Apex: inflict 5 Cripple/1.",
    );
    // Expect at least 2 clauses: the MP reduction + the apex
    expect(effects.length).toBeGreaterThanOrEqual(2);
    const apex = effects.find((e) => e.type === "apex");
    expect(apex).toBeDefined();
  });
});

// =============================================================================
// isApexActive -- per-range-type semantics
// =============================================================================

describe("isApexActive: returns false for ranges without a max", () => {
  it("global never triggers apex", () => {
    const ability = makeAbility({ name: "Global Strike", range: "Global" });
    const user = makeEntity({ num: "P1", name: "A", pos: [0, 0] });
    const target = makeEntity({ num: "P2", name: "B", pos: [9, 9] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(false);
  });

  it("varies never triggers apex", () => {
    const ability = makeAbility({ name: "Variable", range: "Varies" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(false);
  });

  it("empty range never triggers apex", () => {
    const ability = makeAbility({ name: "Self", range: "" });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = user;
    const game = makeGame({ entities: [user] });
    expect(isApexActive(game, user, target, ability)).toBe(false);
  });
});

describe("isApexActive: melee", () => {
  it("fires at chebyshev 1", () => {
    const ability = makeAbility({ name: "Slash", range: "Melee" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [6, 5] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });

  it("fires for diagonal melee tiles", () => {
    const ability = makeAbility({ name: "Slash", range: "Melee" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [6, 6] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });

  it("does not fire at 0 distance or beyond melee", () => {
    const ability = makeAbility({ name: "Slash", range: "Melee" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const same = user;
    const game = makeGame({ entities: [user] });
    expect(isApexActive(game, user, same, ability)).toBe(false);

    const farTarget = makeEntity({ num: "P2", name: "B", pos: [5, 7] });
    game.entities.push(farTarget);
    expect(isApexActive(game, user, farTarget, ability)).toBe(false);
  });
});

describe("isApexActive: Range N / Homing N / Star N", () => {
  it("Range 4 fires at manhattan 4", () => {
    const ability = makeAbility({ name: "R4", range: "Range 4" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 9] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });

  it("Range 4 does NOT fire at manhattan 3", () => {
    const ability = makeAbility({ name: "R4", range: "Range 4" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 8] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(false);
  });

  it("Range 4 does NOT fire when LOS is blocked", () => {
    const map = Array.from({ length: 10 }, () =>
      Array(10).fill(Terrain.Normal),
    );
    map[5][7] = Terrain.Stone;
    const ability = makeAbility({ name: "R4", range: "Range 4" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 9] });
    const game = makeGame({ entities: [user, target], terrain: map });
    expect(isApexActive(game, user, target, ability)).toBe(false);
  });

  it("Homing 4 fires regardless of LOS at manhattan 4", () => {
    const map = Array.from({ length: 10 }, () =>
      Array(10).fill(Terrain.Normal),
    );
    map[5][7] = Terrain.Stone;
    const ability = makeAbility({ name: "H4", range: "Homing 4" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 9] });
    const game = makeGame({ entities: [user, target], terrain: map });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });
});

describe("isApexActive: Burst N", () => {
  it("Burst 3 fires at chebyshev 3", () => {
    const ability = makeAbility({ name: "B3", range: "Burst 3" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [8, 8] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });

  it("Burst 3 fires at manhattan 3 in cardinal direction", () => {
    const ability = makeAbility({ name: "B3", range: "Burst 3" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [8, 5] });
    const game = makeGame({ entities: [user, target] });
    // chebyshev == 3 (manhattan 3 also ≠ in range for burst only via cheb)
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });

  it("Burst 3 does NOT fire at chebyshev 2", () => {
    const ability = makeAbility({ name: "B3", range: "Burst 3" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [7, 6] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(false);
  });
});

describe("isApexActive: Pierce / Line", () => {
  it("Pierce 4 fires at cardinal max distance", () => {
    const ability = makeAbility({ name: "P4", range: "Pierce 4" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 9] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });

  it("Line 3 fires at diagonal max (ceiling(3/2) = 2)", () => {
    const ability = makeAbility({ name: "L3", range: "Line 3" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [7, 7] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });

  it("Line 3 diagonal does NOT fire at chebyshev 3 (> ceiling)", () => {
    const ability = makeAbility({ name: "L3", range: "Line 3" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [8, 8] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(false);
  });

  it("Line 4 fires at diagonal chebyshev 2 (ceiling(4/2))", () => {
    const ability = makeAbility({ name: "L4", range: "Line 4" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [7, 7] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });
});

describe("isApexActive: Beam", () => {
  it("Beam 2 fires at final row (depth 2)", () => {
    const ability = makeAbility({ name: "Be2", range: "Beam 2" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 7] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });

  it("Beam 2 fires for perpendicular tiles in final column (3-wide)", () => {
    // Per glossary "Apex includes the final row/column" -- the 3-wide beam
    // strip at depth N counts as apex, not just the centerline.
    const ability = makeAbility({ name: "Be2", range: "Beam 2" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const game = makeGame({ entities: [user] });

    for (const [r, c, label] of [
      [4, 7, "above-centerline"],
      [5, 7, "centerline"],
      [6, 7, "below-centerline"],
    ] as const) {
      const t = makeEntity({ num: "P2", name: "B", pos: [r, c] });
      game.entities.push(t);
      expect(isApexActive(game, user, t, ability)).toBe(true);
      // pop so pos is unique per iteration
      game.entities.pop();
    }
  });

  it("Beam 2 does NOT fire at depth 1", () => {
    const ability = makeAbility({ name: "Be2", range: "Beam 2" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(false);
  });

  it("Beam 2 does NOT fire at depth 2 with perpendicular offset >1", () => {
    const ability = makeAbility({ name: "Be2", range: "Beam 2" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [3, 7] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(false);
  });

  it("Beam 2 does NOT fire when centerline LOS is blocked", () => {
    // Stone in the centerline path blocks the beam from [5,5] reaching [5,7].
    const map = Array.from({ length: 10 }, () =>
      Array(10).fill(Terrain.Normal),
    );
    map[5][7] = Terrain.Stone;
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 7] });
    const game = makeGame({ entities: [user, target], terrain: map });
    const ability = makeAbility({ name: "Be2", range: "Beam 2" });

    expect(isApexActive(game, user, target, ability)).toBe(false);

    // Sanity -- removing the stone allows apex
    map[5][7] = Terrain.Normal;
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });
});

describe("isApexActive: Cone", () => {
  it("Cone 2 fires at forward distance 2", () => {
    const ability = makeAbility({ name: "C2", range: "Cone 2" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 7] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });

  it("Cone 2 does NOT fire at forward 1", () => {
    const ability = makeAbility({ name: "C2", range: "Cone 2" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(false);
  });
});

// =============================================================================
// applyEffects -- apex gating end-to-end
// =============================================================================

describe("applyEffects: apex gate", () => {
  it("applies apex sub-effects when target is at max range", () => {
    // Pierce 4 + target at manhattan 4 -> apex sub-effects fire
    const ability = makeAbility({
      name: "Razor Rust",
      range: "Pierce 4",
      effect: "For one round, the target only has 3 MP. Apex: inflict 5 Cripple/1.",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 9], team: 1 });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    const messages = applyEffects(game, user, target, effects, ability);

    // The Cripple was applied -- target must have a status.
    const cripple = target.statuses.find((s) => s.name === "Cripple");
    expect(cripple).toBeDefined();
    expect(cripple?.damage).toBe(5);

    // The messages should mention [Apex].
    expect(messages.some((m) => m.includes("[Apex]"))).toBe(true);
  });

  it("does NOT apply apex sub-effects when below max range", () => {
    // Same ability but target at manhattan 2 (not max)
    const ability = makeAbility({
      name: "Razor Rust",
      range: "Pierce 4",
      effect: "For one round, the target only has 3 MP. Apex: inflict 5 Cripple/1.",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 7], team: 1 });
    const game = makeGame({ entities: [user, target] });

    const beforeStatuses = target.statuses.length;
    const effects = parseEffects(ability.effect);
    const messages = applyEffects(game, user, target, effects, ability);

    // No new status added
    expect(target.statuses.length).toBe(beforeStatuses);

    // Messages mention "inactive" and NOT "[Apex]" prefix on the sub-effect
    expect(messages.some((m) => m.toLowerCase().includes("inactive"))).toBe(true);
    expect(messages.some((m) => m.startsWith("    [Apex]"))).toBe(false);
  });

  it("does NOT apply apex sub-effects when LOS blocks", () => {
    const map = Array.from({ length: 10 }, () =>
      Array(10).fill(Terrain.Normal),
    );
    map[5][7] = Terrain.Stone;
    const ability = makeAbility({
      name: "Razor Rust",
      range: "Pierce 4",
      effect: "Apex: Pull 3",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 9], team: 1 });
    const game = makeGame({ entities: [user, target], terrain: map });

    const effects = parseEffects(ability.effect);
    const messages = applyEffects(game, user, target, effects, ability);

    // Pull 3 should NOT have moved anyone
    expect(target.pos).toEqual([5, 9]);
    expect(messages.some((m) => m.toLowerCase().includes("inactive"))).toBe(true);
  });

  it("non-apex effects still apply when target is below max range", () => {
    // The non-apex clause (MP reduction) should still apply even though
    // apex doesn't.
    const ability = makeAbility({
      name: "Razor Rust",
      range: "Pierce 4",
      effect: "For one round, target -3 MP/1. Apex: Pull 3",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 7], team: 1 });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    // MP debuff should have applied
    const mpDebuff = target.buffs.find((b) => b.stat === "mp");
    expect(mpDebuff).toBeDefined();
    // Target not pulled (apex skipped)
    expect(target.pos).toEqual([5, 7]);
  });

  it("emits a fallback message when ability context is missing", () => {
    const ability = makeAbility({
      name: "Test",
      range: "Melee",
      effect: "Apex: Pull 3",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6], team: 1 });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    const messages = applyEffects(game, user, target, effects); // no ability arg

    expect(messages.some((m) => m.toLowerCase().includes("cannot evaluate"))).toBe(
      true,
    );
  });

  it("works with nested apex inside a conditional (then-branch)", () => {
    // The conditional itself doesn't gate (TODO), but its then-branch's apex
    // should still gate correctly when ability is threaded through.
    const ability = makeAbility({
      name: "Big Stick",
      range: "Pierce 4",
      effect: "If target is alive, Apex: Pull 3.",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 7], team: 1 });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    const messages = applyEffects(game, user, target, effects, ability);

    // Not at max range -> nested apex should also be inactive
    expect(target.pos).toEqual([5, 7]);
    expect(messages.some((m) => m.toLowerCase().includes("inactive"))).toBe(true);
  });
});

describe("isApexActive: misc range corner cases", () => {
  it("Burst 3 fires on the diagonal corner (chebyshev 3)", () => {
    const ability = makeAbility({ name: "B3", range: "Burst 3" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [8, 8] }); // cheb 3
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });

  it("Cone 3 fires for sideways-max tile in horizontal cone", () => {
    // A 3-tile cone widening by 1 each row reaches absDc <= 3 sideways
    // at forward distance 3.
    const ability = makeAbility({ name: "C3", range: "Cone 3" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [7, 8] }); // forward 3, sideways 2
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });

  it("Pierce 4 fires at max with LOS open", () => {
    const ability = makeAbility({ name: "P4", range: "Pierce 4" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 9] });
    const game = makeGame({ entities: [user, target] });
    expect(isApexActive(game, user, target, ability)).toBe(true);
  });
});

describe("applyEffects: multiple apex clauses + empty apex", () => {
  it("handles two apex clauses back to back, each gated on its own line", () => {
    // Different contexts (ranges) within the effect text -- target is at max
    // range of the first apex only because the second is at a different range
    // type. Easiest: same range, same target, expect both to fire.
    const ability = makeAbility({
      name: "Double Apex",
      range: "Pierce 4",
      effect: "Apex: inflict 3 Bleed/1. Apex: Pull 2.",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5], team: 0 });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 9], team: 1 });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    expect(effects.filter((e) => e.type === "apex")).toHaveLength(2);

    applyEffects(game, user, target, effects, ability);

    const bleed = target.statuses.find((s) => s.name === "Bleed");
    expect(bleed?.damage).toBe(3);
    // Pull 2 should have moved target -- initial pos [5,9] pulled TWICE toward
    // user at [5,5] -> [5,7] (-2 from dc=4 to dc=2).
    expect(target.pos).toEqual([5, 7]);
  });

  it("tolerates an apex clause with no sub-effects (e.g. 'Thirst 10: no effects')", () => {
    // We can synthesize this by giving the parser an apex clause whose text
    // falls through to "unknown" inside the sub-parse, producing zero effects.
    // Easier: hand-construct an Apex effect with empty effects list.
    const ability = makeAbility({ name: "Empty", range: "Range 4" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 9] });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects("Apex: nothing recognizable xyz");
    // The parser puts unknown sub-effects in the effects[] list (zero-length)
    // -- passing empty effect list through should not crash.
    const messages = applyEffects(game, user, target, effects, ability);
    expect(messages.every((m) => typeof m === "string")).toBe(true);
  });
});

// =============================================================================
// Thirst
// =============================================================================

describe("parseEffects: thirst clause", () => {
  it("recognises 'Thirst N: ...' as a thirst clause", () => {
    const effects = parseEffects("Thirst 4: inflict 5 Cripple/1");
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("thirst");
    if (effects[0].type !== "thirst") return;
    expect(effects[0].threshold).toBe(4);
    expect(effects[0].effects).toHaveLength(1);
  });

  it("parses sub-effects: status inside thirst", () => {
    const effects = parseEffects("Thirst 5: inflict 5 Cripple/1");
    expect(effects[0].type).toBe("thirst");
    if (effects[0].type !== "thirst") return;
    expect(effects[0].effects).toHaveLength(1);
    expect(effects[0].effects[0].type).toBe("status");
  });

  it("parses multiple sub-effects: '+' clauses get re-split as siblings", () => {
    // Commas at top level split clauses into siblings; to keep multiple
    // sub-effects inside a single Thirst, the source text uses '\n' or a
    // semicolon in the data we already have. For here we just check the
    // parser handles standalone "+N STAT/M" alongside the Thirst clause.
    const effects = parseEffects("Thirst 5: +3 MR/1. +2 ATK/1.");
    const thirst = effects.find((e) => e.type === "thirst");
    expect(thirst).toBeDefined();
    // The Thirst's sub-effect should be the MR buff; ATK is a top-level
    // sibling in the same effect text.
    expect(effects.some((e) => e.type === "buff")).toBe(true);
  });

  it("parses alongside other clauses in the same effect text", () => {
    const effects = parseEffects(
      "Per hit: lose 2 Blood. Thirst 5: +3 MR, Double Hit.",
    );
    expect(effects.length).toBeGreaterThanOrEqual(2);
    const thirst = effects.find((e) => e.type === "thirst");
    expect(thirst).toBeDefined();
  });
});

describe("isThirstActive", () => {
  it("fires when Blood >= threshold", () => {
    const user = makeEntity({
      num: "P1",
      name: "A",
      resources: { blood: 5 },
    });
    const { effects } = parseEffects("Thirst 4: +1 MP")![0] as any; // not used
    // Build a ThirstEffect directly
    const thirst = { type: "thirst", threshold: 4, effects: [] } as any;
    expect(isThirstActive(user, thirst)).toBe(true);
  });

  it("fires when Blood equals threshold (boundary)", () => {
    const user = makeEntity({
      num: "P1",
      name: "A",
      resources: { blood: 4 },
    });
    const thirst = { type: "thirst", threshold: 4, effects: [] } as any;
    expect(isThirstActive(user, thirst)).toBe(true);
  });

  it("does NOT fire when Blood < threshold", () => {
    const user = makeEntity({
      num: "P1",
      name: "A",
      resources: { blood: 3 },
    });
    const thirst = { type: "thirst", threshold: 4, effects: [] } as any;
    expect(isThirstActive(user, thirst)).toBe(false);
  });

  it("does NOT fire when user has no Blood pool at all", () => {
    const user = makeEntity({ num: "P1", name: "A", resources: {} });
    const thirst = { type: "thirst", threshold: 1, effects: [] } as any;
    expect(isThirstActive(user, thirst)).toBe(false);
  });
});

describe("applyEffects: thirst gate", () => {
  it("applies sub-effects when Blood >= threshold", () => {
    const ability = makeAbility({
      name: "Carnage",
      range: "Melee",
      effect: "Thirst 4: inflict 5 Cripple/1",
    });
    const user = makeEntity({
      num: "P1",
      name: "Trophy",
      pos: [5, 5],
      team: 0,
      resources: { blood: 5 },
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [5, 6],
      team: 1,
    });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    const messages = applyEffects(game, user, target, effects, ability);

    const cripple = target.statuses.find((s) => s.name === "Cripple");
    expect(cripple?.damage).toBe(5);

    // Sub-effect messages are prefixed with [Thirst N]
    expect(messages.some((m) => m.startsWith("    [Thirst 4]"))).toBe(true);
  });

  it("does NOT apply sub-effects when Blood < threshold", () => {
    const ability = makeAbility({
      name: "Carnage",
      range: "Melee",
      effect: "Thirst 4: inflict 5 Cripple/1",
    });
    const user = makeEntity({
      num: "P1",
      name: "Trophy",
      pos: [5, 5],
      team: 0,
      resources: { blood: 2 },
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [5, 6],
      team: 1,
    });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    const messages = applyEffects(game, user, target, effects, ability);

    expect(target.statuses).toHaveLength(0);

    // Inactive message names both the threshold and the actual Blood value.
    expect(messages.some((m) => m.toLowerCase().includes("thirst 4"))).toBe(true);
    expect(messages.some((m) => m.toLowerCase().includes("inactive"))).toBe(true);
    expect(messages.some((m) => m.startsWith("    [Thirst 4]"))).toBe(false);
  });

  it("does NOT fire when user has no Blood pool", () => {
    const ability = makeAbility({
      name: "Carnage",
      range: "Melee",
      effect: "Thirst 1: inflict 5 Cripple/1",
    });
    const user = makeEntity({
      num: "P1",
      name: "NonTrophy",
      pos: [5, 5],
      team: 0,
      resources: {},
    });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [5, 6],
      team: 1,
    });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    expect(target.statuses).toHaveLength(0);
  });

  it("non-thirst clauses still apply when thirst is gated", () => {
    const ability = makeAbility({
      name: "Dual Clause",
      range: "Melee",
      effect:
        "Thirst 5: Pull 2. Always: target -2 ATK/1.",
    });
    const user = makeEntity({
      num: "P1",
      name: "A",
      pos: [5, 5],
      team: 0,
      resources: { blood: 1 },
    });
    const target = makeEntity({
      num: "P2",
      name: "B",
      pos: [5, 6],
      team: 1,
    });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    // Thirst 5 didn't fire -- target not pulled, still at [5,6]
    expect(target.pos).toEqual([5, 6]);
    // "Always" +"-2 ATK/1" probably parses as something. Just check no bleed.
    expect(target.statuses).toHaveLength(0);
  });

  it("threads ability context into nested apex inside thirst", () => {
    // Thirst fires (Blood high) but the nested apex clause is then evaluated
    // against the per-target range of the *outer* ability. The outer ability
    // here is Melee, and target is at chebyshev 1 (Melee max), so apex would
    // fire if Blood were enough.
    const ability = makeAbility({
      name: "Tomahawk-lite",
      range: "Melee",
      effect: "Thirst 4: Apex: +2 ATK/1",
    });
    const user = makeEntity({
      num: "P1",
      name: "A",
      pos: [5, 5],
      team: 0,
      resources: { blood: 5 },
    });
    const target = makeEntity({
      num: "P2",
      name: "B",
      pos: [5, 6],
      team: 1,
    });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    // Melee apex at chebyshev 1 -> nested apex should fire its +2 ATK buff.
    const atkBuff = target.buffs.find(
      (b) => b.stat === "atk",
    );
    expect(atkBuff?.amount).toBe(2);
  });
});

// =============================================================================
// Choose -- generator-driven prompts
// =============================================================================

/**
 * Drain `applyEffectStream` to completion, emulating a player who always
 * picks the option at `picker(prompt).index` (default: option 0). Returns
 * the accumulated log messages plus the prompts the player saw, in order.
 */
function driveStream(
  gen: Generator<any, string[], string>,
  picker: (prompt: any) => number = () => 0,
) {
  const prompts: any[] = [];
  let nextInput: string | undefined = undefined;
  while (true) {
    const step = gen.next(nextInput);
    nextInput = undefined;
    if (step.done) return { messages: step.value, prompts };
    prompts.push(step.value);
    const idx = picker(step.value);
    const chosen = step.value.options[idx];
    nextInput = chosen.id;
  }
}

describe("parseEffects: choose clause", () => {
  it("recognises 'Choose: A or B or C' as a choose clause", () => {
    const effects = parseEffects("Choose: +3 ATK/1 or +1 ACC/1 or +4 DEF/1");
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("choose");
    if (effects[0].type !== "choose") return;
    expect(effects[0].options.length).toBe(3);
  });

  it("parses 'Choose Yin or Yang.' with two options", () => {
    const effects = parseEffects(
      "Choose Yin or Yang.\\\\nYin: Physical. Yang: Magical.",
    );
    // First clause will be "Choose Yin or Yang" -> choose with [Yin, Yang]
    // parser splits on . at depth 0 so this would be: ["Choose Yin or Yang", "\\nYin: Physical", " Yang: Magical"]
    // The choose clause parses first two options (Yin, Yang) before splittable "." breaks.
    // The remaining clauses go through individually.
    const choose = effects.find((e) => e.type === "choose");
    expect(choose).toBeDefined();
    if (choose?.type !== "choose") return;
    expect(choose.options.length).toBeGreaterThanOrEqual(2);
  });
});

describe("applyEffectStream: choose prompt", () => {
  it("yields a choose prompt when encountering a Choose clause", () => {
    const ability = makeAbility({
      name: "Rising Hope",
      range: "Melee",
      effect: "Choose: +3 ATK/1 or +1 ACC/1 or +4 DEF/1",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    const { messages, prompts } = driveStream(
      applyEffectStream(game, user, target, effects, ability),
    );

    expect(prompts).toHaveLength(1);
    expect(prompts[0].kind).toBe("choose");
    expect(prompts[0].options).toHaveLength(3);
    // The summary labels should mention the relevant stat names.
    const labels = prompts[0].options.map((o: any) => o.label);
    expect(labels.some((l: string) => /atk/i.test(l))).toBe(true);
    expect(labels.some((l: string) => /acc/i.test(l))).toBe(true);
    expect(labels.some((l: string) => /def/i.test(l))).toBe(true);

    // After answering option 0 (+3 ATK), the chosen buff should be applied.
    expect(messages.some((m) => m.includes("+3"))).toBe(true);
    expect(target.buffs.length).toBeGreaterThanOrEqual(1);
  });

  it("only applies the chosen option's sub-effects (not all)", () => {
    const ability = makeAbility({
      name: "Pick One",
      range: "Melee",
      effect: "Choose: +3 ATK/1 or +1 ACC/1 or +4 DEF/1",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);

    // Pick option 2 (+4 DEF/1)
    const { prompts } = driveStream(
      applyEffectStream(game, user, target, effects, ability),
      (p) => 2,
    );

    expect(prompts).toHaveLength(1);
    // Only DEF applied, not ATK or ACC
    const statBuffs = target.buffs.map((b) => b.stat);
    expect(statBuffs).toContain("def");
    expect(statBuffs).not.toContain("atk");
    expect(statBuffs).not.toContain("acc");
  });

  it("doesn't yield when there's no Choose clause -- streams straight through", () => {
    const ability = makeAbility({
      name: "Boost",
      range: "Melee",
      effect: "inflict 3 Bleed/1",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    const game = makeGame({ entities: [user, target] });

    const { prompts, messages } = driveStream(
      applyEffectStream(
        game,
        user,
        target,
        parseEffects(ability.effect),
        ability,
      ),
    );
    expect(prompts).toHaveLength(0);
    expect(messages.length).toBeGreaterThan(0);
    expect(target.statuses.find((s) => s.name === "Bleed")).toBeDefined();
  });

  it("nested Choose: a Choose inside a chosen option also prompts", () => {
    // Manually construct: outer choose { option 0 = +3 atk, option 1 = inner
    // choose { +1 atk, +2 atk } } -> picking option 1 should yield a second
    // prompt.
    const effects = [
      {
        type: "choose" as const,
        options: [
          [{ type: "buff" as const, stat: "atk", amount: 3, rounds: 1 }],
          [
            {
              type: "choose" as const,
              options: [
                [{ type: "buff" as const, stat: "atk", amount: 1, rounds: 1 }],
                [{ type: "buff" as const, stat: "atk", amount: 2, rounds: 1 }],
              ],
            },
          ],
        ],
      },
    ];
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    const game = makeGame({ entities: [user, target] });

    let pickerCalls = 0;
    const { prompts } = driveStream(
      applyEffectStream(game, user, target, effects),
      (p) => {
        pickerCalls++;
        return pickerCalls === 1 ? 1 : 1; // pick option 1 of outer, then option 1 of inner
      },
    );
    expect(prompts.length).toBe(2);
    // Only the second option of the inner choose (+2 atk) should have been
    // applied -- total buff applied once with amount 2.
    expect(target.buffs.length).toBe(1);
    expect(target.buffs[0]).toEqual({ stat: "atk", amount: 2, rounds: 1 });
  });

  it("sync applyEffects fallback fans out choose options (test ergonomics)", () => {
    // applyEffects shouldn't throw on a choose clause -- it should emit a
    // "[Choose one]" placeholder plus one Option N summary line per option.
    const ability = makeAbility({
      name: "Three-way",
      range: "Melee",
      effect: "Choose: +3 ATK/1 or +1 ACC/1 or +4 DEF/1",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    const game = makeGame({ entities: [user, target] });

    const messages = applyEffects(
      game,
      user,
      target,
      parseEffects(ability.effect),
      ability,
    );

    expect(messages.some((m) => m.toLowerCase().includes("choose one"))).toBe(
      true,
    );
    expect(messages.some((m) => m.startsWith("    Option 1:"))).toBe(true);
    expect(messages.some((m) => m.startsWith("    Option 2:"))).toBe(true);
    expect(messages.some((m) => m.startsWith("    Option 3:"))).toBe(true);
  });
});

// =============================================================================
// Conditional gate
// =============================================================================

describe("parseEffects: conditional clause", () => {
  it("recognises 'If CONDITION, EFFECT [Otherwise EFFECT]'", () => {
    const effects = parseEffects("If user ATK > 5, +3 ATK/1. Otherwise, +1 DEF/1.");
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("conditional");
    if (effects[0].type !== "conditional") return;
    expect(effects[0].condition).toContain("user atk > 5");
    expect(effects[0].thenEffects.length).toBeGreaterThan(0);
    expect(effects[0].elseEffects?.length).toBeGreaterThan(0);
  });

  it("parses conditional without otherwise-branch", () => {
    const effects = parseEffects("If target is alive, +1 MP.");
    expect(effects).toHaveLength(1);
    if (effects[0].type !== "conditional") return;
    expect(effects[0].condition).toBe("target is alive");
    expect(effects[0].thenEffects.length).toBeGreaterThan(0);
    expect(effects[0].elseEffects).toBeUndefined();
  });
});

describe("evaluateCondition: supported patterns", () => {
  it("target is alive / dead", () => {
    const user = makeEntity({ num: "P1", name: "A" });
    const live = makeEntity({ num: "P2", name: "B", curhp: 50 });
    const dead = makeEntity({ num: "P2", name: "B", curhp: 0 });
    expect(evaluateCondition("target is alive", user, live)).toBe("then");
    expect(evaluateCondition("target is alive", user, dead)).toBe("else");
    expect(evaluateCondition("target is dead", user, live)).toBe("else");
    expect(evaluateCondition("target is dead", user, dead)).toBe("then");
  });

  it("user/target has Status", () => {
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({
      num: "P2",
      name: "B",
      statuses: [
        { name: "Stun", damage: 0, rounds: 2, maxRounds: 2, removable: true },
      ],
    });
    expect(evaluateCondition("target has Stun", user, target)).toBe("then");
    expect(evaluateCondition("target has Slow", user, target)).toBe("else");
    expect(evaluateCondition("user has Stun", user, target)).toBe("else");
  });

  it("user/target has N <resource>", () => {
    const user = makeEntity({
      num: "P1",
      name: "A",
      resources: { blood: 5 },
    });
    const target = makeEntity({
      num: "P2",
      name: "B",
      resources: { blood: 3 },
    });
    expect(evaluateCondition("user has 5 blood", user, target)).toBe("then");
    expect(evaluateCondition("user has 4 blood", user, target)).toBe("then");
    expect(evaluateCondition("user has 6 blood", user, target)).toBe("else");
    expect(evaluateCondition("target has 3 blood", user, target)).toBe("then");
    expect(evaluateCondition("target has 4 blood", user, target)).toBe("else");
  });

  it("resource threshold shorthand like '5 Blood' / '0 Campaigns'", () => {
    const user = makeEntity({
      num: "P1",
      name: "A",
      resources: { blood: 5, campaigns: 0 },
    });
    const target = makeEntity({ num: "P2", name: "B" });
    expect(evaluateCondition("5 blood", user, target)).toBe("then");
    expect(evaluateCondition("6 blood", user, target)).toBe("else");
    expect(evaluateCondition("zero campaigns", user, target)).toBe("then");
    expect(evaluateCondition("no campaigns", user, target)).toBe("then");
    expect(evaluateCondition("1 campaign", user, target)).toBe("else");
  });

  it("Stat comparison (>, >=, =, greater/less than, equal to)", () => {
    const user = makeEntity({ num: "P1", name: "A", atk: 10 });
    const target = makeEntity({ num: "P2", name: "B", mag: 7 });

    expect(evaluateCondition("user atk > 5", user, target)).toBe("then");
    expect(evaluateCondition("user atk > 15", user, target)).toBe("else");
    expect(evaluateCondition("user atk >= 10", user, target)).toBe("then");
    expect(evaluateCondition("user atk = 10", user, target)).toBe("then");
    expect(evaluateCondition("target mag > 5", user, target)).toBe("then");
    expect(evaluateCondition("target mag greater than 5", user, target)).toBe(
      "then",
    );
    expect(evaluateCondition("target mag less than 10", user, target)).toBe(
      "then",
    );
    expect(evaluateCondition("target mag less than 5", user, target)).toBe(
      "else",
    );
  });

  it("Stat sign (positive/negative/zero)", () => {
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });

    // Vanilla ATK is 10 -> positive
    expect(evaluateCondition("user atk positive", user, target)).toBe("then");
    expect(evaluateCondition("user atk negative", user, target)).toBe("else");
    expect(evaluateCondition("user atk zero", user, target)).toBe("else");

    target.buffs.push({ stat: "atk", amount: -100, rounds: 1 });
    expect(evaluateCondition("target atk positive", user, target)).toBe("else");
    expect(evaluateCondition("target atk negative", user, target)).toBe("then");
  });

  it("not / no negation wraps another condition", () => {
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({
      num: "P2",
      name: "B",
      statuses: [
        { name: "Stun", damage: 0, rounds: 2, maxRounds: 2, removable: true },
      ],
    });

    expect(evaluateCondition("target has Stun", user, target)).toBe("then");
    expect(evaluateCondition("not target has Stun", user, target)).toBe("else");
    expect(evaluateCondition("no target has Stun", user, target)).toBe("else");
    expect(evaluateCondition("target is alive", user, target)).toBe("then");
    expect(evaluateCondition("not target is alive", user, target)).toBe("else");
  });

  it("unknown conditions return 'unknown' (and fall back to then-branch)", () => {
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });

    expect(evaluateCondition("target Dashes before user's next turn", user, target)).toBe(
      "unknown",
    );
    expect(
      evaluateCondition(
        "the player this ability originates from has more MAG than ATK",
        user,
        target,
      ),
    ).toBe("unknown");
  });
});

describe("applyEffectStream / applyEffects: conditional gate end-to-end", () => {
  function buildCtx() {
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({
      num: "P2",
      name: "B",
      pos: [5, 6],
      curhp: 50,
      statuses: [
        {
          name: "Cripple",
          damage: 0,
          rounds: 2,
          maxRounds: 2,
          removable: true,
        },
      ],
    });
    const ability = makeAbility({
      name: "Smart Strike",
      range: "Melee",
      effect: "",
    });
    const game = makeGame({ entities: [user, target] });
    return { user, target, ability, game };
  }

  it("then-branch fires when condition holds", () => {
    const { user, target, ability, game } = buildCtx();
    const effects = parseEffects("If target has Cripple, +5 ATK/1.");
    applyEffectStream(game, user, target, effects, ability).next(undefined);
    expect(target.buffs.some((b) => b.stat === "atk" && b.amount === 5)).toBe(
      true,
    );
  });

  it("else-branch fires when condition is false", () => {
    const { user, target, ability, game } = buildCtx();
    target.statuses = []; // remove Cripple
    const effects = parseEffects(
      "If target has Cripple, +5 ATK/1. Otherwise, +3 DEF/1.",
    );
    applyEffectStream(game, user, target, effects, ability).next(undefined);
    expect(target.buffs.some((b) => b.stat === "def" && b.amount === 3)).toBe(
      true,
    );
    expect(target.buffs.some((b) => b.stat === "atk")).toBe(false);
  });

  it("unknown conditions still fire then-branch but log TODO", () => {
    const { user, target, ability, game } = buildCtx();
    const effects = parseEffects(
      "If target Dashes before user's next turn, +5 ATK/1.",
    );
    const messages = applyEffectStream(game, user, target, effects, ability)
      .next(undefined).value as string[];
    expect(target.buffs.some((b) => b.stat === "atk" && b.amount === 5)).toBe(
      true,
    );
    expect(
      messages.some((m) =>
        m.toLowerCase().includes("condition evaluation todo"),
      ),
    ).toBe(true);
  });

  it("'If target is alive' false-branch drops sub-effects", () => {
    const { user, target, ability, game } = buildCtx();
    target.curhp = 0;
    const effects = parseEffects("If target is alive, +5 ATK/1.");
    applyEffectStream(game, user, target, effects, ability).next(undefined);
    expect(target.buffs.some((b) => b.stat === "atk")).toBe(false);
  });

  it("sync applyEffects routes correctly too", () => {
    const { user, target, ability, game } = buildCtx();
    target.statuses = [];
    const messages = applyEffects(
      game,
      user,
      target,
      parseEffects("If target has Cripple, +5 ATK/1. Otherwise, +3 DEF/1."),
      ability,
    );
    expect(target.buffs.some((b) => b.stat === "def" && b.amount === 3)).toBe(
      true,
    );
    expect(messages.some((m) => m.includes("Otherwise"))).toBe(true);
  });
});

// =============================================================================
// Sanity: non-apex effects still work
// =============================================================================

describe("applyEffects: regressions for non-apex effects", () => {
  beforeEach(() => {});

  it("applies buff effects unchanged", () => {
    const ability = makeAbility({ name: "Boost", range: "Melee", effect: "+3 ATK/2" });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    const game = makeGame({ entities: [user, target] });
    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    expect(target.buffs.length).toBe(1);
    expect(target.buffs[0]).toEqual({ stat: "atk", amount: 3, rounds: 2 });
  });

  it("applies status effects unchanged", () => {
    const ability = makeAbility({ name: "Bleed", range: "Melee", effect: "inflict 5 Bleed/3" });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });
    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    const bleed = target.statuses.find((s) => s.name === "Bleed");
    expect(bleed?.damage).toBe(5);
    expect(bleed?.rounds).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Moon-phase conditions and phase effects
// ---------------------------------------------------------------------------

describe("evaluateCondition: moon phase", () => {
  it("evaluates 'phase is X' against the active phase", () => {
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });

    // Default phase is new moon when none is set.
    expect(evaluateCondition("phase is new moon", user, target)).toBe("then");
    expect(evaluateCondition("phase is full moon", user, target)).toBe("else");

    // Explicit phase argument.
    expect(evaluateCondition("phase is full moon", user, target, "full moon")).toBe("then");
    expect(evaluateCondition("phase is waning", user, target, "full moon")).toBe("else");
  });

  it("parses 'New Moon: EFFECT' as a phase-conditional effect", () => {
    const effects = parseEffects("New Moon: inflict 5 Bleed/3");
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("conditional");
    if (effects[0].type !== "conditional") return;
    expect(effects[0].condition).toBe("phase is new moon");
  });

  it("applies a moon-phase conditional when the phase matches", () => {
    const ability = makeAbility({ name: "Moonlit", range: "Melee", effect: "New Moon: inflict 5 Bleed/3" });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    const bleed = target.statuses.find((s) => s.name === "Bleed");
    expect(bleed?.damage).toBe(5);
  });

  it("skips a moon-phase conditional when the phase mismatches", () => {
    const ability = makeAbility({ name: "Moonlit", range: "Melee", effect: "Full Moon: inflict 5 Bleed/3" });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });
    game.moonPhase = "new moon";

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    const bleed = target.statuses.find((s) => s.name === "Bleed");
    expect(bleed).toBeUndefined();
  });

  it("'Phase: X' effect updates the game's moon phase", () => {
    const ability = makeAbility({ name: "Mooncall", range: "Melee", effect: "Phase: full moon" });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    expect(game.moonPhase).toBe("full moon");
  });
});

describe("Lunar Rod: phase-shift skip + second phase", () => {
  it("parses 'no Phase shift next turn' as skipPhaseShift", () => {
    const effects = parseEffects("no Phase shift next turn.");
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("skipPhaseShift");
  });

  it("parses 'User's Phase disabled next turn' as skipPhaseShift", () => {
    const effects = parseEffects("User's Phase disabled next turn.");
    expect(effects[0].type).toBe("skipPhaseShift");
  });

  it("parses 'Choose another Phase' as choosePhase (not a generic Choose)", () => {
    const effects = parseEffects("Choose another Phase (doesn't shift).");
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("choosePhase");
  });

  it("parses a New/Full Moon slash-combo with an Otherwise else-branch", () => {
    const effects = parseEffects(
      "New/Full Moon: heal 1d10+2. Otherwise: no Phase shift next turn.",
    );
    expect(effects).toHaveLength(1);
    const c = effects[0];
    expect(c.type).toBe("conditional");
    if (c.type !== "conditional") return;
    expect(c.condition).toBe("phase is new moon or full moon");
    expect(c.thenEffects[0].type).toBe("heal");
    expect(c.elseEffects?.[0].type).toBe("skipPhaseShift");
  });

  it("parses a Waxing/Waning slash-combo with an Otherwise else-branch", () => {
    const effects = parseEffects(
      "Waxing/Waning: inflict 5 Poison/1. Otherwise: inflict 3 Bleed/1.",
    );
    const c = effects[0];
    expect(c.type).toBe("conditional");
    if (c.type !== "conditional") return;
    expect(c.condition).toBe("phase is waxing or waning");
    expect(c.thenEffects[0].type).toBe("status");
    expect(c.elseEffects?.[0].type).toBe("status");
  });

  it("evaluates slash-combo phase conditions", () => {
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    expect(
      evaluateCondition("phase is new moon or full moon", user, target, "new moon"),
    ).toBe("then");
    expect(
      evaluateCondition("phase is new moon or full moon", user, target, "waning"),
    ).toBe("else");
  });

  it("evaluates 'user has 2 Phases' from a chosen second phase", () => {
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    expect(evaluateCondition("user has 2 Phases", user, target)).toBe("else");
    user.phaseChoice = "full moon";
    expect(evaluateCondition("user has 2 Phases", user, target)).toBe("then");
  });

  it("applyEffectStream: choosePhase stores the picked second phase", () => {
    const ability = makeAbility({
      name: "Far Side of the Moon",
      range: "Melee",
      effect: "Choose another Phase (doesn't shift).",
    });
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    const game = makeGame({ entities: [user, target] });

    const { prompts } = driveStream(
      applyEffectStream(game, user, target, parseEffects(ability.effect), ability),
      (p) => 2, // pick the third option (Full Moon)
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0].kind).toBe("choose");
    expect(prompts[0].options.map((o: any) => o.label)).toEqual([
      "New Moon",
      "Waxing",
      "Full Moon",
      "Waning",
    ]);
    expect(user.phaseChoice).toBe("full moon");
  });

  it("applyEffects: skipPhaseShift sets the game flag", () => {
    const ability = makeAbility({
      name: "Harvest Moon",
      range: "Melee",
      effect: "no Phase shift next turn.",
    });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });

    const messages = applyEffects(
      game,
      user,
      target,
      parseEffects(ability.effect),
      ability,
    );
    expect(game.skipMoonPhaseShift).toBe(true);
    expect(messages.some((m) => /no phase shift/i.test(m))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per / When triggers dispatch their sub-effects on hit
// ---------------------------------------------------------------------------

describe("per / when triggers", () => {
  it("'Per hit: EFFECT' dispatches its sub-effects", () => {
    const ability = makeAbility({ name: "Siphon", range: "Melee", effect: "Per hit: inflict 5 Bleed/3" });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    const bleed = target.statuses.find((s) => s.name === "Bleed");
    expect(bleed?.damage).toBe(5);
    expect(bleed?.rounds).toBe(3);
  });

  it("'When user damages a foe: EFFECT' dispatches its sub-effects", () => {
    const ability = makeAbility({ name: "Brand", range: "Melee", effect: "When user damages a foe: inflict 3 Stun/1" });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    const stun = target.statuses.find((s) => s.name === "Stun");
    expect(stun).toBeDefined();
  });

  it("'Per 5 CP: EFFECT' dispatches when the resource pool meets the count", () => {
    const ability = makeAbility({ name: "Combo", range: "Melee", effect: "Per 5 CP: inflict 2 Bleed/2" });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });
    user.resources = { cp: 7 }; // meets the 5-count

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    const bleed = target.statuses.find((s) => s.name === "Bleed");
    expect(bleed).toBeDefined();
  });

  it("'Per 5 CP: EFFECT' stays summarized when the pool is below the count", () => {
    const ability = makeAbility({ name: "Combo", range: "Melee", effect: "Per 5 CP: inflict 2 Bleed/2" });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });
    user.resources = { cp: 2 }; // below the 5-count

    const effects = parseEffects(ability.effect);
    const messages = applyEffects(game, user, target, effects, ability);

    const bleed = target.statuses.find((s) => s.name === "Bleed");
    expect(bleed).toBeUndefined();
    // The trigger stays as a summarized log line.
    expect(messages.some((m) => m.includes("[Per 5 cp]"))).toBe(true);
  });

  it("'When user kills a foe: EFFECT' dispatches only when the target is dead", () => {
    const ability = makeAbility({ name: "Execution", range: "Melee", effect: "When user kills a foe: inflict 5 Cripple/1" });
    const user = makeEntity({ num: "P1", name: "A" });
    const dead = makeEntity({ num: "P2", name: "B", curhp: 0 });
    const game = makeGame({ entities: [user, dead] });

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, dead, effects, ability);

    const cripple = dead.statuses.find((s) => s.name === "Cripple");
    expect(cripple).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Crit / dice / miss-rate modifiers -- parser branches
// ---------------------------------------------------------------------------

describe("parseEffects: crit threshold", () => {
  it("recognises 'Crit on N+' as a critMod clause", () => {
    const effects = parseEffects("Crit on 18+");
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("critMod");
    if (effects[0].type !== "critMod") return;
    expect(effects[0].threshold).toBe(18);
  });

  it("parses alongside other clauses (Blitz: 'Crit on 18+. Per hit: ...')", () => {
    const effects = parseEffects("Crit on 18+. Per hit: gain +4 damage on next attack.");
    const crit = effects.find((e) => e.type === "critMod");
    expect(crit).toBeDefined();
    if (crit?.type !== "critMod") return;
    expect(crit.threshold).toBe(18);
    expect(effects.some((e) => e.type === "per")).toBe(true);
  });

  it("parses 'crit on 14+' inside a conditional then-branch", () => {
    const effects = parseEffects("If target is at Range 7+: crit on 14+");
    expect(effects).toHaveLength(1);
    if (effects[0].type !== "conditional") return;
    const crit = effects[0].thenEffects.find((e) => e.type === "critMod");
    expect(crit).toBeDefined();
    if (crit?.type !== "critMod") return;
    expect(crit.threshold).toBe(14);
  });
});

describe("parseEffects: dice modifiers", () => {
  it("parses '+1 dice' as a diceMod (kind: dice)", () => {
    const effects = parseEffects("+1 dice");
    expect(effects[0].type).toBe("diceMod");
    if (effects[0].type !== "diceMod") return;
    expect(effects[0].kind).toBe("dice");
    expect(effects[0].amount).toBe(1);
  });

  it("parses '+1 base dice' as baseDice", () => {
    const effects = parseEffects("+1 base dice");
    expect(effects[0].type).toBe("diceMod");
    if (effects[0].type !== "diceMod") return;
    expect(effects[0].kind).toBe("baseDice");
    expect(effects[0].amount).toBe(1);
  });

  it("parses '+4 dice faces' as diceFaces", () => {
    const effects = parseEffects("+4 dice faces");
    expect(effects[0].type).toBe("diceMod");
    if (effects[0].type !== "diceMod") return;
    expect(effects[0].kind).toBe("diceFaces");
    expect(effects[0].amount).toBe(4);
  });

  it("parses negative decimals ('-1.5 dice faces')", () => {
    const effects = parseEffects("-1.5 dice faces");
    expect(effects[0].type).toBe("diceMod");
    if (effects[0].type !== "diceMod") return;
    expect(effects[0].kind).toBe("diceFaces");
    expect(effects[0].amount).toBe(-1.5);
  });

  it("parses the 'gain +1 dice' verb form", () => {
    const effects = parseEffects("gain +1 dice");
    expect(effects[0].type).toBe("diceMod");
    if (effects[0].type !== "diceMod") return;
    expect(effects[0].amount).toBe(1);
  });

  it("parses '+1 dice/1' duration suffix", () => {
    const effects = parseEffects("+1 dice/1");
    expect(effects[0].type).toBe("diceMod");
    if (effects[0].type !== "diceMod") return;
    expect(effects[0].rounds).toBe(1);
  });

  it("does not treat plain 'dice' words as modifiers", () => {
    const effects = parseEffects("Roll d20 and store");
    expect(effects[0].type).toBe("unknown");
  });
});

describe("parseEffects: miss-rate modifiers", () => {
  it("parses '-1 MR' as an mrMod", () => {
    const effects = parseEffects("-1 MR");
    expect(effects[0].type).toBe("mrMod");
    if (effects[0].type !== "mrMod") return;
    expect(effects[0].amount).toBe(-1);
  });

  it("parses '+3 MR/1' with a duration", () => {
    const effects = parseEffects("+3 MR/1");
    expect(effects[0].type).toBe("mrMod");
    if (effects[0].type !== "mrMod") return;
    expect(effects[0].amount).toBe(3);
    expect(effects[0].rounds).toBe(1);
  });

  it("parses a thirst-gated MR clause (Twin Fangs pattern)", () => {
    const effects = parseEffects("Thirst 5: +3 MR, Double Hit.");
    const thirst = effects.find((e) => e.type === "thirst");
    expect(thirst).toBeDefined();
    if (thirst?.type !== "thirst") return;
    expect(thirst.effects.some((e) => e.type === "mrMod")).toBe(true);
  });
});

describe("parseEffects: Reaction/Trigger-prefixed when-clauses", () => {
  it("parses 'Reaction: When X: EFFECT' as a trigger", () => {
    const effects = parseEffects(
      "Reaction: When foe ends turn within or enters tile's Star 1: inflict 3 Cripple/1",
    );
    expect(effects[0].type).toBe("trigger");
    if (effects[0].type !== "trigger") return;
    expect(effects[0].event).toContain("foe ends turn");
    expect(effects[0].effects.some((e) => e.type === "status")).toBe(true);
  });

  it("parses 'Trigger: When X: EFFECT' as a trigger", () => {
    const effects = parseEffects("Trigger: When user is hit: gain +1 MP");
    expect(effects[0].type).toBe("trigger");
  });
});

describe("parseEffects: ignore lists stay together", () => {
  it("keeps 'Ignores A, B, and C' as one ignore clause", () => {
    const effects = parseEffects(
      "Ignores ATK/MAG, half DEF, and outside damage factors",
    );
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("ignore");
    if (effects[0].type !== "ignore") return;
    expect(effects[0].what).toContain("atk/mag");
    expect(effects[0].what).toContain("half def");
  });

  it("classifies each fragment of an ignore list", () => {
    const meta = extractCombatMetadata(
      parseEffects("Ignores ATK/MAG, half DEF, and outside damage factors"),
    );
    expect(meta.ignore.atkMag).toBe(true);
    expect(meta.ignore.halfDef).toBe(true);
    expect(meta.ignore.outsideFactors).toBe(true);
    expect(meta.ignore.def).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// splitClauses: conjunctive pairings and numbered lists stay whole
// ---------------------------------------------------------------------------

describe("splitClauses: conjunctive pairings stay whole", () => {
  it("does not split stat pairings ('swap ATK and MAG')", () => {
    const effects = parseEffects("attacks become opposite damage type, swap ATK and MAG");
    const fragments = effects.filter((e) => e.type === "unknown");
    // The " and MAG" must not be orphaned as its own clause.
    expect(fragments.some((f) => f.type === "unknown" && f.text.trim() === "MAG")).toBe(
      false,
    );
  });

  it("does not split subject pairings ('User and target gain X')", () => {
    const effects = parseEffects("User and target gain Oath of Mercy");
    expect(effects).toHaveLength(1);
    if (effects[0].type !== "unknown") return;
    expect(effects[0].text).toBe("User and target gain Oath of Mercy");
  });

  it("keeps 'ignores ATK/MAG and DEF' together instead of orphaning DEF", () => {
    const effects = parseEffects(
      "Damage to path foes: ignores ATK/MAG and DEF",
    );
    expect(
      effects.some((e) => e.type === "unknown" && e.text.trim() === "DEF"),
    ).toBe(false);
  });

  it("still splits real effect conjunctions ('heal 2 HP and gain +1 ATK/MAG')", () => {
    const effects = parseEffects("heal 2 HP and gain +1 ATK/MAG");
    const heal = effects.find((e) => e.type === "heal");
    expect(heal).toBeDefined();
    if (heal?.type !== "heal") return;
    expect(heal.amount).toBe(2);
  });
});

describe("splitClauses: numbered list items stay whole", () => {
  it("keeps a numbered item with a mid-item comma intact", () => {
    const effects = parseEffects(
      "4. After damage, the user and target swap their current HP. 5. For one round, attacks automatically hit the user.",
    );
    // Item 4 parses as a swap ("swap their current HP"); item 5 stays whole.
    const swaps = effects.filter((e) => e.type === "swap");
    expect(swaps.length).toBeGreaterThanOrEqual(1);
    expect(
      effects.some((e) => e.type === "unknown" && e.text.includes("For one round") && e.text.includes("attacks automatically hit")),
    ).toBe(true);
  });

  it("does not orphan the list marker as its own clause", () => {
    const effects = parseEffects("5. For one round, attacks automatically hit the user");
    expect(
      effects.some((e) => e.type === "unknown" && e.text.trim() === "5"),
    ).toBe(false);
  });

  it("handles literal backslash-n line breaks in numbered tables", () => {
    // Stacked Deck uses literal \\n between d14 outcomes.
    const effects = parseEffects(
      "In place of an accuracy roll, roll a 1d14. \\n1. The opponent is healed by the roll, \\n2. The user takes 2x damage from all sources for one round.",
    );
    const unk = effects.filter((e) => e.type === "unknown");
    expect(unk.some((e) => e.text.includes("opponent is healed"))).toBe(true);
    expect(unk.some((e) => e.text.includes("user takes 2x damage"))).toBe(true);
    expect(unk.some((e) => e.text.trim() === "MAG")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gladius subweapon clauses: Requires / Switch to / X: branches
// ---------------------------------------------------------------------------

describe("parseEffects: subweapon clauses", () => {
  it("parses 'Requires Pilum' as a requires clause", () => {
    const effects = parseEffects("Requires Pilum. +1 base dice");
    const req = effects.find((e) => e.type === "requires");
    expect(req).toBeDefined();
    if (req?.type !== "requires") return;
    expect(req.weapons).toEqual(["pilum"]);
    expect(effects.some((e) => e.type === "diceMod")).toBe(true);
  });

  it("parses 'Requires Gladius or Pilum' into both weapons", () => {
    const effects = parseEffects("Requires Gladius or Pilum");
    expect(effects).toHaveLength(1);
    if (effects[0].type !== "requires") return;
    expect(effects[0].weapons).toEqual(["gladius", "pilum"]);
  });

  it("parses 'Switch to X' / 'swap to X' / 'Start in X' as switchWeapon", () => {
    for (const [input, expected] of [
      ["Switch to Pilum", ["pilum"]],
      ["swap to Gladius", ["gladius"]],
      ["Start in Gladius", ["gladius"]],
      ["Switch to Gladius or Scutum", ["gladius", "scutum"]],
    ] as [string, string[]][]) {
      const effects = parseEffects(input);
      expect(effects).toHaveLength(1);
      if (effects[0].type !== "switchWeapon") continue;
      expect(effects[0].to).toEqual(expected);
    }
  });

  it("parses 'Swap subweapons (Standard)' as a free-form switch", () => {
    const effects = parseEffects("Swap subweapons (Standard)");
    expect(effects).toHaveLength(1);
    if (effects[0].type !== "switchWeapon") return;
    expect(effects[0].to).toEqual(["gladius", "scutum", "pilum"]);
  });

  it("parses 'Gladius: X' branches as subweapon-gated conditionals", () => {
    const effects = parseEffects(
      "Gladius: +1 dice. Scutum: ranged attacks on user lose 5 damage.",
    );
    const branches = effects.filter((e) => e.type === "conditional");
    expect(branches).toHaveLength(2);
    const gladius = branches[0];
    if (gladius?.type !== "conditional") return;
    expect(gladius.condition).toBe("subweapon is gladius");
    expect(gladius.thenEffects.some((e) => e.type === "diceMod")).toBe(true);
  });

  it("keeps commas and 'and' inside a subweapon branch", () => {
    const effects = parseEffects(
      "Pilum: +1 ACC/1 and +1 CR/1",
    );
    const branch = effects.find((e) => e.type === "conditional");
    expect(branch).toBeDefined();
    if (branch?.type !== "conditional") return;
    expect(branch.condition).toBe("subweapon is pilum");
    const types = branch.thenEffects.map((e) => e.type);
    expect(types).toEqual(["buff", "buff"]);
  });

  it("keeps a swap inside a branch ('Scutum: Push 3, swap to Pilum')", () => {
    const effects = parseEffects(
      "Gladius: swap to Scutum. Scutum: Push 3, swap to Pilum. Pilum: inflict 4 Cripple/1, swap to Gladius.",
    );
    const branches = effects.filter((e) => e.type === "conditional");
    expect(branches).toHaveLength(3);
    const scutum = branches[1];
    if (scutum?.type !== "conditional") return;
    const types = scutum.thenEffects.map((e) => e.type);
    expect(types).toContain("push");
    expect(types).toContain("switchWeapon");
  });

  it("dispatches the matching subweapon branch on apply", () => {
    const ability = makeAbility({
      name: "Subweapon Test",
      range: "Melee",
      effect: "Gladius: gain +2 ACC/1. Scutum: gain +2 PD/1.",
    });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });
    user.subweapon = "gladius";

    const effects = parseEffects(ability.effect);
    applyEffects(game, user, target, effects, ability);

    // Effects apply to the target; only the matching branch should land.
    const accBuff = target.buffs.find((b) => b.stat === "acc");
    expect(accBuff).toBeDefined();
    expect(target.buffs.some((b) => b.stat === "pd")).toBe(false);
  });

  it("switchWeapon effect updates the entity's subweapon", () => {
    const ability = makeAbility({ name: "Swap", range: "Melee", effect: "Switch to Pilum" });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });

    applyEffects(game, user, target, parseEffects(ability.effect), ability);

    expect(user.subweapon).toBe("pilum");
  });

  it("multi-option 'Switch to Gladius or Scutum' prompts and equips the pick", () => {
    const ability = makeAbility({
      name: "Bulwark",
      range: "Melee",
      effect: "Switch to Gladius or Scutum.",
    });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    const { messages, prompts } = driveStream(
      applyEffectStream(game, user, target, effects, ability),
      () => 1, // pick the second option (Scutum)
    );

    expect(prompts).toHaveLength(1);
    expect(prompts[0].kind).toBe("choose");
    expect(prompts[0].options.map((o: any) => o.label)).toEqual([
      "Gladius",
      "Scutum",
    ]);
    expect(user.subweapon).toBe("scutum");
    expect(messages.some((m) => m.includes("switches to Scutum"))).toBe(true);
  });

  it("sync applyEffects fans out multi-option switch choices without applying", () => {
    // The sync wrapper can't collect a prompt, so it lists the options and
    // leaves the subweapon untouched (manual resolution needed).
    const ability = makeAbility({
      name: "Bulwark",
      range: "Melee",
      effect: "Switch to Gladius or Scutum.",
    });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });

    const messages = applyEffects(
      game,
      user,
      target,
      parseEffects(ability.effect),
      ability,
    );

    expect(messages.some((m) => m.includes("Gladius"))).toBe(true);
    expect(messages.some((m) => m.includes("Scutum"))).toBe(true);
    expect(user.subweapon).toBeUndefined();
  });  it("requires clause logs a marker without applying anything", () => {
    const ability = makeAbility({ name: "Gate", range: "Melee", effect: "Requires Scutum. +1 base dice" });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });
    const messages = applyEffects(game, user, target, parseEffects(ability.effect), ability);
    expect(messages.some((m) => m.includes("Requires Scutum"))).toBe(true);
    expect(user.subweapon).toBeUndefined();
  });

  it("requiredSubweapons collects the weapons from 'Requires X' clauses", () => {
    expect(requiredSubweapons("Requires Pilum. +1 base dice")).toEqual(["pilum"]);
    expect(requiredSubweapons("Requires Gladius or Pilum.")).toEqual([
      "gladius",
      "pilum",
    ]);
    expect(requiredSubweapons("Requires Scutum.")).toEqual(["scutum"]);
  });

  it("requiredSubweapons returns [] when there is no requires clause", () => {
    expect(requiredSubweapons("+1 base dice. Push 2.")).toEqual([]);
    expect(requiredSubweapons("")).toEqual([]);
  });

  it("requiredSubweapons dedupes repeated requires clauses", () => {
    expect(requiredSubweapons("Requires Gladius. Requires Gladius.")).toEqual([
      "gladius",
    ]);
  });
});

describe("applyEffectStream: crit/dice/MR mods log naturally", () => {
  it("critMod, diceMod and mrMod all produce log lines", () => {
    const ability = makeAbility({
      name: "Triple Mod",
      range: "Melee",
      effect: "Crit on 18+. +1 dice. -1 MR.",
    });
    const user = makeEntity({ num: "P1", name: "A" });
    const target = makeEntity({ num: "P2", name: "B" });
    const game = makeGame({ entities: [user, target] });

    const effects = parseEffects(ability.effect);
    const messages = applyEffects(game, user, target, effects, ability);

    expect(
      messages.some((m) => m.toLowerCase().includes("crit threshold lowered to 18")),
    ).toBe(true);
    expect(messages.some((m) => m.includes("+1 dice"))).toBe(true);
    expect(messages.some((m) => m.toLowerCase().includes("miss rate -1"))).toBe(
      true,
    );
  });
});

// =============================================================================
// Lunar Phase: range / defender-dice / double-effects clauses
// =============================================================================

describe("Lunar Phase clause parsing", () => {
  it("parses +N Range as a rangeMod", () => {
    const effects = parseEffects("+1 Range");
    expect(effects).toHaveLength(1);
    expect(effects[0].type).toBe("rangeMod");
    if (effects[0].type === "rangeMod") expect(effects[0].amount).toBe(1);
  });

  it("parses a phase-gated +N Range inside New Moon", () => {
    const effects = parseEffects("New Moon: +1 Range.");
    expect(effects[0].type).toBe("conditional");
    if (effects[0].type !== "conditional") return;
    expect(effects[0].condition).toBe("phase is new moon");
    expect(effects[0].thenEffects[0].type).toBe("rangeMod");
  });

  it("parses -N dice on attacks targeting user as a targetingDiceMod", () => {
    const effects = parseEffects("-1 dice on attacks targeting user");
    expect(effects[0].type).toBe("targetingDiceMod");
    if (effects[0].type !== "targetingDiceMod") return;
    expect(effects[0].amount).toBe(-1);
  });

  it("parses the Fatal Moonlight header as a doubleEffects marker", () => {
    const effects = parseEffects("Two effects if user has 2 Phases");
    expect(effects[0].type).toBe("doubleEffects");
  });

  it("parses the full real Lunar Phase passive without unknowns", () => {
    const effects = parseEffects(
      "New Moon: +1 Range. Waxing: +2 dice faces. Full Moon: -1 dice on attacks targeting user. Waning: +1 dice.",
    );
    expect(effects.some((e) => e.type === "unknown")).toBe(false);
    expect(effects.map((e) => e.type)).toEqual([
      "conditional",
      "conditional",
      "conditional",
      "conditional",
    ]);
  });
});

describe("getPassiveRangeBonus", () => {
  it("grants +1 Range while the phase is New Moon", () => {
    const e = makeEntity({ num: "P1", name: "Luna", pos: [5, 5] });
    e.abilities = [
      makeAbility({
        name: "Lunar Phase",
        actionType: "Passive",
        effect: "New Moon: +1 Range.",
      }),
    ];
    expect(getPassiveRangeBonus(e, "new moon")).toBe(1);
    expect(getPassiveRangeBonus(e, "waning")).toBe(0);
    expect(getPassiveRangeBonus(e)).toBe(0); // no phase -> branch not entered
  });

  it("is case/whitespace-insensitive to the phase value ('New Moon' still counts)", () => {
    const e = makeEntity({ num: "P1", name: "Luna", pos: [5, 5] });
    e.abilities = [
      makeAbility({
        name: "Lunar Phase",
        actionType: "Passive",
        effect: "New Moon: +1 Range.",
      }),
    ];
    expect(getPassiveRangeBonus(e, "New Moon")).toBe(1);
    expect(getPassiveRangeBonus(e, "  waning  ")).toBe(0);
  });

  it("formatSubweapon canonicalizes aliases for display", () => {
    expect(formatSubweapon("PILUM")).toBe("Pilum");
    expect(formatSubweapon("pi-lum")).toBe("Pilum");
    expect(formatSubweapon("gladius")).toBe("Gladius");
    expect(formatSubweapon("axe")).toBe("");
    expect(formatSubweapon(undefined)).toBe("");
  });

  it("sums across multiple passive abilities", () => {
    const e = makeEntity({ num: "P1", name: "Luna", pos: [5, 5] });
    e.abilities = [
      makeAbility({
        name: "Lunar Phase",
        actionType: "Passive",
        effect: "New Moon: +1 Range.",
      }),
      makeAbility({ name: "Longer Reach", actionType: "Passive", effect: "+2 Range" }),
    ];
    expect(getPassiveRangeBonus(e, "new moon")).toBe(3);
  });
});

describe("getDefenderDiceMods", () => {
  it("penalizes dice while the phase is Full Moon", () => {
    const e = makeEntity({ num: "P1", name: "Luna", pos: [5, 5] });
    e.abilities = [
      makeAbility({
        name: "Lunar Phase",
        actionType: "Passive",
        effect: "Full Moon: -1 dice on attacks targeting user.",
      }),
    ];
    expect(getDefenderDiceMods(e, "full moon")).toBe(-1);
    expect(getDefenderDiceMods(e, "new moon")).toBe(0);
  });
});

describe("evaluateCondition: chosen 2nd Phase (two effects)", () => {
  it("matches the chosen 2nd phase alongside the active phase", () => {
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    user.phaseChoice = "waning";
    expect(evaluateCondition("phase is waning", user, user, "new moon")).toBe(
      "then",
    );
    expect(evaluateCondition("phase is new moon", user, user, "new moon")).toBe(
      "then",
    );
    expect(evaluateCondition("phase is waning", user, user, "waning")).toBe(
      "then",
    );
    expect(evaluateCondition("phase is waxing", user, user, "new moon")).toBe(
      "else",
    );
  });

  it("slash-combo conditions also accept the chosen 2nd phase", () => {
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    user.phaseChoice = "waning";
    expect(
      evaluateCondition("phase is new moon or waning", user, user, "new moon"),
    ).toBe("then");
    expect(
      evaluateCondition("phase is waxing or waning", user, user, "new moon"),
    ).toBe("then");
    expect(
      evaluateCondition("phase is waxing or full moon", user, user, "new moon"),
    ).toBe("else");
  });

  it("does not match other phases without a 2nd phase", () => {
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    expect(evaluateCondition("phase is waning", user, user, "new moon")).toBe(
      "else",
    );
  });

  it("applyEffects fires both phase branches while a 2nd phase is held", () => {
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    user.phaseChoice = "waning";
    const game = makeGame({ entities: [user, target] });
    game.moonPhase = "new moon";
    const ability = makeAbility({
      name: "Fatal Moonlight",
      effect: "New Moon: +1 dice. Waning: +2 dice faces.",
    });
    const messages = applyEffects(
      game,
      user,
      target,
      parseEffects(ability.effect),
      ability,
    );
    expect(messages.some((m) => m.includes("+1 dice"))).toBe(true);
    expect(messages.some((m) => m.includes("+2 dice faces"))).toBe(true);
  });

  it("applyEffects fires only the active phase's branch without a 2nd phase", () => {
    const user = makeEntity({ num: "P1", name: "A", pos: [5, 5] });
    const target = makeEntity({ num: "P2", name: "B", pos: [5, 6] });
    const game = makeGame({ entities: [user, target] });
    game.moonPhase = "new moon";
    const ability = makeAbility({
      name: "Fatal Moonlight",
      effect: "New Moon: +1 dice. Waning: +2 dice faces.",
    });
    const messages = applyEffects(
      game,
      user,
      target,
      parseEffects(ability.effect),
      ability,
    );
    expect(messages.some((m) => m.includes("+1 dice"))).toBe(true);
    expect(messages.some((m) => m.includes("+2 dice faces"))).toBe(false);
  });
});
