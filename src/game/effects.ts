import {
  type Game,
  type Entity,
  type StatusEffect,
  dealDamage,
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

  // Choose: "Choose EFFECT1 [or EFFECT2 [or EFFECT3]]"
  const chooseMatch = lower.match(/^choose\s+(?:one:\s*)?(.+)$/);
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
    const name = capitalize(slashMatch[1] ? "" : slashMatch[2]);
    const dmg = slashMatch[1] ? parseInt(slashMatch[1]) : 0;
    const rounds = parseInt(slashMatch[3]);
    const statusName = slashMatch[1] ? "" : slashMatch[2];
    if (STATUS_NAMES.includes(statusName)) {
      effects.push({
        type: "status",
        name: capitalize(statusName),
        damage: dmg,
        rounds,
      });
      return effects;
    }
    // "inflict 3X Curse/1" where X is variable
    if (STATUS_NAMES.includes(statusName)) {
      effects.push({
        type: "status",
        name: capitalize(statusName),
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

// ---------------------------------------------------------------------------
// Effect Application
// ---------------------------------------------------------------------------

export function applyEffects(
  game: Game,
  caster: Entity,
  target: Entity,
  effects: Effect[],
): string[] {
  const messages: string[] = [];

  for (const effect of effects) {
    switch (effect.type) {
      case "status": {
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
        target.buffs.push({
          stat: effect.stat,
          amount: effect.amount,
          rounds: effect.rounds ?? 1,
        });
        messages.push(
          `  ${target.num} gains +${effect.amount} ${effect.stat.toUpperCase()}${effect.rounds ? `/${effect.rounds}` : ""}.`,
        );
        break;
      }

      case "debuff": {
        target.buffs.push({
          stat: effect.stat,
          amount: effect.amount,
          rounds: effect.rounds ?? 1,
        });
        messages.push(
          `  ${target.num} loses ${effect.amount} ${effect.stat.toUpperCase()}${effect.rounds ? `/${effect.rounds}` : ""}.`,
        );
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
            `  ${caster.num} heals ${target.num}. (Manual resolution needed)`,
          );
        }
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
        messages.push(
          `  ${target.num} pushed ${effect.amount} tiles. (Push resolution needed)`,
        );
        break;
      }

      case "pull": {
        messages.push(
          `  ${target.num} pulled ${effect.amount} tiles. (Pull resolution needed)`,
        );
        break;
      }

      case "teleport": {
        messages.push(
          `  ${caster.num} teleports${effect.range ? ` to ${effect.range}` : ""}. (Teleport resolution needed)`,
        );
        break;
      }

      case "swap": {
        messages.push(`  ${caster.num} and ${target.num} swap positions.`);
        break;
      }

      case "move": {
        messages.push(
          `  ${caster.num} moves up to ${effect.amount} tiles. (Move resolution needed)`,
        );
        break;
      }

      case "resource": {
        const label = `${effect.action} ${effect.amount} ${effect.resource}`;
        messages.push(`  ${caster.num} ${label}.`);
        break;
      }

      case "delay": {
        messages.push(
          `  Delay ${effect.rounds} round${effect.rounds > 1 ? "s" : ""} applied.`,
        );
        break;
      }

      case "recoil": {
        messages.push(
          `  ${caster.num} takes ${effect.percent}% recoil on damage dealt.`,
        );
        break;
      }

      case "ignore": {
        messages.push(`  Ignores ${effect.what}.`);
        break;
      }

      case "multiHit": {
        messages.push(`  Attack gains +${effect.hits - 1} additional hits.`);
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

      case "conditional": {
        messages.push(
          `  [Conditional: ${effect.condition}] -- needs evaluation.`,
        );
        const thenMsgs = applyEffects(game, caster, target, effect.thenEffects);
        messages.push(...thenMsgs.map((m) => `    ${m}`));
        if (effect.elseEffects) {
          messages.push(`  [Otherwise]`);
          const elseMsgs = applyEffects(
            game,
            caster,
            target,
            effect.elseEffects,
          );
          messages.push(...elseMsgs.map((m) => `    ${m}`));
        }
        break;
      }

      case "thirst": {
        messages.push(
          `  [Thirst ${effect.threshold}] -- needs threshold evaluation.`,
        );
        const thirstMsgs = applyEffects(game, caster, target, effect.effects);
        messages.push(...thirstMsgs.map((m) => `    ${m}`));
        break;
      }

      case "apex": {
        messages.push(`  [Apex] -- needs max-range evaluation.`);
        const apexMsgs = applyEffects(game, caster, target, effect.effects);
        messages.push(...apexMsgs.map((m) => `    ${m}`));
        break;
      }

      case "choose": {
        messages.push(`  [Choose one] -- requires player selection.`);
        for (let i = 0; i < effect.options.length; i++) {
          messages.push(`    Option ${i + 1}:`);
          const optMsgs = applyEffects(game, caster, target, effect.options[i]);
          messages.push(...optMsgs.map((m) => `      ${m}`));
        }
        break;
      }

      case "unknown": {
        messages.push(`  ${effect.text}`);
        break;
      }
    }
  }

  return messages;
}
