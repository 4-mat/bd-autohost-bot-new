import { send, sendPm, toId } from "../utils.js";
import type { User } from "../users.js";
import {
  classes,
  weapons,
  branches,
  type ClassData,
  type WeaponData,
  type AbilityData,
} from "../data/index.js";
import { WhatIs, Reference } from "../data/index.js";
import { modeDescription, describeModes } from "../data/gamemodes.js";
import { parseFrequency } from "../game/state.js";

export function infoCommand(user: User, cmd: string, args: string) {
  const target = user.name;

  if (cmd === "data") {
    const abilityCount =
      [...classes.values()].reduce((n, c) => n + c.abilities.length, 0) +
      [...weapons.values()].reduce((n, w) => n + w.abilities.length, 0);
    sendPm(
      target,
      [
        `Classes: ${classes.size} | Weapons: ${weapons.size} | Branches: ${branches.size}`,
        `Abilities: ${abilityCount} | WhatIs entries: ${WhatIs.size} | References: ${Reference.size}`,
      ].join("\n"),
    );
    return;
  }

  if (cmd === "freq") {
    const id = toId(args);
    if (!id) return sendPm(target, "Usage: %freq <ability>");
    const found = findAbility(id);
    if (!found) return sendPm(target, `No ability found for "${args}".`);
    const ab = found.ability;
    const f = parseFrequency(ab.frequency);
    const max = ab.maxUses ?? f.uses;
    const cd =
      f.cooldown > 0 ? `${f.cooldown} turn${f.cooldown > 1 ? "s" : ""}` : "none";
    const uses = max > 0 ? `${max} per encounter` : "unlimited";
    sendPm(
      target,
      `**${ab.name}** (${found.source}) frequency "${ab.frequency}": ${uses}, cooldown ${cd}.`,
    );
    return;
  }

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

    // Specific ability lookup (e.g. %wt Duet) - targeted, less chat flood.
    const found = findAbility(id);
    if (found) {
      const ab = found.ability;
      const lines = [
        `**${ab.name}** (Lv.${ab.level}) - ${found.source}`,
        `${ab.frequency} | MR ${ab.mr} | ${ab.roll || "-"} | ${ab.damageType || "-"} ${ab.actionType} | ${ab.targetAmount} ${ab.targetGroup} | ${ab.range || "-"}`,
        ab.effect,
      ];
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

function findAbility(id: string): { source: string; ability: AbilityData } | null {
  for (const cls of classes.values()) {
    const ab = cls.abilities.find((a) => toId(a.name) === id);
    if (ab) return { source: `Class ${cls.name}`, ability: ab };
  }
  for (const wpn of weapons.values()) {
    const ab = wpn.abilities.find((a) => toId(a.name) === id);
    if (ab) return { source: `Weapon ${wpn.name}`, ability: ab };
  }
  return null;
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
