/**
 * Attack resolution pipeline for bd-autohost-bot-new.
 *
 * Declares -> Selection/Costs -> Target -> Before Acc -> Acc -> Before Damage
 * -> Damage -> On Hit/On Miss -> Regardless -> After Resolving
 *
 * Exports:
 * - ResolutionResult, AttackPrompt, PromptResponse types
 * - resolveAction(), startAttack(), respondToChoice/Target/Dir/Tile
 * - Core resolution pipeline: resolveAttackFlow, chooseTargets, resolveTargetAction
 * - Damage calculation: resolveHitDamage, resolveHeal, resolveSplash
 * - Cooldown/uses tracking: recordActionUsage, setCooldown
 * - Modifiers math: extractCombatMetadata, formatDamageModsLine, buildModTags
 * - Legacy: resolveAction() for existing callers
 *
 * Import: `import { resolveAction, startAttack } from "../game/resolve.js"`
 * or `import { rollAccuracy, dealDamage } from "../game/state.js"`
 */
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
  hasStatus,
  parseFrequency,
  needsDirection,
  getDirectionCandidates,
  DIRECTION_LABELS,
  placeTerrain,
  TERRAIN_NAMES,
} from "./state.js";
import { modeIdFor } from "../data/gamemodes.js";
import { matchesTargetGroup } from "./targeting.js";
import {
  parseEffects,
  applyEffects,
  applyEffectStream,
  extractCombatMetadata,
  normalizeSubweapon,
  requiredSubweapons,
  type CombatMetadata,
  type EffectChoosePrompt,
  type Effect,
  type PhaseTiming,
} from "./effects.js";
import { rollDice, toId, posToStr, capitalize } from "../utils.js";

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

// BD 4.3 evasion: physical uses PE (PD/10), magical uses ME (MD/10), max 9.
export function eva43(entity: Entity, damageType: string): number {
  const base =
    damageType === "Physical"
      ? getEffectiveStat(entity, "pd")
      : getEffectiveStat(entity, "md");
  const pen = hasStatus(entity, "poison") ? -2 : 0;
  return Math.max(0, Math.min(9, Math.floor(base / 10) + pen));
}

export function getEffectiveStat(entity: Entity, stat: string): number {
  let base = BASE_STATS[stat]?.(entity) ?? 0;
  for (const b of entity.buffs) {
    if (b.stat === stat) base += b.amount;
    // DEF raises both physical and magical defense
    if (b.stat === "def" && (stat === "pd" || stat === "md")) base += b.amount;
  }
  // Status passive effects
  if (stat === "eva" && hasStatus(entity, "poison")) base -= 2;
  if ((stat === "pd" || stat === "md") && hasStatus(entity, "curse")) base -= 4;
  return Math.max(0, base);
}

const BASE_STATS: Record<string, (e: Entity) => number> = {
  atk: (e) => e.atk,
  mag: (e) => e.mag,
  pd: (e) => e.pd,
  md: (e) => e.md,
  eva: (e) => e.eva,
  mp: (e) => e.mp,
};

export function getStatBonus(entity: Entity, stat: string): number {
  let bonus = 0;
  for (const b of entity.buffs) {
    if (b.stat === stat) bonus += b.amount;
  }
  // Status passive effects
  if (stat === "acc" && hasStatus(entity, "burn")) bonus -= 2;
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
      kind: "target";
      message: string;
      candidates: Entity[];
    }
  | {
      kind: "direction";
      message: string;
      candidates: string[];
    }
  | {
      kind: "tile";
      message: string;
      candidates: string[];
    };

export type PromptResponse = string;

type PushPullResult = { type: "push" | "pull"; amount: number };

export type AttackStep =
  | { done: false; prompt: AttackPrompt }
  | { done: true; result: ResolutionResult };

// ---------------------------------------------------------------------------
// Effect-stream driver
// ---------------------------------------------------------------------------

/**
 * Generator that drives an `applyEffectStream` while piping its
 * `EffectChoosePrompt`s outward as `AttackPrompt` (kind: selection). This
 * lets the existing selection-prompt machinery (the host/user feeding a
 * `%choose <optionId>` back through `advanceAttack`) handle player choices
 * inside effect clauses -- including nested choices in chosen sub-effects.
 *
 * Each pending prompt is one `AttackStep` round-trip out of
 * `resolveAttackFlow`. Once the effect stream is exhausted (no more
 * `choose` clauses), it yields all accumulated messages as its return
 * value.
 */
function* runEffectStream(
  gen: Generator<EffectChoosePrompt, string[], string>,
): Generator<AttackPrompt, string[], string> {
  let nextInput: string | undefined = undefined;
  while (true) {
    const step = gen.next(nextInput);
    nextInput = undefined;
    if (step.done) {
      return step.value as string[];
    }
    // EffectChoosePrompt maps cleanly onto AttackPrompt-selection: both
    // are "pick one of N labelled options" interactions.
    const prompt = step.value as EffectChoosePrompt;
    const chosenId: string = yield {
      kind: "selection",
      message: prompt.message,
      options: prompt.options,
    };
    nextInput = chosenId;
  }
}

