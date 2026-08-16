import { send, sendPm, sendPmChunks, toId } from "../utils.js";
import type { User } from "../users.js";
import {
  classes,
  weapons,
  items,
  branches,
  resolveName,
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

    // Check weapons (exact, then alias, then unique prefix)
    const weapon = resolveName(weapons, args).value;
    if (weapon) {
      const lines = [`**${weapon.name}** (${weapon.branch})`];
      for (const ab of weapon.abilities) {
        lines.push(buildAbilityLine(ab));
      }
      sendPm(target, lines.join("\n"));
      return;
    }

    // Check classes (exact, then alias, then unique prefix)
    const cls = resolveName(classes, args).value;
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

  if (cmd === "find") {
    const q = toId(args);
    if (!q) return sendPm(target, "Usage: %find <query>");
    const matches: string[] = [];
    for (const cls of classes.values()) {
      if (toId(cls.name).includes(q)) matches.push(`[class] ${cls.name}`);
      for (const ab of cls.abilities) {
        if (toId(ab.name).includes(q))
          matches.push(`[ability] ${ab.name} (Class ${cls.name})`);
      }
    }
    for (const wpn of weapons.values()) {
      if (toId(wpn.name).includes(q)) matches.push(`[weapon] ${wpn.name}`);
      for (const ab of wpn.abilities) {
        if (toId(ab.name).includes(q))
          matches.push(`[ability] ${ab.name} (Weapon ${wpn.name})`);
      }
    }
    for (const it of items.values()) {
      if (toId(it.name).includes(q)) matches.push(`[item] ${it.name}`);
    }
    if (matches.length === 0) return sendPm(target, `No matches for "${args}".`);
    const capped = matches.slice(0, 20);
    const more =
      matches.length > capped.length
        ? `\n…and ${matches.length - capped.length} more`
        : "";
    sendPm(
      target,
      `Matches for "${args}" (${matches.length}):\n${capped.join("\n")}${more}`,
    );
    return;
  }

  if (cmd === "items") {
    const q = toId(args);
    const list = [...items.values()].filter(
      (it) => !q || toId(it.name).includes(q),
    );
    if (list.length === 0) {
      return sendPm(
        target,
        q ? `No items match "${args}".` : "Items (beta): none defined yet.",
      );
    }
    const lines = list.map(
      (it) =>
        `${it.name} (${it.rank || "-"}) — ${it.slots} slot${it.slots === 1 ? "" : "s"}${it.effect ? ", " + it.effect : ""}`,
    );
    sendPmChunks(target, lines.join("\n"));
    return;
  }

  if (cmd === "classes") {
    const list = [...classes.values()].map((c) => c.name);
    sendPm(target, `Classes (${list.length}):\n${list.join(", ")}`);
    return;
  }

  if (cmd === "weapons") {
    const list = [...weapons.values()].map((w) => w.name);
    sendPm(target, `Weapons (${list.length}):\n${list.join(", ")}`);
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
  const all: { source: string; ability: AbilityData }[] = [];
  for (const cls of classes.values()) {
    for (const ab of cls.abilities) {
      all.push({ source: `Class ${cls.name}`, ability: ab });
    }
  }
  for (const wpn of weapons.values()) {
    for (const ab of wpn.abilities) {
      all.push({ source: `Weapon ${wpn.name}`, ability: ab });
    }
  }

  // Exact name wins, then an explicit alias, then a unique prefix.
  const exact = all.filter((x) => toId(x.ability.name) === id);
  if (exact.length > 0) return exact[0];

  const alias = all.filter((x) =>
    x.ability.aliases?.some((a) => toId(a) === id),
  );
  if (alias.length === 1) return alias[0];

  const prefix = all.filter((x) => toId(x.ability.name).startsWith(id));
  return prefix.length === 1 ? prefix[0] : null;
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
