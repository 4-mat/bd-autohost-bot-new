import {
  type Game,
  type Entity,
  type AbilityData,
  type StatusEffect,
  Terrain,
  chebyshev,
  dealDamage,
  hasLineOfSight,
  inRange,
  manhattan,
  pushEntity,
  pullEntity,
} from "./state.js";
import { rollDice, toId } from "../utils.js";

// ---------------------------------------------------------------------------
// Effect types
// ---------------------------------------------------------------------------

export interface StatusInflict {
  type: "status";
  name: string;
  damage: number;
  rounds: number;
}

export interface StatMod {
  type: "buff" | "debuff";
  stat: string;
  amount: number;
  rounds?: number;
  percent?: number;
}

export interface Displacement {
  type: "push" | "pull" | "teleport" | "swap" | "move";
  amount?: number;
  toward?: "user" | "target";
  range?: string;
}

export interface ResourceChange {
  type: "resource";
  action: "gain" | "spend" | "lose";
  amount: number | string;
  resource: string;
}

export interface HealEffect {
  type: "heal";
  amount?: number;
  roll?: string;
  target: "self" | "ally" | "foe" | string;
}

export interface ShieldEffect {
  type: "shield";
  amount: number;
  rounds: number;
}

export interface DelayEffect {
  type: "delay";
  rounds: number;
}

export interface DamageMod {
  type: "damageMod";
  percent?: number;
  flat?: number;
  rounds?: number;
}

export interface RecoilEffect {
  type: "recoil";
  percent: number;
}

export interface IgnoreEffect {
  type: "ignore";
  what: string;
}

export interface ConditionalEffect {
  type: "conditional";
  condition: string;
  thenEffects: Effect[];
  elseEffects?: Effect[];
}

export interface ThirstEffect {
  type: "thirst";
  threshold: number;
  effects: Effect[];
}

export interface ApexEffect {
  type: "apex";
  effects: Effect[];
}

export interface ChooseEffect {
  type: "choose";
  options: Effect[][];
}

export interface ChannelEffect {
  type: "channel";
  stat: string;
  rounds: number;
}

export interface PhaseEffect {
  type: "phase";
  phase: string;
}

export interface DelayLandEffect {
  type: "delayLand";
}

export interface MultiHitMod {
  type: "multiHit";
  hits: number;
}

export interface UnknownEffect {
  type: "unknown";
  text: string;
}

export interface TileEffect {
  type: "tile";
  terrain: number;
  range: number;
}

export type Effect =
  | StatusInflict
  | StatMod
  | Displacement
  | ResourceChange
  | HealEffect
  | ShieldEffect
  | DelayEffect
  | DamageMod
  | RecoilEffect
  | IgnoreEffect
  | ConditionalEffect
  | ThirstEffect
  | ApexEffect
  | ChooseEffect
  | ChannelEffect
  | PhaseEffect
  | DelayLandEffect
  | MultiHitMod
  | TileEffect
  | UnknownEffect;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const STATUS_NAMES = [
  "bleed",
  "burn",
  "curse",
  "poison",
  "confusion",
  "cripple",
  "root",
  "seal",
  "slow",
  "stun",
  "shield",
];

const STAT_NAMES = [
  "atk",
  "mag",
  "pd",
  "md",
  "def",
  "eva",
  "mp",
  "acc",
  "cr",
  "dmg",
  "range",
  "mdef",
  "pdef",
  "damage",
];

const RESOURCE_NAMES = [
  "rage",
  "qi",
  "mana",
  "blood",
  "resolve",
  "focus",
  "campaign",
  "coin",
  "cp",
  "mark",
  "enrage",
];

/**
 * Maps a subset of resource name variants (singular / plural / case
 * differences) into the canonical RESOURCE_NAMES list. Returns `null`
 * for tokens that aren't a known resource, so callers can still treat
 * an unrecognised word as part of a higher-level pattern.
 */
function canonicalResource(name: string): string | null {
  const lower = name.toLowerCase();
  if (RESOURCE_NAMES.includes(lower)) return lower;
  if (RESOURCE_NAMES.includes(lower.replace(/s$/, "")))
    return lower.replace(/s$/, "");
  return null;
}

