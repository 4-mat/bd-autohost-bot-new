
enum Terrain {
  Normal = 0,
  Stop = 1,
  Water = 2,
  Forest = 3,
  Ice = 4,
  Air = 5,
  Sticky = 6,
  Lava = 7,
  Broken = 8,
  Bone = 9,
  Stone = 10,
  Hearth = 11,
  Boost = 12,
}

const csv = await Bun.file("_data/maps-raw.csv").text();
const lines = csv.split("\n").map((l: string) => l.split(","));

const codeMap: Record<string, number> = {
  "": Terrain.Normal,
  n: Terrain.Normal,
  s: Terrain.Stop,
  i: Terrain.Ice,
  w: Terrain.Water,
  f: Terrain.Forest,
  a: Terrain.Air,
  b: Terrain.Bone,
  bt: Terrain.Broken,
  st: Terrain.Stone,
  l: Terrain.Lava,
  h: Terrain.Hearth,
  "+": Terrain.Boost,
};

interface MapDef {
  name: string;
  displayName: string;
  rows: number;
  cols: number;
  grid: number[][];
}

const maps: MapDef[] = [];
const seen = new Set<string>();
const sizePattern = /^(\d+)x(\d+)$/;

// Pass 1: Find size-labeled rows (e.g. "7x7,,diodes,,,,,,7x8,,abstraction")
for (let rowIdx = 0; rowIdx < lines.length; rowIdx++) {
  const row = lines[rowIdx];

  const entries: { col: number; rows: number; cols: number; name: string }[] =
    [];

  for (let ci = 0; ci < row.length; ci++) {
    const cell = row[ci].trim();
    const sm = cell.match(sizePattern);
    if (sm) {
      const r = parseInt(sm[1]);
      const c = parseInt(sm[2]);
      // Next non-empty cell after the size is the name
      for (let ni = ci + 1; ni < Math.min(ci + 4, row.length); ni++) {
        const name = row[ni].trim();
        if (name && /^[a-zA-Z]/.test(name)) {
          entries.push({ col: ci, rows: r, cols: c, name });
          break;
        }
      }
    }
  }

  if (entries.length === 0) continue;

  const sorted = entries.sort((a, b) => a.col - b.col);

  for (let ei = 0; ei < sorted.length; ei++) {
    const entry = sorted[ei];
    const mapCols = entry.cols;
    const mapRows = entry.rows;
    const startCol = entry.col;

    // Read terrain rows below
    const grid: number[][] = [];
    for (let ri = 0; ri < mapRows; ri++) {
      const dataRow = lines[rowIdx + 1 + ri];
      if (!dataRow) break;
      const mapRow: number[] = [];
      for (let ci = 0; ci < mapCols; ci++) {
        const raw = (dataRow[startCol + ci] ?? "").trim();
        mapRow.push(codeMap[raw] ?? Terrain.Normal);
      }
      grid.push(mapRow);
    }

    if (grid.length === mapRows && !seen.has(entry.name)) {
      seen.add(entry.name);
      const displayName = entry.name
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
      maps.push({
        name: entry.name,
        displayName,
        rows: mapRows,
        cols: mapCols,
        grid,
      });
    }
  }
}

