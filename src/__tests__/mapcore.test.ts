import { describe, expect, test } from "bun:test";
import {
  parseTxt,
  toTxt,
  normalizeMap,
  minDimFor,
  modeIdFor,
} from "../../mapeditor/mapcore.cjs";

// The bot's volunteer .txt format: name/display/modes headers followed by a
// terrain grid. NTR maps may be 5x5; every other mode needs 7x7 (mirrors
// src/data/parse-map-file.ts).
const NTR_GRID = ["nsssn", "snnns", "snhns", "snnns", "nsssn"];
const FFA_7 = Array.from({ length: 7 }, () => ".......");

function mapTxt(opts: {
  name?: string;
  modes?: string;
  rows?: string[];
} = {}): string {
  const name = opts.name ?? "test-map";
  const modes =
    opts.modes !== undefined ? `modes: ${opts.modes}\n` : "";
  const rows = opts.rows ?? NTR_GRID;
  return `name: ${name}\ndisplay: Test Map\n${modes}${rows.join("\n")}\n`;
}

function tiles(n: number): string[][] {
  return Array.from({ length: n }, () => Array(n).fill("normal"));
}

describe("mapcore modes support", () => {
  test("parses a 5x5 NTR map with modes: ntr", () => {
    const map = parseTxt(mapTxt({ modes: "ntr" }), "example-ntr.txt");
    expect(map.rows).toBe(5);
    expect(map.cols).toBe(5);
    expect(map.modes).toEqual(["ntr"]);
  });

  test("rejects a 5x5 map that isn't NTR (min 7)", () => {
    expect(() => parseTxt(mapTxt({ modes: "ffa" }), "small.txt")).toThrow(
      /need 7-60/,
    );
  });

  test("rejects a 5x5 map with mixed ntr+ffa (max-min rule)", () => {
    expect(() =>
      parseTxt(mapTxt({ modes: "ntr, ffa" }), "mix.txt"),
    ).toThrow(/need 7-60/);
  });

  test("parses a 7x7 ffa map", () => {
    const map = parseTxt(
      mapTxt({ modes: "ffa", rows: FFA_7 }),
      "big.txt",
    );
    expect(map.rows).toBe(7);
    expect(map.modes).toEqual(["ffa"]);
  });

  test("parses a map without a modes header (default 7x7 minimum)", () => {
    const map = parseTxt(mapTxt({ rows: FFA_7 }), "no-modes.txt");
    expect(map.modes).toEqual([]);
    expect(map.rows).toBe(7);
  });

  test("rejects an unknown mode in the header", () => {
    expect(() =>
      parseTxt(mapTxt({ modes: "banana" }), "bad.txt"),
    ).toThrow(/unknown game mode/);
  });

  test("rejects a missing name line", () => {
    const txt = "modes: ntr\n" + NTR_GRID.join("\n") + "\n";
    expect(() => parseTxt(txt, "noname.txt")).toThrow(/missing a `name: <id>` line/);
  });

  test("toTxt emits the modes line and round-trips the grid", () => {
    const map = parseTxt(mapTxt({ modes: "ntr" }), "example-ntr.txt");
    const out = toTxt(map);
    expect(out.split("\n").some((l) => l.startsWith("modes: ntr"))).toBe(
      true,
    );
    // 'n' (normal) is canonically re-emitted as '.'; the grid round-trips.
    expect(out.trim().split("\n").pop()).toBe(".sss.");
  });

  test("toTxt rejects an undersized non-NTR map", () => {
    const map = normalizeMap({
      name: "x",
      rows: 5,
      cols: 5,
      tiles: tiles(5),
      modes: ["ffa"],
    });
    expect(() => toTxt(map)).toThrow(/at least 7x7/);
  });

  test("normalizeMap canonicalizes modes through modeIdFor", () => {
    const map = normalizeMap({
      name: "x",
      rows: 7,
      cols: 7,
      tiles: tiles(7),
      modes: ["ntr", "ffa", "2v2", "duel"],
    });
    expect(map.modes).toEqual(["ntr", "ffa", "pvp", "1v1"]);
  });

  test("minDimFor uses per-mode minimums", () => {
    expect(minDimFor(["ntr"])).toBe(5);
    expect(minDimFor(["ffa"])).toBe(7);
    expect(minDimFor(["ntr", "ffa"])).toBe(7);
    expect(minDimFor([])).toBe(7);
    expect(minDimFor(undefined)).toBe(7);
  });

  test("modeIdFor resolves aliases", () => {
    expect(modeIdFor("ffa")).toBe("ffa");
    expect(modeIdFor("duel")).toBe("1v1");
    expect(modeIdFor("2v2")).toBe("pvp");
    expect(modeIdFor("pvp juggernaut")).toBe("pvp");
    expect(modeIdFor("pvp  juggernaut")).toBe("pvp"); // double space collapses
    expect(modeIdFor("banana")).toBeUndefined();
  });

  test("rejects a bad map name (spaces/uppercase)", () => {
    expect(() =>
      parseTxt(mapTxt({ name: "Bad Name!" }), "badname.txt"),
    ).toThrow(/bad map name/);
  });

  test("rejects a reserved gen name", () => {
    expect(() => parseTxt(mapTxt({ name: "gen5" }), "gen.txt")).toThrow(
      /reserved/,
    );
  });

  test("rejects a map that is wide enough but too narrow (7 rows x 5 cols)", () => {
    const rows = Array.from({ length: 7 }, () => ".....");
    expect(() =>
      parseTxt(mapTxt({ modes: "ffa", rows }), "narrow.txt"),
    ).toThrow(/columns, need 7-60/);
  });

  test("parses multi-word mode aliases as a whole entry", () => {
    const pvpj = mapTxt({ modes: "pvp juggernaut", rows: FFA_7 });
    expect(parseTxt(pvpj, "t.txt").modes).toEqual(["pvp"]);
    const pvpntr = mapTxt({ modes: "pvp ntr" });
    expect(parseTxt(pvpntr, "t.txt").modes).toEqual(["ntr"]);
  });

  test("still rejects unknown words after a valid one", () => {
    expect(() =>
      parseTxt(mapTxt({ modes: "pvp banana", rows: FFA_7 }), "t.txt"),
    ).toThrow(/unknown game mode "banana"/);
  });

  test("normalizeMap strips CR/LF and caps displayName at 60 chars", () => {
    const map = normalizeMap({
      name: "foo",
      rows: 7,
      cols: 7,
      tiles: [],
      tokens: [],
      displayName:
        "Line1\r\nLine2 with a long tail that definitely exceeds sixty characters here okay yes",
    });
    expect(map.displayName).not.toMatch(/[\r\n]/);
    expect(map.displayName).toMatch(/^Line1 Line2/);
    expect(map.displayName.length).toBeLessThanOrEqual(60);
  });
});
