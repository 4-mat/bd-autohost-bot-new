import { send, sendPm, toId } from "../utils.js";
import type { User } from "../users.js";
import {
  abilities,
  classes,
  weapons,
  branches,
  type ClassData,
  type WeaponData,
} from "../data/index.js";
import { WhatIs, Reference } from "../data/index.js";
import { modeDescription, describeModes } from "../data/gamemodes.js";

export function infoCommand(user: User, cmd: string, args: string) {
  const target = user.name;

  if (cmd === "wt") {
    const id = toId(args);
    if (!id) return sendPm(target, "Usage: %wt [ability/item/status/tile/mode]");

    // List every game mode (the doc's "/rfaq modes").
    if (id === "modes" || id === "gamemodes") {
      sendPm(target, describeModes());
      return;
    }

    // Check WhatIs database
    const entry = WhatIs.get(id);
    if (entry) {
      sendPm(target, entry);
      return;
    }

    // Single mode lookup (e.g. %wt pvpj, %wt ntr).
    const mode = modeDescription(args);
    if (mode) {
      sendPm(target, mode);
      return;
    }

    // Check weapons
    const weapon = weapons.get(id);
    if (weapon) {
      const lines = [`**${weapon.name}** (${weapon.branch})`];
      for (const ab of weapon.abilities) {
        lines.push(buildAbilityDropdown(ab));
      }
      sendPm(target, lines.join("\n"));
      return;
    }

    // Check classes
    const cls = classes.get(id);
    if (cls) {
      const lines = [`**${cls.name}**`];
      for (const ab of cls.abilities) {
        lines.push(buildAbilityDropdown(ab));
      }
      sendPm(target, lines.join("\n"));
      return;
    }

    // Check specific abilities
    const ab = abilities.get(id);
    if (ab) {
      sendPm(target, buildAbilityDropdown(ab.ability));
      return;
    }

    sendPm(target, `No data for "${args}".`);
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

function buildAbilityDropdown(ab: {
  name: string;
  level: number | "EX1" | "EX2";
  frequency: string;
  mr: number;
  roll: string;
  damageType: string;
  actionType: string;
  range: string;
  effect: string;
}): string {
  const levelDisplay = typeof ab.level === "string"
    ? `${ab.level}`
    : `Lv.${ab.level}`;

  return `
  <details>
    <summary><b>${ab.name}</b> (${levelDisplay})</summary>
    <b>- Action Type:</b> ${ab.actionType}<br>
    <b>- Frequency:</b> ${ab.frequency}<br>
    <b>- MR:</b> ${ab.mr}<br>
    <b>- Roll:</b> ${ab.roll}<br>
    <b>- Damage Type:</b> ${ab.damageType}<br>
    <b>- Range:</b> ${ab.range}<br>
    <b>- Effect:</b> ${ab.effect}
  </details>`.trim();
}
