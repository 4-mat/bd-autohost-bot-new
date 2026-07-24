import {
  type Game,
  type Entity,
  type AbilityData,
  type StatusEffect,
  rollAccuracy,
  dealDamage,
  removeEntity,
  inRange,
  manhattan,
  dist,
  chebyshev,
  pushEntity,
  pullEntity,
  getAoETargets,
  getSplashTargets,
  Terrain,
} from "./state.js";
import { rollDice, toId, posToStr } from "../utils.js";

export interface ResolutionResult {
  messages: string[];
  deaths: Entity[];
  gameOver: boolean;
}

export function resolveAction(game: Game, entity: Entity): ResolutionResult {
  const result: ResolutionResult = {
    messages: [],
    deaths: [],
    gameOver: false,
  };

  if (!entity.pendingAction) return result;

  const { pendingAction } = entity;

  if (pendingAction.type === "attack" && pendingAction.ability) {
    const attackResult = resolveAttack(
      game,
      entity,
      pendingAction.ability,
      pendingAction.target,
    );
    result.messages.push(...attackResult.messages);
    result.deaths.push(...attackResult.deaths);
  }

  entity.pendingAction = null;
  return result;
}

function resolveAttack(
  game: Game,
  caster: Entity,
  ability: AbilityData,
  targetRef?: string,
): ResolutionResult {
  const result: ResolutionResult = {
    messages: [],
    deaths: [],
    gameOver: false,
  };

  const isAttack =
    ability.damageType === "Physical" || ability.damageType === "Magical";
  const isHeal = ability.effect.toLowerCase().includes("heal") && !isAttack;
  const isBuff = !isAttack && !isHeal && ability.actionType !== "Passive";

  // Parse multi-hit from roll string (e.g. "2d8+5\n(Double Hit)")
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

  // Handle Push/Pull from effect text
  const pushPullResult = parsePushPull(ability);

  // Find targets
  let targets: Entity[];
  if (isAoE) {
    targets = getAoETargets(game, caster, ability.range, ability.targetGroup);
    if (targets.length === 0 && targetRef) {
      // Fallback to single target
      targets = findTargets(game, caster, ability, targetRef);
    }
  } else {
    targets = findTargets(game, caster, ability, targetRef);
  }

  if (targets.length === 0) {
    result.messages.push(
      `${caster.num} uses ${ability.name} but no valid targets found.`,
    );
    return result;
  }

  // Build the /me message
  const targetNames = targets.map((t) => t.num).join(", ");
  const rollStr = ability.roll ? ` ${ability.roll}` : "";
  const actionTypeStr = ability.actionType === "Reaction" ? " (Reaction)" : "";
  result.messages.push(
    `/me ${ability.name} @ ${targetNames}, MR ${ability.mr},${rollStr}${actionTypeStr}`,
  );

  // Resolve each target
  for (const target of targets) {
    if (isAttack) {
      for (let h = 0; h < hits; h++) {
        const label = hits > 1 ? ` (Hit ${h + 1}/${hits})` : "";
        const singleResult = resolveSingleTarget(
          game,
          caster,
          ability,
          target,
          label,
        );
        result.messages.push(...singleResult.messages);
        result.deaths.push(...singleResult.deaths);

        // Push/Pull after damage
        if (
          pushPullResult &&
          singleResult.messages.some((m) => m.includes("HIT"))
        ) {
          applyPushPull(game, caster, target, pushPullResult, result);
        }
      }
    } else if (isHeal) {
      const healResult = resolveHeal(game, caster, ability, target);
      result.messages.push(...healResult.messages);
    } else {
      // Non-damaging ability: buffs, debuffs, status, tile effects
      const statusResult = resolveNonDamaging(game, caster, ability, target);
      result.messages.push(...statusResult.messages);
      result.deaths.push(...statusResult.deaths);
    }
  }

  // Handle Splash for non-AoE attacks
  if (isAttack && !isAoE && targets.length > 0) {
    const splashResult = resolveSplash(game, caster, ability, targets[0]);
    result.messages.push(...splashResult.messages);
    result.deaths.push(...splashResult.deaths);
  }

  // Set cooldown
  setCooldown(caster, ability);

  // Track uses
  if (ability.maxUses) {
    caster.usesUsed[ability.name] = (caster.usesUsed[ability.name] ?? 0) + 1;
  }

  // Check game over
  for (const death of result.deaths) {
    if (isWinCondition(game)) {
      result.gameOver = true;
      const winner = game.entities[0];
      if (winner) {
        result.messages.push(
          `**Game over! ${winner.num} (${winner.name}) wins!**`,
        );
      } else {
        result.messages.push("**Game over! No survivors!**");
      }
    }
  }

  return result;
}

