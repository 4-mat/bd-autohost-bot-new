import {
  type Game,
  type Entity,
  type AbilityData,
  type AbilityCost,
  rollAccuracy,
  dealDamage,
  removeEntity,
  inRange,
  pushEntity,
  pullEntity,
  getAoETargets,
  getSplashTargets,
  isConfused,
  placeTerrain,
  needsDirection,
  getDirectionCandidates,
  DIRECTION_LABELS,
} from "./state.js";
import { parseEffects, applyEffects } from "./effects.js";
import { rollDice, toId, posToStr } from "../utils.js";
import { Terrain } from "./state.js";

export interface ResolutionResult {
  messages: string[];
  deaths: Entity[];
  gameOver: boolean;
  confusionTriggered?: boolean;
}

function newResult(): ResolutionResult {
  return { messages: [], deaths: [], gameOver: false };
}

function offensiveStat(entity: Entity, damageType: string): number {
  return getEffectiveStat(entity, damageType === "Physical" ? "atk" : "mag");
}

function defensiveStat(entity: Entity, damageType: string): number {
  return getEffectiveStat(entity, damageType === "Physical" ? "pd" : "md");
}

function getEffectiveStat(entity: Entity, stat: string): number {
  let base = 0;
  switch (stat) {
    case "atk":
      base = entity.atk;
      break;
    case "mag":
      base = entity.mag;
      break;
    case "pd":
      base = entity.pd;
      break;
    case "md":
      base = entity.md;
      break;
    case "eva":
      base = entity.eva;
      break;
    case "mp":
      base = entity.mp;
      break;
  }
  for (const b of entity.buffs) {
    if (b.stat === stat) base += b.amount;
  }
  return Math.max(0, base);
}

function getStatBonus(entity: Entity, stat: string): number {
  let bonus = 0;
  for (const b of entity.buffs) {
    if (b.stat === stat) bonus += b.amount;
  }
  return bonus;
}

export interface SelectionOption {
  id: string;
  label: string;
}

export type AttackPrompt =
  | {
      kind: "selection";
      message: string;
      options: SelectionOption[];
    }
  | {
      kind: "direction";
      message: string;
      candidates: string[];
    }
  | {
      kind: "target";
      message: string;
      candidates: Entity[];
    }
  | {
      kind: "tile";
      message: string;
      validTiles: [number, number][];
      dir?: [number, number];
    };

export type PromptResponse = string;

export type AttackStep =
  | { done: false; prompt: AttackPrompt }
  | { done: true; result: ResolutionResult };

// ---------------------------------------------------------------------------
// The pipeline itself:
// Declare -> Selection/Costs -> Target -> Before Acc -> Acc -> Before Damage
// -> Damage -> On Hit/On Miss -> Regardless -> After Resolving
// ---------------------------------------------------------------------------

