// Deterministic symmetric terrain generator for curated maps.
//
// This module is intentionally self-contained (no imports from the game code)
// so it keeps working even while other parts of the repo are mid-merge. The
// terrain values match the `Terrain` enum in `src/game/state.ts`:
//   0 Normal, 1 Stop, 2 Water, 3 Forest, 4 Ice, 5 Air, 6 Sticky,
//   7 Lava, 8 Broken, 9 Bone, 10 Stone, 11 Hearth, 12 Boost
//
// Every grid produced is:
//  - D2-symmetric (mirrored across both the horizontal and vertical axes), so
//    competitive games start from fair, identical positions.
//  - Varied: a mix of Normal terrain with Water, Forest, Sticky, Lava, Stone,
//    Broken, Ice and Bone features (never all-Normal).
//  - Connected: every walkable tile is reachable from the map centre, so no
//    one can be sealed off.
//  - Deterministic: the same map name always yields the same grid, so
//    regeneration is stable.

const Normal = 0;
const Stop = 1;
const Water = 2;
const Forest = 3;
const Ice = 4;
const Sticky = 6;
const Lava = 7;
const Broken = 8;
const Bone = 9;
const Stone = 10;
const Hearth = 11;

// Obstructions per the BD 4.4 glossary (Stop/Bone, Ice, Stone, Hearth) plus
// Broken, which is impassable to movement even though it is not itself called
// an obstruction. Lava is excluded separately: it damages on entry.
const OBSTRUCTIONS = new Set<number>([Stop, Bone, Ice, Stone, Hearth, Broken]);

function isPassable(t: number): boolean {
  return !OBSTRUCTIONS.has(t) && t !== Lava;
}

function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Deterministic pseudo-random in [0, 1) keyed on the *symmetric* coordinates
// (dr, dc). Mirrored cells share the same (dr, dc), so they get the same
// value — this is what guarantees D2 symmetry.
function cellRand(seed: string, dr: number, dc: number, salt = 0): number {
  const h = hashSeed(`${seed}:${salt}:${Math.round(dr)},${Math.round(dc)}`);
  return (h % 10000) / 10000;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// BFS from the centre; returns true when every passable tile is reachable.
function isConnected(grid: number[][]): boolean {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return true;
  const start = [Math.floor(rows / 2), Math.floor(cols / 2)];
  if (!isPassable(grid[start[0]][start[1]])) return false;

  const seen = new Set<string>([`${start[0]},${start[1]}`]);
  const queue: [number, number][] = [[start[0], start[1]]];
  let reachable = 1;
  let total = 0;
  for (const row of grid) for (const t of row) if (isPassable(t)) total++;

  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
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
      reachable++;
      queue.push([nr, nc]);
    }
  }
  return reachable === total;
}

/** Inputs a themed cell generator needs to pick terrain for one tile. */
type ThemeCell = (
  seedName: string,
  dr: number,
  dc: number,
  d: number,
  m: number,
  n: number,
  inner: number,
) => number;

/** Concentric square rings (theme 0). */
const concentricRings: ThemeCell = (seedName, _dr, _dc, d, _m, n, inner) => {
  const ring = d - inner;
  if (ring % 3 === 0) {
    const v = cellRand(seedName, _dr, _dc, 1);
    if (v < 0.45) return Water;
    if (v < 0.7) return Forest;
    if (v < 0.85) return Lava;
    return Normal;
  }
  if (ring % 3 === 1) {
    if (n < 0.15) return Sticky;
    if (n < 0.3) return Forest;
    if (n < 0.36) return Broken;
    return Normal;
  }
  if (n < 0.12) return Stone;
  if (n < 0.2) return Broken;
  if (n < 0.35) return Water;
  return Normal;
};

/** Diamond rings, Manhattan bands (theme 1). */
const diamondRings: ThemeCell = (_seedName, _dr, _dc, _d, m, n, _inner) => {
  const band = m % 4;
  if (band === 0) {
    if (n < 0.4) return Forest;
    if (n < 0.55) return Water;
    return Normal;
  }
  if (band === 1) {
    if (n < 0.15) return Lava;
    if (n < 0.3) return Water;
    if (n < 0.36) return Ice;
    return Normal;
  }
  if (band === 2) {
    if (n < 0.2) return Stone;
    if (n < 0.35) return Forest;
    return Normal;
  }
  if (n < 0.15) return Ice;
  if (n < 0.3) return Water;
  return Normal;
};

/** Crossroads: open corridors, themed quadrants (theme 2). */
const crossroads: ThemeCell = (_seedName, dr, dc, _d, _m, n, _inner) => {
  if (dr <= 1 || dc <= 1) return Normal;
  if (n < 0.28) return Water;
  if (n < 0.4) return Forest;
  if (n < 0.47) return Lava;
  if (n < 0.53) return Sticky;
  if (n < 0.58) return Stone;
  return Normal;
};

/** Corner pools: quadrant blobs (theme 3). */
const cornerPools: ThemeCell = (_seedName, dr, dc, _d, m, n, inner) => {
  if (dr > inner && dc > inner) {
    if (n < 0.25) return Water;
    if (n < 0.32) return Lava;
    if (n < 0.4) return Forest;
    if (m % 5 === 0) return Stone;
    if (n < 0.45) return Sticky;
    return Normal;
  }
  if (n < 0.12) return Water;
  return Normal;
};

