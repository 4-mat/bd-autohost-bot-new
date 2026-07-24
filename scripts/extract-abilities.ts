import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGameData, classes, weapons } from "../src/data/index.js";
import type { AbilityData } from "../src/data/index.js";

loadGameData();

interface AbilityEntry extends AbilityData {
  source: string;
  sourceType: "class" | "weapon";
  branch?: string;
}

// Collect all abilities
const all: AbilityEntry[] = [];

for (const [id, cls] of classes) {
  for (const a of cls.abilities) {
    all.push({ ...a, source: cls.name, sourceType: "class" });
  }
}
for (const [id, wpn] of weapons) {
  for (const a of wpn.abilities) {
    all.push({
      ...a,
      source: wpn.name,
      sourceType: "weapon",
      branch: wpn.branch,
    });
  }
}

// Mechanical groupings
const byDamageType: Record<string, AbilityEntry[]> = {};
const byActionType: Record<string, AbilityEntry[]> = {};
const byRangeType: Record<string, AbilityEntry[]> = {};
const byFrequency: Record<string, AbilityEntry[]> = {};
const byTargetGroup: Record<string, AbilityEntry[]> = {};
const byTargetAmount: Record<string, AbilityEntry[]> = {};

function group(
  arr: Record<string, AbilityEntry[]>,
  key: string,
  entry: AbilityEntry,
) {
  if (!arr[key]) arr[key] = [];
  arr[key].push(entry);
}

for (const a of all) {
  // Damage type
  const dmg = a.damageType || "None";
  group(byDamageType, dmg, a);

  // Action type
  const act = a.actionType || "None";
  group(byActionType, act, a);

  // Range type (extract prefix)
  const rangeStr = a.range.toLowerCase().trim();
  let rangeType = "None/Empty";
  if (rangeStr.includes("melee")) rangeType = "Melee";
  else if (rangeStr.includes("burst")) rangeType = "Burst";
  else if (rangeStr.includes("star")) rangeType = "Star";
  else if (rangeStr.includes("cone")) rangeType = "Cone";
  else if (rangeStr.includes("beam")) rangeType = "Beam";
  else if (rangeStr.includes("pierce")) rangeType = "Pierce";
  else if (rangeStr.includes("line")) rangeType = "Line";
  else if (rangeStr.includes("homing")) rangeType = "Homing";
  else if (rangeStr.includes("range")) rangeType = "Range";
  else if (rangeStr.includes("global")) rangeType = "Global";
  else if (rangeStr.includes("varies")) rangeType = "Varies";
  group(byRangeType, rangeType, a);

  // Frequency
  group(byFrequency, a.frequency || "None", a);

  // Target group (normalize)
  const tg = a.targetGroup.toLowerCase().trim();
  let targetGroup = tg || "None";
  if (tg.includes("self and allies")) targetGroup = "Self and Allies";
  else if (tg.includes("self or ally")) targetGroup = "Self or Ally";
  else if (tg.includes("self or foe")) targetGroup = "Self or Foe";
  else if (tg.includes("foe or ally")) targetGroup = "Foe or Ally";
  else if (tg.includes("self, foes")) targetGroup = "Self, Foes, Allies";
  else if (tg === "self") targetGroup = "Self";
  else if (tg === "ally") targetGroup = "Ally";
  else if (tg === "foe") targetGroup = "Foe";
  else if (tg === "any") targetGroup = "Any";
  else if (tg === "tile") targetGroup = "Tile";
  group(byTargetGroup, targetGroup, a);

  // Target amount
  const ta = String(a.targetAmount);
  group(byTargetAmount, ta, a);
}

// Mechanically interesting: group by "complexity"
// Simple: just damage
// Status: applies statuses
// Heal: heals
// Buff/Debuff: modifies stats
// Movement: moves entities
// Complex: has special keywords
const byMechanic: Record<string, AbilityEntry[]> = {};

function hasStatus(effect: string): boolean {
  return (
    /\d+\s*(bleed|poison|curse)\s*\/\s*\d+/.test(effect) ||
    /(burn|root|seal|stun|confusion|cripple|slow)\s*\/\s*\d+/.test(effect)
  );
}

