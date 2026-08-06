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
  isApexActive,
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
