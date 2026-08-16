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
    // wtLookup returns atomic blocks (each <details> element is indivisible).
    // Chunk at block boundaries so a PM never splits a block mid-tag, which
    // would render as broken HTML in the client.
    for (const chunk of chunkBlocks(wtLookup(args))) {
      sendPm(target, chunk);
    }
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

// Pure lookup: returns the atomic blocks %wt should reply with (each
// <details> ability/mode block is one block), so the command handler stays
// a thin send wrapper and the logic is unit-testable without touching the
// process-wide send queue.
export function wtLookup(args: string): string[] {
  const id = toId(args);
  if (!id) return ["Usage: %wt [ability/item/status/tile/mode] or %wt <class/weapon> <ability>"];

  // List every game mode (the doc's "/rfaq modes"). describeModes joins
  // per-mode <details> blocks with a blank line — split back into atoms.
  if (id === "modes" || id === "gamemodes") {
    return describeModes().split(/\n\s*\n/).filter(Boolean);
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
    return buildItemDump(weapon.name, weapon.branch, weapon.abilities);
  }

  // Check classes
  const cls = classes.get(id);
  if (cls) {
    return buildItemDump(cls.name, "", cls.abilities);
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

// One class/weapon's full ability list, one block per ability. Large
// classes exceed Discord's ~2000-char PM limit and would be truncated (the
// original %wt flooding), so the caller chunks the blocks — see chunkBlocks.
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
): string[] {
  return [
    `**${name}**` + (branch ? ` (${branch})` : ""),
    ...abilities.map((ab) => buildAbilityDropdown(ab)),
  ];
}

// Group atomic blocks into PM-sized messages without ever splitting a
// block. Each <details> element must stay whole or its HTML breaks when
// rendered; a single block longer than the limit is sent intact (Discord's
// hard limit is 2000, so an oversized block still fits one PM).
export function chunkBlocks(blocks: string[], limit = 900): string[] {
  const out: string[] = [];
  let cur = "";
  for (const b of blocks) {
    const next = cur ? cur + "\n" + b : b;
    if (cur && next.length > limit) {
      out.push(cur);
      cur = b;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);
  return out;
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