function hasBuff(effect: string): boolean {
  return /\+\d+\s+(atk|mag|pd|md|eva|mp|def|acc|cr)\s*\/\s*\d+/.test(effect);
}

function hasDebuff(effect: string): boolean {
  return /-\d+\s+(atk|mag|pd|md|eva|mp|def|acc|cr)\s*\/\s*\d+/.test(effect);
}

function hasHeal(effect: string): boolean {
  return /heal\s+\d+/.test(effect) || /heals?\s+\d+/.test(effect);
}

function hasPushPull(effect: string): boolean {
  return /push\s*\d+/.test(effect) || /pull\s*\d+/.test(effect);
}

function hasMultiHit(roll: string): boolean {
  return /double hit|triple hit|quad/.test(roll.toLowerCase());
}

function hasBomb(effect: string): boolean {
  return /bomb\s*dice/i.test(effect);
}

function hasSplash(range: string): boolean {
  return /splash\s*\d+/.test(range.toLowerCase());
}

for (const a of all) {
  const e = a.effect.toLowerCase();
  const tags: string[] = [];

  if (a.damageType === "Physical" || a.damageType === "Magical")
    tags.push("Damage");
  if (a.damageType === "") {
    if (hasHeal(e)) tags.push("Heal");
    if (hasBuff(e)) tags.push("Buff");
    if (hasDebuff(e)) tags.push("Debuff");
    if (hasStatus(e)) tags.push("Status");
    if (hasPushPull(e)) tags.push("Push/Pull");
  } else {
    // Damaging abilities can also have these
    if (hasStatus(e)) tags.push("+Status");
    if (hasDebuff(e)) tags.push("+Debuff");
    if (hasBuff(e)) tags.push("+Buff");
    if (hasPushPull(e)) tags.push("+Push/Pull");
    if (hasMultiHit(a.roll)) tags.push("MultiHit");
    if (hasBomb(e)) tags.push("Bomb");
    if (hasSplash(a.range)) tags.push("Splash");
  }

  if (tags.length === 0) tags.push("Other/Special");

  for (const tag of tags) {
    group(byMechanic, tag, a);
  }
}

// Build output
const output = {
  meta: {
    totalAbilities: all.length,
    totalClasses: classes.size,
    totalWeapons: weapons.size,
    extractedAt: new Date().toISOString(),
  },
  all,
  groupings: {
    byDamageType,
    byActionType,
    byRangeType,
    byFrequency,
    byTargetGroup,
    byTargetAmount,
    byMechanic,
  },
};

const json = JSON.stringify(output, null, 2);
const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "data");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "abilities.json");
writeFileSync(outPath, json, "utf-8");

console.log(`Extracted ${all.length} abilities to data/abilities.json`);
console.log(`\nGroupings:`);
console.log(
  `  byDamageType: ${Object.keys(byDamageType)
    .map((k) => `${k}(${byDamageType[k].length})`)
    .join(", ")}`,
);
console.log(
  `  byActionType: ${Object.keys(byActionType)
    .map((k) => `${k}(${byActionType[k].length})`)
    .join(", ")}`,
);
console.log(
  `  byRangeType: ${Object.keys(byRangeType)
    .map((k) => `${k}(${byRangeType[k].length})`)
    .join(", ")}`,
);
console.log(
  `  byFrequency: ${Object.keys(byFrequency)
    .map((k) => `${k}(${byFrequency[k].length})`)
    .join(", ")}`,
);
console.log(
  `  byTargetGroup: ${Object.keys(byTargetGroup)
    .map((k) => `${k}(${byTargetGroup[k].length})`)
    .join(", ")}`,
);
console.log(
  `  byTargetAmount: ${Object.keys(byTargetAmount)
    .map((k) => `${k}(${byTargetAmount[k].length})`)
    .join(", ")}`,
);
console.log(
  `  byMechanic: ${Object.keys(byMechanic)
    .map((k) => `${k}(${byMechanic[k].length})`)
    .join(", ")}`,
);

process.exit(0);