function resolveSingleTarget(
  game: Game,
  caster: Entity,
  ability: AbilityData,
  target: Entity,
  hitLabel = "",
): ResolutionResult {
  const result: ResolutionResult = {
    messages: [],
    deaths: [],
    gameOver: false,
  };

  // 1. Accuracy check
  const casterAccBonus = getStatBonus(caster, "acc");
  const targetEva = getEffectiveStat(target, "eva");
  const {
    hit,
    roll: accRoll,
    crit,
  } = rollAccuracy(ability.mr, targetEva, casterAccBonus);

  result.messages.push(
    `  **Accuracy${hitLabel}**: ${caster.num} rolls **${accRoll}** vs MR ${ability.mr} + EVA ${targetEva} = ${ability.mr + targetEva} -> ${hit ? "**HIT**" : "**MISS**"}${crit ? " (CRIT!)" : ""}`,
  );

  if (!hit) return result;

  // 2. Damage roll
  const damageRoll = rollDice(ability.roll);
  let baseDamage = damageRoll.total;

  // Add offensive stat (only first hit gets ATK/MAG per multi-hit rules)
  if (ability.damageType === "Physical") {
    baseDamage += getEffectiveStat(caster, "atk");
  } else {
    baseDamage += getEffectiveStat(caster, "mag");
  }

  // Subtract defensive stat
  if (ability.damageType === "Physical") {
    baseDamage -= getEffectiveStat(target, "pd");
  } else {
    baseDamage -= getEffectiveStat(target, "md");
  }

  // Critical hit: double base dice
  if (crit) {
    const critRoll = rollDice(ability.roll);
    baseDamage += critRoll.total;
    result.messages.push(
      `  **Critical Hit!** Extra dice: ${critRoll.rolls.join("+")} = ${critRoll.total}`,
    );
  }

  // Clamp damage
  const finalDamage = Math.max(0, baseDamage);

  // 3. Deal damage
  const actual = dealDamage(target, finalDamage);
  result.messages.push(
    `  **Damage${hitLabel}**: ${ability.roll}(${damageRoll.rolls.join("+")}) + ${ability.damageType === "Physical" ? "ATK" : "MAG"}(${getEffectiveStat(caster, ability.damageType === "Physical" ? "atk" : "mag")}) - ${ability.damageType === "Physical" ? "PD" : "MD"}(${getEffectiveStat(target, ability.damageType === "Physical" ? "pd" : "md")}) = **${finalDamage}** -> ${target.num} (${target.curhp}/${target.maxhp} HP)`,
  );

  // 4. Apply statuses from effect
  applyStatusEffects(game, caster, target, ability);

  // 5. Check death
  if (target.curhp <= 0) {
    result.messages.push(
      `  **${target.num} (${target.name}) has been defeated!**`,
    );
    removeEntity(game, target);
    result.deaths.push(target);
  }

  return result;
}

function findTargets(
  game: Game,
  caster: Entity,
  ability: AbilityData,
  targetRef?: string,
): Entity[] {
  const group = ability.targetGroup;
  const range = ability.range;

  // Handle compound ranges like "Range 10 or Burst 1" -- try each part
  const rangeParts = range.toLowerCase().includes(" or ")
    ? range.split(/\s+or\s+/i)
    : [range];

  // If a specific target was given
  if (targetRef) {
    const target = game.entities.find(
      (e) =>
        toId(e.num) === toId(targetRef) || toId(e.name) === toId(targetRef),
    );
    if (target && isValidTarget(caster, target, group)) {
      // Check if target is in range for any of the range parts
      for (const rp of rangeParts) {
        if (inRange(game, caster.pos, target.pos, rp.trim())) {
          return [target];
        }
      }
    }
    return [];
  }

  // Auto-target: get all valid targets in any range part
  return game.entities.filter((e) => {
    if (e.num === caster.num && !group.toLowerCase().includes("self"))
      return false;
    if (!isValidTarget(caster, e, group)) return false;
    for (const rp of rangeParts) {
      if (inRange(game, caster.pos, e.pos, rp.trim())) return true;
    }
    return false;
  });
}

