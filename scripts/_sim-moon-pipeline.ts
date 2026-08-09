// E2E battle sim: moon phases + attack pipeline together (PR #169 verification).
// Drives real attacks through startAttack/resolveAttackFlow and prints the logs.
import { setWs } from "../src/utils.js";
import {
  type Game,
  type Entity,
  type AbilityData,
  Terrain,
} from "../src/game/state.js";
import { startAttack } from "../src/game/resolve.js";

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

function makeGame(opts: { entities?: Entity[]; size?: number } = {}): Game {
  const size = opts.size ?? 10;
  const map = Array.from({ length: size }, () =>
    Array(size).fill(Terrain.Normal),
  );
  const entities = opts.entities ?? [
    makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 }),
    makeEntity({ num: "P2", name: "Bob", pos: [5, 6], team: 1 }),
  ];
  return {
    id: "sim",
    room: "battledome",
    host: "Host",
    entities,
    map,
    mapName: "sim",
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
    mr: 0,
    roll: "1d1+0",
    damageType: "Physical",
    actionType: "Standard",
    targetAmount: 1,
    targetGroup: "Foe",
    range: "Melee",
    effect: "",
    ...overrides,
  };
}

/** Drive startAttack to completion (answers any prompt with "0"). */
function drive(game: Game, user: Entity, ability: AbilityData, targetNum: string): string {
  const step = startAttack(game, user, ability, targetNum);
  const out: string[] = [];
  if (step.done) out.push(...step.result.messages);
  let lastDone = step.done;
  let safety = 0;
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
  if (!lastDone) out.push("!! SIM: generator did not complete !!");
  return out.join("\n");
}

function banner(title: string) {
  console.log("\n" + "=".repeat(70));
  console.log(title);
  console.log("=".repeat(70));
}

// ---------------------------------------------------------------------------
// Scenario 1: New Moon range bonus + passive + ability phase branch + crit
// ---------------------------------------------------------------------------
banner("Scenario 1: New Moon — Lunar Phase passive (+1 Range), ability 'New Moon: +1 dice', Crit on 18+");
{
  const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
  const target = makeEntity({
    num: "P2", name: "Bob", pos: [5, 7], team: 1, eva: 0,
  });
  const game = makeGame({ entities: [user, target] });
  game.moonPhase = "new moon";
  user.abilities = [
    makeAbility({
      name: "Lunar Phase",
      actionType: "Passive",
      effect: "New Moon: +1 Range.",
    }),
    makeAbility({
      name: "Moonlight Slash",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      effect: "New Moon: +1 dice. Crit on 18+.",
    }),
  ];
  const log = drive(game, user, user.abilities[1], target.num);
  console.log(log);
}

// ---------------------------------------------------------------------------
// Scenario 2: phaseChoice — ability folds BOTH phase branches (Fatal Moonlight)
// ---------------------------------------------------------------------------
banner("Scenario 2: phaseChoice=waning while active=new moon — ability 'New Moon: +1 dice. Waning: +2 dice faces.'");
{
  const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
  const target = makeEntity({
    num: "P2", name: "Bob", pos: [5, 6], team: 1, eva: 0,
  });
  const game = makeGame({ entities: [user, target] });
  game.moonPhase = "new moon";
  user.phaseChoice = "waning";
  user.abilities = [
    makeAbility({
      name: "Fatal Moonlight",
      range: "Melee",
      mr: 0,
      roll: "1d6+0",
      effect: "New Moon: +1 dice. Waning: +2 dice faces.",
    }),
  ];
  const log = drive(game, user, user.abilities[0], target.num);
  console.log(log);
}

// ---------------------------------------------------------------------------
// Scenario 3: defender Full Moon dice penalty + subweapon branch + Requires
// ---------------------------------------------------------------------------
banner("Scenario 3: Full Moon defender penalty + Gladius branch + 'Requires Pilum' gate");
{
  const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
  const target = makeEntity({
    num: "P2", name: "Bob", pos: [5, 6], team: 1, eva: 0,
  });
  target.abilities = [
    makeAbility({
      name: "Lunar Ward",
      actionType: "Passive",
      effect: "Full Moon: -1 dice on attacks targeting user.",
    }),
  ];
  const game = makeGame({ entities: [user, target] });
  game.moonPhase = "full moon";

  // 3a: subweapon branch matches (gladius equipped)
  user.subweapon = "gladius";
  user.abilities = [
    makeAbility({
      name: "Gladius Flurry",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      effect: "Gladius: +2 dice.",
    }),
  ];
  const logA = drive(game, user, user.abilities[0], target.num);
  console.log("--- 3a) Gladius equipped (branch fires, defender -1 dice) ---");
  console.log(logA);

  // 3b: Requires Pilum gate rejects a Gladius user
  user.subweapon = "gladius";
  user.abilities = [
    makeAbility({
      name: "Pilum Locked",
      range: "Melee",
      mr: 0,
      roll: "2d6+0",
      effect: "Requires Pilum. +1 base dice.",
    }),
  ];
  const logB = drive(game, user, user.abilities[0], target.num);
  console.log("--- 3b) Requires Pilum while Gladius equipped (should be blocked) ---");
  console.log(logB);
}

// ---------------------------------------------------------------------------
// Scenario 4: attack pipeline phases — Multi-Hit + splash + kill
// ---------------------------------------------------------------------------
banner("Scenario 4: Multi-Hit 3 + Splash with +50% damage, low-HP target for a kill");
{
  const user = makeEntity({ num: "P1", name: "Alice", pos: [5, 5], team: 0 });
  const target = makeEntity({
    num: "P2", name: "Bob", pos: [5, 6], team: 1, eva: 0, curhp: 10, maxhp: 10,
  });
  const bystander = makeEntity({
    num: "P3", name: "Cara", pos: [4, 6], team: 1, eva: 0,
  });
  const game = makeGame({ entities: [user, target, bystander] });
  game.moonPhase = "waning";
  const ability = makeAbility({
    name: "Storm Flurry",
    range: "Burst 1",
    mr: 0,
    roll: "2d6+0",
    targetAmount: "AoE",
    targetGroup: "Foes",
    effect: "Multi-Hit: 3. +50% damage.",
  });
  user.abilities = [ability];
  const log = drive(game, user, ability, target.num);
  console.log(log);
}

console.log("\nSIM COMPLETE");
