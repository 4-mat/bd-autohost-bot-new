import { send, sendPm, toId } from "../utils.js";
import type { User } from "../users.js";
import type { Room } from "../rooms.js";
import { type GameVersion } from "../data/index.js";
import { WhatIs, Reference } from "../data/index.js";
import { getVersionData } from "../data/version43.js";
import { games, type Game } from "../game/state.js";
import { modeDescription, describeModes } from "../data/gamemodes.js";

function findGameForRoom(roomid: string): Game | null {
  for (const game of games.values()) {
    if (game.room === roomid) return game;
  }
  return null;
}

// Resolve the game version to use for a %wt lookup.
// Prefer the current room's game version; fall back to a player-scoped
// scan, then to 4.4. Pass an override (e.g. "4.3") to pin to a specific
// version regardless of context (used by %wt4.3).
function resolveVersion(
  user: User,
  room: Room | null | undefined,
  override?: GameVersion,
): GameVersion {
  if (override) return override;
  const roomGame = room ? findGameForRoom(room.id) : null;
  if (roomGame) return roomGame.version;
  for (const g of games.values()) {
    if (g.entities.some((e) => toId(e.name) === toId(user.name))) {
      return g.version;
    }
  }
  return "4.4";
}

// Render an ability card used by the %wt ability-search path.
function formatAbilityCard(
  parent: string,
  branch: string | null,
  ab: {
    name: string;
    level: number | "EX1" | "EX2";
    frequency: string;
    mr: number;
    roll: string;
    damageType: string;
    actionType: string;
    range: string;
    effect: string;
  },
): string {
  const head = branch
    ? `**${parent}** (${branch}) — **${ab.name}**`
    : `**${parent}** — **${ab.name}**`;
  return [
    head,
    `Lv.${ab.level} | ${ab.frequency} | MR ${ab.mr}`,
    ab.roll ? `Roll: ${ab.roll}` : "",
    ab.damageType ? `${ab.damageType} ${ab.actionType}` : ab.actionType,
    ab.range ? `Range: ${ab.range}` : "",
    "",
    ab.effect,
  ]
    .filter(Boolean)
    .join("\n");
}

// Search classes → weapons → abilities within the given version data.
// Returns the rendered message, or null if no match was found.
function searchVersionData(
  id: string,
  args: string,
  version: GameVersion,
  classes: ReturnType<typeof getVersionData>["classes"],
  weapons: ReturnType<typeof getVersionData>["weapons"],
): string | null {
  // Check weapons
  const weapon = weapons.get(id);
  if (weapon) {
    const lines = [`**${weapon.name}** (${weapon.branch})`];
    for (const ab of weapon.abilities) {
      lines.push(buildAbilityLine(ab));
    }
    return lines.join("\n");
  }

  // Check classes
  const cls = classes.get(id);
  if (cls) {
    const lines = [`**${cls.name}**`];
    for (const ab of cls.abilities) {
      lines.push(buildAbilityLine(ab));
    }
    return lines.join("\n");
  }

  // Search all abilities across weapons and classes.
  // NOTE on precedence: class-name and weapon-name matches win first
  // because they describe a coherent entry (stats + ability list). An
  // ability-only match returns a single ability card. If two abilities
  // share a name across weapons/classes, the first one found wins —
  // open to disambiguation later (see PR review thread).
  for (const w of weapons.values()) {
    for (const ab of w.abilities) {
      if (toId(ab.name) === id) return formatAbilityCard(w.name, w.branch, ab);
    }
  }
  for (const c of classes.values()) {
    for (const ab of c.abilities) {
      if (toId(ab.name) === id) return formatAbilityCard(c.name, null, ab);
    }
  }

  return null;
}

export function infoCommand(
  user: User,
  cmd: string,
  args: string,
  room?: Room | null,
) {
  const target = user.name;

  // %wt and %wt4.3 share the same lookup logic; the only difference is
  // whether the version is resolved from the room/user or pinned to 4.3.
  if (cmd === "wt" || cmd === "wt4.3") {
    const id = toId(args);
    if (!id)
      return sendPm(target, `Usage: %${cmd} [ability/item/status/tile/mode]`);

    // List every game mode (the doc's "/rfaq modes"). This is not
    // version-scoped — mode descriptions apply to both 4.3 and 4.4.
    if (id === "modes" || id === "gamemodes") {
      sendPm(target, describeModes());
      return;
    }

    // WhatIs and mode lookups are not version-scoped.
    if (cmd === "wt") {
      const entry = WhatIs.get(id);
      if (entry) {
        sendPm(target, entry);
        return;
      }
      const mode = modeDescription(args);
      if (mode) {
        sendPm(target, mode);
        return;
      }
    }

    const override = cmd === "wt4.3" ? "4.3" : undefined;
    const version = resolveVersion(user, room, override);
    const { classes, weapons } = getVersionData(version);
    const result = searchVersionData(id, args, version, classes, weapons);
    if (result) {
      sendPm(target, result);
      return;
    }

    sendPm(target, `No data found for "${args}" in ${version}.`);
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

  if (cmd === "wtm") {
    // Monster move lookup. Tracked in issue #290 — once monster data is
    // loaded into src/data, this command will resolve the same way %wt
    // does for class/weapon abilities, but scoped to monster-only moves.
    return sendPm(
      target,
      "No monster data loaded yet — %wtm is reserved for monster moves. See https://github.com/4-mat/bd-autohost-bot-new/issues/290",
    );
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