/** Prompt for targets when the ability has none pre-selected. Returns
 * null (with a message already pushed) when no valid target exists. */
function* chooseTargets(
  game: Game,
  user: Entity,
  ability: AbilityData,
  initialTarget: string | undefined,
  result: ResolutionResult,
): Generator<AttackPrompt, Entity[] | null, PromptResponse> {
  const candidates = getTargetCandidates(game, user, ability);
  if (candidates.length === 0) {
    result.messages.push(
      `${user.num} uses ${ability.name} but no valid targets found.`,
    );
    return null;
  }

  const targetRef =
    initialTarget ??
    (yield {
      kind: "target",
      message: `Choose a target for ${ability.name}`,
      candidates,
    });

  const targets = findTargets(game, user, ability, targetRef);
  if (targets.length === 0) {
    result.messages.push(
      `${user.num} uses ${ability.name} but no valid targets found.`,
    );
    return null;
  }
  return targets;
}

/** If the ability has damageType "Varies", prompt for a variant and return
 * the resolved ability; otherwise return the ability unchanged. Returns null
 * (with a message pushed) when the variant choice can't be made. */
function* resolveVariantChoice(
  user: Entity,
  ability: AbilityData,
  result: ResolutionResult,
): Generator<AttackPrompt, AbilityData | null, PromptResponse> {
  if (ability.damageType !== "Varies") return ability;

  if (!ability.variants?.length) {
    result.messages.push(
      `${user.num} uses ${ability.name} but it has no damage variants.`,
    );
    return null;
  }
  const variantId = yield {
    kind: "selection",
    message: `Choose the type of ${ability.name}`,
    options: ability.variants.map((v) => ({ id: v.id, label: v.label })),
  };
  const variant = ability.variants.find((v) => v.id === variantId);
  if (!variant) {
    result.messages.push(
      `${user.num} cancels ${ability.name}: unknown variant.`,
    );
    return null;
  }
  return {
    ...ability,
    damageType: variant.damageType,
    range: variant.range ?? ability.range,
    effect: variant.effect ?? ability.effect,
  };
}

/** Prompt for a selection-based ability (choices / sacrifice / pay costs).
 * Returns true when paid, false (with a message pushed) when it can't. */
function* resolveSelection(
  user: Entity,
  ability: AbilityData,
  result: ResolutionResult,
): Generator<AttackPrompt, boolean, PromptResponse> {
  if (!abilityNeedsSelection(ability)) return true;

  const choiceId = yield {
    kind: "selection",
    message: `Choose an option for ${ability.name}`,
    options: buildSelectionOptions(ability),
  };
  if (applySelection(user, ability, choiceId)) return true;

  result.messages.push(
    `${user.num} could not pay the cost for ${ability.name}.`,
  );
  return false;
}

/** Prompt for a direction when the ability needs one and none is pending. */
function* resolveDirection(
  user: Entity,
  ability: AbilityData,
  active: AbilityData,
): Generator<AttackPrompt, string | undefined, PromptResponse> {
  if (!needsDirection(active)) return undefined;
  if (user.pendingAction?.direction) return user.pendingAction.direction;

  return yield {
    kind: "direction",
    message: `Choose a direction for ${ability.name}`,
    candidates: getDirectionCandidates(),
  };
}

// ---------------------------------------------------------------------------
// The pipeline itself:
// Declare -> Selection/Costs -> Target -> Before Acc -> Acc -> Before Damage
// -> Damage -> On Hit/On Miss -> Regardless -> After Resolving
// ---------------------------------------------------------------------------

/**
 * "Requires Pilum" abilities may only be used while that subweapon is
 * equipped. Returns a failure message when the gate blocks the ability,
 * or null when the user may proceed.
 */
function subweaponGateMessage(user: Entity, ability: AbilityData): string | null {
  const requires = requiredSubweapons(ability.effect);
  if (requires.length === 0) return null;
  const equipped = normalizeSubweapon(user.subweapon);
  if (equipped && requires.includes(equipped)) return null;
  return `${user.num} could not use ${ability.name}: requires the ${requires.map(capitalize).join(" or ")} subweapon${equipped ? ` (equipped: ${capitalize(equipped)})` : ""}.`;
}

/** Returns a failure message when an unprompted cost could not be paid. */
function autoCostMessage(user: Entity, ability: AbilityData): string | null {
  if (!ability.cost || ability.cost.prompt) return null;
  if (autoDeductCost(user, ability.cost)) return null;
  return `${user.num} could not pay the cost for ${ability.name}.`;
}

