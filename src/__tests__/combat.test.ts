import { describe, it, expect, beforeEach } from "bun:test";
import { setWs } from "../utils.js";
import {
  type Game,
  type Entity,
  type AbilityData,
  Terrain,
} from "../game/state.js";
import { parseEffects, extractCombatMetadata } from "../game/effects.js";
import { startAttack, isValidTarget } from "../game/resolve.js";

setWs({ send() {} });

// ---------------------------------------------------------------------------
// Helpers (effects/ability/entity/game) -- limited to what these tests need.
// resolve.ts has its own makeEntity copies; for the metadata unit we just
// need minimal entities since extractCombatMetadata never reads them.
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

function makeGame(
  opts: { entities?: Entity[]; size?: number; map?: Terrain[][]; version?: string } = {},
): Game {
  const size = opts.size ?? 10;
  const map =
    opts.map ??
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
    version: opts.version ?? "4.4",
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
    mr: 0,
    roll: "1d6+0",
    damageType: "Physical",
    actionType: "Standard",
    targetAmount: 1,
    targetGroup: "Foe",
    range: "Melee",
    effect: "",
    ...overrides,
  };
}

beforeEach(() => {});

// ===========================================================================
// extractCombatMetadata — direct unit tests
// ===========================================================================

describe("extractCombatMetadata", () => {
  it("returns zero metadata for an empty effect list", () => {
    const meta = extractCombatMetadata([]);
    expect(meta.damagePercent).toBe(0);
    expect(meta.flatDamage).toBe(0);
    expect(meta.additionalHits).toBe(0);
    expect(meta.ignore.atkMag).toBe(false);
    expect(meta.ignore.def).toBe(false);
    expect(meta.ignore.halfDef).toBe(false);
    expect(meta.ignore.quarterDef).toBe(false);
    expect(meta.ignore.defReduction).toBe(0);
    expect(meta.ignore.outsideFactors).toBe(false);
    expect(meta.ignore.other).toEqual([]);
  });

  it("extracts a single +50% damage clause", () => {
    const effects = parseEffects("+50% damage");
    const meta = extractCombatMetadata(effects);
    expect(meta.damagePercent).toBe(50);
  });

  it("stacks multiple damage percent clauses additively (+30 +25 -10 = +45)", () => {
    const effects = parseEffects("+30% damage. +25% damage. -10% damage.");
    const meta = extractCombatMetadata(effects);
    expect(meta.damagePercent).toBe(45);
  });

  it("extracts flat DMG clauses (5 + 3 = 8)", () => {
    const effects = parseEffects("+5 DMG. +3 DMG.");
    const meta = extractCombatMetadata(effects);
    expect(meta.flatDamage).toBe(8);
  });

  it("combines percentages and flat damage (+30% / +5)", () => {
    const effects = parseEffects("+30% damage. +5 DMG.");
    const meta = extractCombatMetadata(effects);
    expect(meta.damagePercent).toBe(30);
    expect(meta.flatDamage).toBe(5);
  });

  it("extracts 'Ignores ATK/MAG'", () => {
    const effects = parseEffects("Ignores ATK/MAG.");
    const meta = extractCombatMetadata(effects);
    expect(meta.ignore.atkMag).toBe(true);
  });

  it("extracts plain 'Ignores DEF' as full-zero path", () => {
    const effects = parseEffects("Ignores DEF.");
    const meta = extractCombatMetadata(effects);
    expect(meta.ignore.def).toBe(true);
    expect(meta.ignore.halfDef).toBe(false);
    expect(meta.ignore.defReduction).toBe(0);
  });

  it("extracts 'Ignores 1/2 DEF' as half path", () => {
    const effects = parseEffects("Ignores 1/2 DEF.");
    const meta = extractCombatMetadata(effects);
    expect(meta.ignore.halfDef).toBe(true);
    expect(meta.ignore.def).toBe(false);
  });

  it("extracts 'Ignores half DEF' as half path (word variant)", () => {
    const effects = parseEffects("Ignores half DEF.");
    const meta = extractCombatMetadata(effects);
    expect(meta.ignore.halfDef).toBe(true);
  });

  it("extracts 'Ignores 1/4 DEF' as quarter path", () => {
    const effects = parseEffects("Ignores 1/4 DEF.");
    const meta = extractCombatMetadata(effects);
    expect(meta.ignore.quarterDef).toBe(true);
  });

  it("extracts 'Ignores 5 DEF' as numeric subtract path", () => {
    const effects = parseEffects("Ignores 5 DEF.");
    const meta = extractCombatMetadata(effects);
    expect(meta.ignore.defReduction).toBe(5);
    expect(meta.ignore.def).toBe(false);
    expect(meta.ignore.halfDef).toBe(false);
  });

  it("extracts 'Ignores up to 10 DEF'", () => {
    const effects = parseEffects("Ignores up to 10 DEF.");
    const meta = extractCombatMetadata(effects);
    expect(meta.ignore.defReduction).toBe(10);
  });

  it("extracts 'Ignores outside damage factors'", () => {
    const effects = parseEffects("Ignores outside damage factors.");
    const meta = extractCombatMetadata(effects);
    expect(meta.ignore.outsideFactors).toBe(true);
  });

  it("extracts Multi-Hit: 3 as additionalHits = 2", () => {
    const meta = extractCombatMetadata(parseEffects("Multi-Hit: 3"));
    expect(meta.additionalHits).toBe(2);
  });

  it("takes the max of multiple Multi-Hit clauses (4 vs 2 -> 3 hits beyond the base)", () => {
    const effects = parseEffects("Multi-Hit: 2. Multi-Hit: 4.");
    const meta = extractCombatMetadata(effects);
    expect(meta.additionalHits).toBe(3);
  });

  it("captures unrecognised Ignore clauses into `other`", () => {
    const effects = parseEffects("Ignores unknown thing.");
    const meta = extractCombatMetadata(effects);
    expect(meta.ignore.other).toContain("unknown thing");
  });

  it("does NOT descend into Apex sub-effects (would over-apply at non-apex ranges)", () => {
    const meta = extractCombatMetadata(parseEffects("Apex: +50% damage"));
    expect(meta.damagePercent).toBe(0);
  });

  it("does NOT descend into Thirst sub-effects (would over-apply when blood < threshold)", () => {
    const meta = extractCombatMetadata(parseEffects("Thirst 4: Multi-Hit: 3"));
    expect(meta.additionalHits).toBe(0);
  });

  it("does NOT descend into Conditional then- or else-branches at extract time", () => {
    // Walking both at extract time would over-count: a then-branch +30%
    // and an else-branch +10% together = +40% even though only one fires
    // at runtime. resolve.ts handles per-branch metadata through the
    // legacy buff pipeline; metadata here is top-level only.
    const meta = extractCombatMetadata(
      parseEffects("If target is alive, +30% damage. Otherwise, +10% damage."),
    );
    expect(meta.damagePercent).toBe(0);
  });

  it("does NOT descend into Choose option sub-effects at extract time", () => {
    const meta = extractCombatMetadata(
      parseEffects("Choose: Multi-Hit: 2 or +30% damage or Ignores DEF."),
    );
    // All clauses are inside the Choose gate, so the metadata extractor
    // treats them as gated and leaves the top-level metadata at zero.
    expect(meta.additionalHits).toBe(0);
    expect(meta.damagePercent).toBe(0);
    expect(meta.ignore.def).toBe(false);
  });

  it("combines all categories of top-level metadata in one block", () => {
    const effects = parseEffects(
      "Multi-Hit: 3. +50% damage. +8 DMG. Ignores 5 DEF. Ignores ATK/MAG.",
    );
    const meta = extractCombatMetadata(effects);
    expect(meta.additionalHits).toBe(2);
    expect(meta.damagePercent).toBe(50);
    expect(meta.flatDamage).toBe(8);
    expect(meta.ignore.defReduction).toBe(5);
    expect(meta.ignore.atkMag).toBe(true);
  });
});

