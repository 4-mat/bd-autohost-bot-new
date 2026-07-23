import { writeFileSync } from "fs";
import {
  type Game,
  type Entity,
  type AbilityData,
  type Terrain,
  Terrain as T,
} from "./src/game/state.js";
import { buildHostPage, buildPlayerPage } from "./src/html/pages.js";

const map: Terrain[][] = [
  [
    T.Normal,
    T.Normal,
    T.Normal,
    T.Normal,
    T.Normal,
    T.Normal,
    T.Normal,
    T.Normal,
  ],
  [
    T.Normal,
    T.Forest,
    T.Forest,
    T.Normal,
    T.Normal,
    T.Water,
    T.Water,
    T.Normal,
  ],
  [
    T.Normal,
    T.Forest,
    T.Normal,
    T.Normal,
    T.Normal,
    T.Normal,
    T.Water,
    T.Normal,
  ],
  [
    T.Normal,
    T.Normal,
    T.Normal,
    T.Stop,
    T.Normal,
    T.Normal,
    T.Normal,
    T.Normal,
  ],
  [
    T.Normal,
    T.Normal,
    T.Normal,
    T.Normal,
    T.Boost,
    T.Normal,
    T.Normal,
    T.Normal,
  ],
  [
    T.Normal,
    T.Water,
    T.Normal,
    T.Normal,
    T.Normal,
    T.Normal,
    T.Normal,
    T.Normal,
  ],
  [T.Normal, T.Water, T.Water, T.Normal, T.Normal, T.Ice, T.Ice, T.Normal],
  [T.Normal, T.Normal, T.Normal, T.Normal, T.Normal, T.Ice, T.Normal, T.Normal],
];

const makeAbilities = (): AbilityData[] => [
  {
    name: "Arrow Flurry",
    level: 1,
    frequency: "Every Turn",
    mr: 3,
    roll: "2d8+7",
    damageType: "Physical",
    actionType: "Standard",
    targetAmount: 1,
    targetGroup: "Foe",
    range: "Range 6",
    effect:
      "If target has Mark: Splash 1. If target has 3+ Marks: Splash 2 instead.",
  },
  {
    name: "Hunter's Mark",
    level: 1,
    frequency: "Passive",
    mr: 0,
    roll: "",
    damageType: "",
    actionType: "Passive",
    targetAmount: 0,
    targetGroup: "",
    range: "",
    effect:
      "When Crossbow attack resolves: targets gain 1 Mark. Attacks deal +1d4 damage per Mark on target.",
  },
  {
    name: "First Aid",
    level: 1,
    frequency: "EoT",
    mr: 0,
    roll: "3d4+6",
    damageType: "",
    actionType: "Swift",
    targetAmount: 1,
    targetGroup: "Self or Ally",
    range: "Range 3",
    effect: "Heal target for rolled amount.",
  },
  {
    name: "Ward",
    level: 2,
    frequency: "E3T",
    mr: 0,
    roll: "",
    damageType: "",
    actionType: "Swift",
    targetAmount: "AoE",
    targetGroup: "Self and Allies",
    range: "Burst 2",
    effect: "Cannot be inflicted with debuffs or statuses/1.",
  },
  {
    name: "Bloodrush",
    level: 1,
    frequency: "Every Turn",
    mr: 2,
    roll: "2d8+4",
    damageType: "Magical",
    actionType: "Standard",
    targetAmount: 1,
    targetGroup: "Foe",
    range: "Range 4",
    effect: "If used from max range: gain +5 DMG/1 and +1 MP/1.",
  },
  {
    name: "Heaven's Wind",
    level: 3,
    frequency: "EoT",
    mr: 0,
    roll: "",
    damageType: "",
    actionType: "Swift",
    targetAmount: 2,
    targetGroup: "Any",
    range: "Range 4",
    effect: "Swap targets.",
  },
];