function* resolveAttackFlow(
  game: Game,
  user: Entity,
  ability: AbilityData,
  initialTarget?: string,
  initialDir?: [number, number],
): Generator<AttackPrompt, ResolutionResult, PromptResponse> {
  const result = newResult();
  let dir: [number, number] | undefined = initialDir;

  // --- Declare Attack ---
  // result.messages.push(`/me declares ${ability.name}`);

  // --- Auto-deduct non-prompted costs ---
  if (ability.cost && !ability.cost.prompt) {
    if (!autoDeductCost(user, ability.cost)) {
      result.messages.push(
        `${user.num} could not pay the cost for ${ability.name}.`,
      );
      return result;
    }
  }

  // --- Selection / Choices / Sacrifice / Pay Costs ---
  if (abilityNeedsSelection(ability)) {
    const choiceId = yield {
      kind: "selection",
      message: `Choose an option for ${ability.name}`,
      options: buildSelectionOptions(ability),
    };
    const paid = applySelection(user, ability, choiceId);
    if (!paid) {
      result.messages.push(
        `${user.num} could not pay the cost for ${ability.name}.`,
      );
      return result;
    }
  }

  // --- Direction (for directional AoE abilities like Cone, Line, Beam, Pierce) ---
  if (needsDirection(ability.range)) {
    const candidates = getDirectionCandidates(ability.range);
    if (candidates.length > 0 && !dir) {
      const dirLabel: string = yield {
        kind: "direction",
        message: `Choose a direction for ${ability.name}`,
        candidates,
      };
      dir = DIRECTION_LABELS[dirLabel.toUpperCase()];
      if (!dir) {
        result.messages.push(
          `${user.num} chose an invalid direction for ${ability.name}.`,
        );
        return result;
      }
    }
  }

  // --- Target (attack may not continue if nothing can be chosen) ---
  const isTileTarget = ability.targetGroup.toLowerCase().trim() === "tile";

  if (isTileTarget) {
    // Tile targeting: prompt for a tile position
    const tileCandidates = getTileCandidates(game, user, ability, dir);
    if (tileCandidates.length === 0) {
      result.messages.push(
        `${user.num} uses ${ability.name} but no valid tiles in range.`,
      );
      return result;
    }

    const tileRef: string =
      initialTarget ??
      (yield {
        kind: "tile",
        message: `Choose a tile for ${ability.name}`,
        validTiles: tileCandidates,
        dir,
      });

    const tilePos = parseTileRef(tileRef);
    if (
      !tilePos ||
      !tileCandidates.some(([r, c]) => r === tilePos[0] && c === tilePos[1])
    ) {
      result.messages.push(
        `${user.num} uses ${ability.name} on an invalid tile.`,
      );
      return result;
    }

    result.messages.push(
      `/me ${ability.name} @ ${posToStr(tilePos[0], tilePos[1])}, MR ${ability.mr}`,
    );

    // Apply effects at the tile position
    const effects = parseEffects(ability.effect);
    const tileMsgs = applyTileEffects(game, user, tilePos, effects);
    result.messages.push(...tileMsgs);

    setCooldown(user, ability);
    if (ability.maxUses) {
      user.usesUsed[ability.name] = (user.usesUsed[ability.name] ?? 0) + 1;
    }
    return result;
  }

  const {
    hits: hitCount,
    isAoE,
    targets: autoTargets,
  } = prepareTargeting(game, user, ability, dir);
  let targets = autoTargets;
  if (targets.length === 0) {
    const candidates = getTargetCandidates(game, user, ability);

    if (candidates.length === 0) {
      result.messages.push(
        `${user.num} uses ${ability.name} but no valid targets found.`,
      );
      return result;
    }

    const targetRef =
      initialTarget ??
      (yield {
        kind: "target",
        message: `Choose a target for ${ability.name}`,
        candidates,
      });

    targets = findTargets(game, user, ability, targetRef);

    if (targets.length === 0) {
      result.messages.push(
        `${user.num} uses ${ability.name} but no valid targets found.`,
      );
      return result;
    }
  }

  const targetNames = targets.map((t) => t.num).join(", ");
  const rollStr = ability.roll ? ` ${ability.roll}` : "";
  const actionTypeStr = ability.actionType === "Reaction" ? " (Reaction)" : "";
  result.messages.push(
    `/me ${ability.name} @ ${targetNames}, MR ${ability.mr},${rollStr}${actionTypeStr}`,
  );

  const isAttack =
    ability.damageType === "Physical" || ability.damageType === "Magical";
  const isHeal = ability.effect.toLowerCase().includes("heal") && !isAttack;
  const pushPullResult = parsePushPull(ability);

  for (const target of targets) {
    if (isAttack) {
      let confusionApplied = false;
      for (let h = 0; h < hitCount; h++) {
        const label = hitCount > 1 ? ` (Hit ${h + 1}/${hitCount})` : "";
        const singleResult = resolveSingleTarget(
          game,
          user,
          ability,
          target,
          label,
          confusionApplied,
        );
        result.messages.push(...singleResult.messages);
        result.deaths.push(...singleResult.deaths);

        if (!confusionApplied && singleResult.confusionTriggered) {
          confusionApplied = true;
        }

        if (
          pushPullResult &&
          singleResult.messages.some((m) => m.includes("HIT"))
        ) {
          applyPushPull(game, user, target, pushPullResult, result);
        }
      }
    } else if (isHeal) {
      const healResult = resolveHeal(game, user, ability, target);
      result.messages.push(...healResult.messages);
    } else {
      const statusResult = resolveNonDamaging(game, user, ability, target);
      result.messages.push(...statusResult.messages);
      result.deaths.push(...statusResult.deaths);
    }
  }

  if (isAttack && !isAoE && targets.length > 0) {
    const splashResult = resolveSplash(game, user, ability, targets[0]);
    result.messages.push(...splashResult.messages);
    result.deaths.push(...splashResult.deaths);
  }

  // --- After Resolving (cooldowns, use tracking, win check) ---
  setCooldown(user, ability);
  if (ability.maxUses) {
    user.usesUsed[ability.name] = (user.usesUsed[ability.name] ?? 0) + 1;
  }
  // Bug fix carried over: check win condition once after all deaths this
  // action, not once per death (was producing duplicate "Game over!" lines
  // on multi-kill splash/AoE).
  if (result.deaths.length > 0 && isWinCondition(game)) {
    result.gameOver = true;
    const winner = game.entities[0];
    result.messages.push(
      winner
        ? `**Game over! ${winner.num} (${winner.name}) wins!**`
        : "**Game over! No survivors!**",
    );
  }

  return result;
}

