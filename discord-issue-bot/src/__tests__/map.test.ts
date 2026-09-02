import { describe, it, expect } from "bun:test";
import { buildMapProposal, normalizeMapName } from "../map.js";

const NTR_5x5 = ["..r..", ".....", ".w+w.", ".....", "..r.."].join("\n");

describe("normalizeMapName", () => {
  it("lowercases and trims", () => {
    expect(normalizeMapName("  Sprint  ")).toBe("sprint");
  });
  it("accepts underscores/hyphens and lowercases", () => {
    expect(normalizeMapName("UPPER_ok-1")).toBe("upper_ok-1");
  });
  it("rejects spaces / bad chars / too long", () => {
    expect(() => normalizeMapName("my map")).toThrow();
    expect(() => normalizeMapName("a".repeat(41))).toThrow();
    expect(() => normalizeMapName("")).toThrow();
  });
});

describe("buildMapProposal", () => {
  it("builds a valid ntr 5x5 proposal", () => {
    const p = buildMapProposal("sprint", "ntr", NTR_5x5);
    expect(p.title).toBe("Map: sprint"); // workflow trigger
    expect(p.name).toBe("sprint");
    expect(p.rows).toBe(5);
    expect(p.cols).toBe(5);
    expect(p.modes).toEqual(["ntr"]);
    expect(p.body).toContain("Map name: sprint");
    expect(p.body).toContain("Modes: ntr");
    expect(p.body).toContain("```txt");
    expect(p.body).toContain("name: sprint");
    expect(p.body).toContain("..r..");
  });

  it("accepts multiple modes and aliases (duel → 1v1)", () => {
    const p = buildMapProposal("arena7", "ffa, duel", [
      ".......",
      ".......",
      ".......",
      ".......",
      ".......",
      ".......",
      ".......",
    ].join("\n"));
    expect(p.modes).toEqual(["ffa", "1v1"]);
    expect(p.body).toContain("Modes: ffa, 1v1");
  });

  it("rejects unknown modes", () => {
    expect(() => buildMapProposal("x", "teamdeathmatch", NTR_5x5)).toThrow(
      /unknown game mode/i,
    );
  });

  it("rejects maps smaller than the mode minimum (7 for ffa, 5 for ntr)", () => {
    // 5x5 with ffa → needs 7
    expect(() => buildMapProposal("small", "ffa", NTR_5x5)).toThrow(/row/);
    // 4x4 with ntr → needs 5
    expect(() =>
      buildMapProposal("tiny", "ntr", ["....", "....", "....", "...."].join("\n")),
    ).toThrow(/row/);
  });

  it("rejects ragged rows", () => {
    expect(() =>
      buildMapProposal("ragged", "ntr", ["..r..", ".....", ".w+w", ".....", "..r.."].join("\n")),
    ).toThrow(/same length|columns|row/i);
  });

  it("rejects unknown terrain codes", () => {
    expect(() =>
      buildMapProposal("bad", "ntr", ["..q..", ".....", ".....", ".....", "..r.."].join("\n")),
    ).toThrow(/unknown terrain code/i);
  });

  it("rejects empty grid", () => {
    expect(() => buildMapProposal("empty", "ntr", "")).toThrow(/empty/i);
  });
});
