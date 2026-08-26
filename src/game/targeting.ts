import type { Entity } from "./state.js";

// FFA / no-team games put everyone on team 0: "Foe" means anyone but self,
// "Ally" targets nobody, and ally-groups resolve to self only. These mirror
// the GUI candidate filter in pages.ts so the direct-target path (isValidTarget
// in resolve.ts) agrees with the AoE path (isValidGroupTarget in state.ts).

function foeCheck(user: Entity, target: Entity): boolean {
  return user.team === 0
    ? target.num !== user.num
    : target.team !== user.team;
}

function allyCheck(user: Entity, target: Entity): boolean {
  if (user.team === 0) return false;
  return target.team === user.team && target.num !== user.num;
}

function selfOrAllyCheck(user: Entity, target: Entity): boolean {
  return user.team === 0
    ? target.num === user.num
    : target.team === user.team;
}

/**
 * Whether `target` fits the ability's target group from `user`'s perspective.
 * Shared by the direct-target validator and the AoE group filter so both
 * paths agree on FFA / team-mode semantics.
 */
export function matchesTargetGroup(
  user: Entity,
  target: Entity,
  group: string,
): boolean {
  if (group === "self") return target.num === user.num;
  if (group === "ally") return allyCheck(user, target);
  if (group === "foe") return foeCheck(user, target);
  if (group === "any") return true;
  if (group === "tile") return false;
  if (/self (and|or) alle?/.test(group) || /allies? and self/.test(group))
    return selfOrAllyCheck(user, target);
  if (group.includes("self or foe")) return true;
  if (group.includes("foe or ally")) return target.num !== user.num;
  if (/self, foes?, (and )?alle?s?/.test(group)) return true;
  return true;
}
