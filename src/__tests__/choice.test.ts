import { describe, it, expect, beforeEach } from "bun:test";
import { gameCommand } from "../commands/game.js";
import {
  games,
  type Game,
  type Entity,
  type AbilityData,
  Terrain,
} from "../game/state.js";
import { startAttack, respondToChoice } from "../game/resolve.js";
import { buildPlayerPage } from "../html/pages.js";
import { setWs } from "../utils.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";

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

const room: Room = { id: "battledome", type: "battle", users: [] };
const alice: User = { id: "alice", name: "Alice", rooms: {}, last: 0 };

describe("choice prompts", () => {
  beforeEach(() => games.clear());

  it("startAttack stores the full selection prompt on the entity", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({ num: "P2", name: "Bob", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Rising Hope",
      choices: [
        { id: "atk_mag", label: "+3 ATK/MAG" },
        { id: "def", label: "+4 DEF" },
      ],
    });

    const step = startAttack(game, caster, ability);

    expect(step.done).toBe(false);
    if (step.done) throw new Error("expected a prompt");
    const prompt = step.prompt;
    expect(prompt.kind).toBe("selection");
    if (prompt.kind !== "selection") throw new Error("expected selection");
    expect(prompt.options).toEqual([
      { id: "atk_mag", label: "+3 ATK/MAG" },
      { id: "def", label: "+4 DEF" },
    ]);
    expect(caster.pendingPromptKind).toBe("selection");
    expect(caster.pendingPrompt).toEqual(prompt);
  });

  it("respondToChoice resumes and resolves the attack", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({ num: "P2", name: "Bob", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Rising Hope",
      mr: 0,
      roll: "1d1+0",
      choices: [{ id: "atk_mag", label: "+3 ATK/MAG" }],
    });

    startAttack(game, caster, ability, "P2");
    const step = respondToChoice(caster, "atk_mag");

    expect(step.done).toBe(true);
    if (!step.done) throw new Error("expected resolution");
    expect(target.curhp).toBeLessThan(100);
    expect(caster.pendingPrompt).toBeUndefined();
    expect(caster.pendingPromptKind).toBeUndefined();
  });

  it("prompted cost deducts the resource via pay_cost", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
      resources: { Qi: 3 },
    });
    const target = makeEntity({ num: "P2", name: "Bob", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    const ability = makeAbility({
      name: "Staccato",
      mr: 0,
      roll: "1d1+0",
      cost: { type: "Resource", resource: "Qi", amount: 2, prompt: true },
    });

    startAttack(game, caster, ability, "P2");
    const step = respondToChoice(caster, "pay_cost");

    expect(step.done).toBe(true);
    if (!step.done) throw new Error("expected resolution");
    expect(caster.resources.Qi).toBe(1);
    expect(target.curhp).toBeLessThan(100);
  });
});

describe("choice prompt GUI", () => {
  beforeEach(() => games.clear());

  it("buildPlayerPage renders %choose buttons for a selection prompt", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({ num: "P2", name: "Bob", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    caster.pendingPrompt = {
      kind: "selection",
      message: "Choose an option for Rising Hope",
      options: [
        { id: "atk_mag", label: "+3 ATK/MAG" },
        { id: "def", label: "+4 DEF" },
      ],
    };

    const html = buildPlayerPage(game, caster);

    expect(html).toContain('value="%choose atk_mag"');
    expect(html).toContain('value="%choose def"');
    expect(html).toContain("+3 ATK/MAG");
  });

  it("buildPlayerPage renders %target buttons for a target prompt", () => {
    const caster = makeEntity({
      num: "P1",
      name: "Alice",
      pos: [2, 2],
      team: 0,
    });
    const target = makeEntity({ num: "P2", name: "Bob", pos: [2, 3], team: 1 });
    const game = makeGame({ entities: [caster, target] });

    caster.pendingPrompt = {
      kind: "target",
      message: "Choose a target for Rising Hope",
      candidates: [target],
    };

    const html = buildPlayerPage(game, caster);

    expect(html).toContain('value="%target P2"');
  });
});

describe("choose command routing", () => {
  beforeEach(() => games.clear());

  it("confirm broadcasts a selection prompt, then %choose resolves the attack", () => {
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

    const ability = makeAbility({
      name: "Rising Hope",
      mr: 0,
      roll: "1d1+0",
      choices: [{ id: "atk_mag", label: "+3 ATK/MAG" }],
    });
    caster.pendingAction = { type: "attack", ability, target: "P2" };
    caster.standardUsed = true;

    gameCommand(room, alice, "confirm", "", "");
    const pp = caster.pendingPrompt;
    expect(pp?.kind).toBe("selection");
    if (pp?.kind === "selection") {
      expect(pp.options).toHaveLength(1);
    }

    gameCommand(room, alice, "choose", "atk_mag", "");

    expect(caster.pendingAction).toBeNull();
    expect(target.curhp).toBeLessThan(100);
  });
});
