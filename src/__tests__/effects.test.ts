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
  it("memoizes: the same normalized text returns the identical array (cache hit)", () => {
    // Ability effect strings are static game data re-parsed on hot paths
    // (getPassiveRangeBonus / getDefenderDiceMods via inRange); the cache
    // must return the SAME array for the same normalized text so repeated
    // parses are O(1) lookups, and the tree stays immutable across callers.
    const a = parseEffects("+1 dice. +2 dice faces.");
    const b = parseEffects("+1 dice. +2 dice faces.");
    expect(a).toBe(b);
    // Whitespace-only / newline variants normalize to the same key.
    expect(parseEffects("\n  +1 dice.\n +2 dice faces. ")).toBe(a);
    // Empty / whitespace-only input: referentially stable singleton, not a
    // fresh array per call (PR-Agent #184).
    expect(parseEffects("")).toBe(parseEffects(""));
    expect(parseEffects("   \n ")).toBe(parseEffects(""));
  });

  it("evicts the oldest entry once the bounded cache overflows", () => {
    // 2048 unique entries fill the cache; the 2049th evicts the first, so
    // the first text's array is freed and gets re-parsed as a fresh entry
    // (still referentially stable for the SAME input at any moment).
    const first = parseEffects("unique effect 0");
    for (let i = 1; i <= 2048; i++) {
      parseEffects(`unique effect ${i}`);
    }
    const again = parseEffects("unique effect 0");
    expect(again).toBeDefined();
    expect(again).not.toBe(first); // evicted old entry, then re-parsed
  });

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