function isValidTarget(caster: Entity, target: Entity, group: string): boolean {
  if (target.curhp <= 0) return false;
  const g = group.toLowerCase();

  if (g.includes("self and allies") || g.includes("self and ally"))
    return target.team === caster.team;
  if (g.includes("self or ally") || g.includes("self or allies"))
    return target.team === caster.team;
  if (g.includes("self or foe")) return true; // any entity
  if (g.includes("foe or ally")) return target.num !== caster.num;
  if (g.includes("self, foes, allies") || g.includes("self, foes, and allies"))
    return true;

  if (g === "self") return target.num === caster.num;
  if (g === "ally")
    return target.team === caster.team && target.num !== caster.num;
  if (g === "foe") return target.team !== caster.team;
  if (g === "any") return true;
  if (g === "tile") return false;

  return true; // default: any
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

  // Apply buffs
  for (const b of entity.buffs) {
    if (b.stat === stat) base += b.amount;
  }

  // Clamp to 0 (except HP)
  return Math.max(0, base);
}

function getStatBonus(entity: Entity, stat: string): number {
  let bonus = 0;
  for (const b of entity.buffs) {
    if (b.stat === stat) bonus += b.amount;
  }
  return bonus;
}

function applyStatusEffects(
  game: Game,
  caster: Entity,
  target: Entity,
  ability: AbilityData,
) {
  // Parse effect text for common status patterns
  // This is a simplified parser -- real implementation would need the full ability data
  const effect = ability.effect.toLowerCase();

  // Bleed: "X bleed/Y" or "inflict X bleed/Y"
  const bleedMatch = effect.match(/(\d+)\s*bleed\s*\/\s*(\d+)/);
  if (bleedMatch) {
    applyStatus(target, {
      name: "Bleed",
      damage: parseInt(bleedMatch[1]),
      rounds: parseInt(bleedMatch[2]),
      maxRounds: parseInt(bleedMatch[2]),
      removable: true,
    });
  }

  // Burn
  const burnMatch = effect.match(/burn\s*\/\s*(\d+)/);
  if (burnMatch) {
    applyStatus(target, {
      name: "Burn",
      damage: 0,
      rounds: parseInt(burnMatch[1]),
      maxRounds: parseInt(burnMatch[1]),
      removable: true,
    });
  }

  // Poison
  const poisonMatch = effect.match(/(\d+)\s*poison\s*\/\s*(\d+)/);
  if (poisonMatch) {
    applyStatus(target, {
      name: "Poison",
      damage: parseInt(poisonMatch[1]),
      rounds: parseInt(poisonMatch[2]),
      maxRounds: parseInt(poisonMatch[2]),
      removable: true,
    });
  }

  // Curse
  const curseMatch = effect.match(/(\d+)\s*curse\s*\/\s*(\d+)/);
  if (curseMatch) {
    applyStatus(target, {
      name: "Curse",
      damage: parseInt(curseMatch[1]),
      rounds: parseInt(curseMatch[2]),
      maxRounds: parseInt(curseMatch[2]),
      removable: true,
    });
  }

  // Root
  if (effect.includes("root")) {
    const rootMatch = effect.match(/root\s*\/\s*(\d+)/);
    const rounds = rootMatch ? parseInt(rootMatch[1]) : 1;
    applyStatus(target, {
      name: "Root",
      damage: 0,
      rounds,
      maxRounds: rounds,
      removable: true,
    });
  }

  // Seal
  if (effect.includes("seal")) {
    const sealMatch = effect.match(/seal\s*\/\s*(\d+)/);
    const rounds = sealMatch ? parseInt(sealMatch[1]) : 1;
    applyStatus(target, {
      name: "Seal",
      damage: 0,
      rounds,
      maxRounds: rounds,
      removable: true,
    });
  }

  // Slow
  if (effect.includes("slow")) {
    const slowMatch = effect.match(/slow\s*\/\s*(\d+)/);
    const rounds = slowMatch ? parseInt(slowMatch[1]) : 1;
    applyStatus(target, {
      name: "Slow",
      damage: 0,
      rounds,
      maxRounds: rounds,
      removable: true,
    });
  }

  // Stun
  if (effect.includes("stun")) {
    const stunMatch = effect.match(/stun\s*\/\s*(\d+)/);
    const rounds = stunMatch ? parseInt(stunMatch[1]) : 1;
    applyStatus(target, {
      name: "Stun",
      damage: 0,
      rounds,
      maxRounds: rounds,
      removable: true,
    });
  }

  // Confusion
  if (effect.includes("confusion")) {
    const confMatch = effect.match(/confusion\s*\/\s*(\d+)/);
    const rounds = confMatch ? parseInt(confMatch[1]) : 1;
    applyStatus(target, {
      name: "Confusion",
      damage: 0,
      rounds,
      maxRounds: rounds,
      removable: true,
    });
  }

  // Cripple
  if (effect.includes("cripple")) {
    const crMatch = effect.match(/cripple\s*\/\s*(\d+)/);
    const rounds = crMatch ? parseInt(crMatch[1]) : 1;
    applyStatus(target, {
      name: "Cripple",
      damage: 0,
      rounds,
      maxRounds: rounds,
      removable: true,
    });
  }

  // Shield
  if (effect.includes("shield")) {
    const shMatch = effect.match(/shield\s*\/\s*(\d+)/);
    const rounds = shMatch ? parseInt(shMatch[1]) : 1;
    applyStatus(target, {
      name: "Shield",
      damage: 0,
      rounds,
      maxRounds: rounds,
      removable: true,
    });
  }

  // Buffs: "+X STAT/Y" pattern
  const buffRegex = /\+(\d+)\s+(atk|mag|pd|md|eva|mp|def|acc|cr)\s*\/\s*(\d+)/g;
  let buffMatch;
  while ((buffMatch = buffRegex.exec(effect)) !== null) {
    target.buffs.push({
      stat:
        buffMatch[2].toLowerCase() === "def"
          ? "pd"
          : buffMatch[2].toLowerCase(),
      amount: parseInt(buffMatch[1]),
      rounds: parseInt(buffMatch[3]),
    });
  }

  // Debuffs: "-X STAT/Y" pattern
  const debuffRegex =
    /-(\d+)\s+(atk|mag|pd|md|eva|mp|def|acc|cr)\s*\/\s*(\d+)/g;
  let debuffMatch;
  while ((debuffMatch = debuffRegex.exec(effect)) !== null) {
    target.buffs.push({
      stat:
        debuffMatch[2].toLowerCase() === "def"
          ? "pd"
          : debuffMatch[2].toLowerCase(),
      amount: -parseInt(debuffMatch[1]),
      rounds: parseInt(debuffMatch[3]),
    });
  }
}