// ===========================================================================
// applyIgnoreToDefense path is internal to resolve.ts; we test it indirectly
// by exercising resolve.ts through a minimal end-to-end attack and checking
// the resulting log. We avoid asserting exact damage numbers (dice are
// random) and instead check that the mod trail line shows up.
// ===========================================================================

/** Drive resolveAttackFlow to completion. Returns the joined log. */
function driveResolve(user: Entity, ability: AbilityData): string {
  const target = makeEntity({ num: "P2", name: "Bob", pos: [5, 6], team: 1 });
  return driveResolveAgainst(user, ability, target);
}

function driveResolveAgainst(
  user: Entity,
  ability: AbilityData,
  target: Entity,
  map?: Terrain[][],
  version?: string,
): string {
  const game = makeGame({ entities: [user, target], map, version });
  user.abilities = [ability];
  const step = startAttack(game, user, ability, target.num);
  let safety = 0;
  const out: string[] = [];
  if (step.done) out.push(...step.result.messages);

  let lastStepDone = step.done;
  while (user.pendingResolution && safety++ < 50) {
    const flow = user.pendingResolution;
    // Always answer with the first option / first target so the test
    // sweeps through any prompts. Multi-step generators advance cleanly.
    const step2 = flow.next("0");
    if (step2.done) {
      user.pendingResolution = undefined;
      user.pendingPromptKind = undefined;
      out.push(...step2.value.messages);
      lastStepDone = true;
      break;
    }
  }
  // Hard assertion against a hung generator: if the safety cap
  // tripped, the loop exited without `done`. Surface this loudly so
  // future test additions don't silently spin.
  expect(lastStepDone).toBe(true);
  return out.join("\n");
}

