import { describe, it, expect } from "bun:test";
import { parseItemStats, applyItemMods, parseHeal } from "../game/items.js";

describe("parseItemStats", () => {
  it("parses stat-first boost/nerf tokens", () => {
    expect(parseItemStats({ statBoosts: "ATK +2, MAG +1" })).toEqual([
      { stat: "atk", amount: 2 },
      { stat: "mag", amount: 1 },
    ]);
    expect(parseItemStats({ statNerfs: "PD -1" })).toEqual([
      { stat: "pd", amount: -1 },
    ]);
  });

  it("parses number-first tokens", () => {
    expect(parseItemStats({ statBoosts: "+2 ATK, -1 MD" })).toEqual([
      { stat: "atk", amount: 2 },
      { stat: "md", amount: -1 },
    ]);
  });

  it("treats unsigned nerfs as negative", () => {
    expect(parseItemStats({ statNerfs: "EVA 3" })).toEqual([
      { stat: "eva", amount: -3 },
    ]);
  });

  it("handles abbreviations and dot-separated names", () => {
    expect(parseItemStats({ statBoosts: "P.Def +4, M.Def +2" })).toEqual([
      { stat: "pd", amount: 4 },
      { stat: "md", amount: 2 },
    ]);
  });
});

describe("applyItemMods", () => {
  const block = () => ({
    maxhp: 100,
    curhp: 80,
    atk: 10,
    mag: 10,
    pd: 0,
    md: 0,
    eva: 0,
    mp: 3,
  });

  it("applies and reverts stat mods", () => {
    const e = block();
    const item = { statBoosts: "ATK +3, HP +20", statNerfs: "PD -1" };
    applyItemMods(e, item, 1);
    expect(e.atk).toBe(13);
    expect(e.maxhp).toBe(120);
    expect(e.curhp).toBe(100);
    expect(e.pd).toBe(-1);

    applyItemMods(e, item, -1);
    expect(e.atk).toBe(10);
    expect(e.maxhp).toBe(100);
    expect(e.curhp).toBe(100);
    expect(e.pd).toBe(0);
  });

  it("clamps curhp when reverting HP with damage taken", () => {
    const e = block();
    const item = { statBoosts: "HP +20" };
    applyItemMods(e, item, 1);
    e.curhp = 30; // took damage while boosted
    applyItemMods(e, item, -1);
    expect(e.maxhp).toBe(100);
    expect(e.curhp).toBe(30);
  });
});

describe("parseHeal", () => {
  it("finds heal amounts", () => {
    expect(parseHeal("Heal 20 HP")).toBe(20);
    expect(parseHeal("Restore 15 health on use")).toBe(15);
    expect(parseHeal("Recover 8 HP")).toBe(8);
  });

  it("returns 0 for non-heal effects", () => {
    expect(parseHeal("Deal 10 damage")).toBe(0);
    expect(parseHeal("")).toBe(0);
  });
});
