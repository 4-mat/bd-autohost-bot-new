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
  mkdirSync,
} from "fs";
import { dirname, join } from "path";
import { classes, weapons, type ClassData, type WeaponData } from "./index.js";

function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** JSON file the editor server writes after every mutation. */
export const RUNTIME_DATA_PATH = join(
  import.meta.dirname,
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
  let applied = 0;
  for (const c of snap.classes ?? []) {
    if (c?.name) {
      classes.set(toId(c.name), c);
      applied++;
    }
  }
  for (const w of snap.weapons ?? []) {
    if (w?.name) {
      weapons.set(toId(w.name), w);
      applied++;
    }
  }
  return applied;
}

/** Dump the current in-memory Maps so other processes can apply them. */
export function writeEditorSnapshot(path: string = RUNTIME_DATA_PATH): void {
  const snap: EditorSnapshot = {
    classes: [...classes.values()],
    weapons: [...weapons.values()],
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snap, null, 2) + "\n");
}