export function startAttack(
  game: Game,
  user: Entity,
  ability: AbilityData,
  target?: string,
  dir?: [number, number],
): AttackStep {
  const flow = resolveAttackFlow(game, user, ability, target, dir);
  user.pendingResolution = flow;
  return advanceAttack(user, flow, undefined as unknown as PromptResponse);
}

// %choose <optionId> -- only valid while a "selection" prompt is pending.
export function respondToChoice(user: Entity, choiceId: string): AttackStep {
  return respondToPromptOfKind(user, "selection", choiceId, "%choose");
}

// %target <ref> -- only valid while a "target" prompt is pending.
export function respondToTarget(user: Entity, targetRef: string): AttackStep {
  return respondToPromptOfKind(user, "target", targetRef, "%target");
}

// %tile <pos> -- only valid while a "tile" prompt is pending.
export function respondToTile(user: Entity, tileRef: string): AttackStep {
  return respondToPromptOfKind(user, "tile", tileRef, "%tile");
}

// %dir <label> -- only valid while a "direction" prompt is pending.
export function respondToDir(user: Entity, dirLabel: string): AttackStep {
  return respondToPromptOfKind(user, "direction", dirLabel, "%dir");
}

function parseTileRef(ref: string): [number, number] | null {
  const m = ref.toLowerCase().match(/^([a-z])\s*[, ]\s*(\d+)$/);
  if (!m) return null;
  const r = m[1].charCodeAt(0) - 97;
  const c = parseInt(m[2]) - 1;
  return r >= 0 && c >= 0 ? [r, c] : null;
}

// Apply effects for tile-targeted abilities (place terrain, etc.)
function applyTileEffects(
  game: Game,
  user: Entity,
  tilePos: [number, number],
  effects: import("./effects.js").Effect[],
): string[] {
  const msgs: string[] = [];
  for (const e of effects) {
    if (e.type === "tile") {
      const t = terrainFromName(e.terrain);
      if (t !== null) {
        placeTerrain(game, tilePos, t);
        msgs.push(
          `  ${user.num} places ${e.terrain} at ${posToStr(tilePos[0], tilePos[1])}.`,
        );
      }
    } else {
      msgs.push(`  ${e.type}: ${JSON.stringify(e)}`);
    }
  }
  return msgs;
}

