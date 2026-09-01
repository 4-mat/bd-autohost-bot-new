// src/data/overrides.ts
//
// Shared handoff between the Ability Editor (abilityeditor/) and any process
// that runs the game (test-app, the bot, etc.).
//
// The editor server keeps the authoritative in-memory `classes`/`weapons`
// Maps. On every mutation it writes abilityeditor/runtime-data.json — a plain
// snapshot of the full class/weapon dataset, including any temporary custom
// test classes/weapons. Game processes call `applyEditorSnapshot()` after
// `loadGameData()` (or on demand) to pick those up without a restart.
//
// Custom test classes/weapons are NEVER written into src/data/index.ts; only
// permanent ability/stat edits made through "Save to Bot" regenerate source.

import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { classes, weapons, type ClassData, type WeaponData } from "./index.js";

function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** JSON file the editor server writes after every mutation. */
// import.meta.dirname needs Node >= 20.11 / Bun 1.0 — fall back for older runtimes.
const MODULE_DIR =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : dirname(fileURLToPath(import.meta.url));

export const RUNTIME_DATA_PATH = join(
  MODULE_DIR,
  "../../abilityeditor/runtime-data.json",
);

export interface EditorSnapshot {
  classes: ClassData[];
  weapons: WeaponData[];
}

/** Read the editor's latest snapshot (null when the file doesn't exist). */
export function readEditorSnapshot(
  path: string = RUNTIME_DATA_PATH,
): EditorSnapshot | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Overlay an editor snapshot onto the in-memory classes/weapons Maps.
 * Returns the number of entries (re)applied.
 */
export function applyEditorSnapshot(snap: EditorSnapshot | null): number {
  if (!snap) return 0;
  const seenClasses = new Set<string>();
  const seenWeapons = new Set<string>();
  let applied = 0;
  for (const c of snap.classes ?? []) {
    if (c?.name) {
      const id = toId(c.name);
      classes.set(id, c);
      seenClasses.add(id);
      applied++;
    }
  }
  for (const w of snap.weapons ?? []) {
    if (w?.name) {
      const id = toId(w.name);
      weapons.set(id, w);
      seenWeapons.add(id);
      applied++;
    }
  }
  // The snapshot is authoritative: drop entries the editor removed (deleted
  // customs, renamed-away built-ins) so the running process mirrors it exactly.
  for (const k of classes.keys()) if (!seenClasses.has(k)) classes.delete(k);
  for (const k of weapons.keys()) if (!seenWeapons.has(k)) weapons.delete(k);
  return applied;
}

/** Dump the current in-memory Maps so other processes can apply them. */
export function writeEditorSnapshot(path: string = RUNTIME_DATA_PATH): void {
  const snap: EditorSnapshot = {
    classes: [...classes.values()],
    weapons: [...weapons.values()],
  };
  mkdirSync(dirname(path), { recursive: true });
  // Write atomically (temp + rename) so a reader polling the file never sees
  // a truncated snapshot mid-write.
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(snap, null, 2) + "\n");
  renameSync(tmp, path);
}
