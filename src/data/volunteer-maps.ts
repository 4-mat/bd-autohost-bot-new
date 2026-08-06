import { Terrain } from "../game/state.js";
import type { MapDef } from "./maps.js";

export const volunteerMaps: MapDef[] = [
  {
    name: "example",
    displayName: "Example",
    rows: 9,
    cols: 9,
    grid: [
      [0, 2, 1, 3, 0, 3, 1, 2, 0],
      [2, 7, 0, 0, 0, 0, 0, 7, 2],
      [1, 0, 11, 0, 0, 0, 11, 0, 1],
      [3, 0, 0, 0, 0, 0, 0, 0, 3],
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [3, 0, 0, 0, 0, 0, 0, 0, 3],
      [1, 0, 11, 0, 0, 0, 11, 0, 1],
      [2, 7, 0, 0, 0, 0, 0, 7, 2],
      [0, 2, 1, 3, 0, 3, 1, 2, 0]
    ],
  },
];
