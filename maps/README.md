# Volunteer maps

Drop a `.txt` file in this folder to add a map to the bot. Then run
`bun run maps` and the map will be available with `%setmap <name>` (and listed by
`%listmaps`).

## File format

Each file is one map. Lines starting with `#` are comments. Three optional
metadata lines:

```
name: my_map_name        # lowercase id used by %setmap (required)
display: My Map Name     # nice name shown to players (optional, derived from name if omitted)
modes: ntr,1v1           # game modes this map fits (optional, comma or space separated)
```

`modes` takes any of: `ffa`, `ntr`, `jugg`, `pvp`, `1v1` (aliases like `duel`
or `2v2` are accepted). A map tagged for a mode shows up in that mode's
recommended pool (`%listmaps <mode>`) and can be picked by `%setmap <mode>`.

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

- Map must be at least `7x7` and at most `60x60`. The one exception: maps
  tagged `modes: ntr` may be as small as `5x5`, so volunteers can make tight
  centre-hold maps (see `example-ntr.txt`).
- All rows must have the same number of columns.
- `name` must be up to 40 characters: lowercase letters, digits, `-`, `_` only.
- Names starting with `gen` (like `gen` or `gen16`) are reserved for procedural
  maps (`%setmap gen`).
- Names must be unique (across volunteer and curated maps).
- Battle Dome maps are symmetric: mirror the layout on both axes so no side has
  an advantage. See `example.txt` and `example-ntr.txt`.

## How to add a map

1. Copy `example.txt` to `maps/<name>.txt` and edit the grid.
2. Run `bun run maps`. It validates every file and reports any errors (with file
   and line numbers) — fix them and rerun.
3. Commit `maps/<name>.txt` **and** the regenerated `src/data/volunteer-maps.ts`,
   then open a pull request. CI runs the same validation (plus the test suite)
   automatically on PRs touching `maps/`.

In-game, hosts can test with `%setmap <name>` and browse with `%listmaps`.

Maps tagged with `modes:` also join that mode's recommended pool, so `%setmap
<mode>` and `%listmaps <mode>` consider them alongside the curated maps. Maps
without a `modes:` tag are available to every game but don't join any pool.
