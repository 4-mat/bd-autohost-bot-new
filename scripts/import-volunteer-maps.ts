import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseMapFile } from "../src/data/parse-map-file.js";

const root = process.cwd();
const mapsDir = join(root, "maps");

const files = (await readdir(mapsDir)).filter((f) => f.endsWith(".txt")).sort();

const mapsSrc = await Bun.file(join(root, "src", "data", "maps.ts")).text();
const curatedNames = new Set(
  [...mapsSrc.matchAll(/MAPS\.set\("([^"]+)"/g)].map((m) => m[1]),
);

const errors: string[] = [];
const parsed: {
  name: string;
  displayName: string;
  rows: number;
  cols: number;
  grid: number[][];
}[] = [];
const seen = new Set<string>();

for (const file of files) {
  const text = await Bun.file(join(mapsDir, file)).text();
  let map;
  try {
    map = parseMapFile(text, file);
  } catch (e) {
    errors.push((e as Error).message);
    continue;
  }
  if (curatedNames.has(map.name)) {
    errors.push(
      `${file}: map name "${map.name}" already exists in the curated map database`,
    );
    continue;
  }
  if (seen.has(map.name)) {
    errors.push(
      `${file}: duplicate map name "${map.name}" (also used in another volunteer map)`,
    );
    continue;
  }
  seen.add(map.name);
  parsed.push(map);
}

if (errors.length > 0) {
  console.error(`Volunteer map import failed with ${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

parsed.sort((a, b) => a.name.localeCompare(b.name));

const out: string[] = [];
out.push(`import { Terrain } from "../game/state.js";`);
out.push(`import type { MapDef } from "./maps.js";`);
out.push(``);
out.push(`export const volunteerMaps: MapDef[] = [`);

for (const m of parsed) {
  const gridStr = m.grid.map((row) => `[${row.join(", ")}]`).join(",\n      ");
  out.push(`  {`);
  out.push(`    name: "${m.name}",`);
  out.push(`    displayName: "${m.displayName}",`);
  out.push(`    rows: ${m.rows},`);
  out.push(`    cols: ${m.cols},`);
  out.push(`    grid: [`);
  out.push(`      ${gridStr}`);
  out.push(`    ],`);
  out.push(`  },`);
}

out.push(`];`);
out.push(``);

await Bun.write(join(root, "src", "data", "volunteer-maps.ts"), out.join("\n"));

console.log(
  `Imported ${parsed.length} volunteer map(s) into src/data/volunteer-maps.ts`,
);
for (const m of parsed) {
  console.log(`  ${m.name} (${m.rows}x${m.cols}) — ${m.displayName}`);
}
