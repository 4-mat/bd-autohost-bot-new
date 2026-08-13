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
  isObstruction,
  parseFrequency,
  needsDirection,
  getDirectionCandidates,
  DIRECTION_LABELS,
  placeTerrain,
  TERRAIN_NAMES,
  Terrain,
} from "./state.js";
import {
  parseEffects,
  applyEffects,
  applyEffectStream,
  extractCombatMetadata,
  type CombatMetadata,
  type EffectChoosePrompt,
} from "./effects.js";
import { rollDice, toId, posToStr } from "../utils.js";

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

// Per the BD 4.4 Map glossary (src/README.md terrain table), terrain affects
// a defending entity on its tile, keyed by the attacker's damage type:
//   Forest: +5 PD, -1 EVA vs Physical attacks
//   Water:  +5 MD, -1 EVA vs Magical attacks
export function terrainStatBonus(
  game: Game,
  entity: Entity,
  stat: string,
  damageType: string,
): number {
  const tile = game.map[entity.pos[0]]?.[entity.pos[1]];
  if (tile === Terrain.Forest) {
    if (stat === "pd") return 5;
    if (stat === "eva" && damageType === "Physical") return -1;
  }
  if (tile === Terrain.Water) {
    if (stat === "md") return 5;
    if (stat === "eva" && damageType === "Magical") return -1;
  }
  return 0;
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
    // DEF raises both physical and magical defense
    if (b.stat === "def" && (stat === "pd" || stat === "md")) base += b.amount;
  }
  // Status passive effects
  if (stat === "eva" && hasStatus(entity, "poison")) base -= 2;
  if ((stat === "pd" || stat === "md") && hasStatus(entity, "curse")) base -= 4;
  return Math.max(0, base);
}

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
      /** Obstruction-replacement confirmations: only the host may answer. */
      confirmObstruction?: boolean;
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
): Generator<AttackPrompt, ResolutionResult, PromptResponse> {
  const result = newResult();

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

  // --- Variant choice for damageType "Varies" ---
  let active = ability;
  if (ability.damageType === "Varies") {
    if (!ability.variants?.length) {
      result.messages.push(
        `${user.num} uses ${ability.name} but it has no damage variants.`,
      );
      return result;
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
      return result;
    }
    active = {
      ...ability,
      damageType: variant.damageType,
      range: variant.range ?? ability.range,
      effect: variant.effect ?? ability.effect,
    };
  }

  // --- Direction prompt for AoE abilities ---
  const needsDir = needsDirection(active);
  let dir = user.pendingAction?.direction;
  if (needsDir && !dir) {
    const dirs = getDirectionCandidates();
    dir = yield {
      kind: "direction",
      message: `Choose a direction for ${ability.name}`,
      candidates: dirs,
    };
  }

  // --- Target (attack may not continue if nothing can be chosen) ---
  // Tile-group abilities that actually place terrain (Whittle, Mending
  // Mantel, ...) target a map tile instead of an entity: collect in-range
  // tiles, yield a "tile" prompt, and resolve the chosen reference into a
  // position. Passives whose targetGroup is "Tile" but whose effects carry
  // no tile clause (Bloom, Mantrap, ...) fall through to entity targeting.
  const isTileAbility = /^tiles?$/i.test(active.targetGroup);
  const effects = parseEffects(active.effect);
  const shouldPromptTile =
    isTileAbility && effects.some((e) => e.type === "tile");
  let tilePos: [number, number] | null = null;
  let targets: Entity[] = [];
  let hitCount = 0;
  let isAoE = false;

  if (shouldPromptTile) {
    const candidates = getTileCandidates(game, user, active);

    if (candidates.length === 0) {
      result.messages.push(
        `${user.num} uses ${active.name} but no valid tiles in range.`,
      );
      return result;
    }

    const tileRef =
      initialTarget ??
      (yield {
        kind: "tile",
        message: `Choose a tile for ${active.name}`,
        candidates,
      });

    tilePos = parseTileRef(tileRef);
    if (
      !tilePos ||
      tilePos[0] < 0 ||
      tilePos[0] >= game.map.length ||
      tilePos[1] < 0 ||
      tilePos[1] >= game.map[0].length ||
      !candidates.includes(posToStr(tilePos[0], tilePos[1]))
    ) {
      result.messages.push(
        `${user.num} uses ${active.name} but the chosen tile is invalid.`,

      );
      return result;
    }

    // Obstruction tiles (Stop/Bone/Ice/Stone/Hearth) are replaceable, but
    // only with explicit confirmation.
    if (isObstruction(game.map[tilePos[0]][tilePos[1]])) {
      const tileName =
        TERRAIN_NAMES[game.map[tilePos[0]][tilePos[1]]] ?? "obstruction";
      const decision = yield {
        kind: "selection",
        message: `Replace the ${tileName} obstruction at ${posToStr(
          tilePos[0],
          tilePos[1],
        )}?`,
        options: [
          { id: "yes", label: "Yes, replace it" },
          { id: "no", label: "Cancel" },
        ],
        confirmObstruction: true,
      };
      if (decision !== "yes") {
        result.messages.push(`${user.num} cancels ${ability.name}.`);
        return result;
      }
    }
  } else {
    const prepared = prepareTargeting(game, user, ability);
    hitCount = prepared.hits;
    isAoE = prepared.isAoE;
    targets = prepared.targets;
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
  }

  const targetNames = targets.map((t) => t.num).join(", ");
  const rollStr = active.roll ? ` ${active.roll}` : "";
  const actionTypeStr = active.actionType === "Reaction" ? " (Reaction)" : "";
  result.messages.push(
    `/me ${active.name} @ ${
      shouldPromptTile && tilePos
        ? posToStr(tilePos[0], tilePos[1])
        : targetNames
    }, MR ${active.mr},${rollStr}${actionTypeStr}`,
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

  const combat = extractCombatMetadata(effects);
  const effectiveHitCount = Math.max(hitCount, 1 + combat.additionalHits);

  if (shouldPromptTile && tilePos) {
    // Tile-targeting abilities run their effect stream against the chosen
    // tile: the user stands in as the target (the "tile" case places the
    // terrain at tilePos; buff-style clauses still land on the user).
    const tileMsgs: string[] = yield* runEffectStream(
      applyEffectStream(game, user, user, effects, ability, tilePos),
    );
    if (tileMsgs.length > 0) {
      result.messages.push(`  ${user.num} uses ${ability.name}:`);
      result.messages.push(...tileMsgs);
    }
  }

  for (const target of targets) {
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
  }

  if (isAttack && !isAoE && targets.length > 0) {
    const splashResult = resolveSplash(game, user, active, targets[0], combat);
    result.messages.push(...splashResult.messages);
    result.deaths.push(...splashResult.deaths);
  }

  // --- After Resolving (cooldowns, use tracking, win check) ---
  setCooldown(user, active);
  const { uses } = parseFrequency(active.frequency);
  if (active.maxUses ?? uses) {
    user.usesUsed[active.name] = (user.usesUsed[active.name] ?? 0) + 1;
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
  dir?: string,
): AttackStep {
  if (dir && user.pendingAction) {
    user.pendingAction.direction = dir;
  }
  const flow = resolveAttackFlow(game, user, ability, target);
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
  // Letter-number format: A1, B3, etc. (also accepts "a,2" -- the format
  // produced by posToStr and shown as tile-prompt candidates).
  const match = ref.trim().match(/^([a-zA-Z])\s*,?\s*(\d+)$/);
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
  const g = group.toLowerCase();
  // FFA / no-team games put everyone on team 0: "Foe" means anyone but
  // self, "Ally" targets nobody, and ally-groups resolve to self only.
  // Mirrors the GUI candidate filter in pages.ts so the direct-target
  // path agrees with the AoE path (isValidGroupTarget in state.ts).
  const noTeams = user.team === 0;
  const foeCheck = noTeams
    ? target.num !== user.num
    : target.team !== user.team;
  const allyCheck = noTeams
    ? false
    : target.team === user.team && target.num !== user.num;
  const selfOrAllyCheck = noTeams
    ? target.num === user.num
    : target.team === user.team;

  if (g.includes("self and allies") || g.includes("self and ally"))
    return selfOrAllyCheck;
  if (g.includes("allies and self")) return selfOrAllyCheck;
  if (g.includes("self or ally") || g.includes("self or allies"))
    return selfOrAllyCheck;
  if (g.includes("self or foe")) return true;
  if (g.includes("foe or ally")) return target.num !== user.num;
  if (g.includes("self, foes, allies") || g.includes("self, foes, and allies"))
    return true;

  if (g === "self") return target.num === user.num;
  if (g === "ally") return allyCheck;
  if (g === "foe") return foeCheck;
  if (g === "any") return true;
  if (g === "tile") return false;

  return true;
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

  const userAccBonus = getStatBonus(user, "acc");
  const targetEva =
    (game.version === "4.3"
      ? eva43(target, ability.damageType)
      : getEffectiveStat(target, "eva")) +
    terrainStatBonus(game, target, "eva", ability.damageType);
  const {
    hit,
    roll: accRoll,
    crit,
  } = rollAccuracy(ability.mr, targetEva, userAccBonus);

  result.messages.push(
    `  **Accuracy${hitLabel}**: ${user.num} rolls **${accRoll}** vs MR ${ability.mr} + EVA ${targetEva} = ${ability.mr + targetEva} -> ${hit ? "**HIT**" : "**MISS**"}${crit ? " (CRIT!)" : ""}`,
  );

  // --- Hit resolves first (damage to target first) ---
  if (hit) {
    const damageRoll = rollDice(ability.roll);
    const userOff = combat.ignore.atkMag
      ? 0
      : offensiveStat(user, ability.damageType);
    const targetDef = applyIgnoreToDefense(
      defensiveStat(target, ability.damageType) +
        terrainStatBonus(
          game,
          target,
          ability.damageType === "Physical" ? "pd" : "md",
          ability.damageType,
        ),
      combat.ignore,
    );

    let baseDamage = damageRoll.total + userOff - targetDef;

    if (crit) {
      const critRoll = rollDice(ability.roll);
      baseDamage += critRoll.total;
      result.messages.push(
        `  **Critical Hit!** Extra dice: ${critRoll.rolls.join("+")} = ${critRoll.total}`,
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
      `  **Damage${hitLabel}**: ${ability.roll}(${damageRoll.rolls.join("+")}) + ${ability.damageType === "Physical" ? "ATK" : "MAG"}(${userOff}) - ${ability.damageType === "Physical" ? "PD" : "MD"}(${targetDef})${formatDamageModsLine(combat)}${bleedLabel} = **${finalDamage}** -> ${target.num} (${target.curhp}/${target.maxhp} HP)`,
    );
    emitDamageModTrail(result.messages, combat, finalDamage);

    if (dmgResult.shieldAbsorbed > 0) {
      result.messages.push(
        `  **Shield** absorbed **${dmgResult.shieldAbsorbed}** damage.${dmgResult.shieldBreaks ? " Shield broken!" : ""}`,
      );
    }

    const effects = parseEffects(ability.effect);
    const effectMsgs = yield* runEffectStream(
      applyEffectStream(game, user, target, effects, ability),
    );
    result.messages.push(...effectMsgs);

    // Apply recoil damage after hit damage (reuse the parsed `effects`
    // array rather than re-running the regex-based clause splitter).
    // Recoil scales off the post-mod `finalDamage` so a "+30% damage /
    // Recoil 25%" combo reflects the boosted total.
    for (const e of effects) {
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
      return result;
    }
  }

  // --- Confusion triggers after the hit resolves (regardless of hit/miss) ---
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
    }
  }

  return result;
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
function formatDamageModsLine(combat: CombatMetadata): string {
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
): void {
  if (
    combat.damagePercent === 0 &&
    combat.flatDamage === 0 &&
    !combat.ignore.atkMag &&
    !combat.ignore.def &&
    !combat.ignore.halfDef &&
    !combat.ignore.quarterDef &&
    combat.ignore.defReduction === 0 &&
    combat.ignore.other.length === 0 &&
    !combat.ignore.outsideFactors
  )
    return;
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
  log.push(
    `  *Damage Modifiers applied:* ${tags.join(", ")} -> **${finalDamage}**`,
  );
}

function setCooldown(entity: Entity, ability: AbilityData) {
  const { cooldown } = parseFrequency(ability.frequency);
  if (cooldown) entity.cooldowns[ability.name] = cooldown;
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
    const rawDef = half(
      defensiveStat(target, ability.damageType) +
        terrainStatBonus(
          game,
          target,
          ability.damageType === "Physical" ? "pd" : "md",
          ability.damageType,
        ),
    );
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
      `  **Splash Damage**: ${ability.roll}(${damageRoll.rolls.join("+")}) + ${ability.damageType === "Physical" ? "ATK" : "MAG"}(${userOff}) - half DEF(${targetDef})${formatDamageModsLine(combat)} -> ${target.num} (${target.curhp}/${target.maxhp} HP) = **${finalDamage}**${bleed > 0 ? ` (Bleed -${bleed})` : ""}`,
    );
    emitDamageModTrail(result.messages, combat, finalDamage);

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