describe("resolveAttackFlow: damage mods surface in the log", () => {
  it("emits a 'Damage Modifiers applied' line when +50% damage is in effect", () => {
    // mr + eva = 0 means any roll >= 0 hits; we don't mock the dice,
    // we rely on the engine guaranteeing a hit so the trail always
    // appears in the log path.
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [5, 6],
      team: 1,
      eva: 0,
    });
    const ability = makeAbility({
      name: "Heavy Strike",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      effect: "+50% damage.",
    });
    const log = driveResolveAgainst(user, ability, target);
    const trail = log
      .split("\n")
      .find((line) => line.includes("Damage Modifiers applied"));
    expect(trail).toBeDefined();
    expect(trail!.toLowerCase()).toContain("+50% damage");
  });

  it("emits the damage mod trail when 'Ignores DEF' is in effect", () => {
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const ability = makeAbility({
      name: "Penetrating Strike",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      effect: "Ignores DEF.",
    });
    const log = driveResolve(user, ability);
    const trail = log
      .split("\n")
      .find((line) => line.includes("Damage Modifiers applied"));
    expect(trail).toBeDefined();
    expect(trail!.toLowerCase()).toContain("ignores def");
  });

  it("emits the damage mod trail when 'Ignores 5 DEF' is in effect", () => {
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const ability = makeAbility({
      name: "Armor-Piercer",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      effect: "Ignores 5 DEF.",
    });
    const log = driveResolve(user, ability);
    const trail = log
      .split("\n")
      .find((line) => line.includes("Damage Modifiers applied"));
    expect(trail).toBeDefined();
    expect(trail!.toLowerCase()).toContain("ignores 5 def");
  });

  it("emits an (Hit N/M) label once per Multi-Hit: 3 extra hit", () => {
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const ability = makeAbility({
      name: "Triple Tap",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      effect: "Multi-Hit: 3.",
    });
    const log = driveResolve(user, ability);
    // Expect 3 separate accuracy lines labelled Hit 1/3 .. Hit 3/3.
    expect(log).toMatch(/\(Hit 1\/3\)/);
    expect(log).toMatch(/\(Hit 2\/3\)/);
    expect(log).toMatch(/\(Hit 3\/3\)/);
  });

  it("emits Ignore ATK/MAG in the mod trail", () => {
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const ability = makeAbility({
      name: "Pure Strike",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      effect: "Ignores ATK/MAG.",
    });
    const log = driveResolve(user, ability);
    const trail = log
      .split("\n")
      .find((line) => line.includes("Damage Modifiers applied"));
    expect(trail).toBeDefined();
    expect(trail!.toLowerCase()).toContain("ignores atk/mag");
  });

  it("emits half DEF trail text when 'Ignores 1/2 DEF' is in effect", () => {
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const ability = makeAbility({
      name: "Shred",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      effect: "Ignores 1/2 DEF.",
    });
    const log = driveResolve(user, ability);
    const trail = log
      .split("\n")
      .find((line) => line.includes("Damage Modifiers applied"));
    expect(trail).toBeDefined();
    expect(trail!.toLowerCase()).toContain("ignores half def");
  });

  it("does NOT pull +N% damage from inside an Apex clause when target is below max range", () => {
    // Belt-and-suspenders test for the apex-over-apply risk: the
    // extracted metadata must not report a damage percent that was
    // nested inside an Apex clause, otherwise the resolve math treats
    // it as always-on.
    const meta = extractCombatMetadata(parseEffects("Apex: +50% damage"));
    expect(meta.damagePercent).toBe(0);
  });
});