function* resolveAttackFlow(
  game: Game,
  user: Entity,
  ability: AbilityData,
  initialTarget?: string,
): Generator<AttackPrompt, ResolutionResult, PromptResponse> {
  const result = newResult();

  // --- Declare Attack ---
  // result.messages.push(`/me declares ${ability.name}`);

  // --- Subweapon requirement gate ---
  // "Requires Pilum" abilities may only be used while that subweapon is
  // equipped. Fail early (before costs/targeting) so the user sees the
  // requirement instead of a half-resolved action.
  const gateMsg = subweaponGateMessage(user, ability);
  if (gateMsg) {
    result.messages.push(gateMsg);
    return result;
  }

  // --- Auto-deduct non-prompted costs ---
  const costMsg = autoCostMessage(user, ability);
  if (costMsg) {
    result.messages.push(costMsg);
    return result;
  }

  // --- Selection / Choices / Sacrifice / Pay Costs ---
  const paid = yield* resolveSelection(user, ability, result);
  if (!paid) return result;

  // --- Variant choice for damageType "Varies" ---
  const active = yield* resolveVariantChoice(user, ability, result);
  if (!active) return result;

  // --- Direction prompt for AoE abilities ---
  const dir = yield* resolveDirection(user, ability, active);

  // --- Target (attack may not continue if nothing can be chosen) ---
  const {
    hits: hitCount,
    isAoE,
    targets: autoTargets,
  } = prepareTargeting(game, user, active);
  let targets = autoTargets;
  if (targets.length === 0) {
    const chosen = yield* chooseTargets(
      game,
      user,
      active,
      initialTarget,
      result,
    );
    if (chosen === null) return result;
    targets = chosen;
  }

  const targetNames = targets.map((t) => t.num).join(", ");
  const rollStr = active.roll ? ` ${active.roll}` : "";
  const actionTypeStr = active.actionType === "Reaction" ? " (Reaction)" : "";
  result.messages.push(
    `/me ${active.name} @ ${targetNames}, MR ${active.mr},${rollStr}${actionTypeStr}`,
  );

  const isAttack =
    active.damageType === "Physical" || active.damageType === "Magical";
  const isHeal = active.effect.toLowerCase().includes("heal") && !isAttack;
  const pushPullResult = parsePushPull(active);

  // Combat metadata walks the whole effect tree once for `Multi-Hit: N`,
  // `+N% damage`, `+N DMG`, and `Ignores …` clauses. The base hit count
  // already reflects roll-field keywords like "Double Hit" via
  // parseMultiHit(); meta.additionalHits adds the effect-driven extra hits
  // on top. We take the max so a "+Double Hit" roll + a "Multi-Hit: 4"
  // effect still rolls the highest of the two.
  const effects = parseEffects(active.effect);
  const combat = extractCombatMetadata(
    effects,
    normalizeSubweapon(user.subweapon),
  );
  const effectiveHitCount = Math.max(hitCount, 1 + combat.additionalHits);

  for (const target of targets) {
    const userDefeated = yield* resolveTargetAction(
      game,
      user,
      active,
      target,
      combat,
      effectiveHitCount,
      isAttack,
      isHeal,
      pushPullResult,
      result,
    );
    if (userDefeated) break;
  }

  resolveSplashFor(
    game,
    user,
    active,
    targets,
    combat,
    isAttack,
    isAoE,
    result,
  );

  // --- After Resolving (cooldowns, use tracking, win check) ---
  recordActionUsage(user, active);
  checkActionWin(game, result);

  return result;
}

/** Apply splash damage to nearby tiles when a single-target attack hits. */
function resolveSplashFor(
  game: Game,
  user: Entity,
  active: AbilityData,
  targets: Entity[],
  combat: CombatMetadata,
  isAttack: boolean,
  isAoE: boolean,
  result: ResolutionResult,
): void {
  if (!isAttack || isAoE || targets.length === 0) return;
  const splashResult = resolveSplash(game, user, active, targets[0], combat);
  result.messages.push(...splashResult.messages);
  result.deaths.push(...splashResult.deaths);
}

/** Resolve one ability against one target (attack hits / heal / status).
 * Returns true if the attacker (user) was defeated and resolution should stop. */
