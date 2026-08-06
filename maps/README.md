# Volunteer maps

Drop a `.txt` file in this folder to add a map to the bot. Then run
`bun run maps` and the map will be available with `%setmap <name>` (and listed by
`%listmaps`).

## File format

Each file is one map. Lines starting with `#` are comments. Two optional
metadata lines:

```
name: my_map_name        # lowercase id used by %setmap (required)
display: My Map Name     # nice name shown to players (optional, derived from name if omitted)
```

Everything else is the map grid. Each row is one line; each character is one
tile. All rows must be the same length.

### Terrain codes

| Code       | Terrain | Code | Terrain |
| ---------- | ------- | ---- | ------- |
| `.` or `n` | Normal  | `b`  | Bone    |
| `s`        | Stop    | `l`  | Lava    |
| `i`        | Ice     | `h`  | Hearth  |
| `w`        | Water   | `+`  | Boost   |
| `f`        | Forest  | `x`  | Sticky  |
| `a`        | Air     | `r`  | Broken  |
|            |         | `o`  | Stone   |

(`.` and `n` both mean Normal — use whichever is easier to read.)

### Rules

- Map must be at least `7x7` and at most `60x60`.
- All rows must have the same number of columns.
- `name` must be up to 40 characters: lowercase letters, digits, `-`, `_` only.
- Names starting with `gen` (like `gen` or `gen16`) are reserved for procedural
  maps (`%setmap gen`).
- Names must be unique (across volunteer and curated maps).
- Battle Dome maps are symmetric: mirror the layout on both axes so no side has
  an advantage. See `example.txt`.

## How to add a map

1. Copy `example.txt` to `maps/<name>.txt` and edit the grid.
2. Run `bun run maps`. It validates every file and reports any errors (with file
   and line numbers) — fix them and rerun.
3. Commit `maps/<name>.txt` **and** the regenerated `src/data/volunteer-maps.ts`,
   then open a pull request. CI runs the same validation (plus the test suite)
   automatically on PRs touching `maps/`.

In-game, hosts can test with `%setmap <name>` and browse with `%listmaps`.

Note: volunteer maps are not added to any game-mode recommended pool. Only the
curated maps in `src/data/maps.ts` appear in the mode pools.
