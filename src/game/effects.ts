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
  MOON_PHASE_CYCLE,
  formatPhase,
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

/** "No Phase shift next turn" / "User's Phase disabled next turn" (Harvest Moon / Celestial Blessing). */
export interface SkipPhaseShiftEffect {
  type: "skipPhaseShift";
}

/** "Choose another Phase (doesn't shift)" (Far Side of the Moon) -- prompts for a second phase. */
export interface ChoosePhaseEffect {
  type: "choosePhase";
}

/** "+N Range" (Lunar Phase New Moon) -- extends the user's ability ranges. */
export interface RangeModEffect {
  type: "rangeMod";
  amount: number;
}

/** "-N dice on attacks targeting user" (Lunar Phase Full Moon) -- defender-side. */
export interface TargetingDiceModEffect {
  type: "targetingDiceMod";
  amount: number;
}

/**
 * "Two effects if user has 2 Phases" (Fatal Moonlight) -- marker. The actual
 * double application is driven by evaluateCondition: while the user holds a
 * chosen 2nd phase (entity.phaseChoice), every "phase is X" branch whose
 * phase matches the current *or* chosen phase fires, so two phase effects
 * land.
 */
export interface DoubleEffectsEffect {
  type: "doubleEffects";
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

export interface PerEffect {
  type: "per";
  trigger: string;
  effects: Effect[];
}

export interface TriggerEffect {
  type: "trigger";
  event: string;
  effects: Effect[];
}

export type PhaseTiming = "before-acc" | "before-damage" | "on-miss" | "regardless";

export interface RequiresEffect {
  type: "requires";
  weapons: string[]; // gladius / scutum / pilum
}

export interface SwitchWeaponEffect {
  type: "switchWeapon";
  to: string[]; // gladius / scutum / pilum -- >1 when the player may pick
}

export interface CritModEffect {
  type: "critMod";
  threshold: number;
}

export interface DiceModEffect {
  type: "diceMod";
  kind: "dice" | "diceFaces" | "baseDice";
  amount: number;
  rounds?: number;
}

export interface MrModEffect {
  type: "mrMod";
  amount: number;
  rounds?: number;
}

export interface PhaseTimingEffect {
  type: "phaseEffect";
  phase: PhaseTiming;
  effects: Effect[];
}

export interface OnMissEffect {
  type: "onMiss";
  effects: Effect[];
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
  | SkipPhaseShiftEffect
  | ChoosePhaseEffect
  | RangeModEffect
  | TargetingDiceModEffect
  | DoubleEffectsEffect
  | DelayLandEffect
  | MultiHitMod
  | TileEffect
  | PerEffect
  | TriggerEffect
  | PhaseTimingEffect
  | OnMissEffect
  | RequiresEffect
  | SwitchWeaponEffect
  | CritModEffect
  | DiceModEffect
  | MrModEffect
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

/** Gladius-class subweapons referenced by "Requires X" / "Switch to X" / "X: EFFECT" clauses. */
const SUBWEAPONS = ["gladius", "scutum", "pilum"] as const;

/**
 * Canonicalize any subweapon value ("Gladius", " PILUM ", garbage, undefined)
 * into the lowercase engine id ("gladius" | "scutum" | "pilum"), or undefined
 * when it isn't a known subweapon. Every reader that compares an entity's
 * equipped subweapon should route through this so the id forms always agree.
 */
export function normalizeSubweapon(
  value: string | undefined | null,
): string | undefined {
  const id = toId(value ?? "");
  return (SUBWEAPONS as readonly string[]).includes(id) ? id : undefined;
}

/**
 * Canonical display form for a subweapon value ("Pilum" / "pi-lum" ->
 * "Pilum"). Empty string for invalid/absent values, so stale restored state
 * never renders raw.
 */
export function formatSubweapon(s?: string): string {
  const n = normalizeSubweapon(s);
  if (!n) return "";
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/**
 * Splits a subweapon list like "Gladius or Pilum" / "Scutum" into canonical
 * lowercase ids, ignoring anything that isn't a known subweapon.
 */
function parseSubweaponList(text: string): string[] {
  return text
    .split(/\s+(?:or|and)\s+|\s*,\s*/)
    .map((w) => normalizeSubweapon(w))
    .filter((w): w is string => !!w);
}

/**
 * Collect the subweapons required by an ability's effect text ("Requires
 * Pilum" / "Requires Gladius or Scutum"). Returns [] when the effect has
 * no `requires` clause. Command/resolve layers use this to gate abilities
 * the user's equipped subweapon doesn't satisfy.
 */
export function requiredSubweapons(effect: string): string[] {
  const required: string[] = [];
  for (const e of parseEffects(effect)) {
    if (e.type === "requires") {
      for (const w of e.weapons) {
        if (!required.includes(w)) required.push(w);
      }
    }
  }
  return required;
}

/**
 * Memoization for parseEffects. Ability effect strings are static game
 * data, so the same normalized text always parses to the same Effect[].
 * Targeting/UI hot paths (getPassiveRangeBonus / getDefenderDiceMods via
 * inRange, plus every resolveAttackFlow attack) re-parse the same passive
 * and ability strings repeatedly -- caching avoids that work. Effect trees
 * are treated as immutable by every caller (they only read / fold / apply
 * them), so sharing the cached array is safe.
 */
// Assumes ability effect text is static game data (abilities.json / glossary
// CSVs), so a bounded process-lifetime cache is safe and never needs clearing.
const PARSE_EFFECTS_CACHE = new Map<string, Effect[]>();
const PARSE_EFFECTS_CACHE_MAX = 2048;

function cachedParseEffects(normalized: string): Effect[] {
  const hit = PARSE_EFFECTS_CACHE.get(normalized);
  if (hit) return hit;
  const parsed = parseEffectsUncached(normalized);
  if (PARSE_EFFECTS_CACHE.size >= PARSE_EFFECTS_CACHE_MAX) {
    // Bounded cache: drop the oldest entry (Map preserves insertion order).
    const oldest = PARSE_EFFECTS_CACHE.keys().next().value;
    if (oldest !== undefined) PARSE_EFFECTS_CACHE.delete(oldest);
  }
  PARSE_EFFECTS_CACHE.set(normalized, parsed);
  return parsed;
}

export function parseEffects(text: string): Effect[] {
  if (!text || !text.trim()) return [];

  const normalized = text
    .replace(/\n/g, " ")
    .replace(/\\\\n/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cachedParseEffects(normalized);
}

function parseEffectsUncached(normalized: string): Effect[] {
  // "On Miss: <effects>" wraps subsequent effects so they only fire
  // when the attack misses.  The prefix is case-insensitive and may
  // appear at the start of the entire ability text.
  const lowerFull = normalized.toLowerCase();
  const onMissMatch = lowerFull.match(/^on\s+miss:\s*(.+)$/i);
  if (onMissMatch) {
    const inner = parseEffects(onMissMatch[1].trim());
    return [{ type: "onMiss", effects: inner }];
  }

  // Conditional statements span multiple splitClauses pieces, so try the
  // whole normalized text as a single conditional effect first. If the WHOLE
  // input is an `If CONDITION, EFFECT [Otherwise, EFFECT]` statement, return
  // one effect rather than splitting on the inner period and losing context.
  // The regex tolerates either ", " or ". " before "Otherwise", and an
  // optional trailing period at the end of the else-branch.
  const fullIfMatch = lowerFull.match(
    /^if\s+(.+?)[,:]\s*(.+?)(?:[.,]?\s+otherwise,?\s*(.+?))?[.,]?$/,
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
    const c = clause.trim();
    // Standalone "Otherwise: EFFECT" / "Otherwise, EFFECT" continues the
    // PREVIOUS conditional as its else-branch (Blood Moon / Harvest Moon
    // style "New/Full Moon: X. Otherwise: Y." pairings). A bare "Otherwise"
    // with no preceding conditional falls through to parseClause and is
    // surfaced as unknown rather than silently dropped.
    const otherwiseMatch = c.toLowerCase().match(/^otherwise,?\s*:?\s*(.+)$/);
    if (otherwiseMatch) {
      const prev = effects[effects.length - 1];
      // Never clobber an else-branch a conditional may already carry (a
      // second "Otherwise:" after "If X, A. Otherwise, B." keeps B).
      if (prev && prev.type === "conditional" && !prev.elseEffects) {
        prev.elseEffects = parseEffects(otherwiseMatch[1]);
        continue;
      }
    }
    const parsed = parseClause(c);
    if (parsed) effects.push(...parsed);
  }

  return effects;
}

/**
 * At a depth-0 position, how many characters the clause separator occupies
 * (0 = not a boundary). Handles sentence periods (but not decimals or
 * numbered-list markers), list commas (but not inside dice notation,
 * after "and"/"or", inside thirst/apex/ignore/if/subweapon clauses, or
 * mid-numbered-item), and " and " only when the right side starts an
 * effect of its own.
 */
function clauseBoundarySkip(
  text: string,
  i: number,
  current: string,
): number {
  const ch = text[i];
  // A period inside a decimal number (e.g. "-1.5 dice faces", "x1.25")
  // is not a clause boundary -- only sentence periods are.
  const isDecimalDot =
    /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "");
  // A period after a bare number is a numbered-list marker ("4. After
  // damage"), not a sentence end -- keep it attached to the item.
  const isListMarkerDot = /^\d+$/.test(current.trim());
  if (
    ch === "." &&
    !isInsideDice(text, i) &&
    !isDecimalDot &&
    !isListMarkerDot
  ) {
    return 1;
  }
  if (ch === "," && isCommaBoundary(text, i, current)) return 1;
  if (isAndBoundary(text, i, current)) return 5;
  return 0;
}

/** True when a comma at `i` starts a new clause (not a list continuation). */
function isCommaBoundary(
  text: string,
  i: number,
  current: string,
): boolean {
  const inNumberedItem = /^\d+[.:]\s/.test(current.trim());
  const commaStartsNewItem = /^,\s*\d+[.:]\s/.test(text.slice(i));
  return (
    !isInsideDice(text, i) &&
    !text.slice(i).match(/^,\s*(?:and|or)\s/i) &&
    !/^(thirst\s+\d+:|apex:|ignores?\b|if\b|gladius:|scutum:|pilum:)/i.test(
      current.trim(),
    ) &&
    // A comma inside a numbered list item ("5. For one round, attacks
    // ...") is mid-item, not a clause boundary -- unless it introduces
    // the next item ("..., 6. The user ...").
    !(inNumberedItem && !commaStartsNewItem)
  );
}

/** True when " and " at `i` starts a new clause (right side is an effect). */
function isAndBoundary(text: string, i: number, current: string): boolean {
  return (
    text.slice(i).match(/^ and /i) &&
    !isInsideDice(text, i) &&
    !/^(thirst\s+\d+:|apex:|ignores?\b|if\b|gladius:|scutum:|pilum:)/i.test(
      current.trim(),
    ) &&
    // Only treat " and " as a clause boundary when the right side
    // starts an effect of its own.
    looksLikeEffectStart(text.slice(i + 5))
  );
}

function looksLikeEffectStart(text: string): boolean {
  return /^(?:gain|gains|lose|loses|take|takes|inflict|inflicts|deal|deals|heal|heals|push|pulls?|add|adds|reduce|reduces|remove|removes|become|becomes|treat|treated|convert|converts|double|halve|grant|grants|spend|spends|swap|swaps|switch|switches|shield|ignore|ignores|attack|attacks|regain|recover|cleanse|reset|recharge|restore|sacrifice|designate|channel|reroll|roll|start|starts|end|ends|prevent|cannot|may|also|next|this|until|while|per\b|when\b|if\b|crit\b|requir|once|for\s+\d+|[+\-]|x|×|\d)/i.test(
    text.trim(),
  );
}

function splitClauses(text: string): string[] {
  const clauses: string[] = [];
  let depth = 0;
  let current = "";

  // The data sometimes uses a literal "\n" (backslash-n) as a line break
  // (e.g. the numbered d14 table on Cards/Stacked Deck). Normalize to a
  // real newline so the whitespace guards below treat it as a separator.
  text = text.replace(/\\n/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0) {
      const skip = clauseBoundarySkip(text, i, current);
      if (skip > 0) {
        if (current.trim()) clauses.push(current.trim());
        current = "";
        // " and " is 5 chars: skip past it so it isn't re-scanned.
        i += skip - 1;
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) clauses.push(current.trim());

  return clauses;
}

/**
 * True when the given text plausibly *starts an effect clause* ("gain +1
 * ACC", "-1 MR", "inflict 3 Bleed/1") rather than continuing a list
 * ("and MAG", "and target gain X"). splitClauses uses this so conjunctive
 * pairings like "swap ATK and MAG" / "User and target ..." / "obstructions
 * and DEF" stay whole instead of fragmenting into orphan tokens.
 */
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
/**
 * Parse subweapon clauses: "Requires Pilum.", "Switch to Pilum.",
 * "Swap subweapons", and "Gladius: EFFECT" branches. Returns null when
 * the clause isn't a subweapon statement.
 */
function parseSubweaponClause(lower: string): Effect[] | null {
  // Subweapon requirement: "Requires Pilum." / "Requires Gladius or Pilum."
  // (Gladius class). Gated abilities may only be used while the named
  // subweapon is equipped; the resolve layer surfaces this as a marker.
  const requiresMatch = lower.match(/^requires\s+(.+?)\s*\.?$/);
  if (requiresMatch) {
    const weapons = parseSubweaponList(requiresMatch[1]);
    if (weapons.length > 0) {
      return [{ type: "requires", weapons }];
    }
  }

  // Switch subweapon: "Switch to Pilum." / "swap to Gladius" /
  // "Switch to Gladius or Scutum." / "Start in Gladius."
  const switchMatch = lower.match(
    /^(?:switch|swap)\s+to\s+(.+?)\s*\.?$|^start\s+in\s+(.+?)\s*\.?$/,
  );
  if (switchMatch) {
    const weapons = parseSubweaponList(switchMatch[1] ?? switchMatch[2]);
    if (weapons.length > 0) {
      return [{ type: "switchWeapon", to: weapons }];
    }
  }

  // "Swap subweapons (Standard)" -- free-form swap action.
  if (/^swap subweapons?/.test(lower)) {
    return [{ type: "switchWeapon", to: ["gladius", "scutum", "pilum"] }];
  }

  // Subweapon-conditional sub-effect: "Gladius: EFFECT" / "Scutum: EFFECT" /
  // "Pilum: EFFECT" -- each branch applies only while that subweapon is held.
  const subweaponCondMatch = lower.match(
    /^(gladius|scutum|pilum):\s*(.+)$/,
  );
  if (subweaponCondMatch) {
    return [{
      type: "conditional",
      condition: `subweapon is ${subweaponCondMatch[1]}`,
      thenEffects: parseEffects(subweaponCondMatch[2]),
    }];
  }

  return null;
}

/**
 * Parse combat-mod clauses: "Crit on N+" / "+N dice" / "+N base dice" /
 * "+N dice faces" / "+N MR". Returns null when the clause isn't one.
 */
function parseModClause(lower: string): Effect[] | null {
  // Crit threshold: "Crit on 18+" / "Crit on 14+" -- lowers the roll
  // needed to crit from the engine default of 20.
  const critModMatch = lower.match(/^crit\s+on\s+(\d+)\+?$/);
  if (critModMatch) {
    return [{ type: "critMod", threshold: parseInt(critModMatch[1]) }];
  }

  // Dice modifiers: "+1 dice" / "+1 base dice" / "+4 dice faces" /
  // "-1.5 dice faces" / "+1 dice/1". Optional "gain/gains" verb. We
  // deliberately do NOT accept a "label:" prefix (e.g. "Melee on Bounty:
  // +1 dice") -- those clauses are gated conditions, and extractCombatMetadata
  // would otherwise apply them to every attack as unconditional dice.
  const diceModMatch = lower.match(
    /^(?:(?:gain|gains)\s*)?([+-])\s*(\d+(?:\.\d+)?)\s+(?:(base)\s+)?dice(?:\s+faces)?(?:\s*\/\s*(\d+))?$/,
  );
  if (diceModMatch) {
    const sign = diceModMatch[1] === "-" ? -1 : 1;
    const kind = diceModMatch[3]
      ? "baseDice"
      : /faces/.test(diceModMatch[0])
        ? "diceFaces"
        : "dice";
    return [{
      type: "diceMod",
      kind,
      amount: sign * parseFloat(diceModMatch[2]),
      rounds: diceModMatch[4] ? parseInt(diceModMatch[4]) : undefined,
    }];
  }

  // Miss-rate modifier: "+2 MR" / "-1 MR" / "+3 MR/1" (with duration).
  const mrModMatch = lower.match(/^([+-])\s*(\d+)\s+mr(?:\s*\/\s*(\d+))?$/);
  if (mrModMatch) {
    const sign = mrModMatch[1] === "-" ? -1 : 1;
    return [{
      type: "mrMod",
      amount: sign * parseInt(mrModMatch[2]),
      rounds: mrModMatch[3] ? parseInt(mrModMatch[3]) : undefined,
    }];
  }

  // Range bonus: "+1 Range" / "-1 Range" -- standing passive bonus
  // (Lunar Phase's "+1 Range") consumed statically by getPassiveRangeBonus.
  const rangeModMatch = lower.match(/^([+-])\s*(\d+)\s+range$/);
  if (rangeModMatch) {
    return [{
      type: "rangeMod",
      amount: (rangeModMatch[1] === "-" ? -1 : 1) * parseInt(rangeModMatch[2]),
    }];
  }

  // Defender dice penalty: "-1 dice on attacks targeting user" -- Lunar
  // Phase's "Full Moon: -N dice on attacks targeting user", consumed
  // statically by getDefenderDiceMods when this entity is attacked.
  const targetingDiceModMatch = lower.match(
    /^([+-])\s*(\d+)\s+dice on attacks targeting (?:the )?user$/,
  );
  if (targetingDiceModMatch) {
    return [{
      type: "targetingDiceMod",
      amount: (targetingDiceModMatch[1] === "-" ? -1 : 1) *
        parseInt(targetingDiceModMatch[2]),
    }];
  }

  return null;
}

const PHASE_PREFIX_MAP: Record<string, PhaseTiming> = {
  "before accuracy": "before-acc",
  "before damage": "before-damage",
  "on miss": "on-miss",
  "regardless": "regardless",
  "regard": "regardless",
};

interface SimpleClausePattern {
  re: RegExp;
  build: (m: RegExpMatchArray) => Effect[] | null;
}

// Table of single-match clause patterns tried in order after the special
// cases (if/choose/subweapon/mod). Each entry knows how to turn its match
// into an Effect, keeping parseClauseStructured a flat loop.
const SIMPLE_CLAUSE_PATTERNS: SimpleClausePattern[] = [
  // Thirst: "Thirst N: EFFECT"
  {
    re: /^thirst\s+(\d+):\s*(.+)$/,
    build: (m) => [{
      type: "thirst",
      threshold: parseInt(m[1]),
      effects: parseEffects(m[2]),
    }],
  },
  // Apex: "Apex: EFFECT"
  {
    re: /^apex:\s*(.+)$/,
    build: (m) => [{ type: "apex", effects: parseEffects(m[1]) }],
  },
  // Channel: "Channel STAT for N rounds"
  {
    re: /^channel\s+(\w+)(?:\s+for\s+(\d+)\s+rounds?)?$/,
    build: (m) => [{
      type: "channel",
      stat: m[1],
      rounds: m[2] ? parseInt(m[2]) : 1,
    }],
  },
  // Phase slash-combo: "New/Full Moon: EFFECT" / "Waxing/Waning: EFFECT" --
  // two phases share one branch; the other two are the implicit else. The
  // else can arrive either as an inline "... Otherwise: Y" (Harvest Moon's
  // "1d10+2" plus-sign keeps the whole text in ONE clause) or as a separate
  // clause (Blood Moon), which parseEffects' loop attaches below.
  // "New/Full Moon" writes the first phase as a bare "new" (and the data
  // only ever shortens "new"/"full"), so both spellings are accepted and
  // normalized before building the condition.
  {
    re: /^(new moon|new|waxing|full moon|full|waning)\s*\/\s*(new moon|waxing|full moon|waning):\s*(.+)$/,
    build: (m) => {
      const norm = (p: string) =>
        p === "new" ? "new moon" : p === "full" ? "full moon" : p;
      const body = m[3];
      const elseAt = body.search(/\s+otherwise,?\s*:?\s*/i);
      const thenText = elseAt >= 0 ? body.slice(0, elseAt) : body;
      const elseText =
        elseAt >= 0
          ? body.slice(elseAt).replace(/^\s+otherwise,?\s*:?\s*/i, "")
          : undefined;
      return [{
        type: "conditional",
        condition: `phase is ${norm(m[1])} or ${norm(m[2])}`,
        thenEffects: parseEffects(thenText),
        elseEffects: elseText ? parseEffects(elseText) : undefined,
      }];
    },
  },
  // Phase: "Phase: PHASE_NAME"
  {
    re: /^phase:\s*(new moon|waxing|full moon|waning)$/,
    build: (m) => [{ type: "phase", phase: m[1] }],
  },
  // Phase-conditional sub-effect: "New Moon: EFFECT" / "Full Moon: EFFECT" etc.
  {
    re: /^(new moon|waxing|full moon|waning):\s*(.+)$/,
    build: (m) => [{
      type: "conditional",
      condition: `phase is ${m[1]}`,
      thenEffects: parseEffects(m[2]),
    }],
  },
  // "No Phase shift next turn" / "User's Phase disabled next turn" -- the
  // Lunar Rod (Harvest Moon / Celestial Blessing) can suppress the next
  // turn's auto-advance. nextTurn consumes the game-level flag.
  {
    re: /^(?:no|skip)\s+phase shift(?: next turn)?$|^user'?s phase disabled next turn$/,
    build: () => [{ type: "skipPhaseShift" }],
  },
  // "Two effects if user has 2 Phases" (Fatal Moonlight header) -- marker.
  // The double-application itself is driven by evaluateCondition matching
  // the user's chosen 2nd phase, so no runtime behavior lives here.
  {
    re: /^two effects? if (?:the )?user has (?:2|two) phases?$/,
    build: () => [{ type: "doubleEffects" }],
  },
  // Phase-prefixed: "Before accuracy: EFFECT" / "On Miss: EFFECT" / etc.
  {
    re: /^(before accuracy|before damage|on miss|regard(?:less)?):\s*(.+)$/,
    build: (m) => [{
      type: "phaseEffect",
      phase: PHASE_PREFIX_MAP[m[1]],
      effects: parseEffects(m[2]),
    }],
  },
  // Per: "Per hit: EFFECT" / "Per 5 CP: EFFECT" / "Per X: EFFECT"
  {
    re: /^per\s+(.+?):\s*(.+)$/,
    build: (m) => [{
      type: "per",
      trigger: m[1].trim(),
      effects: parseEffects(m[2]),
    }],
  },
  // "Trigger: When X: EFFECT" -- the action-economy label is redundant
  // with the ability's actionType, so strip it and parse the When clause.
  {
    re: /^(?:reaction|trigger):\s*when\s+(.+?):\s*(.+)$/,
    build: (m) => [{
      type: "trigger",
      event: m[1].trim(),
      effects: parseEffects(m[2]),
    }],
  },
  // When: "When user damages a foe: EFFECT" / "When attacked for 40+: EFFECT"
  {
    re: /^when\s+(.+?):\s*(.+)$/,
    build: (m) => [{
      type: "trigger",
      event: m[1].trim(),
      effects: parseEffects(m[2]),
    }],
  },
  // Delay: "Delay N rounds" or "Delay-N" or "Delay-1. May delay up to +2 more turns."
  {
    re: /^(?:delay[\s-]+(\d+)\s+rounds?|delay-?(\d+))$/,
    build: (m) => [{ type: "delay", rounds: parseInt(m[1] ?? m[2]) }],
  },
  // Recoil: "Recoil N%"
  {
    re: /^recoil\s+(\d+)%$/,
    build: (m) => [{ type: "recoil", percent: parseInt(m[1]) }],
  },
  // Ignore: "Ignore(s) X"
  {
    re: /^ignores?\s+(?:non-\w+\s+)?(.+?)\.?$/,
    build: (m) => [{ type: "ignore", what: m[1].trim() }],
  },
  // Multi-hit from dice: "Multi-Hit: N" or "becomes Multi-Hit: N"
  {
    re: /multi[\s-]hit[:\s]+(\d+)/,
    build: (m) => [{ type: "multiHit", hits: parseInt(m[1]) }],
  },
];

function parseClauseStructured(lower: string): Effect[] | null {
  // Conditional: "If CONDITION, EFFECT [Otherwise, EFFECT]" (comma or colon)
  const ifMatch = lower.match(
    /^if\s+(.+?)[,:]\s*(.+?)(?:\s+otherwise,?\s*(.+))?$/,
  );
  if (ifMatch) {
    return [{
      type: "conditional",
      condition: ifMatch[1].trim(),
      thenEffects: parseEffects(ifMatch[2]),
      elseEffects: ifMatch[3] ? parseEffects(ifMatch[3]) : undefined,
    }];
  }

  // "Choose another Phase (doesn't shift)" -- Far Side of the Moon. Prompts
  // the user for a SECOND phase that can power Lunar Rod effects; it never
  // shifts the active phase itself. Must run before the generic Choose branch
  // (which would otherwise treat "another phase (doesn't shift)" as an option).
  if (/^choose (?:another|a) phase/.test(lower)) {
    return [{ type: "choosePhase" }];
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

  const subweaponClause = parseSubweaponClause(lower);
  if (subweaponClause) return subweaponClause;

  const modClause = parseModClause(lower);
  if (modClause) return modClause;

  for (const clause of SIMPLE_CLAUSE_PATTERNS) {
    const m = lower.match(clause.re);
    if (!m) continue;
    const built = clause.build(m);
    if (built) return built;
  }
  return null;
}

interface StatusPattern {
  re: RegExp;
  /** Extract name/damage/rounds from a match; null when the pattern has no status. */
  extract: (m: RegExpMatchArray) => { name: string; damage: number; rounds: number } | null;
}

// Patterns tried in order: "inflict N Status for M rounds", "inflict N
// Status/M", standalone "N Status/M", standalone "Status/M", "inflict
// Status/M", and bare "inflict Status".
const STATUS_PATTERNS: StatusPattern[] = [
  {
    re: /inflict\s+(\d+)?\s*([a-z]+)\s+(?:for\s+)?(\d+)\s+rounds?/,
    extract: (m) => ({
      name: m[2],
      damage: m[1] ? parseInt(m[1]) : 0,
      rounds: parseInt(m[3]),
    }),
  },
  {
    re: /inflict\s+(\d+)?\s*([a-z]+)\s*\/\s*(\d+)/,
    extract: (m) => ({
      name: m[2],
      damage: m[1] ? parseInt(m[1]) : 0,
      rounds: parseInt(m[3]),
    }),
  },
  {
    re: /^(\d+)?\s*([a-z]+)\s*\/\s*(\d+)$/,
    extract: (m) => ({
      name: m[2],
      damage: m[1] ? parseInt(m[1]) : 0,
      rounds: parseInt(m[3]),
    }),
  },
  {
    re: /^([a-z]+)\s*\/\s*(\d+)$/,
    extract: (m) => ({ name: m[1], damage: 0, rounds: parseInt(m[2]) }),
  },
  {
    re: /inflict\s+([a-z]+)\s*\/\s*(\d+)/,
    extract: (m) => ({ name: m[1], damage: 0, rounds: parseInt(m[2]) }),
  },
  {
    re: /inflict\s+([a-z]+)$/,
    extract: (m) => ({ name: m[1], damage: 0, rounds: 1 }),
  },
];

function parseStatusInflict(lower: string): Effect[] {
  for (const { re, extract } of STATUS_PATTERNS) {
    const m = lower.match(re);
    if (!m) continue;
    const parsed = extract(m);
    if (!parsed || !STATUS_NAMES.includes(parsed.name)) continue;
    return [
      {
        type: "status",
        name: capitalize(parsed.name),
        damage: parsed.damage,
        rounds: parsed.rounds,
      },
    ];
  }
  return [];
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

  const resRegex = /(gain|spend|lose)\s+(\d+(?:\+|-?\d+)?|X|any)\s+([a-z]+)/i;
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
  if (
    type !== "beam" &&
    !inRange(
      game,
      user.pos,
      target.pos,
      ability.range,
      getPassiveRangeBonus(user, game.moonPhase),
    )
  ) {
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

/**
 * "phase is X" / "phase is X or Y" -- moon-phase conditions generated by the
 * "New Moon: EFFECT" and "New/Full Moon: EFFECT" parser branches. Returns
 * the outcome, or null when the text isn't a phase condition. The user's
 * chosen 2nd Phase (Far Side of the Moon) also counts: while one is held,
 * BOTH the active phase's branch and the chosen phase's branch fire for
 * every phase-gated ability (the general rule behind Fatal Moonlight's
 * "Two effects if user has 2 Phases").
 */
function evalMoonPhaseCondition(
  lower: string,
  user: Entity,
  moonPhase?: string,
): ConditionOutcome | null {
  const current = (moonPhase ?? "new moon").toLowerCase().trim();
  const second = (user.phaseChoice ?? "").toLowerCase().trim();
  const matches = (p: string) => current === p || second === p;
  const phaseOrMatch = lower.match(
    /^phase is (new moon|waxing|full moon|waning) or (new moon|waxing|full moon|waning)$/,
  );
  if (phaseOrMatch) {
    return matches(phaseOrMatch[1]) || matches(phaseOrMatch[2])
      ? "then"
      : "else";
  }
  const phaseMatch = lower.match(
    /^phase is (new moon|waxing|full moon|waning)$/,
  );
  if (phaseMatch) {
    return matches(phaseMatch[1]) ? "then" : "else";
  }
  return null;
}

export function evaluateCondition(
  text: string,
  user: Entity,
  target: Entity,
  moonPhase?: string,
): ConditionOutcome {
  const lower = text.toLowerCase().trim();

  const resourceEq = evalResourceEquality(lower, user);
  if (resourceEq !== null) return resourceEq;

  const moonPhaseCond = evalMoonPhaseCondition(lower, user, moonPhase);
  if (moonPhaseCond !== null) return moonPhaseCond;

  // "user has 2 Phases" -- Far Side of the Moon stores a chosen second phase
  // on the user (entity.phaseChoice); the condition holds while one exists.
  if (/^user has (?:2|two) phases?$/.test(lower)) {
    return user.phaseChoice ? "then" : "else";
  }

  // Subweapon condition, generated by the "Gladius: EFFECT" / "Scutum: EFFECT"
  // / "Pilum: EFFECT" parser branch (condition text: "subweapon is gladius"
  // etc.). Resolves against the user's equipped subweapon; entities without
  // one fail the check.
  const subweaponMatch = lower.match(
    /^subweapon is (gladius|scutum|pilum)$/,
  );
  if (subweaponMatch) {
    const current = normalizeSubweapon(user.subweapon) ?? "";
    return current === subweaponMatch[1] ? "then" : "else";
  }

  const negate = evalNegation(lower, user, target, moonPhase);
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
  moonPhase?: string,
): ConditionOutcome | null {
  const m = lower.match(/^(?:not|no)\s+(.+)$/);
  if (!m) return null;
  const inner = evaluateCondition(m[1], user, target, moonPhase);
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
  moonPhase?: string,
): { messages: string[]; outcome: ConditionOutcome } {
  const outcome = evaluateCondition(effect.condition, user, target, moonPhase);
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
  routeBuffsToUser: boolean;
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

/** Log the informational marker for crit-threshold / dice / MR mods. */
function handleCombatMod(
  messages: string[],
  effect: CritModEffect | DiceModEffect | MrModEffect,
): void {
  if (effect.type === "critMod") {
    // The crit threshold itself is consumed by extractCombatMetadata /
    // rollAccuracy in resolve.ts; here we just announce the marker so
    // the effect stream log reads naturally.
    messages.push(
      `  Crit threshold lowered to ${effect.threshold}+.`,
    );
    return;
  }
  if (effect.type === "mrMod") {
    messages.push(
      `  Miss rate ${effect.amount > 0 ? "+" : ""}${effect.amount} MR${effect.rounds ? `/${effect.rounds}` : ""}.`,
    );
    return;
  }
  const kindLabel =
    effect.kind === "baseDice"
      ? "base dice"
      : effect.kind === "diceFaces"
        ? "dice faces"
        : "dice";
  messages.push(
    `  Attack gains ${effect.amount > 0 ? "+" : ""}${effect.amount} ${kindLabel}${effect.rounds ? `/${effect.rounds}` : ""}.`,
  );
}

/** One-line log messages for simple effects, keyed by effect type. */
const SIMPLE_LOG: Record<
  string,
  (user: Entity, e: any, game?: Game) => string | null
> = {
  teleport: (u, e) =>
    `  ${u.num} teleports${e.range ? ` to ${e.range}` : ""}. (Teleport resolution needed — host pick a valid tile)`,
  move: (u, e) =>
    `  ${u.num} moves up to ${e.amount} tiles. (Movement resolution needed — host pick a valid tile)`,
  resource: (u, e) => `  ${u.num} ${e.action} ${e.amount} ${e.resource}.`,
  delay: (u, e) =>
    `  Delay ${e.rounds} round${e.rounds > 1 ? "s" : ""} applied.`,
  ignore: (u, e) => `  Ignores ${e.what}.`,
  channel: (u, e) =>
    `  Channeling ${e.stat.toUpperCase()} for ${e.rounds} rounds.`,
  phase: (u, e, g) => {
    // Track the active moon phase on the game so "Phase is X"
    // conditions (e.g. "New Moon:") evaluate correctly downstream.
    if (g) g.moonPhase = e.phase;
    return `  Phase shifts to ${e.phase}.`;
  },
  multiHit: (u, e) => `  Attack gains +${e.hits - 1} additional hits.`,
  recoil: (u, e) =>
    // Recoil damage itself is applied in resolve.ts after on-hit damage
    // is dealt. Here we just announce the marker so the log is readable.
    `  ${u.num} takes ${e.percent}% recoil on damage dealt.`,
  tile: (u, e) =>
    `  ${u.num} attempts to place terrain. (Tile placement needed — pick a tile within ${e.range} range)`,
  unknown: (u, e) => e.text,
};

function* handleSimple(
  { game, user, messages }: EffectCtx,
  effect: any,
) {
  if (effect.type === "critMod" || effect.type === "diceMod" || effect.type === "mrMod") {
    handleCombatMod(messages, effect);
    return;
  }
  const line = SIMPLE_LOG[effect.type]?.(user, effect, game);
  if (line) messages.push(`  ${line}`);
}

function* handleConditional(
  { game, user, target, ability, messages, routeBuffsToUser }: EffectCtx,
  effect: ConditionalEffect,
) {
  const { outcome, messages: condMsgs } = applyConditional(
    user,
    target,
    effect,
    game.moonPhase,
  );
  messages.push(...condMsgs);
  // "unknown" defaults to then-branch (legacy fallback). "else" without
  // an else-branch drops the sub-effects entirely.
  if (outcome === "then" || outcome === "unknown") {
    const thenMsgs = yield* applyEffectStream(game, user, target, effect.thenEffects, ability, routeBuffsToUser);
    messages.push(...thenMsgs.map((m) => `    ${m}`));
  }
  if (outcome === "else" && effect.elseEffects) {
    const elseMsgs = yield* applyEffectStream(game, user, target, effect.elseEffects, ability, routeBuffsToUser);
    messages.push(...elseMsgs.map((m) => `    ${m}`));
  }
}

function* handleThirst(
  { game, user, target, ability, messages, routeBuffsToUser }: EffectCtx,
  effect: ThirstEffect,
) {
  if (!isThirstActive(user, effect)) {
    messages.push(
      `  [Thirst ${effect.threshold}] inactive (Blood ${user.resources.blood ?? 0} < ${effect.threshold}).`,
    );
    return;
  }
  const thirstMsgs = yield* applyEffectStream(game, user, target, effect.effects, ability, routeBuffsToUser);
  messages.push(...thirstMsgs.map((m) => `    [Thirst ${effect.threshold}] ${m}`));
}

function* handlePer(
  { game, user, target, ability, messages, routeBuffsToUser }: EffectCtx,
  effect: PerEffect,
) {
  // Per-X triggers fire at their applicable resolution event. These
  // effects reach the stream on a successful hit (resolve.ts applies
  // non-phase effects after damage), so "Per hit:" dispatches its
  // sub-effects now. Resource-count triggers ("Per 5 CP:") dispatch
  // when the user's pool meets the count. Triggers that can't be
  // confirmed from the current stream context keep a summary log.
  if (perTriggerApplies(effect.trigger, user)) {
    messages.push(`  [Per ${effect.trigger}]:`);
    const perMsgs = yield* applyEffectStream(
      game,
      user,
      target,
      effect.effects,
      ability,
      routeBuffsToUser,
    );
    messages.push(...perMsgs.map((m) => `    ${m}`));
  } else {
    messages.push(
      `  [Per ${effect.trigger}]: ${summariseEffects(effect.effects)}`,
    );
  }
}

function* handleTrigger(
  { game, user, target, ability, messages, routeBuffsToUser }: EffectCtx,
  effect: TriggerEffect,
) {
  // When-X triggers fire when their event condition is met. These
  // effects reach the stream on a successful hit, so hit-context
  // events ("When user damages a foe", "When user kills foe") dispatch
  // their sub-effects now; other events keep a summary log.
  if (triggerApplies(effect.event, user, target)) {
    messages.push(`  [When ${effect.event}]:`);
    const trigMsgs = yield* applyEffectStream(
      game,
      user,
      target,
      effect.effects,
      ability,
      routeBuffsToUser,
    );
    messages.push(...trigMsgs.map((m) => `    ${m}`));
  } else {
    messages.push(
      `  [When ${effect.event}]: ${summariseEffects(effect.effects)}`,
    );
  }
}

function* handleSubweapon(
  { user, messages }: EffectCtx,
  effect: RequiresEffect | SwitchWeaponEffect,
): Generator<EffectChoosePrompt, void, string> {
  if (effect.type === "requires") {
    messages.push(
      `  Requires ${effect.weapons.map(capitalize).join(" or ")}.`,
    );
    return;
  }
  if (effect.to.length === 1) {
    user.subweapon = effect.to[0];
    messages.push(`  ${user.num} switches to ${capitalize(effect.to[0])}.`);
    return;
  }
  // Multi-option switch ("Switch to Gladius or Scutum"): ask the player
  // which subweapon to equip, same prompt machinery as `choose` clauses.
  const clauseId = `switch-${messages.length}`;
  const chosenId = yield {
    kind: "choose",
    clauseId,
    message: `Choose a subweapon to switch to`,
    options: effect.to.map((w, i) => ({
      id: `${clauseId}:${i}`,
      label: capitalize(w),
    })),
  } satisfies EffectChoosePrompt;
  const idx = parseChosenIdx(chosenId, effect.to.length);
  user.subweapon = effect.to[idx];
  messages.push(`  ${user.num} switches to ${capitalize(effect.to[idx])}.`);
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

function* handleSkipPhaseShift(
  { game, messages }: EffectCtx,
  _effect: { type: "skipPhaseShift" },
) {
  // Harvest Moon / Celestial Blessing: no auto-advance at the next
  // turn boundary. nextTurn consumes (resets) the flag.
  game.skipMoonPhaseShift = true;
  messages.push(`  No Phase shift next turn.`);
}

function* handleDoubleEffects(
  _ctx: EffectCtx,
  _effect: { type: "doubleEffects" },
) {
  // Fatal Moonlight marker: two effects fire while the user holds a 2nd
  // Phase. evaluateCondition already matches both phases, so this is a
  // no-op here.
}

function* handleChoosePhase(
  { user, messages }: EffectCtx,
  _effect: { type: "choosePhase" },
): Generator<EffectChoosePrompt, void, string> {
  // Far Side of the Moon: pick a second phase (never shifts the active
  // one). Stored on the user so "user has 2 Phases" conditions read it.
  const clauseId = `phase-${messages.length}`;
  const chosenId = yield {
    kind: "choose",
    clauseId,
    message: "Choose another Phase (doesn't shift the current one)",
    options: MOON_PHASE_CYCLE.map((p, i) => ({
      id: `${clauseId}:${i}`,
      label: formatPhase(p),
    })),
  } satisfies EffectChoosePrompt;
  const idx = parseChosenIdx(chosenId, MOON_PHASE_CYCLE.length);
  const picked = MOON_PHASE_CYCLE[idx];
  user.phaseChoice = picked;
  messages.push(
    `  ${user.num} picks **${formatPhase(picked)}** as a second Phase.`,
  );
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
  per: handlePer,
  trigger: handleTrigger,
  phaseEffect: handleSimple,
  requires: handleSubweapon,
  switchWeapon: handleSubweapon,
  critMod: handleSimple,
  diceMod: handleSimple,
  mrMod: handleSimple,
  choosePhase: handleChoosePhase,
  skipPhaseShift: handleSkipPhaseShift,
  rangeMod: handleSimple,
  targetingDiceMod: handleSimple,
  doubleEffects: handleDoubleEffects,
  unknown: handleSimple,
};

export function* applyEffectStream(
  game: Game,
  user: Entity,
  target: Entity,
  effects: Effect[],
  ability?: AbilityData,
  routeBuffsToUser = false,
): Generator<EffectChoosePrompt, string[], string> {
  const messages: string[] = [];
  const ctx: EffectCtx = { game, user, target, ability, messages, routeBuffsToUser };

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
/** Join sub-effect summaries into a single string. */
function summariseEffects(effects: Effect[]): string {
  return effects.map(summariseEffect).join(", ");
}

/**
 * True when a `Per X:` trigger fires in the current stream context.
 *
 * These effects reach the stream on a successful hit (resolve.ts applies
 * non-phase effects after damage), so hit-context triggers dispatch their
 * sub-effects. Resource-count triggers ("Per 5 CP:") dispatch when the
 * user's pool meets the count; anything else stays summarized until a
 * dedicated dispatch point exists for it.
 */
function perTriggerApplies(trigger: string, user: Entity): boolean {
  const t = trigger.toLowerCase().trim();
  // "Per hit:" fires on a successful hit (the context these effects reach
  // the stream in). "Per crit:" needs crit context the stream doesn't have,
  // so it stays summarized until a dedicated crit dispatch point exists.
  if (t === "hit") return true;
  const resMatch = t.match(/^(\d+)\s+(.+)$/);
  if (resMatch) {
    const need = parseInt(resMatch[1]);
    const res = canonicalResource(resMatch[2]);
    if (res) return (user.resources[res] ?? 0) >= need;
  }
  return false;
}

/**
 * True when a `When X:` trigger fires in the current stream context.
 * Hit-context events ("user damages a foe", "user kills a foe", "hit")
 * dispatch their sub-effects on a successful hit; other events stay
 * summarized until a dedicated dispatch point exists for them.
 */
function triggerApplies(event: string, user: Entity, target: Entity): boolean {
  const t = event.toLowerCase().trim();
  if (t === "hit") return true;
  if (t === "user damages a foe" || t === "user damages foe") return true;
  if (t === "user kills a foe" || t === "user kills foe")
    return target.curhp <= 0;
  return false;
}

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
  rangeMod: (e) => `${e.amount > 0 ? "+" : ""}${e.amount} range`,
  targetingDiceMod: (e) =>
    `${e.amount > 0 ? "+" : ""}${e.amount} dice on attacks targeting user`,
  doubleEffects: () => "two effects if user has 2 phases",
  choosePhase: () => "choose another phase",
  skipPhaseShift: () => "no phase shift next turn",
  multiHit: (e) => `multi-hit ${e.hits}`,
  apex: () => "apex (...)",
  thirst: (e) => `thirst ${e.threshold} (...)`,
  choose: () => "choose (...)",
  conditional: (e) => `if [${e.condition}]`,
  delayLand: () => "delay attacks always land",
  per: (e) => `per ${e.trigger} (${summariseEffects(e.effects)})`,
  trigger: (e) => `when ${e.event} (${summariseEffects(e.effects)})`,
  phaseEffect: (e) => `[${e.phase}] ${summariseEffects(e.effects)}`,
  requires: (e) => `requires ${e.weapons.join(" or ")}`,
  switchWeapon: (e) => `switch to ${e.to.join(" or ")}`,
  critMod: (e) => `crit on ${e.threshold}+`,
  diceMod: (e) => `${e.amount > 0 ? "+" : ""}${e.amount} ${e.kind === "baseDice" ? "base dice" : e.kind === "diceFaces" ? "dice faces" : "dice"}`,
  mrMod: (e) => `${e.amount > 0 ? "+" : ""}${e.amount} MR${e.rounds ? `/${e.rounds}` : ""}`,
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
  /**
   * Lowest parsed "Crit on N+" threshold. null when no explicit
   * threshold clause is present (engine default of 20 applies).
   */
  critThreshold: number | null;
  /**
   * Extra damage dice added to the roll from "+N dice" clauses.
   * Applied as additional dice of the ability's die size.
   */
  extraDice: number;
  /**
   * Extra faces per die from "+N dice faces" clauses. Applied by
   * increasing each die's side count.
   */
  extraDiceFaces: number;
  /**
   * Extra BASE dice from "+N base dice" clauses. Base dice are the
   * pre-crit-multiplier dice, so they double on a crit along with the
   * rest of the roll.
   */
  extraBaseDice: number;
  /**
   * Summed Miss Rate modifier from "+N MR" / "-N MR" clauses. Added to
   * the ability's base miss rate before the accuracy roll.
   */
  mrMod: number;
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

/**
 * Walk an effect tree collecting standing-passive mods, descending only into
 * branches that are knowable statically:
 *  - "phase is X" / "phase is X or Y" conditionals: descend only if the
 *    current moon phase matches (the else-branch is the complement, which is
 *    out of scope for standing-passive scans)
 *  - everything else that gates on runtime state (If/Apex/Thirst/Per/Trigger/
 *    Choose) is skipped, matching mergeCombatMetadata's conservative rule so
 *    gated mods never count as unconditional
 */
function walkPhaseAware(
  effects: Effect[],
  moonPhase: string | undefined,
  visit: (e: Effect) => void,
): void {
  const phase = moonPhase?.toLowerCase().trim();
  for (const e of effects) {
    if (e.type === "conditional" && e.condition.startsWith("phase is ")) {
      const want = e.condition
        .slice("phase is ".length)
        .split(" or ")
        .map((s) => s.trim());
      if (phase && want.includes(phase)) {
        walkPhaseAware(e.thenEffects, phase, visit);
      } else if (phase && e.elseEffects) {
        // "Otherwise:" branch applies when the active phase doesn't match.
        walkPhaseAware(e.elseEffects, phase, visit);
      }
      continue;
    }
    if (
      e.type === "conditional" ||
      e.type === "per" ||
      e.type === "trigger" ||
      e.type === "apex" ||
      e.type === "thirst" ||
      e.type === "choose"
    ) {
      continue;
    }
    visit(e);
  }
}

/**
 * Sum the "+N Range" standing bonus from the entity's Passive abilities,
 * gated on the current moon phase (Lunar Phase's "New Moon: +1 Range").
 * resolve.ts / pages.ts / %checkrange use this to extend targeting ranges.
 */
export function getPassiveRangeBonus(
  user: Entity,
  moonPhase?: string,
): number {
  let bonus = 0;
  for (const a of user.abilities) {
    if (a.actionType !== "Passive") continue;
    walkPhaseAware(parseEffects(a.effect), moonPhase, (e) => {
      if (e.type === "rangeMod") bonus += e.amount;
    });
  }
  return bonus;
}

/**
 * Sum the "-N dice on attacks targeting user" penalty from the entity's
 * Passive abilities, gated on the current moon phase (Lunar Phase's "Full
 * Moon: -1 dice on attacks targeting user"). resolveAttackFlow folds this
 * into the attacker's roll for each target that carries it.
 */
export function getDefenderDiceMods(
  entity: Entity,
  moonPhase?: string,
): number {
  let mod = 0;
  for (const a of entity.abilities) {
    if (a.actionType !== "Passive") continue;
    walkPhaseAware(parseEffects(a.effect), moonPhase, (e) => {
      if (e.type === "targetingDiceMod") mod += e.amount;
    });
  }
  return mod;
}

export function extractCombatMetadata(
  effects: Effect[],
  subweapon?: string,
  moonPhase?: string,
  phaseChoice?: string,
): CombatMetadata {
  const out: CombatMetadata = {
    damagePercent: 0,
    flatDamage: 0,
    additionalHits: 0,
    ignore: freshIgnoreMetadata(),
    critThreshold: null,
    extraDice: 0,
    extraDiceFaces: 0,
    extraBaseDice: 0,
    mrMod: 0,
  };

  mergeCombatMetadata(out, effects, subweapon, moonPhase, phaseChoice);
  return out;
}

/**
 * Fold top-level combat metadata from `effects` into `out`. Recurses into
 * subweapon branches ("Gladius: +1 dice") whose condition matches the
 * user's equipped subweapon -- those gates ARE knowable here, so the
 * branch's dice/crit/MR mods count toward the damage math. Other gated
 * clauses are NOT descended into:
 *
 *   - Apex / Thirst / Conditional(if) / Choose sub-trees all fire only
 *     when their runtime gate succeeds, so metadata extracted from their
 *     children would over-apply (e.g. "Apex: +50% damage" would turn the
 *     ability into +50% at any range). resolveSingleTarget re-evaluates
 *     each gate per hit through the entity.buffs/statuses path instead.
 */
function mergeCombatMetadata(
  out: CombatMetadata,
  effects: Effect[],
  subweapon?: string,
  moonPhase?: string,
  phaseChoice?: string,
): void {
  const phase = moonPhase?.toLowerCase().trim();
  const choice = phaseChoice?.toLowerCase().trim();
  for (const e of effects) {
    if (e.type === "conditional" && e.condition.startsWith("subweapon is ")) {
      // Only the matching branch's sub-effects count; the non-matching
      // branches are dead code for this user's equipped subweapon.
      const want = e.condition.slice("subweapon is ".length);
      if (subweapon && subweapon === want) {
        mergeCombatMetadata(out, e.thenEffects, subweapon, phase, choice);
      }
      continue;
    }
    if (e.type === "conditional" && e.condition.startsWith("phase is ")) {
      // Phase-gated branches (Lunar Phase's "Waxing: +2 dice faces") count
      // only while the current moon phase matches. The condition is either
      // "phase is X" or the slash-combo "phase is X or Y"; both are knowable
      // at metadata time, so unlike If/Apex/Thirst gates we descend here.
      const want = e.condition
        .slice("phase is ".length)
        .split(" or ")
        .map((s) => s.trim());
      // The user's chosen 2nd phase (Far Side of the Moon / Fatal
      // Moonlight) counts too: evaluateCondition fires a "phase is X"
      // branch when EITHER the active phase or the chosen phase matches,
      // so ability metadata must fold both in for the damage math.
      if (
        (phase && want.includes(phase)) ||
        (choice && want.includes(choice))
      ) {
        mergeCombatMetadata(out, e.thenEffects, subweapon, phase, choice);
      }
      continue;
    }
    mergeOneEffect(out, e);
  }
}

/** Fold a single top-level effect's combat metadata into `out`. */
function mergeOneEffect(out: CombatMetadata, e: Effect): void {
  switch (e.type) {
    case "damageMod":
      if (e.percent) out.damagePercent += e.percent;
      if (typeof e.flat === "number") out.flatDamage += e.flat;
      break;
    case "multiHit":
      out.additionalHits = Math.max(out.additionalHits, e.hits - 1);
      break;
    case "ignore":
      classifyIgnore(e.what, out.ignore);
      break;
    case "critMod":
      out.critThreshold =
        out.critThreshold === null
          ? e.threshold
          : Math.min(out.critThreshold, e.threshold);
      break;
    case "diceMod":
      mergeDiceMod(out, e);
      break;
    case "mrMod":
      out.mrMod += e.amount;
      break;
    case "buff":
    case "debuff":
      mergeStatDamage(out, e);
      break;
  }
}

function mergeDiceMod(out: CombatMetadata, e: Extract<Effect, { type: "diceMod" }>): void {
  if (e.kind === "dice") out.extraDice += e.amount;
  else if (e.kind === "diceFaces") out.extraDiceFaces += e.amount;
  else out.extraBaseDice += e.amount;
}

function mergeStatDamage(
  out: CombatMetadata,
  e: Extract<Effect, { type: "buff" | "debuff" }>,
): void {
  // parseStatMods emits a "buff"/"debuff" with stat: "dmg" for the
  // every-day "+50% damage", "+5 DMG", "-10% damage" clauses --
  // because the regex matches "damage" / "dmg" as a stat name and
  // folds them onto the dmg alias. Those are damage modifiers, not
  // self-buffs, so the resolve layer reads them here. The
  // buff/debuff still lands on `target.buffs` so legacy code that
  // scans entity.buffs for damage modifiers keeps working too.
  if (e.stat !== "dmg") return;
  // parseStatMods bakes the sign into percent / amount, so a
  // debuff for "-10% damage" arrives here with percent = -10.
  if (typeof e.percent === "number") {
    out.damagePercent += e.percent;
  } else if (typeof e.amount === "number" && e.percent === undefined) {
    out.flatDamage += e.amount;
  }
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
  // Ignore lists arrive as a single clause now (splitClauses keeps
  // "Ignores X, Y, and Z" together), e.g. "ATK/MAG, half DEF, and
  // outside damage factors". Classify each fragment independently so
  // a combined list sets all matching flags instead of just the first.
  const fragments = what
    .toLowerCase()
    .split(/\s*(?:,| and | or )\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (fragments.length === 0) return;
  for (const fragment of fragments) {
    classifyIgnoreFragment(fragment, what, out);
  }
}

function classifyIgnoreFragment(
  lower: string,
  original: string,
  out: CombatIgnoreMetadata,
): void {
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
    classifyDefIgnore(lower, out);
    return;
  }

  if (lower.includes("non-target") || lower.includes("obstruction")) {
    out.other.push(original);
    return;
  }

  out.other.push(original);
}

/** Classify a DEF ignore clause. Order matters: a fractional "1/2 DEF" /
 * "1/4 DEF" / "half DEF" / "quarter DEF" overrides a plain "5 DEF" -> the
 * latter reads as "Ignores half DEF AND 5 DEF" which means (def/2 - 5). But
 * BD's text typically gives them in a single clause. Without a clean
 * multi-clause parser we take the strongest effect (full-zero > quarter >
 * half > numeric subtract). If you see both strongest and subtract in real
 * data, file an issue and we'll revisit. */
function classifyDefIgnore(lower: string, out: CombatIgnoreMetadata): void {
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
}