function* resolveTargetAction(
  game: Game,
  user: Entity,
  active: AbilityData,
  target: Entity,
  combat: CombatMetadata,
  effectiveHitCount: number,
  isAttack: boolean,
  isHeal: boolean,
  pushPullResult: PushPullResult | null,
  result: ResolutionResult,
): Generator<AttackPrompt, boolean, PromptResponse> {
  if (isAttack) {
    let confusionApplied = false;
    for (let h = 0; h < effectiveHitCount; h++) {
      const label =
        effectiveHitCount > 1 ? ` (Hit ${h + 1}/${effectiveHitCount})` : "";
      const singleResult: ResolutionResult = yield* resolveSingleTarget(
        game,
        user,
        active,
        target,
        combat,
        label,
        confusionApplied,
      );
      result.messages.push(...singleResult.messages);
      result.deaths.push(...singleResult.deaths);

      // If the attacker was defeated by recoil or confusion, stop remaining hits
      if (singleResult.deaths.some((d) => d.num === user.num)) {
        return true;
      }

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
    const healResult = resolveHeal(game, user, active, target);
    result.messages.push(...healResult.messages);
  } else {
    const statusResult: ResolutionResult = yield* resolveNonDamaging(
      game,
      user,
      active,
      target,
    );
    result.messages.push(...statusResult.messages);
    result.deaths.push(...statusResult.deaths);
  }
  return false;
}

/** Track cooldown + use count after an ability resolves. */
function recordActionUsage(user: Entity, active: AbilityData) {
  setCooldown(user, active);
  const { uses } = parseFrequency(active.frequency);
  if (active.maxUses ?? uses) {
    user.usesUsed[active.name] = (user.usesUsed[active.name] ?? 0) + 1;
  }
}

/**
 * Check win condition once after all deaths this action (not once per
 * death — that produced duplicate "Game over!" lines on multi-kill
 * splash/AoE).
 */
function checkActionWin(game: Game, result: ResolutionResult) {
  if (result.deaths.length === 0 || !isWinCondition(game)) return;
  result.gameOver = true;
  const winner = game.entities[0];
  result.messages.push(
    winner
      ? `**Game over! ${winner.num} (${winner.name}) wins!**`
      : "**Game over! No survivors!**",
  );
}

export function startAttack(
  game: Game,
  user: Entity,
  ability: AbilityData,
  target?: string,
  dir?: string,
): AttackStep {
  if (dir && user.pendingAction) {
    user.pendingAction.direction = dir;
  }
  const flow = resolveAttackFlow(game, user, ability, target);
  user.pendingResolution = flow;
  // undefined passed as initial prompt input — advanceAttack handles the
  // undefined case by yielding a prompt kind for the caller to respond to.
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

// %dir <direction> -- only valid while a "direction" prompt is pending.
export function respondToDir(user: Entity, dir: string): AttackStep {
  return respondToPromptOfKind(user, "direction", dir, "%dir");
}

// %tile <tileRef> -- only valid while a "tile" prompt is pending.
export function respondToTile(user: Entity, tileRef: string): AttackStep {
  return respondToPromptOfKind(user, "tile", tileRef, "%tile");
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
    const kindMap: Record<string, string> = {
      selection: "%choose",
      target: "%target",
      direction: "%dir",
      tile: "%tile",
    };
    const wants = kindMap[user.pendingPromptKind ?? ""] ?? "%target";
    throw new Error(
      `${user.num}'s pending action expects ${wants}, not ${commandName}.`,
    );
  }
  return advanceAttack(user, flow, value);
}

function advanceAttack(
  user: Entity,
  flow: Generator<AttackPrompt, ResolutionResult, PromptResponse>,
  input: PromptResponse,
): AttackStep {
  let step: IteratorResult<AttackPrompt, ResolutionResult>;
  try {
    step = flow.next(input);
  } catch (e) {
    // A throwing generator means resolution died mid-stream (e.g. a
    // malformed ability in the data). The generator is now exhausted:
    // subsequent .next() calls return {done:true} with no result, so we
    // must clear it here or the user stays stuck on a dangling prompt that
    // crashes finishStep. Report the failure as a completed step so the
    // pending action is cleaned up like any other resolution; %back can
    // still undo any partial effects via the snapshot.
    user.pendingResolution = undefined;
    user.pendingPromptKind = undefined;
    console.error("Attack resolution failed:", e);
    return {
      done: true,
      result: {
        messages: [
          `${user.num}'s action failed to resolve: ${
            e instanceof Error ? e.message : String(e)
          }.`,
        ],
        deaths: [],
        gameOver: false,
      },
    };
  }

  if (step.done === true) {
    user.pendingResolution = undefined;
    user.pendingPromptKind = undefined;
    user.pendingPrompt = undefined;
    return { done: true, result: step.value };
  }

  user.pendingPromptKind = step.value.kind;
  user.pendingPrompt = step.value;
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

function getTileCandidates(
  game: Game,
  user: Entity,
  ability: AbilityData,
): string[] {
  const tiles: string[] = [];
  const rangeStr = ability.range.toLowerCase().trim();
  const rangeMatch = rangeStr.match(/(?:range|homing)\s*(\d+)/);
  const range = rangeMatch ? parseInt(rangeMatch[1]) : 3;

  for (let r = 0; r < game.map.length; r++) {
    for (let c = 0; c < game.map[0].length; c++) {
      const d = Math.abs(r - user.pos[0]) + Math.abs(c - user.pos[1]);
      if (d === 0) continue;
      if (d > range) continue;
      tiles.push(posToStr(r, c));
    }
  }
  return tiles;
}

function parseTileRef(ref: string): [number, number] | null {
  const parts = ref.split(",");
  if (parts.length === 2) {
    const r = parseInt(parts[0]);
    const c = parseInt(parts[1]);
    if (!isNaN(r) && !isNaN(c)) return [r, c];
  }
  // Letter-number format: A1, B3, etc.
  const match = ref.match(/^([a-zA-Z])\s*(\d+)$/);
  if (match) {
    const r = match[1].toUpperCase().charCodeAt(0) - 65;
    const c = parseInt(match[2]) - 1;
    if (r >= 0 && c >= 0) return [r, c];
  }
  return null;
}

// ---------------------------
// Targeting / hit resolution
// ---------------------------

function prepareTargeting(
  game: Game,
  user: Entity,
  ability: AbilityData,
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
    targets = getAoETargets(game, user, ability.range, ability.targetGroup);
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

export function isValidTarget(
  user: Entity,
  target: Entity,
  group: string,
): boolean {
  if (target.curhp <= 0) return false;
  return matchesTargetGroup(user, target, group.toLowerCase());
}

/** Filter effects array to those matching a specific phase. */
function filterByPhase(effects: Effect[], phase: PhaseTiming): Effect[] {
  return effects.filter((e) => e.type === "phaseEffect" && e.phase === phase);
}

/** Returns effects that fire on hit (all non-PhaseEffect effects). PhaseEffect wrappers are applied at their specific timing points. */
function filterNonPhase(effects: Effect[]): Effect[] {
  return effects.filter((e) => e.type !== "phaseEffect");
}

function* resolveSingleTarget(
  game: Game,
  user: Entity,
  ability: AbilityData,
  target: Entity,
  combat: CombatMetadata,
  hitLabel = "",
  confusionAlreadyApplied = false,
): Generator<AttackPrompt, ResolutionResult, string> {
  const result = newResult();

  // Parse effects once, before any phase hooks.
  const allEffects = parseEffects(ability.effect);

  // --- Before Accuracy ---
  const beforeAccEffects = filterByPhase(allEffects, "before-acc");
  if (beforeAccEffects.length > 0) {
    const accMsgs = yield* runEffectStream(
      applyEffectStream(game, user, target, beforeAccEffects, ability),
    );
    result.messages.push(...accMsgs);
  }

  const userAccBonus = getStatBonus(user, "acc");
  const targetEva =
    game.version === "4.3"
      ? eva43(target, ability.damageType)
      : getEffectiveStat(target, "eva");
  const effectiveMr = ability.mr + combat.mrMod;
  const critThreshold = combat.critThreshold ?? 20;
  const {
    hit,
    roll: accRoll,
    crit,
  } = rollAccuracy(effectiveMr, targetEva, userAccBonus, critThreshold);

  const critNote = critThreshold !== 20 ? ` (crit on ${critThreshold}+)` : "";
  result.messages.push(
    `  **Accuracy${hitLabel}**: ${user.num} rolls **${accRoll}** vs MR ${effectiveMr} + EVA ${targetEva} = ${effectiveMr + targetEva} -> ${hit ? "**HIT**" : "**MISS**"}${crit ? " (CRIT!)" : ""}${critNote}`,
  );

  // --- Hit resolves first (damage to target first) ---
  if (hit) {
    const resolved = yield* resolveHitDamage(
      game,
      user,
      ability,
      target,
      combat,
      crit,
      hitLabel,
      result,
    );
    if (resolved === "user-defeated") return result;
  } else {
    yield* applyOnMissEffects(game, user, target, ability, allEffects, result);
  }

  // --- Regard of Hit ---
  const regardlessEffects = filterByPhase(allEffects, "regardless");
  if (regardlessEffects.length > 0) {
    const regMsgs = yield* runEffectStream(
      applyEffectStream(game, user, target, regardlessEffects, ability),
    );
    result.messages.push(...regMsgs);
  }

  // --- Confusion triggers after the hit resolves (regardless of hit/miss) ---
  resolveConfusionSelfDamage(
    game,
    user,
    accRoll,
    confusionAlreadyApplied,
    result,
  );

  return result;
}

/**
 * Apply miss-only effects on a failed accuracy roll: the legacy
 * `onMiss` effects route to the attacker, while phase-tagged
 * "On Miss:" clauses route to the target like the other phases.
 */
function* applyOnMissEffects(
  game: Game,
  user: Entity,
  target: Entity,
  ability: AbilityData,
  allEffects: Effect[],
  result: ResolutionResult,
): Generator<AttackPrompt, void, PromptResponse> {
  // On Miss: apply miss-only effects to the attacker
  const onMiss = parseEffects(ability.effect).filter((e) => e.type === "onMiss");
  if (onMiss.length > 0) {
    result.messages.push(`  [On Miss]`);
    for (const om of onMiss) {
      const missMsgs = yield* runEffectStream(
        applyEffectStream(game, user, user, om.effects, ability),
      );
      result.messages.push(...missMsgs);
    }
  }

  // On Miss (phase-tagged)
  const onMissEffects = filterByPhase(allEffects, "on-miss");
  if (onMissEffects.length > 0) {
    const missMsgs = yield* runEffectStream(
      applyEffectStream(game, user, target, onMissEffects, ability),
    );
    result.messages.push(...missMsgs);
  }
}

/**
 * Resolve the damage portion of a hit: roll, crit, modifiers, recoil,
 * and deaths. Returns "user-defeated" if recoil killed the attacker.
 */
function* resolveHitDamage(
  game: Game,
  user: Entity,
  ability: AbilityData,
  target: Entity,
  combat: CombatMetadata,
  crit: boolean,
  hitLabel: string,
  result: ResolutionResult,
): Generator<AttackPrompt, "user-defeated" | "done", string> {
  const allEffects = parseEffects(ability.effect);

  // --- Before Damage ---
  const beforeDmgEffects = filterByPhase(allEffects, "before-damage");
  if (beforeDmgEffects.length > 0) {
    const dmgMsgs = yield* runEffectStream(
      applyEffectStream(game, user, target, beforeDmgEffects, ability),
    );
    result.messages.push(...dmgMsgs);
  }

  const effectiveRoll = effectiveRollFormula(ability.roll, combat);
  const damageRoll = rollDice(effectiveRoll);
  const userOff = combat.ignore.atkMag
    ? 0
    : offensiveStat(user, ability.damageType);
  const targetDef = applyIgnoreToDefense(
    defensiveStat(target, ability.damageType),
    combat.ignore,
  );

  let baseDamage = damageRoll.total + userOff - targetDef;

  if (crit) {
    // Crit re-rolls only the base dice (+ base-dice extras); plain
    // "+N dice" are not doubled.
    const critFormula = effectiveRollFormula(ability.roll, combat, true);
    const critRoll = rollDice(critFormula);
    baseDamage += critRoll.total;
    result.messages.push(
      `  **Critical Hit!** Extra dice: ${critRoll.rolls.join("+")} = ${critRoll.total}${critFormula !== effectiveRoll ? ` (${critFormula})` : ""}`,
    );
  }

  const bleed = hasStatus(user, "bleed") ? 5 : 0;
  // Apply damage modifiers: "+N% damage" / "+N DMG" / "-N% damage".
  // BD 4.4 stacks these additively, so two "+30%" clauses = +60%, not a
  // multiplicative 1.69x. extractCombatMetadata already summed the
  // percent values additively.
  let finalDamage = baseDamage * (1 + combat.damagePercent / 100);
  finalDamage += combat.flatDamage;
  finalDamage = Math.max(0, Math.floor(finalDamage));
  finalDamage = Math.max(0, finalDamage - bleed);

  const dmgResult = dealDamage(target, finalDamage);
  const bleedLabel = bleed > 0 ? ` - Bleed(${bleed})` : "";
  result.messages.push(
    `  **Damage${hitLabel}**: ${effectiveRoll}(${damageRoll.rolls.join("+")}) + ${ability.damageType === "Physical" ? "ATK" : "MAG"}(${userOff}) - ${ability.damageType === "Physical" ? "PD" : "MD"}(${targetDef})${formatDamageModsLine(combat, ability.roll)}${bleedLabel} = **${finalDamage}** -> ${target.num} (${target.curhp}/${target.maxhp} HP)`,
  );
  emitDamageModTrail(result.messages, combat, finalDamage, ability.roll);

  if (dmgResult.shieldAbsorbed > 0) {
    result.messages.push(
      `  **Shield** absorbed **${dmgResult.shieldAbsorbed}** damage.${dmgResult.shieldBreaks ? " Shield broken!" : ""}`,
    );
  }

  // --- On Hit effects (non-phase-tagged effects fire here) ---
  const onHitEffects = filterNonPhase(allEffects);
  const effectMsgs = yield* runEffectStream(
    applyEffectStream(game, user, target, onHitEffects, ability),
  );
  result.messages.push(...effectMsgs);

  // Apply recoil damage after hit damage (reuse the parsed `allEffects`
  // array rather than re-running the regex-based clause splitter).
  // Recoil scales off the post-mod `finalDamage` so a "+30% damage /
  // Recoil 25%" combo reflects the boosted total.
  for (const e of allEffects) {
    if (e.type === "recoil") {
      const recoilDmg = Math.ceil(finalDamage * (e.percent / 100));
      dealDamage(user, recoilDmg);
      result.messages.push(
        `  **Recoil!** ${user.num} takes **${recoilDmg}** (${e.percent}% of ${finalDamage}) (${user.curhp}/${user.maxhp} HP).`,
      );
    }
  }

  if (target.curhp <= 0) {
    result.messages.push(
      `  **${target.num} (${target.name}) has been defeated!**`,
    );
    removeEntity(game, target);
    result.deaths.push(target);
  }

  // Check if recoil killed the user (after target death is recorded)
  if (user.curhp <= 0) {
    result.messages.push(
      `  **${user.num} (${user.name}) has been defeated by Recoil!**`,
    );
    removeEntity(game, user);
    result.deaths.push(user);
    return "user-defeated";
  }

  return "done";
}

/** Self-damage from Confusion, applied after the hit resolves. */
function resolveConfusionSelfDamage(
  game: Game,
  user: Entity,
  accRoll: number,
  confusionAlreadyApplied: boolean,
  result: ResolutionResult,
) {
  if (!isConfused(user) || accRoll < 16 || confusionAlreadyApplied) return;
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
  }
}

// ---------------------------------------------------------------------------
// Damage-mod math helpers
// ---------------------------------------------------------------------------

/**
 * Apply ignore-clause semantics to a target's defensive stat (PD or MD).
 *
 * Order of precedence (deepest reduction wins):
 *   1. "Ignores DEF"                       -> 0
 *   2. "Ignores 1/4 DEF"                   -> floor(raw / 4)
 *   3. "Ignores 1/2 DEF" / "half DEF"      -> floor(raw / 2)
 *   4. "Ignores X DEF" / "ignores up to …
 *      DEF"                                -> max(0, raw - X)
 *
 * If multiple reductions appear in a single effect ("Ignores DEF AND 5
 * DEF") the strongest (full-zero) wins; a clause that mixes a fraction
 * and a numeric subtract is rare in real data and we conservatively
 * apply the fraction first and then subtract.
 */
function applyIgnoreToDefense(
  raw: number,
  ignore: CombatMetadata["ignore"],
): number {
  if (ignore.def) return 0;
  let def = raw;
  if (ignore.quarterDef) def = Math.floor(def / 4);
  else if (ignore.halfDef) def = Math.floor(def / 2);
  def = Math.max(0, def - ignore.defReduction);
  return def;
}

/**
 * Build a short trace line that the **Damage** log can append after the
 * base = dice + OFF - DEF equation, so the player can see adjustments.
 * Returns "" when no modifier changed the math.
 */
function formatDamageModsLine(combat: CombatMetadata, roll: string): string {
  const parts: string[] = [];
  if (combat.ignore.atkMag) parts.push("no OFF (Ignores ATK/MAG)");
  if (combat.ignore.def) parts.push("no DEF (Ignores DEF)");
  else if (combat.ignore.quarterDef) parts.push("1/4 DEF");
  else if (combat.ignore.halfDef) parts.push("1/2 DEF");
  else if (combat.ignore.defReduction > 0)
    parts.push(`-${combat.ignore.defReduction} DEF`);
  if (combat.damagePercent !== 0) {
    const sign = combat.damagePercent > 0 ? "+" : "";
    parts.push(`${sign}${combat.damagePercent}% damage`);
  }
  if (combat.flatDamage !== 0) {
    const sign = combat.flatDamage > 0 ? "+" : "";
    parts.push(`${sign}${combat.flatDamage} flat`);
  }
  parts.push(...diceModTags(combat, roll));
  if (parts.length === 0) return "";
  return ` [${parts.join(", ")}]`;
}

/**
 * Push a follow-up log line so the operator can see the breakdown after
 * a "+30% damage" or "Ignores 5 DEF" kick in. Includes a clause-by-clause
 * echo for transparency even when the resulting damage has no fractional
 * pieces.
 */
function emitDamageModTrail(
  log: string[],
  combat: CombatMetadata,
  finalDamage: number,
  roll: string,
): void {
  if (!hasDamageMods(combat)) return;
  log.push(
    `  *Damage Modifiers applied:* ${buildModTags(combat, roll).join(", ")} -> **${finalDamage}**`,
  );
}

/** Whether any damage modifier changed the math (no trail if none). */
function hasDamageMods(combat: CombatMetadata): boolean {
  const { ignore } = combat;
  return (
    combat.damagePercent !== 0 ||
    combat.flatDamage !== 0 ||
    ignore.atkMag ||
    ignore.def ||
    ignore.halfDef ||
    ignore.quarterDef ||
    ignore.defReduction > 0 ||
    ignore.other.length > 0 ||
    ignore.outsideFactors ||
    combat.critThreshold !== null ||
    combat.extraDice !== 0 ||
    combat.extraDiceFaces !== 0 ||
    combat.extraBaseDice !== 0 ||
    combat.mrMod !== 0
  );
}

/** Human-readable tags describing the applied damage modifiers. */
function buildModTags(combat: CombatMetadata, roll?: string): string[] {
  const tags: string[] = [];
  if (combat.damagePercent !== 0) {
    const sign = combat.damagePercent > 0 ? "+" : "";
    tags.push(`${sign}${combat.damagePercent}% damage`);
  }
  if (combat.flatDamage !== 0) {
    const sign = combat.flatDamage > 0 ? "+" : "";
    tags.push(`${sign}${combat.flatDamage} DMG`);
  }
  if (combat.ignore.atkMag) tags.push("Ignores ATK/MAG");
  if (combat.ignore.def) tags.push("Ignores DEF");
  else if (combat.ignore.quarterDef) tags.push("Ignores 1/4 DEF");
  else if (combat.ignore.halfDef) tags.push("Ignores half DEF");
  if (combat.ignore.defReduction > 0)
    tags.push(`Ignores ${combat.ignore.defReduction} DEF`);
  if (combat.ignore.outsideFactors) tags.push("Ignores outside damage factors");
  for (const o of combat.ignore.other) tags.push(`Ignores ${o}`);
  if (roll) tags.push(...diceModTags(combat, roll));
  return tags;
}

/**
 * Build the effective dice formula for an ability's roll given parsed
 * dice modifiers ("+N dice" / "+N dice faces" / "+N base dice").
 * Extra dice increase the die count, extra faces increase each die's
 * sides, and base dice are ordinary dice that happen to double on crit
 * via the normal crit re-roll. Falls back to the raw formula when the
 * roll can't be parsed or no modifiers apply.
 *
 * When `forCrit` is set, only base dice (plus "+N base dice" extras) are
 * re-rolled -- plain "+N dice" do NOT double on crit, per the standard
 * Battle Dome convention.
 */
function effectiveRollFormula(
  roll: string,
  combat: CombatMetadata,
  forCrit = false,
): string {
  if (combat.extraDice === 0 && combat.extraDiceFaces === 0 && combat.extraBaseDice === 0) {
    return roll;
  }
  const m = roll.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!m) return roll;
  const count = Math.max(
    1,
    parseInt(m[1]) +
      (forCrit ? combat.extraBaseDice : combat.extraDice + combat.extraBaseDice),
  );
  const sides = Math.max(1, parseInt(m[2]) + combat.extraDiceFaces);
  return `${count}d${sides}${m[3] ?? ""}`;
}

/**
 * Tag strings for active dice modifiers ("+2 dice" / "+1 base dice" /
 * "+3 dice faces"). Returns [] when the roll formula can't be parsed --
 * the modifiers can't be applied to an unparseable roll, so showing them
 * next to the raw formula would be misleading.
 */
function diceModTags(combat: CombatMetadata, roll: string): string[] {
  if (!/^\d+d\d+([+-]\d+)?$/.test(roll.trim())) return [];
  const tags: string[] = [];
  if (combat.extraDice !== 0)
    tags.push(`${combat.extraDice > 0 ? "+" : ""}${combat.extraDice} dice`);
  if (combat.extraBaseDice !== 0)
    tags.push(`${combat.extraBaseDice > 0 ? "+" : ""}${combat.extraBaseDice} base dice`);
  if (combat.extraDiceFaces !== 0)
    tags.push(`${combat.extraDiceFaces > 0 ? "+" : ""}${combat.extraDiceFaces} dice faces`);
  return tags;
}

function setCooldown(entity: Entity, ability: AbilityData) {
  const { cooldown } = parseFrequency(ability.frequency);
  if (cooldown) entity.cooldowns[ability.name] = cooldown;
}

function isWinCondition(game: Game): boolean {
  // game.mode is stored uppercase (e.g. "FFA", "2V2", "NTR", "JUGG");
  // normalize before matching so mode rules always resolve correctly.
  const mode = game.mode.toLowerCase();
  const id = modeIdFor(game.mode);
  if (id === "jugg") {
    // Juggernaut: the jugg side wins by surviving; the field wins by
    // killing the jugg. Handled by the jugg-designation logic elsewhere —
    // here a generic "one side left" check still applies.
    const teams = new Map<number, boolean>();
    for (const e of game.entities) {
      if (!teams.has(e.team)) teams.set(e.team, false);
      if (e.curhp > 0) teams.set(e.team, true);
    }
    return [...teams.values()].filter(Boolean).length <= 1;
  }
  if (id === "ffa" || id === "ntr" || id === "pvp" || id === "1v1" ||
      mode.includes("ffa") || mode.includes("pvp")) {
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

function* resolveNonDamaging(
  game: Game,
  user: Entity,
  ability: AbilityData,
  target: Entity,
): Generator<AttackPrompt, ResolutionResult, string> {
  const result = newResult();
  const effects = parseEffects(ability.effect);
  const effectMsgs: string[] = yield* runEffectStream(
    applyEffectStream(game, user, target, effects, ability),
  );

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
  combat: CombatMetadata,
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
    // Splash halves defense by default per the home page ("half target
    // DEF on Splash"). Apply ignore clauses AFTER halving: an "Ignores
    // DEF" on the parent ability should still wipe the remaining half.
    const rawDef = half(defensiveStat(target, ability.damageType));
    const targetDef = applyIgnoreToDefense(rawDef, combat.ignore);
    const userOff = combat.ignore.atkMag
      ? 0
      : offensiveStat(user, ability.damageType);

    const baseDamage = damageRoll.total + userOff - targetDef;

    let finalDamage = baseDamage * (1 + combat.damagePercent / 100);
    finalDamage += combat.flatDamage;
    finalDamage = Math.max(0, Math.floor(finalDamage));

    const bleed = hasStatus(user, "bleed") ? 5 : 0;
    finalDamage = Math.max(0, finalDamage - bleed);
    const dmgResult = dealDamage(target, finalDamage);
    result.messages.push(
      `  **Splash Damage**: ${ability.roll}(${damageRoll.rolls.join("+")}) + ${ability.damageType === "Physical" ? "ATK" : "MAG"}(${userOff}) - half DEF(${targetDef})${formatDamageModsLine(combat, ability.roll)} -> ${target.num} (${target.curhp}/${target.maxhp} HP) = **${finalDamage}**${bleed > 0 ? ` (Bleed -${bleed})` : ""}`,
    );
    emitDamageModTrail(result.messages, combat, finalDamage, ability.roll);

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

  return startAttack(
    game,
    user,
    action.ability,
    action.target,
    action.direction,
  );
}
