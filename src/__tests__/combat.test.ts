import {
  startAttack,
  isValidTarget,
  respondToTile,
  respondToChoice,
} from "../game/resolve.js";
import {
  Terrain,
} from "../game/state.js";
import { parseEffects, extractCombatMetadata } from "../game/effects.js";
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

describe("tile-targeting abilities", () => {
  it("prompts for a tile and places the terrain on the chosen tile (Whittle)", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const whittle = makeAbility({
      name: "Whittle",
      damageType: "",
      roll: "",
      targetGroup: "Tile",
      range: "Homing 2",
      effect: "create Totem tile on target (removes existing).",
    });
    caster.abilities = [whittle];
    const game = makeGame({ entities: [caster] });
    // Prove placement: the tile starts as Lava and Whittle clears it.
    game.map[2][3] = Terrain.Lava;

    const step = startAttack(game, caster, whittle);
    expect(step.done).toBe(false);
    if (step.done) return;
    expect(step.prompt.kind).toBe("tile");

    // "c,4" is posToStr(2, 3) -- a valid candidate within Homing 2.
    const step2 = respondToTile(caster, "c,4");
    expect(step2.done).toBe(true);
    if (!step2.done) return;
    expect(game.map[2][3]).toBe(Terrain.Normal);
    expect(step2.result.messages.join("\n")).toContain(
      "creates a Normal tile at c,4",
    );
  })

  // Test all obstruction types (Stop, Bone, Ice, Stone, Hearth)
  const obstructionTypes = [
    { terrain: Terrain.Stop, name: 'Stop' },
    { terrain: Terrain.Bone, name: 'Bone' },
    { terrain: Terrain.Ice, name: 'Ice' },
    { terrain: Terrain.Stone, name: 'Stone' },
    { terrain: Terrain.Hearth, name: 'Hearth' },
  ];

  for (const obs of obstructionTypes) {
    it(`requires confirmation to replace a ${obs.name} obstruction`, () => {
      const caster = makeEntity({ num: 'P1', name: 'Alice', pos: [2, 2], team: 0 });
      const whittle = makeAbility({
        name: 'Whittle', damageType: '', roll: '', targetGroup: 'Tile', range: 'Homing 2',
        effect: 'create Totem tile on target (removes existing).',
      });
      caster.abilities = [whittle];
      const game = makeGame({ entities: [caster] });
      game.map[2][3] = obs.terrain;

      const step = startAttack(game, caster, whittle);
      if (step.done) throw new Error('expected prompt');
      if (step.prompt.kind !== 'tile') throw new Error('expected tile prompt');
      const step2 = respondToTile(caster, 'c,4');
      if (step2.done) throw new Error('expected confirmation');
      if (step2.prompt.kind !== 'selection') throw new Error('expected selection');
      if (!step2.prompt.confirmObstruction) throw new Error('expected confirmObstruction');
    });
  }


  it("offers obstruction tiles but requires confirmation to replace them", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const whittle = makeAbility({
      name: "Whittle",
      damageType: "",
      roll: "",
      targetGroup: "Tile",
      range: "Homing 2",
      effect: "create Totem tile on target (removes existing).",
    });
    caster.abilities = [whittle];
    const game = makeGame({ entities: [caster] });
    // Stone at (2,3) is an obstruction within Homing 2: it IS offered, but
    // choosing it asks for confirmation first. Lava at (2,4) is a hazard,
    // not an obstruction: it stays replaceable without confirmation.
    game.map[2][3] = Terrain.Stone;
    game.map[2][4] = Terrain.Lava;

    const step = startAttack(game, caster, whittle);
    expect(step.done).toBe(false);
    if (step.done) return;
    expect(step.prompt.kind).toBe("tile");
    if (step.prompt.kind !== "tile") return;
    expect(step.prompt.candidates).toContain("c,4");
    expect(step.prompt.candidates).toContain("c,5");

    // Picking the Stone tile yields a confirmation prompt.
    const step2 = respondToTile(caster, "c,4");
    expect(step2.done).toBe(false);
    if (step2.done) return;
    expect(step2.prompt.kind).toBe("selection");
    if (step2.prompt.kind !== "selection") return;
    expect(step2.prompt.message).toContain("St
