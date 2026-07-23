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

  // Find target(s)
  const targets = findTargets(game, caster, ability, targetRef);
  if (targets.length === 0) {
    result.messages.push(
      `${caster.num} targets ${ability.name} but no valid targets found.`,
    );
    return result;
  }

  const isAttack =
    ability.damageType === "Physical" || ability.damageType === "Magical";

  // Build the /me message
  const targetNames = targets.map((t) => t.num).join(", ");
  const rollStr = ability.roll ? ` ${ability.roll}` : "";
  result.messages.push(
    `/me ${ability.name} @ ${targetNames}, MR ${ability.mr},${rollStr}`,
  );

  // Resolve each target
  for (const target of targets) {
    const singleResult = resolveSingleTarget(game, caster, ability, target);
    result.messages.push(...singleResult.messages);
    result.deaths.push(...singleResult.deaths);
  }

  // Set cooldown if ability has a frequency that creates cooldown
  setCooldown(caster, ability);

  // Track uses
  if (ability.maxUses) {
    caster.usesUsed[ability.name] = (caster.usesUsed[ability.name] ?? 0) + 1;
  }

  // Check game over after all targets
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
): ResolutionResult {
  const result: ResolutionResult = {
    messages: [],
    deaths: [],
    gameOver: false,
  };
  const isAttack =
    ability.damageType === "Physical" || ability.damageType === "Magical";

  if (!isAttack) {
    // Non-damaging ability — just log it
    result.messages.push(
      `  ${caster.num} uses ${ability.name} on ${target.num}.`,
    );
    return result;
  }

  // 1. Accuracy check
  const casterAccBonus = getStatBonus(caster, "acc");
  const targetEva = getEffectiveStat(target, "eva");
  const {
    hit,
    roll: accRoll,
    crit,
  } = rollAccuracy(ability.mr, targetEva, casterAccBonus);

  result.messages.push(
    `  **Accuracy**: ${caster.num} rolls **${accRoll}** vs MR ${ability.mr} + EVA ${targetEva} = ${ability.mr + targetEva} → ${hit ? "**HIT**" : "**MISS**"}${crit ? " (CRIT!)" : ""}`,
  );

  if (!hit) return result;

  // 2. Damage roll
  const damageRoll = rollDice(ability.roll);
  let baseDamage = damageRoll.total;

  // Add offensive stat
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
    `  **Damage**: ${ability.roll}(${damageRoll.rolls.join("+")}) + ${ability.damageType === "Physical" ? "ATK" : "MAG"}(${getEffectiveStat(caster, ability.damageType === "Physical" ? "atk" : "mag")}) - ${ability.damageType === "Physical" ? "PD" : "MD"}(${getEffectiveStat(target, ability.damageType === "Physical" ? "pd" : "md")}) = **${finalDamage}** → ${target.num} (${target.curhp}/${target.maxhp} HP)`,
  );

  // 4. Apply statuses from effect (simplified — parse common patterns)
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
  const group = ability.targetGroup.toLowerCase();
  const range = ability.range.toLowerCase();

  // If a specific target was given
  if (targetRef) {
    const target = game.entities.find(
      (e) =>
        toId(e.num) === toId(targetRef) || toId(e.name) === toId(targetRef),
    );
    if (
      target &&
      isValidTarget(caster, target, group) &&
      isValidRange(game, caster, target, range)
    ) {
      return [target];
    }
    return [];
  }

  // Auto-target: get all valid targets
  return game.entities.filter(
    (e) =>
      e.num !== caster.num &&
      isValidTarget(caster, e, group) &&
      isValidRange(game, caster, e, range),
  );
}

function isValidTarget(caster: Entity, target: Entity, group: string): boolean {
  if (target.curhp <= 0) return false;

  if (group === "self") return target.num === caster.num;
  if (group === "ally")
    return target.team === caster.team && target.num !== caster.num;
  if (group === "foe") return target.team !== caster.team;
  if (group === "any") return true;
  if (group === "tile") return false; // tile targeting handled separately

  return true; // default: any
}

function isValidRange(
  game: Game,
  caster: Entity,
  target: Entity,
  range: string,
): boolean {
  return inRange(game, caster.pos, target.pos, range);
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
  // This is a simplified parser — real implementation would need the full ability data
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
  // Don't stack same status — refresh duration
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

  // EoT = 2 turns cooldown (can't use next turn)
  if (freq === "eot") {
    entity.cooldowns[ability.name] = 2;
  }
  // E3T = 3 turns
  else if (freq === "e3t") {
    entity.cooldowns[ability.name] = 3;
  }
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