function applyStatus(entity: Entity, status: StatusEffect) {
  // Don't stack same status -- refresh duration
  const existing = entity.statuses.find((s) => s.name === status.name);
  if (existing) {
    existing.rounds = status.rounds;
    existing.damage = Math.max(existing.damage, status.damage);
  } else {
    entity.statuses.push(status);
  }
}

function setCooldown(entity: Entity, ability: AbilityData) {
  const freq = ability.frequency.toLowerCase();
  if (freq === "every turn" || freq === "passive") return;

  // EoT = 2 turns (can't use next turn)
  if (freq === "eot") {
    entity.cooldowns[ability.name] = 2;
  }
  // E3T = 3 turns
  else if (freq === "e3t") {
    entity.cooldowns[ability.name] = 3;
  }
  // Once/Twice/Thrice = use-based, not cooldown-based
  // But mark that a use was consumed (done in resolveAttack)
}

function isWinCondition(game: Game): boolean {
  if (game.mode.includes("ffa") || game.mode.includes("pvp")) {
    return game.entities.filter((e) => e.curhp > 0).length <= 1;
  }
  // Team modes: check if all members of any team are dead
  const teams = new Map<number, boolean>();
  for (const e of game.entities) {
    if (!teams.has(e.team)) teams.set(e.team, false);
    if (e.curhp > 0) teams.set(e.team, true);
  }
  const aliveTeams = [...teams.values()].filter(Boolean).length;
  return aliveTeams <= 1;
}