/** Scattered symmetric clusters, quantised noise (theme 4). */
const scatterClusters: ThemeCell = (seedName, dr, dc, _d, _m, _n, _inner) => {
  const v = cellRand(seedName, Math.floor(dr / 2), Math.floor(dc / 2), 7);
  if (v < 0.2) return Water;
  if (v < 0.28) return Stone;
  if (v < 0.34) return Forest;
  if (v < 0.4) return Lava;
  if (v < 0.46) return Sticky;
  if (v < 0.5) return Broken;
  return Normal;
};

/** Framed: layered rings around a wide plaza (theme 5, also default). */
const framed: ThemeCell = (_seedName, _dr, _dc, d, _m, n, inner) => {
  const ring = d - inner;
  if (ring % 4 === 0) return n < 0.5 ? Forest : Water;
  if (ring % 4 === 1) {
    if (n < 0.15) return Lava;
    return Normal;
  }
  if (ring % 4 === 2) {
    if (n < 0.25) return Sticky;
    return Normal;
  }
  if (n < 0.1) return Stone;
  return Normal;
};

/** Theme id -> cell generator. */
const THEME_CELLS: Record<number, ThemeCell> = {
  0: concentricRings,
  1: diamondRings,
  2: crossroads,
  3: cornerPools,
  4: scatterClusters,
  5: framed,
};

/**
 * Generate a D2-symmetric, varied, connected terrain grid.
 *
 * @param rows     number of rows
 * @param cols     number of columns
 * @param seedName stable seed (usually the map name)
 */
export function generateSymmetricGrid(
  rows: number,
  cols: number,
  seedName: string,
): number[][] {
  const grid: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(Normal),
  );

  const minDim = Math.min(rows, cols);
  const inner = Math.max(1, Math.floor(minDim / 5));
  const centerR = (rows - 1) / 2;
  const centerC = (cols - 1) / 2;
  const rng = mulberry32(hashSeed(seedName));
  const theme = Math.floor(rng() * 6);
  const themeCell = THEME_CELLS[theme] ?? THEME_CELLS[5];

  for (let r = 0; r < rows; r++) {
    const dr = Math.abs(r - centerR);
    for (let c = 0; c < cols; c++) {
      const dc = Math.abs(c - centerC);
      const d = Math.max(dr, dc); // Chebyshev ring
      const m = dr + dc; // Manhattan distance
      const n = cellRand(seedName, dr, dc);

      // Open spawn plaza in the centre, themed terrain beyond it.
      grid[r][c] = d <= inner ? Normal : themeCell(seedName, dr, dc, d, m, n, inner);
    }
  }

  ensureWalkablePlaza(grid, centerR, centerC, inner);
  ensureVariety(grid, seedName, centerR, centerC, inner);
  ensureConnectivity(grid, seedName, centerR, centerC, inner);
  ensureNotAllNormal(grid);

  return grid;
}

/** Overwrite the centre plaza with walkable Normal tiles for spawns. */
function ensureWalkablePlaza(
  grid: number[][],
  centerR: number,
  centerC: number,
  inner: number,
): void {
  const cols = grid[0]!.length;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.max(Math.abs(r - centerR), Math.abs(c - centerC)) <= inner)
        grid[r][c] = Normal;
    }
  }
}

/** Sprinkle Water when a map is too uniform (matters for tiny maps). */
function ensureVariety(
  grid: number[][],
  seedName: string,
  centerR: number,
  centerC: number,
  inner: number,
): void {
  const total = grid.length * (grid[0]?.length ?? 0);
  const nonNormal = grid.flat().filter((t) => t !== Normal).length;
  if (nonNormal >= Math.max(1, Math.floor(total * 0.12))) return;

  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[0]?.length ?? 0); c++) {
      const dr = Math.abs(r - centerR);
      const dc = Math.abs(c - centerC);
      if (Math.max(dr, dc) <= inner) continue;
      if (cellRand(seedName, dr, dc, 99) < 0.3) grid[r][c] = Water;
    }
  }
  if (grid.flat().filter((t) => t !== Normal).length === 0) {
    // Water in all four corners preserves D2 (both-axis mirror) symmetry.
    waterCorners(grid);
  }
}

/** Connectivity safety net: fall back to a simple always-connected, always
 * varied stripe pattern if the themed layout ever seals anything off. Only
 * Water + Normal are used, so the result is trivially connected, and the
 * pattern is keyed on the symmetric coordinates so symmetry is preserved. */
function ensureConnectivity(
  grid: number[][],
  seedName: string,
  centerR: number,
  centerC: number,
  inner: number,
): void {
  if (isConnected(grid)) return;
  const cols = grid[0]?.length ?? 0;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < cols; c++) {
      const dr = Math.abs(r - centerR);
      const dc = Math.abs(c - centerC);
      const d = Math.max(dr, dc);
      grid[r][c] =
        d > inner && (Math.round(dr) + Math.round(dc)) % 3 === 0
          ? Water
          : Normal;
    }
  }
}

/** Absolute safety net: never ship an all-Normal map. */
function ensureNotAllNormal(grid: number[][]): void {
  if (!grid.flat().every((t) => t === Normal)) return;
  waterCorners(grid);
}

/** Put Water in all four corners (preserves D2 both-axis mirror symmetry). */
function waterCorners(grid: number[][]): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  grid[0][0] = Water;
  grid[0][cols - 1] = Water;
  grid[rows - 1][0] = Water;
  grid[rows - 1][cols - 1] = Water;
}
