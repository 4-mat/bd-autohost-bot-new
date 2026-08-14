import { describe, it, expect, beforeEach } from "bun:test";
import {
  games,
  type Game,
  type Entity,
  type AbilityData,
  Terrain,
} from "../game/state.js";
import { startAttack, respondToDir, respondToChoice } from "../game/resolve.js";
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

function makeGame(opts: { entities?: Entity[] } = {}): Game {
  const size = 10;
  const map = Array.from({ length: size }, () =>
    Array(size).fill(Terrain.Normal),
  );
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
    mr: 10,
    roll: "2d6+3",
    damageType: "Physical",
    actionType: "Standard",
    targetAmount: 1,
    targetGroup: "Foes",
    range: "Melee",
    effect: "",
    ...overrides,
  };
}

describe("directional AoE prompts", () => {
  beforeEach(() => games.clear());

  it("lists only directions with targets, labelled with the target names", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [5, 5],
      team: 0,
    });
    const bob = makeEntity({ num: "P2", name: "Bob", pos: [5, 6], team: 1 });
    const charlie = makeEntity({
      num: "P3",
      name: "Charlie",
      pos: [4, 5],
      team: 1,
    });
    const game = makeGame({ entities: [caster, bob, charlie] });

    const step = startAttack(
      game,
      caster,
      makeAbility({
        name: "Sweep",
        range: "Cone 1",
      }),
    );

    expect(step.done).toBe(false);
    if (step.done) throw new Error("expected a prompt");
    expect(step.prompt.kind).toBe("direction");
    if (step.prompt.kind !== "direction") throw new Error("expected direction");
    expect(step.prompt.candidates).toEqual(["up", "right"]);
    expect(step.prompt.candidateTargets).toEqual(["Charlie", "Bob"]);
    expect(caster.pendingPromptKind).toBe("direction");
  });

  it("skips directions with no valid targets", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [5, 5],
      team: 0,
    });
    const bob = makeEntity({ num: "P2", name: "Bob", pos: [5, 6], team: 1 });
    const game = makeGame({ entities: [caster, bob] });

    const step = startAttack(
      game,
      caster,
      makeAbility({
        name: "Sweep",
        range: "Cone 1",
      }),
    );

    expect(step.done).toBe(false);
    if (step.done) throw new Error("expected a prompt");
    expect(step.prompt.kind).toBe("direction");
    if (step.prompt.kind !== "direction") throw new Error("expected direction");
    expect(step.prompt.candidates).toEqual(["right"]);
    expect(step.prompt.candidateTargets).toEqual(["Bob"]);
  });

  it("respondToDir resolves the AoE against the chosen direction's targets", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [5, 5],
      team: 0,
    });
    const bob = makeEntity({ num: "P2", name: "Bob", pos: [5, 6], team: 1 });
    const charlie = makeEntity({
      num: "P3",
      name: "Charlie",
      pos: [4, 5],
      team: 1,
    });
    const game = makeGame({ entities: [caster, bob, charlie] });

    const step = startAttack(
      game,
      caster,
      makeAbility({
        name: "Sweep",
        range: "Cone 1",
        mr: 0,
      }),
    );
    expect(step.done).toBe(false);

    const next = respondToDir(caster, "up");
    expect(next.done).toBe(true);
    if (!next.done) throw new Error("expected resolution");
    expect(charlie.curhp).toBeLessThan(100);
    expect(bob.curhp).toBe(100);
    expect(caster.pendingPrompt).toBeUndefined();
    expect(caster.pendingPromptKind).toBeUndefined();
  });

  it("line/pierce direction prompts include diagonal candidates with targets", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [5, 5],
      team: 0,
    });
    const bob = makeEntity({ num: "P2", name: "Bob", pos: [4, 6], team: 1 });
    const game = makeGame({ entities: [caster, bob] });

    const step = startAttack(
      game,
      caster,
      makeAbility({
        name: "Impale",
        range: "Pierce 4",
      }),
    );

    expect(step.done).toBe(false);
    if (step.done) throw new Error("expected a prompt");
    expect(step.prompt.kind).toBe("direction");
    if (step.prompt.kind !== "direction") throw new Error("expected direction");
    expect(step.prompt.candidates).toContain("up-right");
    expect(step.prompt.candidateTargets).toContain("Bob");
  });

  it("offers undo when no direction has valid targets", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [5, 5],
      team: 0,
    });
    const bob = makeEntity({ num: "P2", name: "Bob", pos: [9, 9], team: 1 });
    const game = makeGame({ entities: [caster, bob] });

    const step = startAttack(
      game,
      caster,
      makeAbility({
        name: "Sweep",
        range: "Cone 1",
      }),
    );

    expect(step.done).toBe(false);
    if (step.done) throw new Error("expected a prompt");
    expect(step.prompt.kind).toBe("selection");
    if (step.prompt.kind !== "selection") throw new Error("expected selection");
    expect(step.prompt.options).toEqual([
      { id: "undo", label: "↶ Undo — choose a different action" },
    ]);

    const next = respondToChoice(caster, "undo");
    expect(next.done).toBe(true);
    if (!next.done) throw new Error("expected resolution");
    expect(next.result.messages.join(" ")).toContain("cancels");
    expect(caster.pendingPrompt).toBeUndefined();
    expect(caster.pendingPromptKind).toBeUndefined();
  });
});