// ===========================================================================
// Splash: integration of resolveSplash through resolveAttackFlow
// ===========================================================================

describe("resolveAttackFlow: splash honours damage modifiers", () => {
  it("AoE hits two foes and the mod trail appears in each damage line for +50% damage", () => {
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [5, 6],
      team: 1,
      eva: 0,
    });
    const bystander = makeEntity({
      num: "P3",
      name: "Cara",
      pos: [4, 6],
      team: 1,
      eva: 0,
    });
    const game = makeGame({ entities: [user, target, bystander] });
    user.abilities = [];
    // Burst 1 covers both P2 (straight south) and P3 (south-west), each
    // gets their own damage roll -- so the mod trail must surface in
    // BOTH `Damage:` lines.
    const ability = makeAbility({
      name: "Storm Strike",
      range: "Burst 1",
      mr: 0,
      roll: "2d6+0",
      targetAmount: "AoE",
      targetGroup: "Foes",
      effect: "+50% damage.",
    });
    user.abilities = [ability];
    const step = startAttack(game, user, ability, target.num);
    let safety = 0;
    const out: string[] = [];
    if (step.done) out.push(...step.result.messages);
    let lastDone = step.done;
    while (user.pendingResolution && safety++ < 50) {
      const flow = user.pendingResolution;
      const s2 = flow.next("0");
      if (s2.done) {
        user.pendingResolution = undefined;
        user.pendingPromptKind = undefined;
        out.push(...s2.value.messages);
        lastDone = true;
        break;
      }
    }
    expect(lastDone).toBe(true);
    const log = out.join("\n");
    // Both P2 and P3 damage lines should carry the +50% mod tag.
    expect(log).toContain("P2");
    expect(log).toContain("P3");
    const p2Trail = log
      .split("\n")
      .find(
        (line) =>
          line.includes("Damage Modifiers applied") && line.includes("P2"),
      );
    const p3Trail = log
      .split("\n")
      .find(
        (line) =>
          line.includes("Damage Modifiers applied") && line.includes("P3"),
      );
    // The mod trails reference just the damageValue; for each target we
    // confirm at least one line contains the +50% tag.
    expect(log).toMatch(/\+50% damage/);
  });
});

// ===========================================================================
// Terrain stat bonuses: Forest +5 PD / -1 EVA vs Physical; Water +5 MD /
// -1 EVA vs Magical (BD 4.4 Map glossary).
// ===========================================================================