export function parseEffects(text: string): Effect[] {
  if (!text || !text.trim()) return [];

  const normalized = text
    .replace(/\n/g, " ")
    .replace(/\\\\n/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Conditional statements span multiple splitClauses pieces, so try the
  // whole normalized text as a single conditional effect first. If the WHOLE
  // input is an `If CONDITION, EFFECT [Otherwise, EFFECT]` statement, return
  // one effect rather than splitting on the inner period and losing context.
  // The regex tolerates either ", " or ". " before "Otherwise", and an
  // optional trailing period at the end of the else-branch.
  const lowerFull = normalized.toLowerCase();
  const fullIfMatch = lowerFull.match(
    /^if\s+(.+?),\s*(.+?)(?:[.,]?\s+otherwise,?\s*(.+?))?[.,]?$/,
  );
  if (fullIfMatch) {
    const thenEffects = parseEffects(fullIfMatch[2].trim());
    const elseEffects = fullIfMatch[3]
      ? parseEffects(fullIfMatch[3].trim())
      : undefined;
    const conditional: ConditionalEffect = {
      type: "conditional",
      condition: fullIfMatch[1].trim(),
      thenEffects,
      elseEffects,
    };
    return [conditional];
  }

  const clauses = splitClauses(normalized);
  const effects: Effect[] = [];

  for (const clause of clauses) {
    const parsed = parseClause(clause.trim());
    if (parsed) effects.push(...parsed);
  }

  return effects;
}

function splitClauses(text: string): string[] {
  const clauses: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0) {
      if (ch === "." && !isInsideDice(text, i)) {
        if (current.trim()) clauses.push(current.trim());
        current = "";
        continue;
      }
      if (
        ch === "," &&
        !isInsideDice(text, i) &&
        !text.slice(i).match(/^,\s*(?:and|or)\s/i)
      ) {
        if (current.trim()) clauses.push(current.trim());
        current = "";
        continue;
      }
      if (text.slice(i).match(/^ and /i) && !isInsideDice(text, i)) {
        if (current.trim()) clauses.push(current.trim());
        current = "";
        i += 4;
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) clauses.push(current.trim());

  return clauses;
}

function isInsideDice(text: string, pos: number): boolean {
  let depth = 0;
  for (let i = 0; i < pos; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
  }
  const before = text.slice(Math.max(0, pos - 20), pos);
  if (/\d+d\d+/.test(before) && depth === 0) {
    return (
      /\+/.test(before) && !/\s/.test(before.slice(before.lastIndexOf("+")))
    );
  }
  return false;
}

function parseClause(clause: string): Effect[] {
  const lower = clause.toLowerCase().trim();

  const clauseMatch = parseClauseStructured(lower);
  if (clauseMatch) return clauseMatch;

  // Inflict: "inflict N Status/M" or "inflict Status/M" or "N Status/M" or "Status/M"
  const statusEffects = parseStatusInflict(lower);
  if (statusEffects.length > 0) return statusEffects;

  // Stat modifiers: "+N STAT/M" or "-N STAT/M" or "+N% STAT/M"
  const statMods = parseStatMods(lower);
  if (statMods.length > 0) return statMods;

  // Damage mod: "+N% damage" or "+N% healing"
  const dmgMod = parseDamageMod(lower);
  if (dmgMod.length > 0) return dmgMod;

  // Push/Pull
  const displacement = parseDisplacement(lower);
  if (displacement.length > 0) return displacement;

  // Resource: "Gain/Spend/Lose N resource"
  const resource = parseResource(lower);
  if (resource.length > 0) return resource;

  // Heal: "Heal N HP" or "heal target for amount"
  const heal = parseHeal(lower);
  if (heal.length > 0) return heal;

  // Shield: "Shield N for M rounds" or "N Shield/M"
  const shield = parseShield(lower);
  if (shield.length > 0) return shield;

  // Tile placement: "Place X tiles" or "X tiles"
  const tileEffect = parseTilePlacement(lower);
  if (tileEffect) return [tileEffect];

  // Fallback: unknown
  return [{ type: "unknown", text: clause }];
}

/** Structured clauses with a fixed keyword prefix (If/Thirst/Apex/...). */
function parseClauseStructured(lower: string): Effect[] | null {
  // Conditional: "If CONDITION, EFFECT [Otherwise, EFFECT]"
  const ifMatch = lower.match(
    /^if\s+(.+?),\s*(.+?)(?:\s+otherwise,?\s*(.+))?$/,
  );
  if (ifMatch) {
    return [{
      type: "conditional",
      condition: ifMatch[1].trim(),
      thenEffects: parseEffects(ifMatch[2]),
      elseEffects: ifMatch[3] ? parseEffects(ifMatch[3]) : undefined,
    }];
  }

  // Thirst: "Thirst N: EFFECT"
  const thirstMatch = lower.match(/^thirst\s+(\d+):\s*(.+)$/);
  if (thirstMatch) {
    return [{
      type: "thirst",
      threshold: parseInt(thirstMatch[1]),
      effects: parseEffects(thirstMatch[2]),
    }];
  }

  // Apex: "Apex: EFFECT"
  const apexMatch = lower.match(/^apex:\s*(.+)$/);
  if (apexMatch) {
    return [{ type: "apex", effects: parseEffects(apexMatch[1]) }];
  }

  // Choose: "Choose: EFFECT1 [or EFFECT2 [or EFFECT3]]" or "Choose EFFECT1 or EFFECT2".
  // Optional colon + "one" prefix to match real glossary variants.
  const chooseMatch = lower.match(/^choose\s*:?\s+(?:one:\s*)?(.+)$/);
  if (chooseMatch) {
    const options = chooseMatch[1]
      .split(/\s+or\s+/)
      .map((o) => parseEffects(o.trim()))
      .filter((o) => o.length > 0);
    if (options.length > 0) return [{ type: "choose", options }];
  }

  // Channel: "Channel STAT for N rounds"
  const channelMatch = lower.match(
    /^channel\s+(\w+)(?:\s+for\s+(\d+)\s+rounds?)?$/,
  );
  if (channelMatch) {
    return [{
      type: "channel",
      stat: channelMatch[1],
      rounds: channelMatch[2] ? parseInt(channelMatch[2]) : 1,
    }];
  }

  // Phase: "Phase: PHASE_NAME"
  const phaseMatch = lower.match(
    /^phase:\s*(new moon|waxing|full moon|waning)$/,
  );
  if (phaseMatch) {
    return [{ type: "phase", phase: phaseMatch[1] }];
  }

  // Delay: "Delay N rounds" or "Delay-N" or "Delay-1. May delay up to +2 more turns."
  const delayMatch =
    lower.match(/^delay[\s-]+(\d+)\s+rounds?$/) ??
    lower.match(/^delay-?(\d+)$/);
  if (delayMatch) {
    return [{ type: "delay", rounds: parseInt(delayMatch[1]) }];
  }

  // Recoil: "Recoil N%"
  const recoilMatch = lower.match(/^recoil\s+(\d+)%$/);
  if (recoilMatch) {
    return [{ type: "recoil", percent: parseInt(recoilMatch[1]) }];
  }

  // Ignore: "Ignore(s) X"
  const ignoreMatch = lower.match(/^ignores?\s+(?:non-\w+\s+)?(.+?)\.?$/);
  if (ignoreMatch) {
    return [{ type: "ignore", what: ignoreMatch[1].trim() }];
  }

  // Multi-hit from dice: "Multi-Hit: N" or "becomes Multi-Hit: N"
  const multiHitMatch = lower.match(/multi[\s-]hit[:\s]+(\d+)/);
  if (multiHitMatch) {
    return [{ type: "multiHit", hits: parseInt(multiHitMatch[1]) }];
  }

  return null;
}

function parseStatusInflict(lower: string): Effect[] {
  const effects: Effect[] = [];

  // Pattern: "inflict N Status/M" or "inflict Status/M"
  // Also: "N Status/M" standalone, or "Status/M" standalone
  // Also: "inflict N status for M rounds"

  // Try "inflict N Status for M rounds"
  const formalMatch = lower.match(
    /inflict\s+(\d+)?\s*([a-z]+)\s+(?:for\s+)?(\d+)\s+rounds?/,
  );
  if (formalMatch) {
    const name = capitalize(formalMatch[2]);
    const dmg = formalMatch[1] ? parseInt(formalMatch[1]) : 0;
    const rounds = parseInt(formalMatch[3]);
    if (STATUS_NAMES.includes(formalMatch[2])) {
      effects.push({ type: "status", name, damage: dmg, rounds });
      return effects;
    }
  }

  // Try "inflict N Status/M"
  const slashMatch = lower.match(/inflict\s+(\d+)?\s*([a-z]+)\s*\/\s*(\d+)/);
  if (slashMatch) {
    const statusName = slashMatch[2];
    const name = capitalize(statusName);
    const dmg = slashMatch[1] ? parseInt(slashMatch[1]) : 0;
    const rounds = parseInt(slashMatch[3]);
    if (STATUS_NAMES.includes(statusName)) {
      effects.push({
        type: "status",
        name,
        damage: dmg,
        rounds,
      });
      return effects;
    }
  }

  // Try standalone "N Status/M" (e.g. "3 Bleed/1", "2 Cripple/1")
  const standaloneMatch = lower.match(/^(\d+)?\s*([a-z]+)\s*\/\s*(\d+)$/);
  if (standaloneMatch) {
    const statusName = standaloneMatch[1] ? "" : standaloneMatch[2];
    if (STATUS_NAMES.includes(statusName)) {
      effects.push({
        type: "status",
        name: capitalize(statusName),
        damage: standaloneMatch[1] ? parseInt(standaloneMatch[1]) : 0,
        rounds: parseInt(standaloneMatch[3]),
      });
      return effects;
    }
  }

  // Try standalone "Status/M" (e.g. "Slow/1", "Stun/1")
  const nonDmgMatch = lower.match(/^([a-z]+)\s*\/\s*(\d+)$/);
  if (nonDmgMatch) {
    if (STATUS_NAMES.includes(nonDmgMatch[1])) {
      effects.push({
        type: "status",
        name: capitalize(nonDmgMatch[1]),
        damage: 0,
        rounds: parseInt(nonDmgMatch[2]),
      });
      return effects;
    }
  }

  // "inflict Status/M" without damage number
  const inflictMatch = lower.match(/inflict\s+([a-z]+)\s*\/\s*(\d+)/);
  if (inflictMatch) {
    if (STATUS_NAMES.includes(inflictMatch[1])) {
      effects.push({
        type: "status",
        name: capitalize(inflictMatch[1]),
        damage: 0,
        rounds: parseInt(inflictMatch[2]),
      });
      return effects;
    }
  }

  // Bare "inflict Status" without duration
  const bareMatch = lower.match(/inflict\s+([a-z]+)$/);
  if (bareMatch) {
    if (STATUS_NAMES.includes(bareMatch[1])) {
      effects.push({
        type: "status",
        name: capitalize(bareMatch[1]),
        damage: 0,
        rounds: 1,
      });
      return effects;
    }
  }

  return effects;
}

function parseStatMods(lower: string): Effect[] {
  const effects: Effect[] = [];

  // Pattern: "+N STAT/M" or "-N STAT/M" with optional "for" or "until"
  // Also: "+N% STAT" or "-N% STAT"
  // Also: "+N STAT" without duration
  // Also: "gain +N STAT/M"

  const statRegex =
    /([+-]?)\s*(\d+(?:\.\d+)?%?)\s+(atk|mag|pd|md|def|mdef|pdef|eva|mp|acc|cr|dmg|damage|range)\s*(?:\/\s*(\d+))?/g;
  let match;
  while ((match = statRegex.exec(lower)) !== null) {
    const sign = match[1] === "-" ? -1 : 1;
    const isPercent = match[2].includes("%");
    const value = parseFloat(match[2].replace("%", ""));
    let stat = match[3].toLowerCase();

    // Normalize stat names
    if (stat === "damage") stat = "dmg";
    if (stat === "mdef") stat = "md";
    if (stat === "pdef") stat = "pd";

    const rounds = match[4] ? parseInt(match[4]) : undefined;

    if (isPercent) {
      effects.push({
        type: sign > 0 ? "buff" : "debuff",
        stat,
        amount: 0,
        percent: sign * value,
        rounds,
      });
    } else {
      effects.push({
        type: sign > 0 ? "buff" : "debuff",
        stat,
        amount: sign * value,
        rounds,
      });
    }
  }

  return effects;
}

function parseDamageMod(lower: string): Effect[] {
  const effects: Effect[] = [];

  // "+N% damage" or "+N% healing" or "+N% DMG"
  const dmgPctMatch = lower.match(/([+-]?)\s*(\d+)%\s*(?:damage|healing|dmg)/);
  if (dmgPctMatch) {
    const sign = dmgPctMatch[1] === "-" ? -1 : 1;
    effects.push({
      type: "damageMod",
      percent: sign * parseInt(dmgPctMatch[2]),
    });
    return effects;
  }

  // "+N DMG/M"
  const dmgFlatMatch = lower.match(/([+-]?)\s*(\d+)\s+dmg\s*(?:\/\s*(\d+))?/);
  if (dmgFlatMatch) {
    const sign = dmgFlatMatch[1] === "-" ? -1 : 1;
    effects.push({
      type: "damageMod",
      flat: sign * parseInt(dmgFlatMatch[2]),
      rounds: dmgFlatMatch[3] ? parseInt(dmgFlatMatch[3]) : undefined,
    });
    return effects;
  }

  return effects;
}

function parseDisplacement(lower: string): Effect[] {
  const effects: Effect[] = [];

  // "Push N toward user" or "Push N away from user" or "Push N"
  const pushMatch = lower.match(
    /push\s+(\d+)\s*(?:toward(?:s)?\s+user|away\s+from\s+user)?/,
  );
  if (pushMatch) {
    const towardUser = lower.includes("toward");
    effects.push({
      type: "push",
      amount: parseInt(pushMatch[1]),
      toward: towardUser ? "user" : "target",
    });
    return effects;
  }

  // "Pull N toward user" or "Pull N"
  const pullMatch = lower.match(/pull\s+(\d+)\s*(?:toward(?:s)?\s+user)?/);
  if (pullMatch) {
    effects.push({
      type: "pull",
      amount: parseInt(pullMatch[1]),
      toward: "user",
    });
    return effects;
  }

  // "Teleport to range"
  if (lower.includes("teleport")) {
    const rangeMatch = lower.match(/teleport\s+to\s+(.+)/);
    effects.push({
      type: "teleport",
      range: rangeMatch ? rangeMatch[1].trim() : undefined,
    });
    return effects;
  }

  // "Swap positions"
  if (lower.includes("swap")) {
    effects.push({ type: "swap" });
    return effects;
  }

  // "Move N"
  const moveMatch = lower.match(/move\s+(?:up\s+to\s+)?(\d+)\s*(?:tiles?|mp)?/);
  if (moveMatch) {
    effects.push({ type: "move", amount: parseInt(moveMatch[1]) });
    return effects;
  }

  return effects;
}

function parseResource(lower: string): Effect[] {
  const effects: Effect[] = [];

  const resRegex = /(gain|spend|lose)\s+(\d+(?:-\d+)?|X|any)\s+([a-z]+)/i;
  const match = lower.match(resRegex);
  if (match) {
    const action = match[1].toLowerCase() as "gain" | "spend" | "lose";
    const amountStr = match[2];
    const amount = /^\d+$/.test(amountStr) ? parseInt(amountStr) : amountStr;
    const resource = match[3].toLowerCase();

    if (RESOURCE_NAMES.includes(resource) || lower.includes(resource)) {
      effects.push({ type: "resource", action, amount, resource });
      return effects;
    }
  }

  // "gain +N MP" pattern (gain with stat modifier)
  const gainStatMatch = lower.match(/gain\s+([+-]?\d+)\s+(mp)/);
  if (gainStatMatch) {
    effects.push({
      type: "buff",
      stat: "mp",
      amount: parseInt(gainStatMatch[1]),
    });
    return effects;
  }

  return effects;
}

function parseHeal(lower: string): Effect[] {
  const effects: Effect[] = [];

  // "Heal N HP"
  const healMatch = lower.match(/heal\s+(?:target\s+for\s+)?(\d+)\s*(?:hp)?/);
  if (healMatch) {
    effects.push({
      type: "heal",
      amount: parseInt(healMatch[1]),
      target: lower.includes("self") ? "self" : "target",
    });
    return effects;
  }

  // "heal X% of damage"
  const healPctMatch = lower.match(/heal\s+(\d+)%\s+of/);
  if (healPctMatch) {
    effects.push({
      type: "heal",
      target: "self",
    });
    return effects;
  }

  return effects;
}

function parseShield(lower: string): Effect[] {
  const effects: Effect[] = [];

  // "Shield N for M rounds"
  const shieldMatch = lower.match(
    /shield\s+(\d+)\s+(?:for\s+)?(\d+)\s+rounds?/,
  );
  if (shieldMatch) {
    effects.push({
      type: "shield",
      amount: parseInt(shieldMatch[1]),
      rounds: parseInt(shieldMatch[2]),
    });
    return effects;
  }

  // "N Shield/M" standalone
  const shieldSlashMatch = lower.match(/^(\d+)\s+shield\s*\/\s*(\d+)$/);
  if (shieldSlashMatch) {
    effects.push({
      type: "shield",
      amount: parseInt(shieldSlashMatch[1]),
      rounds: parseInt(shieldSlashMatch[2]),
    });
    return effects;
  }

  return effects;
}

export function terrainFromName(name: string): number {
  const map: Record<string, number> = {
    normal: Terrain.Normal,
    stop: Terrain.Stop,
    water: Terrain.Water,
    forest: Terrain.Forest,
    ice: Terrain.Ice,
    air: Terrain.Air,
    sticky: Terrain.Sticky,
    lava: Terrain.Lava,
    broken: Terrain.Broken,
    bone: Terrain.Bone,
    stone: Terrain.Stone,
    hearth: Terrain.Hearth,
    boost: Terrain.Boost,
  };
  return map[name.toLowerCase().trim()] ?? Terrain.Normal;
}

export function parseTilePlacement(text: string): TileEffect | null {
  const lower = text.toLowerCase().trim();
  // "Place X tiles" or "Set X on tiles" or "Create X tiles"
  const match = lower.match(
    /(?:place|set|create|summon)\s+(\w+)\s+(?:terrain\s+)?tiles?(?:\s+range\s+(\d+))?/,
  );
  if (match) {
    const terrain = terrainFromName(match[1]);
    const range = match[2] ? parseInt(match[2]) : 1;
    return { type: "tile", terrain, range };
  }
  // "X tiles" shorthand
  const short = lower.match(/^(\w+)\s+tiles?(?:\s+range\s+(\d+))?$/);
  if (short && short[1] !== "all" && short[1] !== "any") {
    const terrain = terrainFromName(short[1]);
    if (terrain !== Terrain.Normal) {
      return {
        type: "tile",
        terrain,
        range: short[2] ? parseInt(short[2]) : 1,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getBaseStat(entity: Entity, stat: string): number {
  switch (stat) {
    case "atk":
      return entity.atk;
    case "mag":
      return entity.mag;
    case "pd":
    case "def":
      return entity.pd;
    case "md":
      return entity.md;
    case "eva":
      return entity.eva;
    case "mp":
      return entity.mp;
    default:
      return 0;
  }
}

// Local copy of `getEffectiveStat` -- same logic that resolve.ts inlines,
// kept local so effects.ts stays self-contained. Used in places where a
// clamped (>= 0) stat is what we need, e.g. damage scaling.
function getEffStat(entity: Entity, stat: string): number {
  let base = getBaseStat(entity, stat);
  for (const b of entity.buffs) {
    if (b.stat === stat) base += b.amount;
  }
  return Math.max(0, base);
}

// Unclamped variant -- used by condition evaluation so the sign check can
// detect a stat that has debuffed below zero. The clamped helper would mask
// negatives back to 0 and cause "Stat is negative" to misfire on heavily
// debuffed targets.
function getRawStat(entity: Entity, stat: string): number {
  let base = getBaseStat(entity, stat);
  for (const b of entity.buffs) {
    if (b.stat === stat) base += b.amount;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Thirst gate
// ---------------------------------------------------------------------------

/**
 * Returns true when the caster's Blood resource meets (or exceeds) the
 * threshold required by a `Thirst N:` clause.
 *
 * Per BD 4.4 (Trophy class): Blood is its own resource counter -- separate
 * from HP/MP/Resolve. Every `Thirst N:` clause in an ability text fires only
 * when the caster has N+ Blood at move-select time. Real examples:
 *   - "Thirst 5: +3 MR, Double Hit."
 *   - "Thirst 4: inflict Cripple 4/1."
 *   - "Thirst 10: no effects."
 *
 * The Blood spend (if any) is handled by explicit sub-effect text such as
 * "lose X Blood"; this gate only decides whether the sub-effects run.
 *
 * Entities without a Blood pool (i.e. any class other than Trophy) read as 0
 * Blood and so never satisfy a thirst threshold -- matches the design where
 * thirst clauses are Trophy-specific mechanics.
 */
export function isThirstActive(user: Entity, effect: ThirstEffect): boolean {
  const blood = user.resources.blood ?? 0;
  return blood >= effect.threshold;
}

// ---------------------------------------------------------------------------
// Apex gate
// ---------------------------------------------------------------------------

/**
 * Returns true when target is at the maximum listed range of the ability,
 * so any sub-effects of an `apex` clause should fire.
 *
 * Per BD 4.4: "When a Tomahawk ability targets a player at its maximum listed
 * range, it gains its Apex effect. Apex includes the final row/column of Beam
 * ranges."
 *
 * Range types with a numeric max:
 *   Burst N    -- Chebyshev == N
 *   Range N    -- Manhattan == N (LOS required)
 *   Homing N   -- Manhattan == N (no LOS)
 *   Star N     -- Manhattan == N (LOS required)
 *   Pierce N   -- Cardinal Manhattan == N, diagonal chebyshev == ceil(N/2) (LOS required)
 *   Line N     -- same as Pierce (LOS required)
 *   Cone N     -- forward distance == N
 *   Beam N     -- final row/column strip at depth N: max(|d|) == N AND min(|d|) <= 1.
 *                  Beam LOS is checked via centerline, since state.ts inBeam has
 *                  known bugs for off-axis perpendicular tiles.
 *   Melee      -- chebyshev == 1
 *
 * Global / varies / unknown -> no apex, no max.
 */
export function isApexActive(
  game: Game,
  user: Entity,
  target: Entity,
  ability: AbilityData,
): boolean {
  const r = ability.range.toLowerCase().trim();

  // No apex on ranges without a numeric max.
  if (r === "" || r === "varies" || r === "global") return false;

  const dr = target.pos[0] - user.pos[0];
  const dc = target.pos[1] - user.pos[1];
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);
  const mh = manhattan(user.pos, target.pos);
  const ch = chebyshev(user.pos, target.pos);

  // Melee: max is 1 tile in any of the 8 surrounding tiles.
  if (r === "melee") return ch === 1;

  // For numbered range types, the trailing digit of the first clause is "max".
  // (We don't try to handle `Range 3 or 5` style combos; pick the first.)
  const m = r.match(/^(burst|range|homing|pierce|line|beam|cone|star)\s+(\d+)/);
  if (!m) return false;
  const type = m[1];
  const max = parseInt(m[2]);

  const cardinal = dr === 0 || dc === 0;
  const diagonal = !cardinal && absDr === absDc;

  // Beam LOS / off-axis geometry isn't modelled correctly by inRange's
  // inBeam helper, so beam is handled separately below (with its own
  // centerline LOS check). For all other range types, require the target
  // to be in range (handles LOS).
  if (type !== "beam" && !inRange(game, user.pos, target.pos, ability.range)) {
    return false;
  }

  const apexCheck = APEX_CHECKS[type];
  return apexCheck
    ? apexCheck({ game, user, target, dr, dc, absDr, absDc, mh, ch, max })
    : false;
}

/** Inputs a per-range-type apex distance check needs. */
type ApexCtx = {
  game: Game;
  user: Entity;
  target: Entity;
  dr: number;
  dc: number;
  absDr: number;
  absDc: number;
  mh: number;
  ch: number;
  max: number;
};

/** Per-range-type "is target at max range" checks for Apex. */
const APEX_CHECKS: Record<string, (ctx: ApexCtx) => boolean> = {
  burst: ({ ch, max }) => ch === max,
  range: ({ mh, max }) => mh === max,
  homing: ({ mh, max }) => mh === max,
  star: ({ mh, max }) => mh === max,
  pierce: ({ dr, dc, absDr, absDc, mh, max }) =>
    dr === 0 || dc === 0
      ? mh === max
      : absDr === absDc && absDr === Math.ceil(max / 2),
  line: ({ dr, dc, absDr, absDc, mh, max }) =>
    dr === 0 || dc === 0
      ? mh === max
      : absDr === absDc && absDr === Math.ceil(max / 2),
  cone: ({ absDr, absDc, max }) => {
    if (absDr > absDc) return absDr === max;
    if (absDc > absDr) return absDc === max;
    return false;
  },
  beam: ({ game, user, target, dr, dc, absDr, absDc, max }) => {
    // "Apex includes the final row/column of Beam ranges." The final
    // row/column is a 3-tile strip at depth == max (one tile perpendicular
    // to each side of the beam centerline).
    if (Math.max(absDr, absDc) !== max) return false;
    if (Math.min(absDr, absDc) > 1) return false;
    // Centerline LOS: from user toward the centerline of the beam at the
    // target's depth cardinal axis.
    if (dr === 0)
      return hasLineOfSight(game, user.pos, [user.pos[0], target.pos[1]]);
    if (dc === 0)
      return hasLineOfSight(game, user.pos, [target.pos[0], user.pos[1]]);
    // Diagonal beam — direct LOS to target.
    return hasLineOfSight(game, user.pos, target.pos);
  },
};

// ---------------------------------------------------------------------------
// Effect Application
// ---------------------------------------------------------------------------

/**
 * Apply a parsed effect list to a target, returning log messages.
 *
 * `ability` is required for the gating effect types (Apex, Thirst, Conditional,
 * Choose). Without it, gated clauses emit a "cannot evaluate" stub message
 * and skip their sub-effects rather than firing unconditionally. Plumbing it
 * through also lets nested gating clauses evaluate correctly inside the
 * recursive streams those effect types spawn.
 *
 * For the Choose clause, this sync wrapper **fans out all options** as a
 * fallback so callers don't have to handle the prompt themselves. Resolve.ts
 * uses `applyEffectStream` instead, which yields prompts and only applies
 * the chosen option.
 */
export function applyEffects(
  game: Game,
  user: Entity,
  target: Entity,
  effects: Effect[],
  ability?: AbilityData,
): string[] {
  return drainApplyStream(
    applyEffectStream(game, user, target, effects, ability),
  );
}

// ---------------------------------------------------------------------------
// Conditional gate
// ---------------------------------------------------------------------------

/**
 * Returns "then" when the parsed condition holds, "else" when it doesn't,
 * "unknown" when the condition text can't be evaluated (e.g. it depends on
 * future state we don't track yet -- "target Dashes before user's next turn").
 *
 * Supported patterns (case-insensitive):
 *   - "target is alive" / "target is dead" / "target dies"
 *   - "user has Status" / "target has Status" (matches STATUS_NAMES list)
 *   - "user has N Resource" / "target has N Resource" (resource pool >= N)
 *   - "user Stat is (positive|negative|zero)"
 *   - "user Stat > N" / "user Stat >= N" / etc. with stats or numerical values
 *   - "0 Campaigns" / "10 Blood" -- resource threshold shorthand
 *   - "user Stat greater than N" / "less than N" / "equal to N" (word variants)
 *   - "not ..." / "no ..." -- wraps any of the above
 *
 * Unknown outcomes defer to the caller; in applyEffectStream that means the
 * then-branch still runs (legacy fallback) with a "condition evaluation TODO"
 * log so human readers can see what didn't get auto-routed.
 */
export type ConditionOutcome = "then" | "else" | "unknown";

export function evaluateCondition(
  text: string,
  user: Entity,
  target: Entity,
): ConditionOutcome {
  const lower = text.toLowerCase().trim();

  const resourceEq = evalResourceEquality(lower, user);
  if (resourceEq !== null) return resourceEq;

  const negate = evalNegation(lower, user, target);
  if (negate !== null) return negate;

  const alive = evalAlive(lower, target);
  if (alive !== null) return alive;

  const status = evalHasStatus(lower, user, target);
  if (status !== null) return status;

  const resource = evalHasResource(lower, user, target);
  if (resource !== null) return resource;

  const sign = evalStatSign(lower, user, target);
  if (sign !== null) return sign;

  const cmp = evalStatCompare(lower, user, target);
  if (cmp !== null) return cmp;

  const word = evalStatWordCompare(lower, user, target);
  if (word !== null) return word;

  return "unknown";
}

/** "5 Blood" / "0 Campaigns" / "no Campaigns" — resource threshold. */
function evalResourceEquality(
  lower: string,
  user: Entity,
): ConditionOutcome | null {
  // Checked *before* the generic "not / no" negation wrapper so that
  // "no Campaigns" reads as "<user> has Campaigns == 0" rather than
  // "negation(<something unknown>)". The bare token must be a known
  // resource name (or its plural) so natural-language phrases like
  // "no target has Stun" aren't swallowed as a resource lookup.
  const m = lower.match(/^(\d+|zero|no)\s+([a-z]+)$/);
  if (!m) return null;
  const raw = m[1];
  const value = raw === "zero" || raw === "no" ? 0 : parseInt(raw);
  const resource = canonicalResource(m[2]);
  if (!resource) return null;
  return (user.resources[resource] ?? 0) >= value ? "then" : "else";
}

/** "not ..." / "no ..." — flips any wrapped condition. */
function evalNegation(
  lower: string,
  user: Entity,
  target: Entity,
): ConditionOutcome | null {
  const m = lower.match(/^(?:not|no)\s+(.+)$/);
  if (!m) return null;
  const inner = evaluateCondition(m[1], user, target);
  if (inner === "then") return "else";
  if (inner === "else") return "then";
  return "unknown";
}

/** "target is alive/dead" / "target dies" / "target has been killed". */
function evalAlive(lower: string, target: Entity): ConditionOutcome | null {
  const m = lower.match(/^target is (alive|dead)$/);
  if (m) {
    const wantAlive = m[1] === "alive";
    return target.curhp > 0 === wantAlive ? "then" : "else";
  }
  if (lower === "target dies" || /target has been (killed|defeated)/.test(lower)) {
    return target.curhp <= 0 ? "then" : "else";
  }
  return null;
}

/** "user/target has <status>" — matches any candidate name. */
function evalHasStatus(
  lower: string,
  user: Entity,
  target: Entity,
): ConditionOutcome | null {
  const m = lower.match(/^(user|target) has (?:a |an )?([a-z ]+?)$/);
  if (!m) return null;
  const which = m[1];
  const candidates = m[2]
    .trim()
    .split(/\s+or\s+|\s*,\s*/)
    .map((s) => s.trim().split(/\s+/).pop()!)
    .filter(Boolean);
  const entity = which === "user" ? user : target;
  for (const cand of candidates) {
    const has = entity.statuses.some((s) => toId(s.name) === toId(cand));
    if (has) return "then";
  }
  return "else";
}

/** "user/target has N <resource>". */
function evalHasResource(
  lower: string,
  user: Entity,
  target: Entity,
): ConditionOutcome | null {
  const m = lower.match(/^(user|target) has (\d+)\s+([a-z]+)$/);
  if (!m) return null;
  const which = m[1];
  const amount = parseInt(m[2]);
  const resource = m[3];
  const entity = which === "user" ? user : target;
  return (entity.resources[resource] ?? 0) >= amount ? "then" : "else";
}

/** "user/target <stat> positive|negative|zero". */
function evalStatSign(
  lower: string,
  user: Entity,
  target: Entity,
): ConditionOutcome | null {
  const m = lower.match(
    /^(user|target)\s+(atk|mag|pd|md|eva|mp|acc|cr)\s+(positive|negative|zero)$/,
  );
  if (!m) return null;
  const which = m[1];
  const stat = m[2];
  const sign = m[3];
  const entity = which === "user" ? user : target;
  const v = getRawStat(entity, stat);
  if (sign === "positive") return v > 0 ? "then" : "else";
  if (sign === "negative") return v < 0 ? "then" : "else";
  return v === 0 ? "then" : "else";
}

/** "user/target <stat> > N" / ">=" / "<" / "<=" / "=". */
function evalStatCompare(
  lower: string,
  user: Entity,
  target: Entity,
): ConditionOutcome | null {
  const m = lower.match(
    /^(user|target)\s+(atk|mag|pd|md|eva|mp|acc|cr)\s*(>=|<=|>|<|=)\s*(-?\d+)$/,
  );
  if (!m) return null;
  const which = m[1];
  const stat = m[2];
  const op = m[3];
  const value = parseInt(m[4]);
  const entity = which === "user" ? user : target;
  const v = getRawStat(entity, stat);
  if (op === ">") return v > value ? "then" : "else";
  if (op === ">=") return v >= value ? "then" : "else";
  if (op === "<") return v < value ? "then" : "else";
  if (op === "<=") return v <= value ? "then" : "else";
  return v === value ? "then" : "else";
}

/** "user/target <stat> greater than|less than|equal to N". */
function evalStatWordCompare(
  lower: string,
  user: Entity,
  target: Entity,
): ConditionOutcome | null {
  const m = lower.match(
    /^(user|target)'?s?\s+(atk|mag|pd|md|eva|mp|acc|cr)\s+(greater than|less than|equal to)\s+(-?\d+)$/,
  );
  if (!m) return null;
  const which = m[1];
  const stat = m[2];
  const op = m[3];
  const value = parseInt(m[4]);
  const entity = which === "user" ? user : target;
  const v = getRawStat(entity, stat);
  if (op === "greater than") return v > value ? "then" : "else";
  if (op === "less than") return v < value ? "then" : "else";
  return v === value ? "then" : "else";
}

/**
 * Routes a ConditionalEffect based on `evaluateCondition`. Used by both
 * the sync `applyEffects` and the generator `applyEffectStream` so the
 * observable log semantics stay consistent across both code paths.
 *
 * - "then" outcome: then-branch runs
 * - "else" outcome: else-branch runs if present, otherwise nothing
 * - "unknown" outcome: then-branch runs (legacy fallback) and a
 *   "[Conditional: X] -- condition evaluation TODO." line is logged
 */
function applyConditional(
  user: Entity,
  target: Entity,
  effect: ConditionalEffect,
): { messages: string[]; outcome: ConditionOutcome } {
  const outcome = evaluateCondition(effect.condition, user, target);
  const messages: string[] = [];
  if (outcome === "unknown") {
    messages.push(
      `  [Conditional: ${effect.condition}] -- condition evaluation TODO.`,
    );
  } else if (outcome === "else" && effect.elseEffects) {
    messages.push(`  [Conditional: ${effect.condition}] = false. Otherwise:`);
  } else {
    messages.push(
      `  [Conditional: ${effect.condition}] = ${outcome === "then" ? "true" : "false"}.`,
    );
  }
  return { messages, outcome };
}

// ---------------------------------------------------------------------------
// Effect stream (generator) -- used by resolve.ts for interactive choose
// ---------------------------------------------------------------------------

/**
 * Prompt yielded by `applyEffectStream` when the user has to make a
 * sub-effect selection inside an effect clause (Choose). The resolve
 * pipeline relays this to the host/user, gets back a `choiceId`, and feeds
 * it into the generator as the next `next()` argument.
 */
export interface EffectChoosePrompt {
  kind: "choose";
  clauseId: string; // unique id for the choose clause, kept stable across yield/resume so the resolve pipeline can match it
  message: string;
  options: { id: string; label: string }[];
}

/**
 * Generator form of `applyEffects`.
 *
 * Walks `effects` left-to-right. For most effect types it emits the same
 * log messages `applyEffects` does. For a `choose` clause it yields an
 * `EffectChoosePrompt` and waits for the caller to `next()` it with the
 * chosen `option.id`. Only the chosen option's sub-effects are then applied.
 *
 * Nested gating clauses (Apex / Thirst / Conditional / Choose inside the
 * chosen sub-effects, etc.) flow correctly via `yield*` so the resolve
 * pipeline keeps a single structure of prompts.
 */
type EffectCtx = {
  game: Game;
  user: Entity;
  target: Entity;
  ability?: AbilityData;
  messages: string[];
};

/**
 * A single effect-type handler. Pushes log lines into `ctx.messages` and
 * may `yield` prompts (choose) or recurse into sub-effects via
 * `yield* applyEffectStream(...)`.
 */
type EffectHandler = (
  ctx: EffectCtx,
  effect: any,
) => Generator<EffectChoosePrompt, void, string>;

function* handleStatus(
  { target, messages }: EffectCtx,
  effect: StatusInflict,
) {
  const hasShield = target.statuses.some((s) => toId(s.name) === "shield");
  if (hasShield && effect.damage === 0) {
    messages.push(`  ${target.num}'s Shield blocks ${effect.name}!`);
    return;
  }
  const existing = target.statuses.find((s) => s.name === effect.name);
  if (existing) {
    existing.rounds = Math.max(existing.rounds, effect.rounds);
    existing.damage = Math.max(existing.damage, effect.damage);
    messages.push(
      `  ${target.num}'s ${effect.name} refreshed (${effect.rounds} rounds).`,
    );
  } else {
    target.statuses.push({
      name: effect.name,
      damage: effect.damage,
      rounds: effect.rounds,
      maxRounds: effect.rounds,
      removable: true,
    });
    messages.push(
      `  ${target.num} afflicted with ${effect.name}${effect.damage > 0 ? ` (${effect.damage}/${effect.rounds})` : ` (${effect.rounds} rounds)`}.`,
    );
  }
}

function* handleStatMod(
  { target, messages }: EffectCtx,
  effect: StatMod,
) {
  const mult = effect.type === "buff" ? 1 : -1;
  if (effect.percent) {
    const baseStat = getBaseStat(target, effect.stat);
    const amount = mult * Math.floor(baseStat * (Math.abs(effect.percent) / 100));
    target.buffs.push({
      stat: effect.stat,
      amount,
      rounds: effect.rounds ?? 1,
    });
    messages.push(
      `  ${target.num} ${effect.type === "buff" ? "gains" : "loses"} ${mult > 0 ? "+" : ""}${effect.percent}% ${effect.stat.toUpperCase()} (${amount})${effect.rounds ? `/${effect.rounds}` : ""}.`,
    );
  } else {
    target.buffs.push({
      stat: effect.stat,
      amount: effect.amount,
      rounds: effect.rounds ?? 1,
    });
    messages.push(
      `  ${target.num} ${effect.type === "buff" ? "gains +" : "loses "}${effect.amount} ${effect.stat.toUpperCase()}${effect.rounds ? `/${effect.rounds}` : ""}.`,
    );
  }
}

function* handleDamageMod(
  { target, messages }: EffectCtx,
  effect: DamageMod,
) {
  const label = effect.percent
    ? `${effect.percent > 0 ? "+" : ""}${effect.percent}% damage`
    : `${effect.flat! > 0 ? "+" : ""}${effect.flat} DMG`;
  messages.push(`  ${target.num} ${label}${effect.rounds ? `/${effect.rounds}` : ""}.`);
}

function* handleHeal(
  { user, target, messages }: EffectCtx,
  effect: HealEffect,
) {
  if (effect.amount) {
    const prev = target.curhp;
    target.curhp = Math.min(target.maxhp, target.curhp + effect.amount);
    const healed = target.curhp - prev;
    messages.push(
      `  ${target.num} healed for ${healed} HP (${target.curhp}/${target.maxhp}).`,
    );
  } else {
    messages.push(`  ${user.num} heals ${target.num}. (Manual resolution needed)`);
  }
}

function* handleShield(
  { target, messages }: EffectCtx,
  effect: ShieldEffect,
) {
  const existingShield = target.statuses.find((s) => s.name === "Shield");
  if (existingShield) {
    existingShield.damage = Math.max(existingShield.damage, effect.amount);
    existingShield.rounds = Math.max(existingShield.rounds, effect.rounds);
  } else {
    target.statuses.push({
      name: "Shield",
      damage: effect.amount,
      rounds: effect.rounds,
      maxRounds: effect.rounds,
      removable: true,
    });
  }
  messages.push(
    `  ${target.num} gains Shield ${effect.amount} for ${effect.rounds} rounds.`,
  );
}

function* handleDisplacement(
  { game, user, target, messages }: EffectCtx,
  effect: Displacement,
) {
  const source = effect.type === "push"
    ? effect.toward === "user"
      ? user.pos
      : target.pos
    : user.pos;
  const { moved, path } = effect.type === "push"
    ? pushEntity(game, target, source, effect.amount ?? 1)
    : pullEntity(game, target, source, effect.amount ?? 1);
  if (moved > 0) {
    const pathStr = path.map((p) => `${p[0]},${p[1]}`).join(" -> ");
    messages.push(
      `  ${target.num} ${effect.type === "push" ? "pushed" : "pulled"} ${moved} tile${moved > 1 ? "s" : ""} to ${pathStr}.`,
    );
  } else {
    messages.push(`  ${target.num} could not be ${effect.type === "push" ? "pushed" : "pulled"}.`);
  }
}

function* handleSwap(
  { user, target, messages }: EffectCtx,
  _effect: Displacement,
) {
  const tmpPos = [...user.pos] as [number, number];
  user.pos = [...target.pos] as [number, number];
  target.pos = tmpPos;
  messages.push(
    `  ${user.num} and ${target.num} swap positions -> ${user.num} at ${user.pos[0]},${user.pos[1]}, ${target.num} at ${target.pos[0]},${target.pos[1]}.`,
  );
}

function* handleSimple(
  { user, messages }: EffectCtx,
  effect: any,
) {
  switch (effect.type) {
    case "teleport":
      messages.push(
        `  ${user.num} teleports${effect.range ? ` to ${effect.range}` : ""}. (Teleport resolution needed — host pick a valid tile)`,
      );
      return;
    case "move":
      messages.push(
        `  ${user.num} moves up to ${effect.amount} tiles. (Movement resolution needed — host pick a valid tile)`,
      );
      return;
    case "resource":
      messages.push(`  ${user.num} ${effect.action} ${effect.amount} ${effect.resource}.`);
      return;
    case "delay":
      messages.push(`  Delay ${effect.rounds} round${effect.rounds > 1 ? "s" : ""} applied.`);
      return;
    case "ignore":
      messages.push(`  Ignores ${effect.what}.`);
      return;
    case "channel":
      messages.push(`  Channeling ${effect.stat.toUpperCase()} for ${effect.rounds} rounds.`);
      return;
    case "phase":
      messages.push(`  Phase shifts to ${effect.phase}.`);
      return;
    case "multiHit":
      messages.push(`  Attack gains +${effect.hits - 1} additional hits.`);
      return;
    case "recoil":
      // Recoil damage itself is applied in resolve.ts after on-hit damage
      // is dealt. Here we just announce the marker so the log is readable.
      messages.push(`  ${user.num} takes ${effect.percent}% recoil on damage dealt.`);
      return;
    case "tile":
      messages.push(
        `  ${user.num} attempts to place terrain. (Tile placement needed — pick a tile within ${effect.range} range)`,
      );
      return;
    case "unknown":
      messages.push(`  ${effect.text}`);
      return;
    default:
      return;
  }
}

function* handleConditional(
  { game, user, target, ability, messages }: EffectCtx,
  effect: ConditionalEffect,
) {
  const { outcome, messages: condMsgs } = applyConditional(user, target, effect);
  messages.push(...condMsgs);
  // "unknown" defaults to then-branch (legacy fallback). "else" without
  // an else-branch drops the sub-effects entirely.
  if (outcome === "then" || outcome === "unknown") {
    const thenMsgs = yield* applyEffectStream(game, user, target, effect.thenEffects, ability);
    messages.push(...thenMsgs.map((m) => `    ${m}`));
  }
  if (outcome === "else" && effect.elseEffects) {
    const elseMsgs = yield* applyEffectStream(game, user, target, effect.elseEffects, ability);
    messages.push(...elseMsgs.map((m) => `    ${m}`));
  }
}

function* handleThirst(
  { game, user, target, ability, messages }: EffectCtx,
  effect: ThirstEffect,
) {
  if (!isThirstActive(user, effect)) {
    messages.push(
      `  [Thirst ${effect.threshold}] inactive (Blood ${user.resources.blood ?? 0} < ${effect.threshold}).`,
    );
    return;
  }
  const thirstMsgs = yield* applyEffectStream(game, user, target, effect.effects, ability);
  messages.push(...thirstMsgs.map((m) => `    [Thirst ${effect.threshold}] ${m}`));
}

function* handleApex(
  { game, user, target, ability, messages }: EffectCtx,
  effect: ApexEffect,
) {
  if (!ability) {
    messages.push(`  [Apex] -- cannot evaluate without ability context.`);
    return;
  }
  if (!isApexActive(game, user, target, ability)) {
    messages.push(`  [Apex] inactive (target not at max listed range of ${ability.range}).`);
    return;
  }
  const apexMsgs = yield* applyEffectStream(game, user, target, effect.effects, ability);
  messages.push(...apexMsgs.map((m) => `    [Apex] ${m}`));
}

function* handleChoose(
  { game, user, target, ability, messages }: EffectCtx,
  effect: ChooseEffect,
) {
  // Yield a prompt. Resolve.ts feeds back the chosen option id and we
  // recurse into the chosen branch's sub-effects through the stream so any
  // nested APEX/THIRST/CHOICE inside the chosen branch also gets prompted.
  const clauseId = `choose-${messages.length}`;
  const chosenId = yield {
    kind: "choose",
    clauseId,
    message: `Choose one option for the effect`,
    options: effect.options.map((opts, i) => ({
      id: `${clauseId}:${i}`,
      label: opts.length
        ? opts.map((o) => summariseEffect(o)).join("; ")
        : `Option ${i + 1}`,
    })),
  } satisfies EffectChoosePrompt;
  const idx = parseChosenIdx(chosenId, effect.options.length);
  messages.push(`  [Choose] user picked option ${idx + 1}.`);
  const chosenMsgs = yield* applyEffectStream(game, user, target, effect.options[idx], ability);
  messages.push(...chosenMsgs.map((m) => `    ${m}`));
}

/** Dispatch an effect of any type to its handler. */
const EFFECT_HANDLERS: Record<string, EffectHandler> = {
  status: handleStatus,
  buff: handleStatMod,
  debuff: handleStatMod,
  damageMod: handleDamageMod,
  heal: handleHeal,
  shield: handleShield,
  push: handleDisplacement,
  pull: handleDisplacement,
  swap: handleSwap,
  conditional: handleConditional,
  thirst: handleThirst,
  apex: handleApex,
  choose: handleChoose,
  teleport: handleSimple,
  move: handleSimple,
  resource: handleSimple,
  delay: handleSimple,
  ignore: handleSimple,
  channel: handleSimple,
  phase: handleSimple,
  multiHit: handleSimple,
  recoil: handleSimple,
  tile: handleSimple,
  unknown: handleSimple,
};

export function* applyEffectStream(
  game: Game,
  user: Entity,
  target: Entity,
  effects: Effect[],
  ability?: AbilityData,
): Generator<EffectChoosePrompt, string[], string> {
  const messages: string[] = [];
  const ctx: EffectCtx = { game, user, target, ability, messages };

  for (const effect of effects) {
    const handler = EFFECT_HANDLERS[effect.type];
    if (handler) {
      yield* handler(ctx, effect);
    } else {
      // No registered handler: surface the raw clause text.
      messages.push(`  ${(effect as { text?: string }).text ?? ""}`);
    }
  }

  return messages;
}

/**
 * Drain an `applyEffectStream` generator without ever yielding. Used by the
 * sync `applyEffects` wrapper to evaluate gating clauses (Apex/Thirst) and
 * the Choose fan-out fallback. For Choose specifically we expand all options
 * -- this matches the legacy "fan out" log and lets unit tests assert on the
 * output without driving interaction.
 */
function drainApplyStream(
  gen: Generator<EffectChoosePrompt, string[], string>,
): string[] {
  const messages: string[] = [];
  while (true) {
    const step = gen.next(undefined);
    if (step.done) {
      messages.push(...step.value);
      break;
    }
    const prompt = step.value as EffectChoosePrompt;
    if (prompt.kind === "choose") {
      messages.push(`  [Choose one] -- player selection NOT YET INTERACTIVE.`);

      // Fan-out fallback: list each option's summarised sub-effects, then
      // stop driving. The real implementation gets driven from resolve.ts
      // via applyEffectStream, which is the path this PR is building toward.
      for (let i = 0; i < prompt.options.length; i++) {
        messages.push(`    Option ${i + 1}: ${prompt.options[i].label}`);
      }
      break;
    }
  }
  return messages;
}

function summariseEffect(eff: Effect): string {
  const fn = SUMMARISE[eff.type];
  return fn ? fn(eff as any) : "";
}

/** Per-effect-type one-line summary, used in choose-prompt option labels. */
const SUMMARISE: Record<string, (eff: any) => string> = {
  status: (e) => `inflict ${e.damage || 0} ${e.name}/${e.rounds}`,
  buff: (e) => `+${e.amount} ${e.stat}${e.rounds ? `/${e.rounds}` : ""}`,
  debuff: (e) => `${e.amount} ${e.stat}${e.rounds ? `/${e.rounds}` : ""}`,
  heal: (e) => `heal ${e.amount ?? "?"} HP`,
  shield: (e) => `Shield ${e.amount}/${e.rounds}`,
  push: (e) => `push ${e.amount ?? 1}`,
  pull: (e) => `pull ${e.amount ?? 1}${e.toward === "user" ? " toward user" : ""}`,
  swap: () => "swap positions",
  teleport: (e) => `teleport${e.range ? ` to ${e.range}` : ""}`,
  move: (e) => `move up to ${e.amount}`,
  resource: (e) => `${e.action} ${e.amount} ${e.resource}`,
  damageMod: (e) => `${e.percent ?? ""}${e.flat != null ? e.flat + " DMG" : ""}`,
  delay: (e) => `delay ${e.rounds}r`,
  recoil: (e) => `recoil ${e.percent}%`,
  ignore: (e) => `ignore ${e.what}`,
  channel: (e) => `channel ${e.stat} for ${e.rounds}r`,
  phase: (e) => `phase ${e.phase}`,
  multiHit: (e) => `multi-hit ${e.hits}`,
  apex: () => "apex (...)",
  thirst: (e) => `thirst ${e.threshold} (...)`,
  choose: () => "choose (...)",
  conditional: (e) => `if [${e.condition}]`,
  delayLand: () => "delay attacks always land",
  unknown: (e) => e.text.slice(0, 40),
};

function parseChosenIdx(chosenId: string, total: number): number {
  const m = chosenId.match(/:(\d+)$/);
  if (!m) return 0;
  const idx = parseInt(m[1], 10);
  if (idx < 0 || idx >= total) return 0;
  return idx;
}

// ---------------------------------------------------------------------------
// Combat metadata
// ---------------------------------------------------------------------------
//
// The damage pipeline in resolve.ts only consults a few parsed effect types:
//   - DamageMod   ("+50% damage", "10 DMG", "+30% healing")
//   - MultiHit    ("Multi-Hit: N") -- rolls N-1 extra accuracy/damage pairs
//   - Ignore      ("Ignores DEF", "Ignores half DEF", "Ignores ATK/MAG",
//                  "Ignores outside damage factors", ...)
//   - Buff / Debuff on stat: "dmg"  -- emitted by parseStatMods for
//                  "+50% damage" / "+5 DMG" / "-10% damage" clauses.
//                  These arrive here because the regex matches "damage"
//                  as a stat name and folds it onto the dmg alias.
//
// Note: Apex / Thirst / Conditional / Choose are intentionally NOT
// descended into. Each of their sub-effects runs only on a successful
// gate. Walking them would over-apply e.g. "Apex: +50% damage" at all
// ranges. The resolve layer re-evaluates any per-target buff or status
// during applyEffectStream and the sub-effect's buff lands on
// target.buffs / statuses with the correct lifecycle.
export interface CombatMetadata {
  /**
   * Additive damagePercent bonus. Combat math treats a +50% and a +25%
   * clause together as +75% (NOT a multiplicative +1.5 * +1.25), matching
   * BD 4.4's additive stacking rule for "outside factors".
   */
  damagePercent: number;
  /**
   * Additive flat damage bonus per hit, drawn from "+N DMG" clauses.
   * "+N DMG/M" round-limited clauses still contribute the current
   * buff's amount once -- the resolve layer applies them through the
   * buff path (target.buffs.amount) so the round countdown lives on
   * the entity.buffs lifecycle.
   */
  flatDamage: number;
  /**
   * Number of EXTRA accuracy+damage passes beyond the base hit.
   * `Multi-Hit: N` -> additionalHits = N-1. Combined with the existing
   * parseMultiHit() helper (which reads "Double Hit" / "Triple Hit"
   * keywords in the roll field) the engine uses `baseHitCount =
   * max(rollBased, 1 + metaAddition)` per target.
   */
  additionalHits: number;
  ignore: CombatIgnoreMetadata;
}

export interface CombatIgnoreMetadata {
  /** "Ignores ATK/MAG" -- userOff becomes 0 (damage from dice only). */
  atkMag: boolean;
  /** Plain "Ignores DEF" -- target defensive stat becomes 0. */
  def: boolean;
  /** "Ignores 1/2 DEF" -- target defensive stat is halved (floor). */
  halfDef: boolean;
  /** "Ignores 1/4 DEF" -- target defensive stat is quartered (floor). */
  quarterDef: boolean;
  /**
   * Subtract-N from the defensive stat after any fraction rule. E.g.
   * "Ignores 5 DEF" -> defReduction: 5. "Ignores DEF AND 5 DEF" -> 0 via
   * the full-zero path (def: true) so this stays 0.
   */
  defReduction: number;
  /**
   * "Ignores outside damage factors" -- reserved for the wider BD rule
   * system. We don't yet model outside damage factors, so this is
   * surfaced as a flag the log can name rather than a math input.
   */
  outsideFactors: boolean;
  /** Anything else we don't model yet, surfaced to the log. */
  other: string[];
}

export function extractCombatMetadata(effects: Effect[]): CombatMetadata {
  const out: CombatMetadata = {
    damagePercent: 0,
    flatDamage: 0,
    additionalHits: 0,
    ignore: freshIgnoreMetadata(),
  };

  // We intentionally do NOT descend into Apex, Thirst, Conditional, or
  // Choose sub-trees. All four are *gated* clauses whose sub-effects run
  // only when their gate succeeds, so any metadata extracted from their
  // children is conditional on the gate firing. resolveSingleTarget
  // re-evaluates each gate per hit and only contributes the matching
  // buff / status / sub-effect to the damage path through the existing
  // entity.buffs / statuses / extra-rolls infrastructure. Surfacing
  // gated metadata here would over-apply -- e.g. "Apex: +50% damage"
  // would otherwise turn the ability into +50% at any range.
  for (const e of effects) {
    if (e.type === "damageMod") {
      if (e.percent) out.damagePercent += e.percent;
      if (typeof e.flat === "number") out.flatDamage += e.flat;
    } else if (e.type === "multiHit") {
      out.additionalHits = Math.max(out.additionalHits, e.hits - 1);
    } else if (e.type === "ignore") {
      classifyIgnore(e.what, out.ignore);
    } else if (e.type === "buff" || e.type === "debuff") {
      // parseStatMods emits a "buff"/"debuff" with stat: "dmg" for the
      // every-day "+50% damage", "+5 DMG", "-10% damage" clauses --
      // because the regex matches "damage" / "dmg" as a stat name and
      // folds them onto the dmg alias. Those are damage modifiers, not
      // self-buffs, so the resolve layer reads them here. The
      // buff/debuff still lands on `target.buffs` so legacy code that
      // scans entity.buffs for damage modifiers keeps working too.
      if (e.stat === "dmg") {
        // parseStatMods bakes the sign into percent / amount, so a
        // debuff for "-10% damage" arrives here with percent = -10.
        if (typeof e.percent === "number") {
          out.damagePercent += e.percent;
        } else if (typeof e.amount === "number" && e.percent === undefined) {
          out.flatDamage += e.amount;
        }
      }
    }
  }
  return out;
}

function freshIgnoreMetadata(): CombatIgnoreMetadata {
  return {
    atkMag: false,
    def: false,
    halfDef: false,
    quarterDef: false,
    defReduction: 0,
    outsideFactors: false,
    other: [],
  };
}

function classifyIgnore(what: string, out: CombatIgnoreMetadata): void {
  const lower = what.toLowerCase().trim();

  if (
    /\batk\/?mag\b/.test(lower) ||
    lower === "atk" ||
    lower === "mag" ||
    lower === "magical"
  ) {
    out.atkMag = true;
    return;
  }
  if (
    lower.includes("outside damage factor") ||
    lower.includes("outside factor")
  ) {
    out.outsideFactors = true;
    return;
  }

  if (lower.includes("def")) {
    // Order matters: a fractional "1/2 DEF" / "1/4 DEF" / "half DEF" /
    // "quarter DEF" overrides a plain "5 DEF" -> the latter reads as
    // "Ignores half DEF AND 5 DEF" which means (def/2 - 5). But BD's text
    // typically gives them in a single clause. Without a clean
    // multi-clause parser we take the strongest effect (full-zero >
    // quarter > half > numeric subtract). If you see both strongest and
    // subtract in real data, file an issue and we'll revisit.
    if (lower.includes("half") || lower.includes("1/2")) {
      out.halfDef = true;
      return;
    }
    if (lower.includes("quarter") || lower.includes("1/4")) {
      out.quarterDef = true;
      return;
    }
    if (/^\s*\d+\s*$/.test(lower)) {
      out.defReduction = Math.max(out.defReduction, parseInt(lower));
      return;
    }
    const num = lower.match(/(\d+)/);
    if (num) {
      out.defReduction = Math.max(out.defReduction, parseInt(num[1]));
      return;
    }
    out.def = true;
    return;
  }

  if (lower.includes("non-target") || lower.includes("obstruction")) {
    out.other.push(what);
    return;
  }

  out.other.push(what);
}
