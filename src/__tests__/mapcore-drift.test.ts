import { describe, expect, test } from "bun:test";
import {
  GAMEMODE_MIN_SIZE as mapcoreMinSizes,
  modeIdFor as mapcoreModeIdFor,
  minDimFor as mapcoreMinDimFor,
} from "../../mapeditor/mapcore.cjs";
import { GAMEMODE_MIN_SIZE, modeIdFor as botModeIdFor } from "../data/gamemodes.js";
import { minDimFor as botMinDimFor } from "../data/parse-map-file.js";

// The map editor (mapeditor/mapcore.cjs) deliberately runs without a build
// step, so it cannot import the bot's TypeScript modules. It therefore keeps
// its own copies of the mode alias table and per-mode minimum map sizes.
// This suite pins those copies to the bot's live modules so any drift fails
// CI loudly instead of surfacing as silently mis-parsed maps in the editor.

const ALIAS_CASES = [
  "ffa",
  "ntr",
  "jugg",
  "juggernaut",
  "pvp",
  "duel",
  "1v1",
  "2vj",
  "3vj",
  "4vj",
  "pvpj",
  "pvp juggernaut",
  "pvpntr",
  "pvp ntr",
  "2v2v2",
  "4v4",
  "2v2v2v2",
  "2v2",
  "3v3",
  "banana",
  "",
];

describe("mapeditor mode-data drift guard", () => {
  test("GAMEMODE_MIN_SIZE matches the bot", () => {
    expect(mapcoreMinSizes).toEqual(GAMEMODE_MIN_SIZE);
  });

  test("modeIdFor resolves every alias exactly like the bot", () => {
    for (const c of ALIAS_CASES) {
      expect(mapcoreModeIdFor(c)).toBe(botModeIdFor(c));
    }
  });

  test("minDimFor matches the bot for all mode combinations", () => {
    const combos: string[][] = [
      [],
      ["ffa"],
      ["ntr"],
      ["jugg"],
      ["pvp"],
      ["1v1"],
      ["ntr", "ffa"],
      ["ntr", "jugg", "pvp"],
      ["ffa", "ntr", "jugg", "pvp", "1v1"],
    ];
    for (const combo of combos) {
      expect(mapcoreMinDimFor(combo)).toBe(botMinDimFor(combo));
    }
  });
});