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

// Build a list of all class names, weapon names, and ability names
// available in the given version data.
type Entry = {
  kind: "class" | "weapon" | "ability";
  parent: string;
  name: string;
};
function collectEntries(
  classes: ReturnType<typeof getVersionData>["classes"],
  weapons: ReturnType<typeof getVersionData>["weapons"],
): Entry[] {
  const out: Entry[] = [];
  for (const [, c] of classes) {
    out.push({ kind: "class", parent: c.name, name: c.name });
    for (const ab of c.abilities)
      out.push({ kind: "ability", parent: c.name, name: ab.name });
  }
  for (const [, w] of weapons) {
    out.push({ kind: "weapon", parent: w.name, name: w.name });
    for (const ab of w.abilities)
      out.push({ kind: "ability", parent: w.name, name: ab.name });
  }
  return out;
}

// Minimum Levenshtein distance between two strings.
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Build an initialism from an ability name: first letter of each word.
// "Arrow Flurry" → "AF", "Hunter's Mark" → "HM", "Oscillations" → "O".
function initialism(name: string): string {
  return name
    .replace(/[^a-zA-Z\s]/g, "")
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// Return up to `max` suggestions for `query` from `entries`.
// Priority: exact initialism match first (case-insensitive), then lowest
// Levenshtein distance. Initialism matches are always included regardless
// of the Levenshtein threshold since a short abbreviation can look nothing
// like the full name.
function getSuggestions(query: string, entries: Entry[], max = 3): string[] {
  const q = toId(query);
  const results: { entry: Entry; dist: number }[] = [];

  for (const entry of entries) {
    const nameId = toId(entry.name);
    // Exact initialism match (case-insensitive via toId on both sides)
    if (toId(initialism(entry.name)) === q) {
      results.push({ entry, dist: -1 }); // -1 sorts before any real distance
      continue;
    }
    // Levenshtein — include if distance <= 3 or <= 40% of query length
    const dist = levenshtein(q, nameId);
    if (dist <= Math.max(3, Math.ceil(q.length * 0.4))) {
      results.push({ entry, dist });
    }
  }

  results.sort((a, b) => a.dist - b.dist);
  return results.slice(0, max).map(({ entry }) => entry.name);
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

    const entries = collectEntries(classes, weapons);

    // Short queries (1-3 chars) skip substring search to avoid flooding
    // results. For these, rely on "Did you mean" which handles initialisms
    // and typos well. Long-enough partial queries go to substring search.
    if (id.length >= 3) {
      const matches = entries
        .filter((e) => toId(e.name).includes(id) || id.includes(toId(e.name)))
        .map((e) => e.name);

      if (matches.length > 1) {
        sendPm(
          target,
          `Multiple entries found: ${matches.join(", ")}, ${version}`,
        );
        return;
      }
      if (matches.length === 1) {
        // Single substring match — treat it like an exact hit by re-running
        // searchVersionData with the matched name (will return the card).
        const matched = searchVersionData(
          toId(matches[0]),
          matches[0],
          version,
          classes,
          weapons,
        );
        if (matched) {
          sendPm(target, matched);
          return;
        }
      }
    }

    // No match — try to suggest close names (initialism or Levenshtein).
    const suggestions = getSuggestions(id, entries);
    if (suggestions.length > 0) {
      sendPm(
        target,
        `No data found for "${args}" in ${version}. Did you mean: ${suggestions.join(", ")}?`,
      );
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