// Pass 2: Find name-only rows (no size prefix) like bifurcation, nyoom, etc.
for (let rowIdx = 0; rowIdx < lines.length; rowIdx++) {
  const row = lines[rowIdx];

  const hasSize = row.some((c: string) => sizePattern.test(c.trim()));
  if (hasSize) continue;

  // Find name cells at start of blocks (preceded by empty cell)
  const namePositions: { col: number; name: string }[] = [];
  for (let ci = 1; ci < row.length; ci++) {
    const cell = row[ci].trim();
    if (!cell) continue;
    if (row[ci - 1].trim()) continue; // not start of block
    if (
      /^[a-zA-Z][a-zA-Z0-9_]*$/.test(cell) &&
      cell.length < 40 &&
      !seen.has(cell)
    ) {
      namePositions.push({ col: ci, name: cell });
    }
  }

  if (namePositions.length < 2) continue;

  // Determine spacing between entries
  const spacings: number[] = [];
  for (let i = 1; i < namePositions.length; i++) {
    spacings.push(namePositions[i].col - namePositions[i - 1].col);
  }
  const avgSpacing =
    spacings.length > 0
      ? Math.round(
          spacings.reduce((a: number, b: number) => a + b, 0) / spacings.length,
        )
      : 7;

  // Find first terrain row below
  let terrainStartRow = -1;
  for (let ri = rowIdx + 1; ri < Math.min(rowIdx + 10, lines.length); ri++) {
    const hasTerrain = lines[ri].some((c: string) => {
      const t = c.trim();
      return t && codeMap.hasOwnProperty(t);
    });
    if (hasTerrain) {
      terrainStartRow = ri;
      break;
    }
  }

  if (terrainStartRow === -1) continue;

  for (const np of namePositions) {
    if (seen.has(np.name)) continue;

    // Count terrain rows
    let numRows = 0;
    for (
      let ri = terrainStartRow;
      ri < Math.min(terrainStartRow + 20, lines.length);
      ri++
    ) {
      const r = lines[ri];
      const hasData = r.slice(np.col, np.col + avgSpacing).some((c: string) => {
        const t = c.trim();
        return t && codeMap.hasOwnProperty(t);
      });
      if (!hasData && numRows > 0) break;
      if (hasData) numRows++;
    }

    if (numRows === 0) continue;

    const grid: number[][] = [];
    for (let ri = 0; ri < numRows; ri++) {
      const dataRow = lines[terrainStartRow + ri];
      if (!dataRow) break;
      const mapRow: number[] = [];
      for (let ci = 0; ci < avgSpacing; ci++) {
        const raw = (dataRow[np.col + ci] ?? "").trim();
        mapRow.push(codeMap[raw] ?? Terrain.Normal);
      }
      grid.push(mapRow);
    }

    if (grid.length === numRows && !seen.has(np.name)) {
      seen.add(np.name);
      const displayName = np.name
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase());
      maps.push({
        name: np.name,
        displayName,
        rows: numRows,
        cols: avgSpacing,
        grid,
      });
    }
  }
}

// Filter out garbage: single-letter names, maps smaller than 7 in either dimension
const terrainCodeNames = new Set([
  "a",
  "b",
  "f",
  "i",
  "l",
  "n",
  "s",
  "w",
  "bt",
  "st",
  "h",
]);
const filtered = maps.filter((m) => {
  if (terrainCodeNames.has(m.name)) return false;
  if (m.name.length <= 2) return false;
  if (m.rows < 7 || m.cols < 7) return false;
  return true;
});

// Generate TypeScript
const out: string[] = [];
out.push(`import { Terrain } from "../game/state.js";`);
out.push(``);
out.push(`export interface MapDef {`);
out.push(`  name: string;`);
out.push(`  displayName: string;`);
out.push(`  rows: number;`);
out.push(`  cols: number;`);
out.push(`  grid: Terrain[][];`);
out.push(`}`);
out.push(``);
out.push(`export const MAPS = new Map<string, MapDef>();`);
out.push(``);

for (const m of maps) {
  const gridStr = m.grid.map((row) => `[${row.join(", ")}]`).join(",\n    ");
  out.push(`MAPS.set("${m.name}", {`);
  out.push(`  name: "${m.name}",`);
  out.push(`  displayName: "${m.displayName}",`);
  out.push(`  rows: ${m.rows},`);
  out.push(`  cols: ${m.cols},`);
  out.push(`  grid: [`);
  out.push(`    ${gridStr}`);
  out.push(`  ],`);
  out.push(`});`);
  out.push(``);
}

out.push(`export function getMapByName(name: string): MapDef | undefined {`);
out.push(`  const id = name.toLowerCase().replace(/\\s+/g, "");`);
out.push(`  return MAPS.get(id);`);
out.push(`}`);
out.push(``);
out.push(`export function listMaps(): MapDef[] {`);
out.push(
  `  return [...MAPS.values()].sort((a, b) => a.rows - b.rows || a.name.localeCompare(b.name));`,
);
out.push(`}`);
out.push(``);

await Bun.write("src/data/maps.ts", out.join("\n"));

console.log(`Generated ${filtered.length} maps (filtered from ${maps.length})`);
console.log(`Maps by size:`);
const bySize = new Map<string, number>();
for (const m of filtered) {
  const key = `${m.rows}x${m.cols}`;
  bySize.set(key, (bySize.get(key) ?? 0) + 1);
}
for (const [k, v] of [...bySize.entries()].sort()) {
  console.log(`  ${k}: ${v} maps`);
}
console.log(`\nAll map names:`);
for (const m of filtered) {
  console.log(`  ${m.name} (${m.rows}x${m.cols})`);
}
