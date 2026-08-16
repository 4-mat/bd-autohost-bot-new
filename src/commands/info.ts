import { send, sendPm, sendPmChunks, toId } from "../utils.js";
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
    const lines = wtLookup(args);
    // Single lookups go out as one PM; class/weapon dumps exceed Discord's
    // ~2000-char limit, so they're chunked (which is also what stops the
    // flooding %wt used to cause).
    const body = lines.join("\n");
    if (body.length > 900) sendPmChunks(target, body);
    else sendPm(target, body);
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

// Pure lookup: returns the lines %wt should reply with, so the command
// handler stays a thin send wrapper and the logic is unit-testable without
// touching the process-wide send queue.
export function wtLookup(args: string): string[] {
  const id = toId(args);
  if (!id) return ["Usage: %wt [ability/item/status/tile/mode] or %wt <class/weapon> <ability>"];

  // List every game mode (the doc's "/rfaq modes").
  if (id === "modes" || id === "gamemodes") {
    return [describeModes()];
  }

  // Check WhatIs database
  const entry = WhatIs.get(id);
  if (entry) {
    return [entry];
  }

  // Single mode lookup (e.g. %wt pvpj, %wt ntr).
  const mode = modeDescription(args);
  if (mode) {
    return [mode];
  }

  // Check weapons
  const weapon = weapons.get(id);
  if (weapon) {
    return [buildItemDump(weapon.name, weapon.branch, weapon.abilities)];
  }

  // Check classes
  const cls = classes.get(id);
  if (cls) {
    return [buildItemDump(cls.name, "", cls.abilities)];
  }

  // Check specific abilities: "%wt <class/weapon> <ability>" filters to
  // one ability on an owner; "%wt <ability>" searches every class/weapon.
  const space = args.indexOf(" ");
  if (space > 0) {
    const ownerId = toId(args.slice(0, space));
    const abilityId = toId(args.slice(space + 1));
    const owner =
      weapons.get(ownerId) || classes.get(ownerId) || null;
    if (owner) {
      const match = owner.abilities.find(
        (a) => toId(String(a.name)) === abilityId,
      );
      if (match) {
        return [buildAbilityDropdown(match)];
      }
      return [`No ability "${args.slice(space + 1)}" on ${owner.name}.`];
    }
  }

  const ab = abilities.get(id);
  if (ab) {
    return [buildAbilityDropdown(ab.ability)];
  }

  return [`No data for "${args}".`];
}

// One class/weapon's full ability list (chunked — large classes would
// otherwise exceed Discord's ~2000-char PM limit and get truncated, which
// is what originally drove the %wt flooding).
function buildItemDump(
  name: string,
  branch: string,
  abilities: {
    name: string;
    level: number | "EX1" | "EX2";
    frequency: string;
    mr: number;
    roll: string;
    damageType: string;
    actionType: string;
    range: string;
    effect: string;
  }[],
): string {
  const lines = [
    `**${name}**` + (branch ? ` (${branch})` : ""),
    ...abilities.map((ab) => buildAbilityDropdown(ab)),
  ];
  return lines.join("\n");
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