// Parse multi-hit count from roll string (e.g. "2d8+5\n(Double Hit)" -> 2)
function parseMultiHit(ability: AbilityData): number {
  const roll = ability.roll.toLowerCase();
  if (roll.includes("double hit")) return 2;
  if (roll.includes("triple hit")) return 3;
  if (roll.includes("quad")) return 4;
  return 1;
}

// Parse Push/Pull from ability effect text
function parsePushPull(
  ability: AbilityData,
): { type: "push" | "pull"; amount: number } | null {
  const effect = ability.effect.toLowerCase();
  const pushMatch = effect.match(/push\s*(\d+)/);
  if (pushMatch) return { type: "push", amount: parseInt(pushMatch[1]) };
  const pullMatch = effect.match(/pull\s*(\d+)/);
  if (pullMatch) return { type: "pull", amount: parseInt(pullMatch[1]) };
  return null;
}

// Apply Push/Pull to a target
function applyPushPull(
  game: Game,
  caster: Entity,
  target: Entity,
  pp: { type: "push" | "pull"; amount: number },
  result: ResolutionResult,
) {
  if (pp.type === "push") {
    const { moved, path } = pushEntity(game, target, caster.pos, pp.amount);
    if (moved > 0) {
      const pathStr = path.map((p) => posToStr(p[0], p[1])).join(" -> ");
      result.messages.push(
        `  **Push**: ${target.num} pushed ${moved} tile${moved > 1 ? "s" : ""} to ${pathStr}`,
      );
    } else {
      result.messages.push(`  **Push**: ${target.num} could not be pushed.`);
    }
  } else {
    const { moved, path } = pullEntity(game, target, caster.pos, pp.amount);
    if (moved > 0) {
      const pathStr = path.map((p) => posToStr(p[0], p[1])).join(" -> ");
      result.messages.push(
        `  **Pull**: ${target.num} pulled ${moved} tile${moved > 1 ? "s" : ""} to ${pathStr}`,
      );
    } else {
      result.messages.push(`  **Pull**: ${target.num} could not be pulled.`);
    }
  }
}

// Resolve a healing ability
function resolveHeal(
  game: Game,
  caster: Entity,
  ability: AbilityData,
  target: Entity,
): ResolutionResult {
  const result: ResolutionResult = {
    messages: [],
    deaths: [],
    gameOver: false,
  };

  if (ability.roll) {
    const healRoll = rollDice(ability.roll);
    let healAmount = healRoll.total;

    // Heals may add caster ATK or MAG
    const effect = ability.effect.toLowerCase();
    if (effect.includes("atk") || effect.includes("mag")) {
      const bonus = Math.max(
        getEffectiveStat(caster, "atk"),
        getEffectiveStat(caster, "mag"),
      );
      healAmount += bonus;
    }

    const prevHp = target.curhp;
    target.curhp = Math.min(target.maxhp, target.curhp + healAmount);
    const healed = target.curhp - prevHp;

    result.messages.push(
      `  **Heal**: ${ability.roll}(${healRoll.rolls.join("+")}) = **${healed}** -> ${target.num} (${target.curhp}/${target.maxhp} HP)`,
    );
  } else {
    // Roll-less heals (e.g. percentage-based from effect text)
    result.messages.push(
      `  ${caster.num} uses ${ability.name} on ${target.num}. (Manual resolution needed)`,
    );
  }

  return result;
}

