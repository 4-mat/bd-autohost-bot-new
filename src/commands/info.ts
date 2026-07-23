import { send, sendPm, toId } from "../utils.js";
import type { User } from "../users.js";
import {
  classes,
  weapons,
  branches,
  type ClassData,
  type WeaponData,
} from "../data/index.js";
import { WhatIs, Reference } from "../data/index.js";

export function infoCommand(user: User, cmd: string, args: string) {
  const target = user.name;

  if (cmd === "wt") {
    const id = toId(args);
    if (!id) return sendPm(target, "Usage: %wt [ability/item/status/tile]");

    // Check WhatIs database
    const entry = WhatIs.get(id);
    if (entry) {
      sendPm(target, entry);
      return;
    }

    // Check weapons
    const weapon = weapons.get(id);
    if (weapon) {
      const lines = [`**${weapon.name}** (${weapon.branch})`];
      for (const ab of weapon.abilities) {
        lines.push(buildAbilityLine(ab));
      }
      sendPm(target, lines.join("\n"));
      return;
    }

    // Check classes
    const cls = classes.get(id);
    if (cls) {
      const lines = [`**${cls.name}**`];
      for (const ab of cls.abilities) {
        lines.push(buildAbilityLine(ab));
      }
      sendPm(target, lines.join("\n"));
      return;
    }

    sendPm(target, `No data found for "${args}".`);
    return;
  }

  if (cmd === "rf") {
    const id = toId(args);
    const link = Reference.get(id);
    if (link) {
      sendPm(target, link);
    } else {
      sendPm(target, `No reference found for "${args}". Use %rf for a list.`);
    }
    return;
  }
}

function buildAbilityLine(ab: {
  name: string;
  level: number;
  frequency: string;
  mr: number;
  roll: string;
  damageType: string;
  actionType: string;
  range: string;
  effect: string;
}): string {
  return `  **${ab.name}** (Lv.${ab.level}) - ${ab.frequency}, MR ${ab.mr}, ${ab.roll}, ${ab.damageType} ${ab.actionType}, ${ab.range}: ${ab.effect}`;
}
