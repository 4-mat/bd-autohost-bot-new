import { describe, expect, test } from "bun:test";
import {
  GAMEMODE_MAPS,
  GAMEMODE_MIN_SIZE,
  mapsForMode,
  modeIdFor,
  randomMapForMode,
  recommendedMaps,
} from "../data/gamemodes.js";
import { getMapByName } from "../data/maps.js";

describe("GAMEMODE_MAPS", () => {
  test("every designated map exists in the curated map list", () => {
    for (const [mode, pool] of Object.entries(GAMEMODE_MAPS)) {
      for (const name of pool) {
        expect(
          getMapByName(name),
          `${mode} pool: "${name}" is not a curated map`,
        ).toBeDefined();
      }
    }
  });

  test("pools are non-empty and have no duplicates", () => {
    for (const [mode, pool] of Object.entries(GAMEMODE_MAPS)) {
      expect(pool.length, `${mode} pool is empty`).toBeGreaterThan(0);
      expect(new Set(pool).size, `${mode} pool has duplicates`).toBe(
        pool.length,
      );
    }
  });

  test("ntr maps may be as small as 5x5", () => {
    expect(GAMEMODE_MIN_SIZE.ntr).toBe(5);
    for (const [mode, min] of Object.entries(GAMEMODE_MIN_SIZE)) {
      if (mode !== "ntr") expect(min).toBeGreaterThanOrEqual(7);
    }
  });
});

describe("mapsForMode", () => {
  test("merges volunteer maps tagged for a mode into its pool", () => {
    expect(mapsForMode("ntr")).toContain("example-ntr");
    expect(mapsForMode("ffa")).not.toContain("example-ntr");
  });

  test("returns empty for unknown modes", () => {
    expect(mapsForMode("solo")).toEqual([]);
  });

  test("recommendedMaps includes volunteer-tagged maps", () => {
    expect(recommendedMaps("ntr")).toContain("example-ntr");
  });

  test("randomMapForMode can pick a volunteer-tagged map", () => {
    const pool = recommendedMaps("ntr")!;
    for (let i = 0; i < 50; i++) {
      expect(pool).toContain(randomMapForMode("ntr"));
    }
  });
});

describe("modeIdFor", () => {
  test("resolves known modes and aliases", () => {
    expect(modeIdFor("ffa")).toBe("ffa");
    expect(modeIdFor("FFA")).toBe("ffa");
    expect(modeIdFor("ntr")).toBe("ntr");
    expect(modeIdFor("jugg")).toBe("jugg");
    expect(modeIdFor("juggernaut")).toBe("jugg");
    expect(modeIdFor("pvp")).toBe("pvp");
    expect(modeIdFor("2v2")).toBe("pvp");
    expect(modeIdFor("3v3")).toBe("pvp");
    expect(modeIdFor("1v1")).toBe("1v1");
    expect(modeIdFor("duel")).toBe("1v1");
  });

  test("returns undefined for unknown modes", () => {
    expect(modeIdFor("solo")).toBeUndefined();
    expect(modeIdFor("co-op")).toBeUndefined();
    expect(modeIdFor("")).toBeUndefined();
    expect(modeIdFor("  ")).toBeUndefined();
  });
});

describe("recommendedMaps", () => {
  test("returns the designated pool for a mode", () => {
    expect(recommendedMaps("ffa")).toEqual(GAMEMODE_MAPS.ffa);
    expect(recommendedMaps("2v2")).toEqual(GAMEMODE_MAPS.pvp);
    expect(recommendedMaps("duel")).toEqual(GAMEMODE_MAPS["1v1"]);
  });

  test("returns undefined when the mode has no pool", () => {
    expect(recommendedMaps("unknown")).toBeUndefined();
  });
});

describe("randomMapForMode", () => {
  test("always picks a map from the mode's pool", () => {
    for (const mode of ["ffa", "ntr", "jugg", "pvp", "1v1", "2v2", "duel"]) {
      const pool = recommendedMaps(mode)!;
      for (let i = 0; i < 20; i++) {
        const pick = randomMapForMode(mode);
        expect(pick, `${mode} pick must be from its pool`).toBeDefined();
        expect(pool).toContain(pick);
      }
    }
  });

  test("returns undefined for unknown modes", () => {
    expect(randomMapForMode("solo")).toBeUndefined();
    expect(randomMapForMode("")).toBeUndefined();
  });
});
