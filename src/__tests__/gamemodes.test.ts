import { describe, expect, test } from "bun:test";
import {
  GAMEMODE_MAPS,
  VOTE_OPTIONS,
  describeModes,
  modeDescription,
  modeIdFor,
  normalizeVoteMode,
  randomMapForMode,
  recommendedMaps,
  runoffOptions,
  tallyVotes,
  tieModes,
  voteOptionsFor,
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
    // BD 4.4 modes
    expect(modeIdFor("4v4")).toBe("pvp");
    expect(modeIdFor("2v2v2")).toBe("pvp");
    expect(modeIdFor("2v2v2v2")).toBe("pvp");
    expect(modeIdFor("2vj")).toBe("jugg");
    expect(modeIdFor("3vj")).toBe("jugg");
    expect(modeIdFor("4vj")).toBe("jugg");
    expect(modeIdFor("pvpj")).toBe("pvp");
    expect(modeIdFor("pvp juggernaut")).toBe("pvp");
    expect(modeIdFor("pvpntr")).toBe("ntr");
    expect(modeIdFor("pvp ntr")).toBe("ntr");
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

describe("voteOptionsFor", () => {
  test("filters exact-count modes by lobby size", () => {
    expect(voteOptionsFor(2).map((o) => o.id)).toEqual([
      "FFA",
      "1v1",
      "NTR",
      "JUGG",
    ]);
    expect(voteOptionsFor(4).map((o) => o.id)).toEqual([
      "FFA",
      "2v2",
      "NTR",
      "JUGG",
      "3vJ",
      "PvPNTR",
    ]);
    expect(voteOptionsFor(6).map((o) => o.id)).toEqual([
      "FFA",
      "3v3",
      "2v2v2",
      "NTR",
      "JUGG",
      "PvPNTR",
    ]);
    expect(voteOptionsFor(8).map((o) => o.id)).toEqual([
      "FFA",
      "4v4",
      "2v2v2v2",
      "NTR",
      "JUGG",
      "PvPNTR",
    ]);
  });

  test("offers Juggernaut formats at their exact sizes", () => {
    expect(voteOptionsFor(3).map((o) => o.id)).toContain("2vJ");
    expect(voteOptionsFor(4).map((o) => o.id)).toContain("3vJ");
    expect(voteOptionsFor(5).map((o) => o.id)).toContain("4vJ");
    expect(voteOptionsFor(5).map((o) => o.id)).toContain("PvPJ");
    expect(voteOptionsFor(7).map((o) => o.id)).toContain("PvPJ");
    expect(voteOptionsFor(5).map((o) => o.id)).not.toContain("3vJ");
    expect(voteOptionsFor(7).map((o) => o.id)).not.toContain("4vJ");
  });

  test("never offers a team mode the lobby can't fill", () => {
    expect(voteOptionsFor(3).map((o) => o.id)).not.toContain("1v1");
    expect(voteOptionsFor(3).map((o) => o.id)).not.toContain("2v2");
    expect(voteOptionsFor(4).map((o) => o.id)).not.toContain("3v3");
    expect(voteOptionsFor(4).map((o) => o.id)).not.toContain("2v2v2");
    expect(voteOptionsFor(1).length).toBe(0);
  });
});

describe("normalizeVoteMode", () => {
  test("resolves aliases and case", () => {
    expect(normalizeVoteMode("ffa")).toBe("FFA");
    expect(normalizeVoteMode("FFA")).toBe("FFA");
    expect(normalizeVoteMode("2v2")).toBe("2v2");
    expect(normalizeVoteMode("duel")).toBe("1v1");
    expect(normalizeVoteMode("juggernaut")).toBe("JUGG");
    expect(normalizeVoteMode("ntr")).toBe("NTR");
    expect(normalizeVoteMode("pvpj")).toBe("PvPJ");
    expect(normalizeVoteMode("pvp juggernaut")).toBe("PvPJ");
    expect(normalizeVoteMode("pvp ntr")).toBe("PvPNTR");
    expect(normalizeVoteMode("2vj")).toBe("2vJ");
    expect(normalizeVoteMode("4v4")).toBe("4v4");
    expect(normalizeVoteMode("2v2v2")).toBe("2v2v2");
  });

  test("returns undefined for unknown modes", () => {
    expect(normalizeVoteMode("solo")).toBeUndefined();
    expect(normalizeVoteMode("")).toBeUndefined();
  });
});

describe("VOTE_OPTIONS descriptions", () => {
  test("every vote option has a non-empty description", () => {
    for (const opt of VOTE_OPTIONS) {
      expect(opt.description.trim().length, `${opt.id} missing description`).toBeGreaterThan(0);
    }
  });
});

describe("modeDescription", () => {
  test("resolves aliases and canonical ids", () => {
    expect(modeDescription("PvPJ")).toContain("Juggernaut");
    expect(modeDescription("pvpj")).toContain("Juggernaut");
    expect(modeDescription("pvp juggernaut")).toContain("Juggernaut");
    expect(modeDescription("ntr")).toContain("Nowhere To Run");
    expect(modeDescription("ffa")).toContain("Free For All");
    expect(modeDescription("2v2")).toContain("two");
  });

  test("returns undefined for unknown modes", () => {
    expect(modeDescription("solo")).toBeUndefined();
    expect(modeDescription("")).toBeUndefined();
  });
});

describe("describeModes", () => {
  test("lists every vote option with its label and description", () => {
    const text = describeModes();
    for (const opt of VOTE_OPTIONS) {
      expect(text).toContain(`**${opt.id}**`);
      expect(text).toContain(opt.label);
      expect(text).toContain(opt.description);
    }
  });
});

describe("tallyVotes", () => {
  test("counts votes and sorts by count descending", () => {
    const tally = tallyVotes({ P1: "FFA", P2: "2v2", P3: "2v2" });
    expect(tally).toEqual([
      { mode: "2v2", count: 2 },
      { mode: "FFA", count: 1 },
    ]);
  });

  test("returns empty for no votes", () => {
    expect(tallyVotes({})).toEqual([]);
  });
});

describe("tieModes", () => {
  test("returns null for a unique winner", () => {
    expect(
      tieModes([
        { mode: "FFA", count: 3 },
        { mode: "NTR", count: 1 },
      ]),
    ).toBeNull();
  });

  test("returns null for a single entry or no votes", () => {
    expect(tieModes([])).toBeNull();
    expect(tieModes([{ mode: "FFA", count: 2 }])).toBeNull();
  });

  test("returns both tied modes for a 2-way tie", () => {
    expect(
      tieModes([
        { mode: "FFA", count: 2 },
        { mode: "NTR", count: 2 },
        { mode: "JUGG", count: 1 },
      ]),
    ).toEqual(["FFA", "NTR"]);
  });

  test("returns all tied modes for a 3-way tie", () => {
    expect(
      tieModes([
        { mode: "FFA", count: 1 },
        { mode: "NTR", count: 1 },
        { mode: "JUGG", count: 1 },
      ]),
    ).toEqual(["FFA", "NTR", "JUGG"]);
  });
});

describe("runoffOptions", () => {
  test("filters VOTE_OPTIONS to the runoff modes", () => {
    const opts = runoffOptions(["FFA", "NTR"]);
    expect(opts.map((o) => o.id)).toEqual(["FFA", "NTR"]);
  });

  test("excludes modes not in the runoff", () => {
    const opts = runoffOptions(["PvPJ"]);
    expect(opts.map((o) => o.id)).toEqual(["PvPJ"]);
    expect(opts[0].description.length).toBeGreaterThan(0);
  });

  test("keeps canonical VOTE_OPTIONS order", () => {
    const opts = runoffOptions(["JUGG", "FFA"]);
    expect(opts.map((o) => o.id)).toEqual(["FFA", "JUGG"]);
  });
});
