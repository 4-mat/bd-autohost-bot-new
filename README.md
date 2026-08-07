# bd-autohost-bot-new

A Pokémon Showdown–based Battle Dome autohost bot (TypeScript + Bun).

## Map Editor (GitHub Pages)

View and edit the maps in this repo right in the browser — no terminal needed:

**https://4-mat.github.io/bd-autohost-bot-new/mapeditor/**

- Browse all **210 curated maps** (`src/data/maps.ts`) and the **volunteer maps** (`maps/*.txt`) as colored grids.
- Paint terrain (13 types: Normal, Stop, Water, Forest, Ice, Air, Sticky, Lava, Broken, Bone, Stone, Hearth, Boost), place players P1–P8, flood fill, eyedropper, undo/redo, resize.
- **I/O new maps:** design a map → **Export → Volunteer .txt** (or hit the Save button, which downloads a `.txt`) → drop the file into `maps/` → commit → run `bun run maps`. Your map is now available with `%setmap <name>`.
- Import: paste volunteer `.txt`, game HTML, or a `.json` map.
- Maps smaller than 7×7 or with names using `gen`/uppercase/spaces are rejected — the editor enforces the same rules as `scripts/import-volunteer-maps.ts`.

### Local mode (optional, extra features)

```bash
npm run maps:seed     # regenerate maps/index.json + maps/curated.json
npm run maps:editor   # local server → http://localhost:4777
```

Local mode can **save** maps back to `maps/` directly (as JSON) and always lists the freshest volunteer/curated maps.

---

## Local Test Client

A built-in testing environment lets you test commands and HTML pages without connecting the bot to Pokemon Showdown.

Start it with:

```bash
npm run testapp
```

Then open:

```text
http://localhost:4000
```

### Features

- Pokémon Showdown–style chat panel
- Live GUI preview
- Supports bot commands
- No network connection to PS required

### Example Commands

```text
%host

%addp Alice

%addp Bob

%start
```
