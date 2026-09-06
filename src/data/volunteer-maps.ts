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
  {
    name: "example-ntr",
    displayName: "Example NTR",
    modes: ["ntr"],
    rows: 5,
    cols: 5,
    grid: [
      [0, 1, 1, 1, 0],
      [1, 0, 0, 0, 1],
      [1, 0, 11, 0, 1],
      [1, 0, 0, 0, 1],
      [0, 1, 1, 1, 0]
    ],
  },
  {
    name: "sprint",
    displayName: "Sprint",
    modes: ["ntr"],
    rows: 5,
    cols: 5,
    grid: [
      [0, 0, 8, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 2, 12, 2, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 8, 0, 0]
    ],
  },
];
