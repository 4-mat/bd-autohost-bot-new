import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { parseMapFile, MAP_FILE_CODES } from "../data/parse-map-file.js";
import { Terrain } from "../game/state.js";
import { getMapByName } from "../data/maps.js";

const valid = `name: test_map
display: Test Map

nnnnnnn
nsssssn
nsfffsn
nsfffsn
nsfffsn
nsssssn
nnnnnnn
`;

const seven = "nnnnnnn\nnnnnnnn\nnnnnnnn\nnnnnnnn\nnnnnnnn\nnnnnnnn\nnnnnnnn\n";

function parseError(text: string): string {
  try {
    parseMapFile(text, "test.txt");
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected parseMapFile to throw");
}

describe("parseMapFile", () => {
  it("parses a valid map and infers dimensions", () => {
    const m = parseMapFile(valid, "test.txt");
    expect(m.name).toBe("test_map");
    expect(m.displayName).toBe("Test Map");
    expect(m.rows).toBe(7);
    expect(m.cols).toBe(7);
    expect(m.grid[0][0]).toBe(Terrain.Normal);
    expect(m.grid[1][1]).toBe(Terrain.Stop);
    expect(m.grid[2][2]).toBe(Terrain.Forest);
  });

  it("lowercases the name", () => {
    const m = parseMapFile(`name: FooBar\n\n${seven}`, "t.txt");
    expect(m.name).toBe("foobar");
  });

  it("derives a display name when omitted", () => {
    const m = parseMapFile(`name: my_map\n\n${seven}`, "t.txt");
    expect(m.displayName).toBe("My Map");
  });

  it("ignores comments and blank lines", () => {
    const m = parseMapFile(
      `# header\n\nname: c_map\n\n# grid below\n${seven}`,
      "t.txt",
    );
    expect(m.name).toBe("c_map");
    expect(m.rows).toBe(7);
  });

  it("accepts every terrain code", () => {
    const codes = Object.keys(MAP_FILE_CODES);
    const rows = codes.map((c) => c.repeat(7));
    const m = parseMapFile(`name: all\n${rows.join("\n")}\n`, "t.txt");
    const expected = Object.values(MAP_FILE_CODES);
    expected.forEach((t, i) => {
      expect(m.grid[i][0]).toBe(t);
    });
  });

  it("treats . and n as Normal", () => {
    const m = parseMapFile(
      `name: dots
.......
.......
.......
.......
.......
.......
.......
`,
      "t.txt",
    );
    expect(m.grid[0][0]).toBe(Terrain.Normal);
    expect(m.grid[0][1]).toBe(Terrain.Normal);
    expect(m.cols).toBe(7);
  });

  it("rejects a missing name", () => {
    expect(parseError(seven)).toContain("missing a `name: <id>` line");
  });

  it("rejects an invalid name", () => {
    expect(parseError(`name: Bad Name!\n\n${seven}`)).toContain(
      'bad map name "bad name!"',
    );
  });

  it("rejects a name longer than 40 characters", () => {
    const long = "a".repeat(41);
    expect(parseError(`name: ${long}\n\n${seven}`)).toContain("bad map name");
  });

  it("reserves gen names for procedural maps", () => {
    expect(parseError(`name: gen12\n\n${seven}`)).toContain(
      "reserved for %setmap gen",
    );
  });

  it("rejects an unknown terrain code with line info", () => {
    const err = parseError(`name: bad\n\nnnnznnn\n${seven.slice(7)}`);
    expect(err).toContain("test.txt:3");
    expect(err).toContain('"z"');
  });

  it("rejects rows of unequal length", () => {
    expect(
      parseError(`name: bad\n\nnnnnnnn\nnnnnnn\n${seven.slice(7)}`),
    ).toContain("row has 6 cells, expected 7");
  });

  it("rejects maps smaller than 7x7", () => {
    expect(
      parseError(
        "name: small\n\nnnnnnn\nnnnnnn\nnnnnnn\nnnnnnn\nnnnnnn\nnnnnnn\n",
      ),
    ).toContain("map too small: 6 row(s), need at least 7");
  });

  it("rejects maps narrower than 7", () => {
    const row = "n".repeat(6);
    expect(
      parseError(`name: narrow\n${Array(7).fill(row).join("\n")}\n`),
    ).toContain("map too narrow: 6 columns, need at least 7");
  });

  it("rejects maps larger than 60x60", () => {
    const row = "n".repeat(61);
    expect(
      parseError(`name: big\n${Array(7).fill(row).join("\n")}\n`),
    ).toContain("map too wide: 61 columns (max 60)");
  });

  it("treats unknown header lines as grid rows", () => {
    expect(parseError(`name: ok\nsize: 7x7\n${seven}`)).toContain(
      'unknown terrain code "z"',
    );
  });

  it("rejects a map with no grid", () => {
    expect(parseError("name: empty\n")).toContain(
      "map too small: 0 row(s), need at least 7",
    );
  });
});

describe("volunteer maps in the map registry", () => {
  it("loads the example map from maps/example.txt", async () => {
    const file = join(import.meta.dir, "..", "..", "maps", "example.txt");
    const text = await Bun.file(file).text();
    const m = parseMapFile(text, "example.txt");
    expect(m.rows).toBe(9);
    expect(m.cols).toBe(9);
  });

  it("registers volunteers into the curated map lookup", () => {
    const m = getMapByName("example");
    expect(m).toBeDefined();
    expect(m!.name).toBe("example");
    expect(m!.displayName).toBe("Example");
    expect(m!.rows).toBe(9);
  });
});