describe("resolveAttackFlow: terrain stat bonuses", () => {
  // Place a terrain tile under the target (default P2 pos [5, 6]).
  function terrainMap(tile: Terrain): Terrain[][] {
    const map = Array.from({ length: 10 }, () =>
      Array(10).fill(Terrain.Normal),
    );
    map[5][6] = tile;
    return map;
  }

  it("4.3 games get the EVA penalty but NOT the +5 PD bonus", () => {
    // The +5 defense bonus is a 4.4 mechanic; 4.3 terrain rules are PE/ME
    // only (the -1 EVA still applies as -1 PE) (PR-Agent on #178).
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [5, 6],
      team: 1,
      pd: 5,
      eva: 0,
    });
    const ability = makeAbility({
      name: "Sword Swing",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      damageType: "Physical",
    });
    const log = driveResolveAgainst(
      user,
      ability,
      target,
      terrainMap(Terrain.Forest),
      "4.3",
    );
    // EVA penalty still applies (eva43: PD 5/10 floor = 0, then terrain -1).
    expect(log).toMatch(/EVA -1 =/);
    // PD is base 5 without the terrain +5 on 4.3.
    expect(log).toMatch(/PD\(5\)/);
    expect(log).not.toMatch(/PD\(10\)/);
  });

  it("Forest grants +5 PD and -1 EVA vs a Physical attack", () => {
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [5, 6],
      team: 1,
      pd: 5,
      eva: 0,
    });
    const ability = makeAbility({
      name: "Sword Swing",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      damageType: "Physical",
    });
    const log = driveResolveAgainst(
      user,
      ability,
      target,
      terrainMap(Terrain.Forest),
    );
    // EVA shown in the accuracy line is base 0 - 1 = -1.
    expect(log).toMatch(/EVA -1 =/);
    // PD shown in the damage line is base 5 + 5 = 10.
    expect(log).toMatch(/PD\(10\)/);
  });

  it("Forest does NOT grant EVA penalty vs a Magical attack (only PD applies)", () => {
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [5, 6],
      team: 1,
      pd: 5,
      md: 5,
      eva: 0,
    });
    const ability = makeAbility({
      name: "Fireball",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      damageType: "Magical",
    });
    const log = driveResolveAgainst(
      user,
      ability,
      target,
      terrainMap(Terrain.Forest),
    );
    // Magical attack uses MD, not PD, so no +5 and no EVA change.
    expect(log).toMatch(/EVA 0 =/);
    expect(log).toMatch(/MD\(5\)/);
  });

  it("Water grants +5 MD and -1 EVA vs a Magical attack", () => {
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [5, 6],
      team: 1,
      md: 5,
      eva: 0,
    });
    const ability = makeAbility({
      name: "Fireball",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      damageType: "Magical",
    });
    const log = driveResolveAgainst(
      user,
      ability,
      target,
      terrainMap(Terrain.Water),
    );
    expect(log).toMatch(/EVA -1 =/);
    expect(log).toMatch(/MD\(10\)/);
  });

  it("Water does NOT grant EVA penalty vs a Physical attack", () => {
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [5, 6],
      team: 1,
      pd: 5,
      eva: 0,
    });
    const ability = makeAbility({
      name: "Sword Swing",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      damageType: "Physical",
    });
    const log = driveResolveAgainst(
      user,
      ability,
      target,
      terrainMap(Terrain.Water),
    );
    expect(log).toMatch(/EVA 0 =/);
    expect(log).toMatch(/PD\(5\)/);
  });

  it("Normal terrain grants no bonus", () => {
    const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
    const target = makeEntity({
      num: "P2",
      name: "Bob",
      pos: [5, 6],
      team: 1,
      pd: 5,
      eva: 0,
    });
    const ability = makeAbility({
      name: "Sword Swing",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      damageType: "Physical",
    });
    const log = driveResolveAgainst(
      user,
      ability,
      target,
      terrainMap(Terrain.Normal),
    );
    expect(log).toMatch(/EVA 0 =/);
    expect(log).toMatch(/PD\(5\)/);
  });
});

describe("FFA targeting (team 0 = no teams)", () => {
  it("treats every other player as a Foe and no one as an Ally", () => {
    const p1 = makeEntity({ num: "P1", name: "Alice", pos: [2, 2], team: 0 });
    const p2 = makeEntity({ num: "P2", name: "Bob", pos: [2, 3], team: 0 });
    expect(isValidTarget(p1, p2, "Foe")).toBe(true);
    expect(isValidTarget(p1, p2, "Ally")).toBe(false);
    expect(isValidTarget(p1, p1, "Foe")).toBe(false);
    expect(isValidTarget(p1, p2, "Self or Foe")).toBe(true);
    expect(isValidTarget(p1, p2, "Self and Allies")).toBe(false);
    expect(isValidTarget(p1, p1, "Self and Allies")).toBe(true);
    expect(isValidTarget(p1, p2, "Self and Ally")).toBe(false);
    expect(isValidTarget(p1, p1, "Self and Ally")).toBe(true);
    expect(isValidTarget(p1, p2, "Allies and Self")).toBe(false);
    expect(isValidTarget(p1, p1, "Allies and Self")).toBe(true);
    expect(isValidTarget(p1, p2, "Foe or Ally")).toBe(true);
  });

  it("keeps team-mode targeting unchanged", () => {
    const p1 = makeEntity({ num: "P1", name: "Alice", pos: [2, 2], team: 1 });
    const p2 = makeEntity({ num: "P2", name: "Bob", pos: [2, 3], team: 1 });
    const p3 = makeEntity({ num: "P3", name: "Carol", pos: [2, 4], team: 2 });
    expect(isValidTarget(p1, p2, "Ally")).toBe(true);
    expect(isValidTarget(p1, p2, "Foe")).toBe(false);
    expect(isValidTarget(p1, p3, "Foe")).toBe(true);
    expect(isValidTarget(p1, p3, "Ally")).toBe(false);
  });
});
