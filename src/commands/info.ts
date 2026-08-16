import { send, sendPm, toId } from "../utils.js";
import type { User } from "../users.js";
import {
  classes,
  weapons,
  items,
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

    // Check items (beta)
    const it = items.get(id);
    if (it) {
      const lines = [
        `**${it.name}** (${it.rank || "-"}) — ${it.slots} slot${it.slots === 1 ? "" : "s"}, ${it.gold} gold`,
        it.materials ? `Materials: ${it.materials}` : "",
        it.statBoosts ? `Boosts: ${it.statBoosts}` : "",
        it.statNerfs ? `Nerfs: ${it.statNerfs}` : "",
        it.frequency || it.actionType ? `${it.frequency} ${it.actionType}`.trim() : "",
        it.effect,
      ].filter(Boolean);
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
  level: number | "EX1" | "EX2";
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
