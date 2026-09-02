import { send, sendPm, toId } from "../utils.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";
import {
  classes,
  weapons,
  branches,
  type ClassData,
  type WeaponData,
} from "../data/index.js";
import { WhatIs, Reference } from "../data/index.js";
import { modeDescription, describeModes } from "../data/gamemodes.js";

export function infoCommand(
  room: Room | null,
  user: User,
  cmd: string,
  args: string,
) {
  const target = user.name;

  if (cmd === "wt") {
    const id = toId(args);
    if (!id) return sendPm(target, "Usage: %wt [ability/item/status/tile/mode]");

    // List every game mode (the doc's "/rfaq modes").
    if (id === "modes" || id === "gamemodes") {
      sendInfo(room, target, describeModes());
      return;
    }

    // Check WhatIs database
    const entry = WhatIs.get(id);
    if (entry) {
      sendInfo(room, target, entry);
      return;
    }

    // Single mode lookup (e.g. %wt pvpj, %wt ntr).
    const mode = modeDescription(args);
    if (mode) {
      sendInfo(room, target, mode);
      return;
    }

    // Check weapons
    const weapon = weapons.get(id);
    if (weapon) {
      const lines = [`<b>${escHtml(weapon.name)}</b> (${escHtml(weapon.branch)})`];
      for (const ab of weapon.abilities) {
        lines.push(buildAbilityHtml(ab));
      }
      sendInfo(room, target, lines.join("<br>"));
      return;
    }

    // Check classes
    const cls = classes.get(id);
    if (cls) {
      const lines = [`<b>${escHtml(cls.name)}</b>`];
      for (const ab of cls.abilities) {
        lines.push(buildAbilityHtml(ab));
      }
      sendInfo(room, target, lines.join("<br>"));
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

function sendInfo(room: Room | null, target: string, text: string) {
  if (room) {
    send(room.id, `/addhtmlbox <div style="padding:4px 8px;font-size:13px">${text}</div>`);
  } else {
    sendPm(target, text);
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildAbilityHtml(ab: {
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
  return `  <b>${escHtml(ab.name)}</b> (Lv.${ab.level}) - ${escHtml(ab.frequency)}, MR ${ab.mr}, ${escHtml(ab.roll)}, ${escHtml(ab.damageType)} ${escHtml(ab.actionType)}, ${escHtml(ab.range)}: ${escHtml(ab.effect)}`;
}
