import { describe, expect, test } from "bun:test";
import terrainColors from "../game/terrain-colors.cjs";
import { TERRAIN_COLORS, TERRAIN_NAMES, Terrain } from "../game/state.ts";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const MapCore = require("../../mapeditor/mapcore.cjs");

/**
 * The palette has exactly one source of truth: src/game/terrain-colors.cjs.
 * Every consumer (engine TERRAIN_COLORS/TERRAIN_NAMES, mapcore TERRAINS)
 * must derive from it — if any consumer hardcodes a color, these tests fail.
 */
describe("terrain color single source", () => {
  test("canonical palette defines all 13 terrains with full metadata", () => {
    const ids = Object.keys(terrainColors);
    expect(ids).toHaveLength(13);
    for (const id of ids) {
      const entry = terrainColors[id];
      expect(entry.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.code.length).toBe(1);
      expect(typeof entry.dark).toBe("boolean");
    }
  });

  test("engine TERRAIN_COLORS matches the canonical palette", () => {
    const byId: Record<string, Terrain> = {
      normal: Terrain.Normal,
      stop: Terrain.Stop,
      water: Terrain.Water,
      forest: Terrain.Forest,
      ice: Terrain.Ice,
      air: Terrain.Air,
      sticky: Terrain.Sticky,
      lava: Terrain.Lava,
      broken: Terrain.Broken,
      bone: Terrain.Bone,
      stone: Terrain.Stone,
      hearth: Terrain.Hearth,
      boost: Terrain.Boost,
    };
    for (const [id, entry] of Object.entries(terrainColors)) {
      const t = byId[id];
      expect(t, `no engine Terrain for ${id}`).toBeDefined();
      expect(TERRAIN_COLORS[t], `engine color for ${id}`).toBe(entry.color);
      expect(TERRAIN_NAMES[t], `engine name for ${id}`).toBe(entry.label);
    }
  });

  test("mapcore TERRAINS matches the canonical palette", () => {
    for (const [id, entry] of Object.entries(terrainColors)) {
      const t = MapCore.TERRAINS[id];
      expect(t, `no mapcore terrain for ${id}`).toBeDefined();
      expect(t.color, `mapcore color for ${id}`).toBe(entry.color);
      expect(t.label, `mapcore label for ${id}`).toBe(entry.label);
      expect(t.code, `mapcore code for ${id}`).toBe(entry.code);
      expect(t.dark, `mapcore dark flag for ${id}`).toBe(entry.dark);
    }
  });
});
