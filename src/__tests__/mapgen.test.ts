import { describe, expect, test } from "bun:test";
import { generateSymmetricGrid } from "../data/mapgen.js";
import { MAPS } from "../data/maps.js";

// Terrain values (mirror the enum in game/state.ts)
const Normal = 0;
const Lava = 7;

// Passability mirrors isObstruction() + lava rule from game/state.ts.
// Obstructions: Stop(1), Ice(4), Stone(10), Bone(9), Hearth(11); Broken(8) is
// impassable though not an obstruction; Lava(7) damages on entry.
const OBSTRUCTIONS = new Set([1, 4, 7, 8, 9, 10, 11]);

function isPassable(t: number): boolean {
  return !OBSTRUCTIONS.has(t);
}

function countPassable(grid: number[][]): number {
  return grid.flat().filter(isPassable).length;
}

function isAllNormal(grid: number[][]): boolean {
  return grid.flat().every((t) => t === Normal);
}

// BFS from the centre over passable tiles
function allPassableReachable(grid: number[][]): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return true;
  const sr = Math.floor(rows / 2);
  const sc = Math.floor(cols / 2);
  if (!isPassable(grid[sr][sc])) return false;

  const seen = new Set<string>([`${sr},${sc}`]);
  const queue: [number, number][] = [[sr, sc]];
  let reachable = 0;
  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    reachable++;
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const key = `${nr},${nc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isPassable(grid[nr][nc])) continue;
      queue.push([nr, nc]);
    }
  }
  return reachable === countPassable(grid);
}

const SIZES: [number, number][] = [
  [7, 7],
  [8, 8],
  [9, 9],
  [10, 10],
  [11, 11],
  [12, 12],
  [13, 13],
  [8, 12],
  [7, 13],
  [10, 12],
  [11, 13],
  [9, 10],
  [5, 6],
  [4, 6],
  [2, 6],
  [1, 2],
  [1, 6],
  [4, 14],
  [4, 43],
];

describe("generateSymmetricGrid", () => {
  test("is deterministic for the same seed", () => {
    expect(generateSymmetricGrid(10, 10, "arena")).toEqual(
      generateSymmetricGrid(10, 10, "arena"),
    );
    expect(generateSymmetricGrid(8, 8, "blitz")).toEqual(
      generateSymmetricGrid(8, 8, "blitz"),
    );
  });

  test("different seeds produce different layouts", () => {
    const a = generateSymmetricGrid(10, 10, "arena");
    const b = generateSymmetricGrid(10, 10, "battleground");
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  test("is D2-symmetric (mirrored on both axes) for every size", () => {
    for (const [rows, cols] of SIZES) {
      const grid = generateSymmetricGrid(rows, cols, `sym-${rows}x${cols}`);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          expect(grid[r][c], `${rows}x${cols} at (${r},${c})`).toBe(
            grid[rows - 1 - r][c],
          );
          expect(grid[r][c], `${rows}x${cols} at (${r},${c})`).toBe(
            grid[r][cols - 1 - c],
          );
        }
      }
    }
  });

  test("is never all-Normal for any size", () => {
    for (const [rows, cols] of SIZES) {
      const grid = generateSymmetricGrid(rows, cols, `varied-${rows}x${cols}`);
      expect(isAllNormal(grid), `${rows}x${cols} came out all-Normal`).toBe(
        false,
      );
    }
    // Regression: these specific seeds used to produce all-Normal grids.
    expect(isAllNormal(generateSymmetricGrid(8, 8, "isometry"))).toBe(false);
    expect(isAllNormal(generateSymmetricGrid(1, 6, "blade"))).toBe(false);
  });

  test("is connected (every passable tile reachable from the centre)", () => {
    for (const [rows, cols] of SIZES) {
      const grid = generateSymmetricGrid(rows, cols, `conn-${rows}x${cols}`);
      expect(
        allPassableReachable(grid),
        `${rows}x${cols} has unreachable tiles`,
      ).toBe(true);
    }
  });

  test("keeps a walkable centre plaza", () => {
    for (const [rows, cols] of SIZES) {
      // Degenerate 1-row maps (1x2, 1x6) have no meaningful centre plaza.
      if (Math.min(rows, cols) < 3) continue;
      const grid = generateSymmetricGrid(rows, cols, `plaza-${rows}x${cols}`);
      const r = Math.floor(rows / 2);
      const c = Math.floor(cols / 2);
      expect(grid[r][c], `${rows}x${cols} centre must be passable`).toBe(
        Normal,
      );
    }
  });

  test("mirrored centre features keep water/lava off the spawn cross for 7x7", () => {
    const grid = generateSymmetricGrid(7, 7, "diodes");
    expect(grid[3][3]).toBe(Normal);
  });
});

describe("curated map data", () => {
  test("arena is the only intentionally empty map", () => {
    const arena = MAPS.get("arena");
    expect(arena).toBeDefined();
    expect(arena!.grid.flat().every((t) => t === Normal)).toBe(true);
    for (const m of MAPS.values()) {
      if (m.name === "arena") continue;
      expect(
        m.grid.flat().some((t) => t !== Normal),
        `${m.name} shipped blank but only arena may be empty`,
      ).toBe(true);
    }
  });

  test("11x11/12x12 maps are not shifted down with an all-normal top row", () => {
    // If a square 11/12 map has an all-normal top row AND becomes fully
    // symmetric after shifting its content up one row (drop the top row,
    // append an all-normal row at the bottom), the design was accidentally
    // offset by one row. Such maps must be re-centered, not shipped shifted.
    const isSym = (grid: number[][]) => {
      const rows = grid.length;
      const cols = grid[0].length;
      const h = grid.every((r) => r.every((t, j) => t === r[cols - 1 - j]));
      const v = grid.every((r, i) => r.every((t, j) => t === grid[rows - 1 - i][j]));
      return h && v;
    };
    for (const m of MAPS.values()) {
      if ((m.rows !== 11 && m.rows !== 12) || m.cols !== m.rows) continue;
      const topAllNormal = m.grid[0].every((t) => t === Normal);
      if (!topAllNormal) continue;
      const shifted = m.grid.slice(1).concat([Array(m.cols).fill(Normal)]);
      if (isSym(shifted)) {
        expect(
          isSym(m.grid),
          `${m.name}: looks symmetric but is shifted 1 row down — re-center it`,
        ).toBe(true);
      }
    }
  });
});
