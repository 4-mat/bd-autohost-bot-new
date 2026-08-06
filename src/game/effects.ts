import {
  type Game,
  type Entity,
  type AbilityData,
  type StatusEffect,
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

export function parseEffects(text: string): Effect[] {
  if (!text || !text.trim()) return [];

  const normalized = text
    .replace(/\n/g, " ")
    .replace(/\\\\n/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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
  const effects: Effect[] = [];

  // Conditional: "If CONDITION, EFFECT [Otherwise, EFFECT]"
  const ifMatch = lower.match(
    /^if\s+(.+?),\s*(.+?)(?:\s+otherwise,?\s*(.+))?$/,
  );
  if (ifMatch) {
    const thenEffects = parseEffects(ifMatch[2]);
    const elseEffects = ifMatch[3] ? parseEffects(ifMatch[3]) : undefined;
    effects.push({
      type: "conditional",
      condition: ifMatch[1].trim(),
      thenEffects,
      elseEffects,
    });
    return effects;
  }

  // Thirst: "Thirst N: EFFECT"
  const thirstMatch = lower.match(/^thirst\s+(\d+):\s*(.+)$/);
  if (thirstMatch) {
    effects.push({
      type: "thirst",
      threshold: parseInt(thirstMatch[1]),
      effects: parseEffects(thirstMatch[2]),
    });
    return effects;
  }

  // Apex: "Apex: EFFECT"
  const apexMatch = lower.match(/^apex:\s*(.+)$/);
  if (apexMatch) {
    effects.push({
      type: "apex",
      effects: parseEffects(apexMatch[1]),
    });
    return effects;
  }

  // Choose: "Choose: EFFECT1 [or EFFECT2 [or EFFECT3]]" or "Choose EFFECT1 or EFFECT2".
  // Optional colon + "one" prefix to match real glossary variants.
  const chooseMatch = lower.match(/^choose\s*:?\s+(?:one:\s*)?(.+)$/);
  if (chooseMatch) {
    const options = chooseMatch[1]
      .split(/\s+or\s+/)
      .map((o) => parseEffects(o.trim()))
      .filter((o) => o.length > 0);
    if (options.length > 0) {
      effects.push({ type: "choose", options });
      return effects;
    }
  }

  // Channel: "Channel STAT for N rounds"
  const channelMatch = lower.match(
    /^channel\s+(\w+)(?:\s+for\s+(\d+)\s+rounds?)?$/,
  );
  if (channelMatch) {
    effects.push({
      type: "channel",
      stat: channelMatch[1],
      rounds: channelMatch[2] ? parseInt(channelMatch[2]) : 1,
    });
    return effects;
  }

  // Phase: "Phase: PHASE_NAME"
  const phaseMatch = lower.match(
    /^phase:\s*(new moon|waxing|full moon|waning)$/,
  );
  if (phaseMatch) {
    effects.push({ type: "phase", phase: phaseMatch[1] });
    return effects;
  }

  // Delay: "Delay N rounds" or "Delay-N"
  const delayMatch = lower.match(/^delay[\s-]+(\d+)\s+rounds?$/);
  if (delayMatch) {
    effects.push({ type: "delay", rounds: parseInt(delayMatch[1]) });
    return effects;
  }

  // Recoil: "Recoil N%"
  const recoilMatch = lower.match(/^recoil\s+(\d+)%$/);
  if (recoilMatch) {
    effects.push({ type: "recoil", percent: parseInt(recoilMatch[1]) });
    return effects;
  }

  // Ignore: "Ignore(s) X"
  const ignoreMatch = lower.match(/^ignores?\s+(?:non-\w+\s+)?(.+?)\.?$/);
  if (ignoreMatch) {
    effects.push({ type: "ignore", what: ignoreMatch[1].trim() });
    return effects;
  }

  // Multi-hit from dice: "Multi-Hit: N" or "becomes Multi-Hit: N"
  const multiHitMatch = lower.match(/multi[\s-]hit[:\s]+(\d+)/);
  if (multiHitMatch) {
    effects.push({ type: "multiHit", hits: parseInt(multiHitMatch[1]) });
    return effects;
  }

  // Delay-land: "Delay attacks always land" or "Delay-N" already handled above
  // Handle "Delay-1. May delay up to +2 more turns." as just delay
  const delaySimple = lower.match(/^delay-?(\d+)$/);
  if (delaySimple) {
    effects.push({ type: "delay", rounds: parseInt(delaySimple[1]) });
    return effects;
  }

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

  // Fallback: unknown
  effects.push({ type: "unknown", text: clause });
  return effects;
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

  switch (type) {
    case "burst":
      return ch === max;
    case "range":
    case "homing":
    case "star":
      return mh === max;
    case "pierce":
    case "line": {
      if (cardinal) return mh === max;
      if (diagonal) return absDr === Math.ceil(max / 2);
      return false;
    }
    case "cone": {
      if (absDr > absDc) return absDr === max;
      if (absDc > absDr) return absDc === max;
      return false;
    }
    case "beam": {
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
    }
  }
  return false;
}

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
export function* applyEffectStream(
  game: Game,
  user: Entity,
  target: Entity,
  effects: Effect[],
  ability?: AbilityData,
): Generator<EffectChoosePrompt, string[], string> {
  const messages: string[] = [];

  for (const effect of effects) {
    switch (effect.type) {
      case "status": {
        const hasShield = target.statuses.some(
          (s) => toId(s.name) === "shield",
        );
        if (hasShield && effect.damage === 0) {
          messages.push(`  ${target.num}'s Shield blocks ${effect.name}!`);
          break;
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
        break;
      }

      case "buff": {
        if (effect.percent) {
          const baseStat = getBaseStat(target, effect.stat);
          const amount = Math.floor(baseStat * (effect.percent / 100));
          target.buffs.push({
            stat: effect.stat,
            amount,
            rounds: effect.rounds ?? 1,
          });
          messages.push(
            `  ${target.num} gains +${effect.percent}% ${effect.stat.toUpperCase()} (+${amount})${effect.rounds ? `/${effect.rounds}` : ""}.`,
          );
        } else {
          target.buffs.push({
            stat: effect.stat,
            amount: effect.amount,
            rounds: effect.rounds ?? 1,
          });
          messages.push(
            `  ${target.num} gains +${effect.amount} ${effect.stat.toUpperCase()}${effect.rounds ? `/${effect.rounds}` : ""}.`,
          );
        }
        break;
      }

      case "debuff": {
        if (effect.percent) {
          const baseStat = getBaseStat(target, effect.stat);
          const amount = -Math.floor(
            baseStat * (Math.abs(effect.percent) / 100),
          );
          target.buffs.push({
            stat: effect.stat,
            amount,
            rounds: effect.rounds ?? 1,
          });
          messages.push(
            `  ${target.num} loses ${effect.percent}% ${effect.stat.toUpperCase()} (${amount})${effect.rounds ? `/${effect.rounds}` : ""}.`,
          );
        } else {
          target.buffs.push({
            stat: effect.stat,
            amount: effect.amount,
            rounds: effect.rounds ?? 1,
          });
          messages.push(
            `  ${target.num} loses ${effect.amount} ${effect.stat.toUpperCase()}${effect.rounds ? `/${effect.rounds}` : ""}.`,
          );
        }
        break;
      }

      case "damageMod": {
        const label = effect.percent
          ? `${effect.percent > 0 ? "+" : ""}${effect.percent}% damage`
          : `${effect.flat! > 0 ? "+" : ""}${effect.flat} DMG`;
        messages.push(
          `  ${target.num} ${label}${effect.rounds ? `/${effect.rounds}` : ""}.`,
        );
        break;
      }

      case "heal": {
        if (effect.amount) {
          const prev = target.curhp;
          target.curhp = Math.min(target.maxhp, target.curhp + effect.amount);
          const healed = target.curhp - prev;
          messages.push(
            `  ${target.num} healed for ${healed} HP (${target.curhp}/${target.maxhp}).`,
          );
        } else {
          messages.push(
            `  ${user.num} heals ${target.num}. (Manual resolution needed)`,
          );
        }
        break;
      }

      case "teleport": {
        messages.push(
          `  ${user.num} teleports${effect.range ? ` to ${effect.range}` : ""}. (Teleport resolution needed — host pick a valid tile)`,
        );
        break;
      }

      case "move": {
        messages.push(
          `  ${user.num} moves up to ${effect.amount} tiles. (Movement resolution needed — host pick a valid tile)`,
        );
        break;
      }

      case "resource": {
        messages.push(
          `  ${user.num} ${effect.action} ${effect.amount} ${effect.resource}.`,
        );
        break;
      }

      case "delay": {
        messages.push(
          `  Delay ${effect.rounds} round${effect.rounds > 1 ? "s" : ""} applied.`,
        );
        break;
      }

      case "ignore": {
        messages.push(`  Ignores ${effect.what}.`);
        break;
      }

      case "channel": {
        messages.push(
          `  Channeling ${effect.stat.toUpperCase()} for ${effect.rounds} rounds.`,
        );
        break;
      }

      case "phase": {
        messages.push(`  Phase shifts to ${effect.phase}.`);
        break;
      }

      case "unknown": {
        messages.push(`  ${effect.text}`);
        break;
      }

      case "shield": {
        const existingShield = target.statuses.find((s) => s.name === "Shield");
        if (existingShield) {
          existingShield.damage = Math.max(
            existingShield.damage,
            effect.amount,
          );
          existingShield.rounds = Math.max(
            existingShield.rounds,
            effect.rounds,
          );
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
        break;
      }

      case "push": {
        const pushSource = effect.toward === "user" ? user.pos : target.pos;
        const { moved: pushMoved, path: pushPath } = pushEntity(
          game,
          target,
          pushSource,
          effect.amount ?? 1,
        );
        if (pushMoved > 0) {
          const pathStr = pushPath.map((p) => `${p[0]},${p[1]}`).join(" -> ");
          messages.push(
            `  ${target.num} pushed ${pushMoved} tile${pushMoved > 1 ? "s" : ""} to ${pathStr}.`,
          );
        } else {
          messages.push(`  ${target.num} could not be pushed.`);
        }
        break;
      }

      case "pull": {
        const { moved: pullMoved, path: pullPath } = pullEntity(
          game,
          target,
          user.pos,
          effect.amount ?? 1,
        );
        if (pullMoved > 0) {
          const pathStr = pullPath.map((p) => `${p[0]},${p[1]}`).join(" -> ");
          messages.push(
            `  ${target.num} pulled ${pullMoved} tile${pullMoved > 1 ? "s" : ""} to ${pathStr}.`,
          );
        } else {
          messages.push(`  ${target.num} could not be pulled.`);
        }
        break;
      }

      case "swap": {
        const tmpPos = [...user.pos] as [number, number];
        user.pos = [...target.pos] as [number, number];
        target.pos = tmpPos;
        messages.push(
          `  ${user.num} and ${target.num} swap positions -> ${user.num} at ${user.pos[0]},${user.pos[1]}, ${target.num} at ${target.pos[0]},${target.pos[1]}.`,
        );
        break;
      }

      case "multiHit": {
        messages.push(`  Attack gains +${effect.hits - 1} additional hits.`);
        break;
      }

      case "recoil": {
        // Recoil damage itself is applied in resolve.ts after on-hit damage
        // is dealt. Here we just announce the marker so the log is readable.
        messages.push(
          `  ${user.num} takes ${effect.percent}% recoil on damage dealt.`,
        );
        break;
      }

      case "conditional": {
        // The conditional-gating logic is owned by a future PR. For now we
        // always fall through to the then-branch and let nested gating
        // (Apex/Thirst/Choose) keep evaluating via the stream.
        messages.push(
          `  [Conditional: ${effect.condition}] -- condition evaluation TODO.`,
        );
        const thenMsgs = yield* applyEffectStream(
          game,
          user,
          target,
          effect.thenEffects,
          ability,
        );
        messages.push(...thenMsgs.map((m) => `    ${m}`));
        if (effect.elseEffects) {
          messages.push(`  [Otherwise]`);
          const elseMsgs = yield* applyEffectStream(
            game,
            user,
            target,
            effect.elseEffects,
            ability,
          );
          messages.push(...elseMsgs.map((m) => `    ${m}`));
        }
        break;
      }

      case "thirst": {
        if (!isThirstActive(user, effect)) {
          messages.push(
            `  [Thirst ${effect.threshold}] inactive (Blood ${user.resources.blood ?? 0} < ${effect.threshold}).`,
          );
          break;
        }
        const thirstMsgs = yield* applyEffectStream(
          game,
          user,
          target,
          effect.effects,
          ability,
        );
        messages.push(
          ...thirstMsgs.map((m) => `    [Thirst ${effect.threshold}] ${m}`),
        );
        break;
      }

      case "apex": {
        if (!ability) {
          messages.push(`  [Apex] -- cannot evaluate without ability context.`);
          break;
        }
        if (!isApexActive(game, user, target, ability)) {
          messages.push(
            `  [Apex] inactive (target not at max listed range of ${ability.range}).`,
          );
          break;
        }
        const apexMsgs = yield* applyEffectStream(
          game,
          user,
          target,
          effect.effects,
          ability,
        );
        messages.push(...apexMsgs.map((m) => `    [Apex] ${m}`));
        break;
      }

      case "choose": {
        // Yield a prompt. Resolve.ts feeds back the chosen option id and
        // we recurse into the chosen branch's sub-effects through the stream
        // so any nested APEX/THIRST/CHOICE inside the chosen branch also
        // gets prompted.
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
        const chosenMsgs = yield* applyEffectStream(
          game,
          user,
          target,
          effect.options[idx],
          ability,
        );
        messages.push(...chosenMsgs.map((m) => `    ${m}`));
        break;
      }
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
  switch (eff.type) {
    case "status":
      return `inflict ${eff.damage || 0} ${eff.name}/${eff.rounds}`;
    case "buff":
      return `+${eff.amount} ${eff.stat}${eff.rounds ? `/${eff.rounds}` : ""}`;
    case "debuff":
      return `${eff.amount} ${eff.stat}${eff.rounds ? `/${eff.rounds}` : ""}`;
    case "heal":
      return `heal ${eff.amount ?? "?"} HP`;
    case "shield":
      return `Shield ${eff.amount}/${eff.rounds}`;
    case "push":
      return `push ${eff.amount ?? 1}`;
    case "pull":
      return `pull ${eff.amount ?? 1}${eff.toward === "user" ? " toward user" : ""}`;
    case "swap":
      return "swap positions";
    case "teleport":
      return `teleport${eff.range ? ` to ${eff.range}` : ""}`;
    case "move":
      return `move up to ${eff.amount}`;
    case "resource":
      return `${eff.action} ${eff.amount} ${eff.resource}`;
    case "damageMod":
      return `${eff.percent ?? ""}${eff.flat != null ? eff.flat + " DMG" : ""}`;
    case "delay":
      return `delay ${eff.rounds}r`;
    case "recoil":
      return `recoil ${eff.percent}%`;
    case "ignore":
      return `ignore ${eff.what}`;
    case "channel":
      return `channel ${eff.stat} for ${eff.rounds}r`;
    case "phase":
      return `phase ${eff.phase}`;
    case "multiHit":
      return `multi-hit ${eff.hits}`;
    case "apex":
      return "apex (...)";
    case "thirst":
      return `thirst ${eff.threshold} (...)`;
    case "choose":
      return "choose (...)";
    case "conditional":
      return `if [${eff.condition}]`;
    case "delayLand":
      return "delay attacks always land";
    case "unknown":
      return eff.text.slice(0, 40);
  }
}

function parseChosenIdx(chosenId: string, total: number): number {
  const m = chosenId.match(/:(\d+)$/);
  if (!m) return 0;
  const idx = parseInt(m[1], 10);
  if (idx < 0 || idx >= total) return 0;
  return idx;
}