// Resolve a non-damaging ability (buffs, debuffs, status, tile effects)
function resolveNonDamaging(
  game: Game,
  caster: Entity,
  ability: AbilityData,
  target: Entity,
): ResolutionResult {
  const result: ResolutionResult = {
    messages: [],
    deaths: [],
    gameOver: false,
  };

  // Apply statuses and buffs/debuffs from effect text
  applyStatusEffects(game, caster, target, ability);

  const effect = ability.effect.toLowerCase();

  // Track what was applied
  const applied: string[] = [];

  // Check for common status inflictions in effect text
  const statusPatterns: [RegExp, string][] = [
    [/(\d+)\s*bleed\s*\/\s*(\d+)/, "Bleed"],
    [/(\d+)\s*poison\s*\/\s*(\d+)/, "Poison"],
    [/burn\s*\/\s*(\d+)/, "Burn"],
    [/(\d+)\s*curse\s*\/\s*(\d+)/, "Curse"],
    [/root\s*\/\s*(\d+)/, "Root"],
    [/seal\s*\/\s*(\d+)/, "Seal"],
    [/stun\s*\/\s*(\d+)/, "Stun"],
    [/confusion\s*\/\s*(\d+)/, "Confusion"],
    [/cripple\s*\/\s*(\d+)/, "Cripple"],
    [/slow\s*\/\s*(\d+)/, "Slow"],
  ];

  for (const [regex, name] of statusPatterns) {
    const match = effect.match(regex);
    if (match) {
      applied.push(
        `${name}${match[1] ? ` (${match[1]})` : ""}/${match[2] || "?"}`,
      );
    }
  }

  // Check for buffs
  const buffRegex = /\+(\d+)\s+(atk|mag|pd|md|eva|mp|def|acc|cr)\s*\/\s*(\d+)/g;
  let buffMatch;
  while ((buffMatch = buffRegex.exec(effect)) !== null) {
    const stat = buffMatch[2].toUpperCase();
    applied.push(`+${buffMatch[1]} ${stat}/${buffMatch[3]}`);
  }

  // Check for debuffs
  const debuffRegex =
    /-(\d+)\s+(atk|mag|pd|md|eva|mp|def|acc|cr)\s*\/\s*(\d+)/g;
  let debuffMatch;
  while ((debuffMatch = debuffRegex.exec(effect)) !== null) {
    const stat = debuffMatch[2].toUpperCase();
    applied.push(`-${debuffMatch[1]} ${stat}/${debuffMatch[3]}`);
  }

  if (applied.length > 0) {
    result.messages.push(
      `  ${caster.num} uses ${ability.name} on ${target.num}: ${applied.join(", ")}`,
    );
  } else {
    result.messages.push(
      `  ${caster.num} uses ${ability.name} on ${target.num}. (Manual resolution may be needed)`,
    );
  }

  return result;
}

// Resolve Splash damage around a primary target
function resolveSplash(
  game: Game,
  caster: Entity,
  ability: AbilityData,
  primary: Entity,
): ResolutionResult {
  const result: ResolutionResult = {
    messages: [],
    deaths: [],
    gameOver: false,
  };

  const range = ability.range.toLowerCase();
  const splashMatch = range.match(/splash\s*(\d+)/);
  if (!splashMatch) return result;

  const radius = parseInt(splashMatch[1]);
  const splashTargets = getSplashTargets(
    game,
    caster,
    primary,
    radius,
    ability.targetGroup,
  );

  if (splashTargets.length === 0) return result;

  const names = splashTargets.map((t) => t.num).join(", ");
  result.messages.push(`  **Splash ${radius}**: hits ${names}`);

  // Splash targets are hit/missed with the same result as primary
  // For simplicity, apply same damage to each splash target (half DEF)
  for (const target of splashTargets) {
    const damageRoll = rollDice(ability.roll);
    let baseDamage = damageRoll.total;

    if (ability.damageType === "Physical") {
      baseDamage += getEffectiveStat(caster, "atk");
      baseDamage -= Math.floor(getEffectiveStat(target, "pd") / 2);
    } else if (ability.damageType === "Magical") {
      baseDamage += getEffectiveStat(caster, "mag");
      baseDamage -= Math.floor(getEffectiveStat(target, "md") / 2);
    }

    const finalDamage = Math.max(0, baseDamage);
    const actual = dealDamage(target, finalDamage);
    result.messages.push(
      `  **Splash Damage**: -> ${target.num} (${target.curhp}/${target.maxhp} HP) = **${finalDamage}**`,
    );

    if (target.curhp <= 0) {
      result.messages.push(
        `  **${target.num} (${target.name}) has been defeated!**`,
      );
      removeEntity(game, target);
      result.deaths.push(target);
    }
  }

  return result;
}