const player1: Entity = {
  num: "P1",
  name: "Taistelu",
  id: "taistelu",
  isMonster: false,
  curhp: 68,
  maxhp: 80,
  atk: 5,
  mag: 4,
  pd: 4,
  md: 5,
  eva: 2,
  mp: 5,
  pos: [3, 3],
  team: 1,
  className: "Bard",
  weaponName: "Crossbow",
  classLevel: 3,
  weaponLevel: 2,
  abilities: makeAbilities(),
  statuses: [
    { name: "Bleed", damage: 3, rounds: 1, maxRounds: 1, removable: true },
  ],
  buffs: [
    { stat: "ATK", amount: 3, rounds: 2 },
    { stat: "DEF", amount: -2, rounds: 1 },
  ],
  cooldowns: { Ward: 1 },
  usesUsed: {},
  pendingAction: null,
  dashUsed: false,
  standardUsed: false,
  movementUsed: false,
};

const player2: Entity = {
  num: "P2",
  name: "Ocean",
  id: "ocean",
  isMonster: false,
  curhp: 45,
  maxhp: 65,
  atk: 3,
  mag: 7,
  pd: 3,
  md: 6,
  eva: 1,
  mp: 6,
  pos: [2, 5],
  team: 2,
  className: "Cleric",
  weaponName: "Crossbow",
  classLevel: 4,
  weaponLevel: 1,
  abilities: makeAbilities(),
  statuses: [],
  buffs: [{ stat: "MAG", amount: 4, rounds: 1 }],
  cooldowns: {},
  usesUsed: {},
  pendingAction: null,
  dashUsed: false,
  standardUsed: true,
  movementUsed: true,
};

const monster1: Entity = {
  num: "M1",
  name: "Goblin",
  id: "goblin",
  isMonster: true,
  curhp: 30,
  maxhp: 30,
  atk: 4,
  mag: 2,
  pd: 2,
  md: 2,
  eva: 3,
  mp: 4,
  pos: [5, 2],
  team: 0,
  className: "Monster",
  weaponName: "Claws",
  classLevel: 1,
  weaponLevel: 1,
  abilities: [],
  statuses: [
    { name: "Slow", damage: 0, rounds: 2, maxRounds: 2, removable: false },
  ],
  buffs: [],
  cooldowns: {},
  usesUsed: {},
  pendingAction: null,
  dashUsed: false,
  standardUsed: false,
  movementUsed: false,
};

const game: Game = {
  id: "test-game-001",
  room: "battledome",
  host: "HostUser",
  entities: [player1, player2, monster1],
  map,
  mapName: "test-map",
  turnOrder: ["P1", "P2", "M1"],
  turnIndex: 0,
  round: 3,
  log: [
    { turn: 1, entity: "P1", description: "P1 moved to d,5", snapshot: "" },
    {
      turn: 1,
      entity: "P2",
      description: "P2 attacks P1 with Arrow Flurry",
      snapshot: "",
    },
    { turn: 2, entity: "M1", description: "M1 uses Claw attack", snapshot: "" },
    { turn: 2, entity: "P1", description: "P1 casts First Aid", snapshot: "" },
    { turn: 3, entity: "P2", description: "P2 uses Ward", snapshot: "" },
  ],
  snapshots: [],
  mode: "FFA",
  phase: "playing",
  started: true,
  kills: { P1: 1, P2: 0, M1: 0 },
  winner: null,
};

const hostHtml = buildHostPage(game);
const player1Html = buildPlayerPage(game, player1);
const player2Html = buildPlayerPage(game, player2);

const output = `================================================================================
HOST PAGE HTML (${hostHtml.length} chars)
================================================================================
${hostHtml}

================================================================================
PLAYER 1 PAGE (Taistelu - Bard/Crossbow - ${player1Html.length} chars)
================================================================================
${player1Html}

================================================================================
PLAYER 2 PAGE (Ocean - Cleric/Crossbow - ${player2Html.length} chars)
================================================================================
${player2Html}
`;

writeFileSync("html-output.txt", output, "utf-8");
console.log("HTML output written to html-output.txt");
console.log(`Host: ${hostHtml.length} chars`);
console.log(`P1 (Taistelu): ${player1Html.length} chars`);
console.log(`P2 (Ocean): ${player2Html.length} chars`);