function terrainFromName(name: string): Terrain | null {
  const map: Record<string, Terrain> = {
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
  return map[name.toLowerCase()] ?? null;
}

function respondToPromptOfKind(
  user: Entity,
  expectedKind: AttackPrompt["kind"],
  value: PromptResponse,
  commandName: string,
): AttackStep {
  const flow = user.pendingResolution as
    | Generator<AttackPrompt, ResolutionResult, PromptResponse>
    | undefined;
  if (!flow) {
    throw new Error(`${user.num} has no pending action awaiting a response.`);
  }
  if (user.pendingPromptKind !== expectedKind) {
    const wants =
      user.pendingPromptKind === "selection"
        ? "%choose"
        : user.pendingPromptKind === "direction"
          ? "%dir"
          : user.pendingPromptKind === "tile"
            ? "%tile"
            : "%target";
    throw new Error(
      `${user.num}'s pending action expects ${wants}, not ${commandName}.`,
    );
  }
  return advanceAttack(user, flow, value);
}

// TODO: work out how to handle the case where the generator throws an error

function advanceAttack(
  user: Entity,
  flow: Generator<AttackPrompt, ResolutionResult, PromptResponse>,
  input: PromptResponse,
): AttackStep {
  const step = flow.next(input);

  if (step.done === true) {
    user.pendingResolution = undefined;
    user.pendingPromptKind = undefined;
    return { done: true, result: step.value };
  }

  user.pendingPromptKind = step.value.kind;
  return { done: false, prompt: step.value };
}

// ---------------------------------------------------------------------------
// Cost / choice system — reads structured AbilityData.cost and .choices
// instead of parsing effect text.
// ---------------------------------------------------------------------------

function abilityNeedsSelection(ability: AbilityData): boolean {
  return !!(ability.choices?.length || ability.cost?.prompt);
}

function buildSelectionOptions(ability: AbilityData): SelectionOption[] {
  const opts: SelectionOption[] = [];
  if (ability.choices) {
    opts.push(...ability.choices);
  }
  if (ability.cost?.prompt) {
    const label = `Pay ${ability.cost.amount} ${ability.cost.type === "Resource" ? (ability.cost.resource ?? "") : ability.cost.type}`;
    // avoid duplicating if the only choice is the same as the cost
    if (!opts.some((o) => o.label === label)) {
      opts.push({ id: "pay_cost", label });
    }
  }
  return opts.length > 0 ? opts : [{ id: "confirm", label: "Confirm" }];
}

function autoDeductCost(user: Entity, cost: AbilityCost): boolean {
  if (cost.type === "HP") {
    if (user.curhp <= cost.amount) return false;
    user.curhp -= cost.amount;
    return true;
  }
  if (cost.type === "MP") {
    if (user.mp < cost.amount) return false;
    user.mp -= cost.amount;
    return true;
  }
  const pool = user.resources[cost.resource ?? ""] ?? 0;
  if (pool < cost.amount) return false;
  user.resources[cost.resource ?? ""] = pool - cost.amount;
  return true;
}

function applySelection(
  user: Entity,
  ability: AbilityData,
  choiceId: string,
): boolean {
  if (choiceId === "pay_cost" && ability.cost) {
    return autoDeductCost(user, ability.cost);
  }
  return true;
}

function getTargetCandidates(
  game: Game,
  user: Entity,
  ability: AbilityData,
): Entity[] {
  // Reuses the same in-range/valid-group filtering as auto-targeting, just
  // without requiring an explicit targetRef -- these become the buttons.
  const group = ability.targetGroup;
  const rangeParts = ability.range.toLowerCase().includes(" or ")
    ? ability.range.split(/\s+or\s+/i)
    : [ability.range];

  return game.entities.filter((e) => {
    if (e.num === user.num && !group.toLowerCase().includes("self"))
      return false;
    if (!isValidTarget(user, e, group)) return false;
    for (const rp of rangeParts) {
      if (inRange(game, user.pos, e.pos, rp.trim())) return true;
    }
    return false;
  });
}

// Returns valid tiles for tile-targeted abilities
function getTileCandidates(
  game: Game,
  user: Entity,
  ability: AbilityData,
  _dir?: [number, number],
): [number, number][] {
  const rangeParts = ability.range.toLowerCase().includes(" or ")
    ? ability.range.split(/\s+or\s+/i)
    : [ability.range];

  const tiles: [number, number][] = [];
  for (let r = 0; r < game.map.length; r++) {
    for (let c = 0; c < game.map[0].length; c++) {
      for (const rp of rangeParts) {
        if (inRange(game, user.pos, [r, c], rp.trim())) {
          tiles.push([r, c]);
          break;
        }
      }
    }
  }
  return tiles;
}

// ---------------------------
// Targeting / hit resolution
// ---------------------------

function prepareTargeting(
  game: Game,
  user: Entity,
  ability: AbilityData,
  dir?: [number, number],
): { hits: number; isAoE: boolean; targets: Entity[] } {
  const hits = parseMultiHit(ability);
  const range = ability.range.toLowerCase().trim();
  const isAoE =
    ability.targetAmount === "AoE" ||
    range.startsWith("burst") ||
    range.startsWith("cone") ||
    range.startsWith("line") ||
    range.startsWith("pierce") ||
    range.startsWith("beam") ||
    range.startsWith("star");

  let targets: Entity[] = [];
  if (isAoE) {
    targets = getAoETargets(
      game,
      user,
      ability.range,
      ability.targetGroup,
      dir,
    );
  }
  return { hits, isAoE, targets };
}

function findTargets(
  game: Game,
  user: Entity,
  ability: AbilityData,
  targetRef?: string,
): Entity[] {
  const group = ability.targetGroup;
  const range = ability.range;
  const rangeParts = range.toLowerCase().includes(" or ")
    ? range.split(/\s+or\s+/i)
    : [range];

  if (targetRef) {
    const ref = toId(targetRef);
    const target = game.entities.find(
      (e) => toId(e.num) === ref || toId(e.name) === ref,
    );
    if (target && isValidTarget(user, target, group)) {
      for (const rp of rangeParts) {
        if (inRange(game, user.pos, target.pos, rp.trim())) {
          return [target];
        }
      }
    }
    return [];
  }

  return game.entities.filter((e) => {
    if (e.num === user.num && !group.toLowerCase().includes("self"))
      return false;
    if (!isValidTarget(user, e, group)) return false;
    for (const rp of rangeParts) {
      if (inRange(game, user.pos, e.pos, rp.trim())) return true;
    }
    return false;
  });
}

function isValidTarget(user: Entity, target: Entity, group: string): boolean {
  if (target.curhp <= 0) return false;
  const g = group.toLowerCase();

  if (g.includes("self and allies") || g.includes("self and ally"))
    return target.team === user.team;
  if (g.includes("self or ally") || g.includes("self or allies"))
    return target.team === user.team;
  if (g.includes("self or foe")) return true;
  if (g.includes("foe or ally")) return target.num !== user.num;
  if (g.includes("self, foes, allies") || g.includes("self, foes, and allies"))
    return true;

  if (g === "self") return target.num === user.num;
  if (g === "ally") return target.team === user.team && target.num !== user.num;
  if (g === "foe") return target.team !== user.team;
  if (g === "any") return true;
  if (g === "tile") return false;

  return true;
}

function resolveSingleTarget(
  game: Game,
  user: Entity,
  ability: AbilityData,
  target: Entity,
  hitLabel = "",
  confusionAlreadyApplied = false,
): ResolutionResult {
  const result = newResult();

  const userAccBonus = getStatBonus(user, "acc");
  const targetEva = getEffectiveStat(target, "eva");
  const {
    hit,
    roll: accRoll,
    crit,
  } = rollAccuracy(ability.mr, targetEva, userAccBonus);

  result.messages.push(
    `  **Accuracy${hitLabel}**: ${user.num} rolls **${accRoll}** vs MR ${ability.mr} + EVA ${targetEva} = ${ability.mr + targetEva} -> ${hit ? "**HIT**" : "**MISS**"}${crit ? " (CRIT!)" : ""}`,
  );

  if (isConfused(user) && accRoll >= 16 && !confusionAlreadyApplied) {
    const offStat = Math.max(
      getEffectiveStat(user, "atk"),
      getEffectiveStat(user, "mag"),
    );
    dealDamage(user, offStat);
    result.messages.push(
      `  **${user.num} is Confused!** Takes **${offStat}** self-damage from their own ${offStat === getEffectiveStat(user, "atk") ? "ATK" : "MAG"} (${user.curhp}/${user.maxhp} HP).`,
    );
    result.confusionTriggered = true;

    if (user.curhp <= 0) {
      result.messages.push(
        `  **${user.num} (${user.name}) has been defeated by Confusion!**`,
      );
      removeEntity(game, user);
      result.deaths.push(user);
      // Bug fix: don't keep resolving a hit for an entity that just died.
      return result;
    }
  }

  if (!hit) return result;

  const damageRoll = rollDice(ability.roll);
  const userOff = offensiveStat(user, ability.damageType); // #5: computed once, reused below
  let baseDamage =
    damageRoll.total + userOff - defensiveStat(target, ability.damageType);

  if (crit) {
    const critRoll = rollDice(ability.roll);
    baseDamage += critRoll.total;
    result.messages.push(
      `  **Critical Hit!** Extra dice: ${critRoll.rolls.join("+")} = ${critRoll.total}`,
    );
  }

  const finalDamage = Math.max(0, baseDamage);
  const dmgResult = dealDamage(target, finalDamage);
  result.messages.push(
    `  **Damage${hitLabel}**: ${ability.roll}(${damageRoll.rolls.join("+")}) + ${ability.damageType === "Physical" ? "ATK" : "MAG"}(${userOff}) - ${ability.damageType === "Physical" ? "PD" : "MD"}(${defensiveStat(target, ability.damageType)}) = **${finalDamage}** -> ${target.num} (${target.curhp}/${target.maxhp} HP)`,
  );

  if (dmgResult.shieldAbsorbed > 0) {
    result.messages.push(
      `  **Shield** absorbed **${dmgResult.shieldAbsorbed}** damage.${dmgResult.shieldBreaks ? " Shield broken!" : ""}`,
    );
  }

  const effects = parseEffects(ability.effect);
  result.messages.push(...applyEffects(game, user, target, effects));

  if (target.curhp <= 0) {
    result.messages.push(
      `  **${target.num} (${target.name}) has been defeated!**`,
    );
    removeEntity(game, target);
    result.deaths.push(target);
  }

  return result;
}

function setCooldown(entity: Entity, ability: AbilityData) {
  const freq = ability.frequency.toLowerCase();
  if (freq === "every turn" || freq === "passive") return;
  if (freq === "eot") {
    entity.cooldowns[ability.name] = 2;
  } else if (freq === "e3t") {
    entity.cooldowns[ability.name] = 3;
  }
}

function isWinCondition(game: Game): boolean {
  if (game.mode.includes("ffa") || game.mode.includes("pvp")) {
    return game.entities.filter((e) => e.curhp > 0).length <= 1;
  }
  const teams = new Map<number, boolean>();
  for (const e of game.entities) {
    if (!teams.has(e.team)) teams.set(e.team, false);
    if (e.curhp > 0) teams.set(e.team, true);
  }
  return [...teams.values()].filter(Boolean).length <= 1;
}

function parseMultiHit(ability: AbilityData): number {
  const roll = ability.roll.toLowerCase();
  if (roll.includes("double hit")) return 2;
  if (roll.includes("triple hit")) return 3;
  if (roll.includes("quad")) return 4;
  return 1;
}

// #6: require a word boundary before "push"/"pull" so this doesn't
// false-positive on unrelated effect text that happens to contain the
// substring (e.g. a status literally named "Pushback"). Still a plain
// regex pass separate from parseEffects -- see note below.
function parsePushPull(
  ability: AbilityData,
): { type: "push" | "pull"; amount: number } | null {
  const effect = ability.effect.toLowerCase();
  const pushMatch = effect.match(/\bpush\s*(\d+)/);
  if (pushMatch) return { type: "push", amount: parseInt(pushMatch[1]) };
  const pullMatch = effect.match(/\bpull\s*(\d+)/);
  if (pullMatch) return { type: "pull", amount: parseInt(pullMatch[1]) };
  return null;
}

function applyPushPull(
  game: Game,
  user: Entity,
  target: Entity,
  pp: { type: "push" | "pull"; amount: number },
  result: ResolutionResult,
) {
  const move = pp.type === "push" ? pushEntity : pullEntity;
  const { moved, path } = move(game, target, user.pos, pp.amount);
  const label = pp.type === "push" ? "Push" : "Pull";
  if (moved > 0) {
    const pathStr = path.map((p) => posToStr(p[0], p[1])).join(" -> ");
    result.messages.push(
      `  **${label}**: ${target.num} ${pp.type === "push" ? "pushed" : "pulled"} ${moved} tile${moved > 1 ? "s" : ""} to ${pathStr}`,
    );
  } else {
    result.messages.push(
      `  **${label}**: ${target.num} could not be ${pp.type === "push" ? "pushed" : "pulled"}.`,
    );
  }
}

function resolveHeal(
  game: Game,
  user: Entity,
  ability: AbilityData,
  target: Entity,
): ResolutionResult {
  const result = newResult();

  if (ability.roll) {
    const healRoll = rollDice(ability.roll);
    let healAmount = healRoll.total;

    const effect = ability.effect.toLowerCase();
    if (effect.includes("atk") || effect.includes("mag")) {
      healAmount += Math.max(
        getEffectiveStat(user, "atk"),
        getEffectiveStat(user, "mag"),
      );
    }

    const prevHp = target.curhp;
    target.curhp = Math.min(target.maxhp, target.curhp + healAmount);
    const healed = target.curhp - prevHp;

    result.messages.push(
      `  **Heal**: ${ability.roll}(${healRoll.rolls.join("+")}) = **${healed}** -> ${target.num} (${target.curhp}/${target.maxhp} HP)`,
    );
  } else {
    result.messages.push(
      `  ${user.num} uses ${ability.name} on ${target.num}. (Manual resolution needed)`,
    );
  }

  return result;
}

function resolveNonDamaging(
  game: Game,
  user: Entity,
  ability: AbilityData,
  target: Entity,
): ResolutionResult {
  const result = newResult();
  const effects = parseEffects(ability.effect);
  const effectMsgs = applyEffects(game, user, target, effects);

  if (effectMsgs.length > 0) {
    result.messages.push(
      `  ${user.num} uses ${ability.name} on ${target.num}:`,
    );
    result.messages.push(...effectMsgs);
  } else {
    result.messages.push(
      `  ${user.num} uses ${ability.name} on ${target.num}. (Manual resolution may be needed)`,
    );
  }

  return result;
}

function resolveSplash(
  game: Game,
  user: Entity,
  ability: AbilityData,
  primary: Entity,
): ResolutionResult {
  const result = newResult();

  const range = ability.range.toLowerCase();
  const splashMatch = range.match(/\bsplash\s*(\d+)/);
  if (!splashMatch) return result;

  const radius = parseInt(splashMatch[1]);
  const splashTargets = getSplashTargets(
    game,
    user,
    primary,
    radius,
    ability.targetGroup,
  );
  if (splashTargets.length === 0) return result;

  const names = splashTargets.map((t) => t.num).join(", ");
  result.messages.push(`  **Splash ${radius}**: hits ${names}`);

  for (const target of splashTargets) {
    const damageRoll = rollDice(ability.roll);
    const half = (v: number) => Math.floor(v / 2);
    const baseDamage =
      damageRoll.total +
      offensiveStat(user, ability.damageType) -
      half(defensiveStat(target, ability.damageType));

    const finalDamage = Math.max(0, baseDamage);
    const dmgResult = dealDamage(target, finalDamage);
    result.messages.push(
      `  **Splash Damage**: -> ${target.num} (${target.curhp}/${target.maxhp} HP) = **${finalDamage}**`,
    );

    if (dmgResult.shieldAbsorbed > 0) {
      result.messages.push(
        `  **Shield** absorbed **${dmgResult.shieldAbsorbed}** damage.${dmgResult.shieldBreaks ? " Shield broken!" : ""}`,
      );
    }

    if (target.curhp <= 0) {
      result.messages.push(
        `  **${target.num} (${target.name}) has been killed!**`,
      );
      removeEntity(game, target);
      result.deaths.push(target);
    }
  }

  return result;
}

// Legacy entry point for existing callers that don't handle prompts yet. TO BE REMOVED

export function resolveAction(game: Game, user: Entity): AttackStep {
  const action = user.pendingAction;

  if (!action || action.type !== "attack") {
    return {
      done: true,
      result: newResult(),
    };
  }

  return startAttack(game, user, action.ability, action.target, action.dir);
}
