import { describe, expect, test } from "bun:test";
import { applyPoolChanges } from "../../mapeditor/pool-validate.cjs";

function base() {
  return {
    modes: {
      ffa: ["arena", "battledome"],
      ntr: ["ntr"],
      jugg: [],
      pvp: [],
      "1v1": [],
    },
  };
}

const valid = new Set(["arena", "battledome", "ntr", "northstar"]);

describe("applyPoolChanges", () => {
  test("applies a real addition", () => {
    const data = base();
    const { applied, summary, unknown } = applyPoolChanges(
      data,
      ["ffa|+|northstar"],
      valid,
    );
    expect(applied).toBe(true);
    expect(data.modes.ffa).toContain("northstar");
    expect(summary).toEqual(["add northstar to ffa"]);
    expect(unknown).toEqual([]);
  });

  test("no-op when already in the pool", () => {
    const data = base();
    const { applied } = applyPoolChanges(data, ["ffa|+|arena"], valid);
    expect(applied).toBe(false);
    expect(data.modes.ffa).toEqual(["arena", "battledome"]);
  });

  test("contradictory add+remove produces no write", () => {
    const data = base();
    const { applied, summary } = applyPoolChanges(
      data,
      ["ffa|+|northstar", "ffa|-|northstar"],
      valid,
    );
    expect(applied).toBe(false);
    expect(data.modes.ffa).toEqual(["arena", "battledome"]);
    expect(summary.length).toBe(2);
  });

  test("unknown map name produces no write", () => {
    const data = base();
    const { applied, unknown } = applyPoolChanges(
      data,
      ["ffa|+|ghostmap"],
      valid,
    );
    expect(applied).toBe(false);
    expect(unknown).toEqual(["ghostmap"]);
    expect(data.modes.ffa).toEqual(["arena", "battledome"]);
  });

  test("mixed valid and unknown changes leave pool unchanged", () => {
    const data = base();
    const { applied, summary, unknown } = applyPoolChanges(
      data,
      ["ffa|+|northstar", "ffa|+|ghostmap"],
      valid,
    );
    expect(applied).toBe(false);
    expect(unknown).toEqual(["ghostmap"]);
    expect(summary).toEqual([]);
    expect(data.modes.ffa).toEqual(["arena", "battledome"]);
  });
});
