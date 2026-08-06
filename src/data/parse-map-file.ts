import { Terrain } from "../game/state.js";
import type { MapDef } from "./maps.js";

export const MIN_DIM = 7;
export const MAX_DIM = 60;

export const TERRAIN_CODES: Record<string, Terrain> = {
  ".": Terrain.Normal,
  n: Terrain.Normal,
  s: Terrain.Stop,
  w: Terrain.Water,
  f: Terrain.Forest,
  i: Terrain.Ice,
  a: Terrain.Air,
  x: Terrain.Sticky,
  l: Terrain.Lava,
  r: Terrain.Broken,
  b: Terrain.Bone,
  o: Terrain.Stone,
  h: Terrain.Hearth,
  "+": Terrain.Boost,
};

export const MAP_FILE_CODES = TERRAIN_CODES;

export class MapError extends Error {
  constructor(file: string, line: number, message: string) {
    super(`${file}:${line}: ${message}`);
    this.name = "MapError";
  }
}

const NAME_RE = /^[a-z0-9_-]{1,40}$/;
const GEN_RE = /^gen\d*$/;
const HEAD_RE = /^(name|display)\s*:\s*(.*)$/;

export function displayFromName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase());
}

export const displayNameFor = displayFromName;

export function parseMapFile(text: string, file = "map"): MapDef {
  let name = "";
  let disp: string | undefined;
  const rows: { text: string; line: number }[] = [];
  let n = 0;

  for (const raw of text.split(/\r?\n/)) {
    n++;
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const head = line.match(HEAD_RE);
    if (head) {
      const val = head[2].trim();
      if (head[1] === "name") {
        name = val.toLowerCase();
        if (!NAME_RE.test(name))
          throw new MapError(
            file,
            n,
            `bad map name "${name}" — use lowercase letters, digits, - or _ (up to 40 chars, no spaces)`,
          );
        if (GEN_RE.test(name))
          throw new MapError(
            file,
            n,
            `"${name}" is reserved for %setmap gen (procedural maps)`,
          );
      } else {
        disp = val;
        if (!disp || disp.length > 60)
          throw new MapError(file, n, "display name must be 1-60 chars");
      }
      continue;
    }

    rows.push({ text: line, line: n });
  }

  if (!name) throw new MapError(file, 0, "missing a `name: <id>` line");
  if (rows.length < MIN_DIM)
    throw new MapError(
      file,
      0,
      `map too small: ${rows.length} row(s), need at least ${MIN_DIM}`,
    );
  if (rows.length > MAX_DIM)
    throw new MapError(
      file,
      0,
      `map too tall: ${rows.length} rows (max ${MAX_DIM})`,
    );

  const cols = rows[0].text.length;
  if (cols < MIN_DIM)
    throw new MapError(
      file,
      rows[0].line,
      `map too narrow: ${cols} columns, need at least ${MIN_DIM}`,
    );
  if (cols > MAX_DIM)
    throw new MapError(
      file,
      rows[0].line,
      `map too wide: ${cols} columns (max ${MAX_DIM})`,
    );

  const grid = rows.map(({ text, line }) => {
    if (text.length !== cols)
      throw new MapError(
        file,
        line,
        `row has ${text.length} cells, expected ${cols} — every row must be the same length`,
      );
    return text.split("").map((code) => {
      const t = TERRAIN_CODES[code];
      if (t === undefined)
        throw new MapError(
          file,
          line,
          `unknown terrain code "${code}" — see maps/README.md for the legend`,
        );
      return t;
    });
  });

  return {
    name,
    displayName: disp ?? displayFromName(name),
    rows: grid.length,
    cols,
    grid,
  };
}

export const parseMapText = parseMapFile;
