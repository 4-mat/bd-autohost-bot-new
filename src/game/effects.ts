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

export interface RequiresEffect {
  type: "requires";
  weapons: string[]; // gladius / scutum / pilum
}

export interface SwitchWeaponEffect {
  type: "switchWeapon";
  to: string[]; // gladius / scutum / pilum -- >1 when the player may pick
}

export type PhaseTiming = "before-acc" | "before-damage" | "on-miss" | "regardless";

export interface PhaseTimingEffect {
  type: "phaseEffect";
  phase: PhaseTiming;
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
  | DelayLandEffect
  | MultiHitMod
  | TileEffect
  | PerEffect
  | TriggerEffect
  | CritModEffect
  | DiceModEffect
  | MrModEffect
  | RequiresEffect
  | SwitchWeaponEffect
  | PhaseTimingEffect
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
    if (e.type === "requires") required.push(...e.weapons);
  }
  return [...new Set(required)];
}

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
 * True when the given text plausibly *starts an effect clause* ("gain +1
 * ACC", "-1 MR", "inflict 3 Bleed/1") rather than continuing a list
 * ("and MAG", "and target gain X"). splitClauses uses this so conjunctive
 * pairings like "swap ATK and MAG" / "User and target ..." / "obstructions
 * and DEF" stay whole instead of fragmenting into orphan tokens.
 */
function looksLikeEffectStart(text: string): boolean {
  return /^(?:gain|gains|lose|loses|take|takes|inflict|inflicts|deal|deals|heal|heals|push|pulls?|add|adds|reduce|reduces|remove|removes|become|becomes|treat|treated|convert|converts|double|halve|grant|grants|spend|spends|swap|swaps|shield|ignore|ignores|attack|attacks|regain|recover|cleanse|reset|recharge|restore|sacrifice|designate|channel|reroll|roll|start|starts|end|ends|prevent|cannot|may|also|next|this|until|while|per\b|when\b|if\b|crit\b|requir|once|for\s+\d+|[+\-]|x|×|\d)/i.test(
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
      // A period inside a decimal number (e.g. "-1.5 dice faces",
      // "x1.25") is not a clause boundary -- only sentence periods are.
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
        if (current.trim()) clauses.push(current.trim());
        current = "";
        continue;
      }
      if (ch === ",") {
        const inNumberedItem = /^\d+[.:]\s/.test(current.trim());
        const commaStartsNewItem = /^,\s*\d+[.:]\s/.test(text.slice(i));
        const isCommaSplit =
          !isInsideDice(text, i) &&
          !text.slice(i).match(/^,\s*(?:and|or)\s/i) &&
          !/^(thirst\s+\d+:|apex:|ignores?\b|if\b|gladius:|scutum:|pilum:)/i.test(
            current.trim(),
          ) &&
          // A comma inside a numbered list item ("5. For one round, attacks
          // ...") is mid-item, not a clause boundary -- unless it introduces
          // the next item ("..., 6. The user ...").
          !(inNumberedItem && !commaStartsNewItem);
        if (isCommaSplit) {
          if (current.trim()) clauses.push(current.trim());
          current = "";
          continue;
        }
      }
      if (
        text.slice(i).match(/^ and /i) &&
        !isInsideDice(text, i) &&
        !/^(thirst\s+\d+:|apex:|ignores?\b|if\b|gladius:|scutum:|pilum:)/i.test(
          current.trim(),
        ) &&
        // Only treat " and " as a clause boundary when the right side
        // starts an effect of its own.
        looksLikeEffectStart(text.slice(i + 5))
      ) {
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
  // Drop a numbered-list marker ("1. " / "7: ") so table entries like
  // "5. For one round, ..." parse as their content. Markers like "10
  // Shield/1" are untouched (the token after the digits isn't a marker).
  const lower = clause.replace(/^\d+[.:]\s/, "").toLowerCase().trim();
  const effects: Effect[] = [];

  // Conditional: "If CONDITION, EFFECT [Otherwise, EFFECT]"
  const ifMatch = lower.match(
    /^if\s+(.+?)[,:]\s*(.+?)(?:\s+otherwise,?\s*(.+))?$/,
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

  // "Choose another Phase (doesn't shift)" -- Far Side of the Moon. Prompts
  // the user for a SECOND phase that can power Lunar Rod effects; it never
  // shifts the active phase itself. Must run before the generic Choose branch
  // (which would otherwise treat "another phase (doesn't shift)" as an option).
  if (/^choose (?:another|a) phase/.test(lower)) {
    effects.push({ type: "choosePhase" });
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

  // Phase-prefixed: "Before accuracy: EFFECT" / "On Miss: EFFECT" / etc.
  const phasePrefixMatch = lower.match(
    /^(before accuracy|before damage|on miss|regard(?:less)?):\s*(.+)$/,
  );
  if (phasePrefixMatch) {
    const phaseMap: Record<string, PhaseTiming> = {
      "before accuracy": "before-acc",
      "before damage": "before-damage",
      "on miss": "on-miss",
      "regardless": "regardless",
      "regard": "regardless",
    };
    effects.push({
      type: "phaseEffect",
      phase: phaseMap[phasePrefixMatch[1]],
      effects: parseEffects(phasePrefixMatch[2]),
    });
    return effects;
  }

  // Per: "Per hit: EFFECT" / "Per 5 CP: EFFECT" / "Per X: EFFECT"
  const perMatch = lower.match(/^per\s+(.+?):\s*(.+)$/);
  if (perMatch) {
    effects.push({
      type: "per",
      trigger: perMatch[1].trim(),
      effects: parseEffects(perMatch[2]),
    });
    return effects;
  }

  // Reaction/Trigger-prefixed triggers: "Reaction: When X: EFFECT" /
  // "Trigger: When X: EFFECT" -- the action-economy label is redundant
  // with the ability's actionType, so strip it and parse the When clause.
  const reactWhenMatch = lower.match(
    /^(?:reaction|trigger):\s*when\s+(.+?):\s*(.+)$/,
  );
  if (reactWhenMatch) {
    effects.push({
      type: "trigger",
      event: reactWhenMatch[1].trim(),
      effects: parseEffects(reactWhenMatch[2]),
    });
    return effects;
  }

  // When: "When user damages a foe: EFFECT" / "When attacked for 40+: EFFECT"
  const whenMatch = lower.match(/^when\s+(.+?):\s*(.+)$/);
  if (whenMatch) {
    effects.push({
      type: "trigger",
      event: whenMatch[1].trim(),
      effects: parseEffects(whenMatch[2]),
    });
    return effects;
  }

  // "No Phase shift next turn" / "User's Phase disabled next turn" -- the
  // Lunar Rod (Harvest Moon / Celestial Blessing) can suppress the next
  // turn's auto-advance. nextTurn consumes the game-level flag.
  if (
    /^(?:no|skip)\s+phase shift(?: next turn)?$/.test(lower) ||
    /^user'?s phase disabled next turn$/.test(lower)
  ) {
    effects.push({ type: "skipPhaseShift" });
    return effects;
  }

  // Phase slash-combo: "New/Full Moon: EFFECT" / "Waxing/Waning: EFFECT" --
  // two phases share one branch; the other two are the implicit else. The
  // else can arrive either as an inline "... Otherwise: Y" (Harvest Moon's
  // "1d10+2" plus-sign keeps the whole text in ONE clause) or as a separate
  // clause (Blood Moon), which parseEffects' loop attaches below.
  // "New/Full Moon" writes the first phase as a bare "new" (and the data
  // only ever shortens "new"/"full"), so both spellings are accepted and
  // normalized before building the condition.
  const slashPhaseMatch = lower.match(
    /^(new moon|new|waxing|full moon|full|waning)\s*\/\s*(new moon|waxing|full moon|waning):\s*(.+)$/,
  );
  if (slashPhaseMatch) {
    const norm = (p: string) =>
      p === "new" ? "new moon" : p === "full" ? "full moon" : p;
    const body = slashPhaseMatch[3];
    const elseAt = body.search(/\s+otherwise,?\s*:?\s*/i);
    const thenText = elseAt >= 0 ? body.slice(0, elseAt) : body;
    const elseText =
      elseAt >= 0
        ? body.slice(elseAt).replace(/^\s+otherwise,?\s*:?\s*/i, "")
        : undefined;
    effects.push({
      type: "conditional",
      condition: `phase is ${norm(slashPhaseMatch[1])} or ${norm(slashPhaseMatch[2])}`,
      thenEffects: parseEffects(thenText),
      elseEffects: elseText ? parseEffects(elseText) : undefined,
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

  // Phase-conditional sub-effect: "New Moon: EFFECT" / "Full Moon: EFFECT" etc.
  const phaseCondMatch = lower.match(
    /^(new moon|waxing|full moon|waning):\s*(.+)$/,
  );
  if (phaseCondMatch) {
    effects.push({
      type: "conditional",
      condition: `phase is ${phaseCondMatch[1]}`,
      thenEffects: parseEffects(phaseCondMatch[2]),
    });
    return effects;
  }

  // Subweapon requirement: "Requires Pilum." / "Requires Gladius or Pilum."
  // (Gladius class). Gated abilities may only be used while the named
  // subweapon is equipped; the resolve layer surfaces this as a marker.
  const requiresMatch = lower.match(/^requires\s+(.+?)\s*\.?$/);
  if (requiresMatch) {
    const weapons = parseSubweaponList(requiresMatch[1]);
    if (weapons.length > 0) {
      effects.push({ type: "requires", weapons });
      return effects;
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
      effects.push({ type: "switchWeapon", to: weapons });
      return effects;
    }
  }

  // "Swap subweapons (Standard)" -- free-form swap action.
  if (/^swap subweapons?/.test(lower)) {
    effects.push({
      type: "switchWeapon",
      to: ["gladius", "scutum", "pilum"],
    });
    return effects;
  }

  // Subweapon-conditional sub-effect: "Gladius: EFFECT" / "Scutum: EFFECT" /
  // "Pilum: EFFECT" -- each branch applies only while that subweapon is held.
  const subweaponCondMatch = lower.match(
    /^(gladius|scutum|pilum):\s*(.+)$/,
  );
  if (subweaponCondMatch) {
    effects.push({
      type: "conditional",
      condition: `subweapon is ${subweaponCondMatch[1]}`,
      thenEffects: parseEffects(subweaponCondMatch[2]),
    });
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

  // Crit threshold: "Crit on 18+" / "Crit on 14+" -- lowers the roll
  // needed to crit from the engine default of 20.
  const critModMatch = lower.match(/^crit\s+on\s+(\d+)\+?$/);
  if (critModMatch) {
    effects.push({ type: "critMod", threshold: parseInt(critModMatch[1]) });
    return effects;
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
    effects.push({
      type: "diceMod",
      kind,
      amount: sign * parseFloat(diceModMatch[2]),
      rounds: diceModMatch[4] ? parseInt(diceModMatch[4]) : undefined,
    });
    return effects;
  }

  // Miss-rate modifier: "+2 MR" / "-1 MR" / "+3 MR/1" (with duration).
  const mrModMatch = lower.match(/^([+-])\s*(\d+)\s+mr(?:\s*\/\s*(\d+))?$/);
  if (mrModMatch) {
    const sign = mrModMatch[1] === "-" ? -1 : 1;
    effects.push({
      type: "mrMod",
      amount: sign * parseInt(mrModMatch[2]),
      rounds: mrModMatch[3] ? parseInt(mrModMatch[3]) : undefined,
    });
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

  // Tile placement: "Place X tiles" or "X tiles"
  const tileEffect = parseTilePlacement(lower);
  if (tileEffect) {
    effects.push(tileEffect);
    return effects;
  }

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
  moonPhase?: string,
): ConditionOutcome {
  const lower = text.toLowerCase().trim();

  // Resource equalities like "5 Blood" / "0 Campaigns" / "no Campaigns" --
  // checked *before* the generic "not / no" negation wrapper so that
  // "no Campaigns" reads as "<user> has Campaigns == 0" rather than
  // "negation(<something unknown>)". We require the bare resource token
  // to be a known resource name (or its plural form, e.g. "Campaigns" ->
  // "Campaign") to avoid swallowing natural-language phrases like
  // "no target has Stun" as a resource lookup.
  const resourceEqMatch = lower.match(/^(\d+|zero|no)\s+([a-z]+)$/);
  if (resourceEqMatch) {
    const raw = resourceEqMatch[1];
    const value = raw === "zero" || raw === "no" ? 0 : parseInt(raw);
    const resource = canonicalResource(resourceEqMatch[2]);
    if (resource) {
      return (user.resources[resource] ?? 0) >= value ? "then" : "else";
    }
  }

  // Moon-phase condition, generated by the "New Moon: EFFECT" / "Full Moon:"
  // parser branch (condition text: "phase is new moon" / "phase is full moon").
  const phaseMatch = lower.match(/^phase is (new moon|waxing|full moon|waning)$/);
  if (phaseMatch) {
    const current = (moonPhase ?? "new moon").toLowerCase().trim();
    return current === phaseMatch[1] ? "then" : "else";
  }

  // Phase slash-combo condition ("phase is new moon or full moon"), generated
  // by the "New/Full Moon: EFFECT" parser branch -- true when the active phase
  // is EITHER of the two named phases.
  const phaseOrMatch = lower.match(
    /^phase is (new moon|waxing|full moon|waning) or (new moon|waxing|full moon|waning)$/,
  );
  if (phaseOrMatch) {
    const current = (moonPhase ?? "new moon").toLowerCase().trim();
    return current === phaseOrMatch[1] || current === phaseOrMatch[2]
      ? "then"
      : "else";
  }

  // "user has 2 Phases" -- Far Side of the Moon stores a chosen second phase
  // on the user (entity.phaseChoice); the condition holds while one exists.
  const twoPhasesMatch = lower.match(/^user has (?:2|two) phases?$/);
  if (twoPhasesMatch) {
    return user.phaseChoice ? "then" : "else";
  }

  // Subweapon condition, generated by the "Gladius: EFFECT" / "Scutum: EFFECT"
  // / "Pilum: EFFECT" parser branch (condition text: "subweapon is gladius"
  // etc.). Resolves against the user's equipped subweapon; entities without a
  // subweapon (non-Gladius classes) read as "" and so never match.
  const subweaponMatch = lower.match(
    /^subweapon is (gladius|scutum|pilum)$/,
  );
  if (subweaponMatch) {
    const current = normalizeSubweapon(user.subweapon) ?? "";
    return current === subweaponMatch[1] ? "then" : "else";
  }

  // Negation wrappers
  const negateMatch = lower.match(/^(?:not|no)\s+(.+)$/);
  if (negateMatch) {
    const inner = evaluateCondition(negateMatch[1], user, target, moonPhase);
    if (inner === "then") return "else";
    if (inner === "else") return "then";
    return "unknown";
  }

  // target is alive / dead / dies
  const aliveMatch = lower.match(/^target is (alive|dead)$/);
  if (aliveMatch) {
    const wantAlive = aliveMatch[1] === "alive";
    return target.curhp > 0 === wantAlive ? "then" : "else";
  }
  if (
    lower === "target dies" ||
    /target has been (killed|defeated)/.test(lower)
  ) {
    return target.curhp <= 0 ? "then" : "else";
  }

  // user/target has Status (matches any STATUS_NAMES)
  const statusMatch = lower.match(/^(user|target) has (?:a |an )?([a-z ]+?)$/);
  if (statusMatch) {
    const which = statusMatch[1];
    const candidates = statusMatch[2]
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

  // user/target has N <resource>
  const resourceMatch = lower.match(/^(user|target) has (\d+)\s+([a-z]+)$/);
  if (resourceMatch) {
    const which = resourceMatch[1];
    const amount = parseInt(resourceMatch[2]);
    const resource = resourceMatch[3];
    const entity = which === "user" ? user : target;
    return (entity.resources[resource] ?? 0) >= amount ? "then" : "else";
  }

  // user/target Stat positive|negative|zero
  const signMatch = lower.match(
    /^(user|target)\s+(atk|mag|pd|md|eva|mp|acc|cr)\s+(positive|negative|zero)$/,
  );
  if (signMatch) {
    const which = signMatch[1];
    const stat = signMatch[2];
    const sign = signMatch[3];
    const entity = which === "user" ? user : target;
    const v = getRawStat(entity, stat);
    if (sign === "positive") return v > 0 ? "then" : "else";
    if (sign === "negative") return v < 0 ? "then" : "else";
    return v === 0 ? "then" : "else";
  }

  // user Stat > N / < N / >= / <= / =
  const cmpMatch = lower.match(
    /^(user|target)\s+(atk|mag|pd|md|eva|mp|acc|cr)\s*(>=|<=|>|<|=)\s*(-?\d+)$/,
  );
  if (cmpMatch) {
    const which = cmpMatch[1];
    const stat = cmpMatch[2];
    const op = cmpMatch[3];
    const value = parseInt(cmpMatch[4]);
    const entity = which === "user" ? user : target;
    const v = getRawStat(entity, stat);
    if (op === ">") return v > value ? "then" : "else";
    if (op === ">=") return v >= value ? "then" : "else";
    if (op === "<") return v < value ? "then" : "else";
    if (op === "<=") return v <= value ? "then" : "else";
    return v === value ? "then" : "else";
  }

  // user Stat greater than / less than N (word variant)
  const wordCmpMatch = lower.match(
    /^(user|target)'?s?\s+(atk|mag|pd|md|eva|mp|acc|cr)\s+(greater than|less than|equal to)\s+(-?\d+)$/,
  );
  if (wordCmpMatch) {
    const which = wordCmpMatch[1];
    const stat = wordCmpMatch[2];
    const op = wordCmpMatch[3];
    const value = parseInt(wordCmpMatch[4]);
    const entity = which === "user" ? user : target;
    const v = getRawStat(entity, stat);
    if (op === "greater than") return v > value ? "then" : "else";
    if (op === "less than") return v < value ? "then" : "else";
    return v === value ? "then" : "else";
  }

  return "unknown";
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
        // Track the active moon phase on the game so "Phase is X"
        // conditions (e.g. "New Moon:") evaluate correctly downstream.
        game.moonPhase = effect.phase;
        messages.push(`  Phase shifts to ${effect.phase}.`);
        break;
      }

      case "choosePhase": {
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
        break;
      }

      case "skipPhaseShift": {
        // Harvest Moon / Celestial Blessing: no auto-advance at the next
        // turn boundary. nextTurn consumes (resets) the flag.
        game.skipMoonPhaseShift = true;
        messages.push(`  No Phase shift next turn.`);
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

      case "critMod": {
        // The crit threshold itself is consumed by extractCombatMetadata /
        // rollAccuracy in resolve.ts; here we just announce the marker so
        // the effect stream log reads naturally.
        messages.push(
          `  Crit threshold lowered to ${effect.threshold}+.`,
        );
        break;
      }

      case "diceMod": {
        const kindLabel =
          effect.kind === "baseDice"
            ? "base dice"
            : effect.kind === "diceFaces"
              ? "dice faces"
              : "dice";
        messages.push(
          `  Attack gains ${effect.amount > 0 ? "+" : ""}${effect.amount} ${kindLabel}${effect.rounds ? `/${effect.rounds}` : ""}.`,
        );
        break;
      }

      case "mrMod": {
        messages.push(
          `  Miss Rate ${effect.amount > 0 ? "+" : ""}${effect.amount}${effect.rounds ? `/${effect.rounds}` : ""}.`,
        );
        break;
      }

      case "requires": {
        messages.push(
          `  Requires ${effect.weapons.map(capitalize).join(" or ")}.`,
        );
        break;
      }

      case "switchWeapon": {
        if (effect.to.length === 1) {
          user.subweapon = effect.to[0];
          messages.push(`  ${user.num} switches to ${capitalize(effect.to[0])}.`);
        } else {
          // Multi-option switch ("Switch to Gladius or Scutum"): ask the
          // player which subweapon to equip, same prompt machinery as
          // `choose` clauses so resolve.ts can relay it to the user.
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
        break;
      }

      case "conditional": {
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
          const thenMsgs = yield* applyEffectStream(
            game,
            user,
            target,
            effect.thenEffects,
            ability,
          );
          messages.push(...thenMsgs.map((m) => `    ${m}`));
        }
        if (outcome === "else" && effect.elseEffects) {
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

      case "tile": {
        messages.push(
          `  ${user.num} attempts to place terrain. (Tile placement needed — pick a tile within ${effect.range} range)`,
        );
        break;
      }

      case "phaseEffect": {
        // Phase effects are applied at specific timing points in the pipeline.
        // When reached at the right phase, expand sub-effects.
        for (const sub of effect.effects) {
          const subMsgs = yield* applyEffectStream(
            game, user, target, [sub], ability,
          );
          messages.push(...subMsgs);
        }
        break;
      }

      case "per": {
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
          );
          messages.push(...perMsgs.map((m) => `    ${m}`));
        } else {
          messages.push(
            `  [Per ${effect.trigger}]: ${summariseEffects(effect.effects)}`,
          );
        }
        break;
      }

      case "trigger": {
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
          );
          messages.push(...trigMsgs.map((m) => `    ${m}`));
        } else {
          messages.push(
            `  [When ${effect.event}]: ${summariseEffects(effect.effects)}`,
          );
        }
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
    case "critMod":
      return `crit on ${eff.threshold}+`;
    case "diceMod":
      return `${eff.amount > 0 ? "+" : ""}${eff.amount} ${eff.kind === "baseDice" ? "base dice" : eff.kind === "diceFaces" ? "dice faces" : "dice"}`;
    case "mrMod":
      return `${eff.amount > 0 ? "+" : ""}${eff.amount} MR${eff.rounds ? `/${eff.rounds}` : ""}`;
    case "requires":
      return `requires ${eff.weapons.join(" or ")}`;
    case "switchWeapon":
      return `switch to ${eff.to.join(" or ")}`;
    case "channel":
      return `channel ${eff.stat} for ${eff.rounds}r`;
    case "phase":
      return `phase ${eff.phase}`;
    case "choosePhase":
      return "choose another phase";
    case "skipPhaseShift":
      return "no phase shift next turn";
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
    case "per":
      return `per ${eff.trigger} (...)`;
    case "trigger":
      return `when ${eff.event} (...)`;
    case "phaseEffect":
      return `[${eff.phase}] ...`;
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

export function extractCombatMetadata(
  effects: Effect[],
  subweapon?: string,
  moonPhase?: string,
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

  mergeCombatMetadata(out, effects, subweapon, moonPhase);
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
): void {
  for (const e of effects) {
    if (e.type === "conditional" && e.condition.startsWith("subweapon is ")) {
      // Only the matching branch's sub-effects count; the non-matching
      // branches are dead code for this user's equipped subweapon.
      const want = e.condition.slice("subweapon is ".length);
      if (subweapon && subweapon === want) {
        mergeCombatMetadata(out, e.thenEffects, subweapon, moonPhase);
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
      if (moonPhase && want.includes(moonPhase)) {
        mergeCombatMetadata(out, e.thenEffects, subweapon, moonPhase);
      }
      continue;
    }
    if (e.type === "damageMod") {
      if (e.percent) out.damagePercent += e.percent;
      if (typeof e.flat === "number") out.flatDamage += e.flat;
    } else if (e.type === "multiHit") {
      out.additionalHits = Math.max(out.additionalHits, e.hits - 1);
    } else if (e.type === "ignore") {
      classifyIgnore(e.what, out.ignore);
    } else if (e.type === "critMod") {
      out.critThreshold =
        out.critThreshold === null
          ? e.threshold
          : Math.min(out.critThreshold, e.threshold);
    } else if (e.type === "diceMod") {
      if (e.kind === "dice") out.extraDice += e.amount;
      else if (e.kind === "diceFaces") out.extraDiceFaces += e.amount;
      else out.extraBaseDice += e.amount;
    } else if (e.type === "mrMod") {
      out.mrMod += e.amount;
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
    classifyIgnoreFragment(fragment, out);
  }
}

function classifyIgnoreFragment(
  lower: string,
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
    out.other.push(lower);
    return;
  }

  out.other.push(lower);
}
