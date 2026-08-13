// Map proposal builder.
//
// Creates the exact issue format consumed by `.github/workflows/map-pr.yml`:
//   - the issue title must start with "Map: " (workflow trigger)
//   - the issue body must contain a "Map name: <id>" line, an optional
//     "Modes: <...>" line, and a ```txt code block with the volunteer map
//     text (name/display/modes headers + grid).
//
// Validation reuses `mapeditor/mapcore.cjs` (the exact same parser the CI
// workflow and the bot's `maps/` import use), so a map that passes here is
// guaranteed to pass the workflow's `parseTxt` check.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Repo root is one level above discord-issue-bot/.
const mapcore = require("../../mapeditor/mapcore.cjs") as {
  parseTxt(text: string, file?: string): ParsedVolunteerMap;
  toTxt(map: ParsedVolunteerMap): string;
};

export interface ParsedVolunteerMap {
  name: string;
  displayName?: string;
  rows: number;
  cols: number;
  modes: string[];
  [key: string]: unknown;
}

export interface MapProposal {
  title: string;
  body: string;
  name: string;
  modes: string[];
  rows: number;
  cols: number;
}

const NAME_RE = /^[a-z0-9_-]{1,40}$/;

/** Map ids must be lowercase letters, digits, `-` or `_` (like the workflow's NAME_SAFE check). */
export function normalizeMapName(name: string | null | undefined): string {
  const n = (name ?? "").trim().toLowerCase();
  if (!NAME_RE.test(n)) {
    throw new Error(
      "Map name must be 1-40 chars of lowercase letters, digits, - or _ (no spaces).",
    );
  }
  return n;
}

/**
 * Validate the user's grid + modes and produce the "Map: <id>" issue title
 * and body. Throws with a human-readable message when the map is invalid.
 */
export function buildMapProposal(
  nameRaw: string | null | undefined,
  modesRaw: string | null | undefined,
  gridRaw: string | null | undefined,
): MapProposal {
  const name = normalizeMapName(nameRaw);
  const grid = (gridRaw ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!grid.trim()) {
    throw new Error("The map grid is empty — paste the rows of terrain codes.");
  }

  const modes = (modesRaw ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const header = [`name: ${name}`, `display: ${(nameRaw ?? "").trim()}`];
  if (modes.length) header.push(`modes: ${modes.join(", ")}`);
  const txt = [...header, "", ...grid.split("\n")].join("\n");

  let parsed: ParsedVolunteerMap;
  try {
    parsed = mapcore.parseTxt(txt, `${name}.txt`);
  } catch (e) {
    throw new Error(`Map validation failed: ${(e as Error).message}`);
  }

  const finalModes: string[] = parsed.modes ?? [];
  const body = [
    `Map name: ${parsed.name}`,
    ...(finalModes.length ? [`Modes: ${finalModes.join(", ")}`] : []),
    "",
    "```txt",
    mapcore.toTxt(parsed).trimEnd(),
    "```",
  ].join("\n");

  return {
    title: `Map: ${parsed.name}`,
    body,
    name: parsed.name,
    modes: finalModes,
    rows: parsed.rows,
    cols: parsed.cols,
  };
}
