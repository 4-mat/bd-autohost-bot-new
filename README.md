# bd-autohost-bot-new

A Pokémon Showdown–based Battle Dome autohost bot (TypeScript + Bun).

## Map Editor & Browser (GitHub Pages)

- **Editor** — [https://4-mat.github.io/bd-autohost-bot-new/mapeditor/](https://4-mat.github.io/bd-autohost-bot-new/mapeditor/)
- **Browser** — [https://4-mat.github.io/bd-autohost-bot-new/mapeditor/gallery/](https://4-mat.github.io/bd-autohost-bot-new/mapeditor/gallery/)
- **Pools** — [https://4-mat.github.io/bd-autohost-bot-new/mapeditor/pools/](https://4-mat.github.io/bd-autohost-bot-new/mapeditor/pools/)

**Editor**

- Pokémon Showdown light theme, game-style grid (square cells, 5×5–60×60, 5×5 minimum for NTR maps).
- Zoom 50–400% (default 150%) — footer buttons, Ctrl+wheel, Ctrl+= / Ctrl+− / Ctrl+0; remembers your zoom.
- Paint 13 terrains, place players P1–P8, flood fill, eyedropper, erase, undo/redo, select & move boxes.
- **Transform** the whole map — rotate 90° clockwise, 90° counter-clockwise, or 180°, and flip horizontally or vertically.
- Drafts auto-save to your browser — refresh-safe, with a Restore/Discard banner.
- **Copy .txt** copies the volunteer format; **Share** copies a link that works even for unsaved maps.
- **I/O:** Export → Volunteer .txt / game HTML / JSON; import .txt, HTML, or .json; Save downloads a .txt.
- "🗺 Maps" button jumps to the browser.

**Browser**

- Index grouped by gamemode (FFA/NTR/JUGG/PvP/1v1) with per-map links and sizes.
- **View all maps** wall — every map as a thumbnail; **search**, **mode filter**, grouped sections, click to open full size (prev/next nav).
- **Map Pools** editor (link on the index) — toggle which gamemode each map belongs to; propose changes → a bot opens the PR.

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

---

## Ability Editor (GitHub Pages)

A browser GUI for editing the bot's classes, weapons and abilities — plus
**temporary custom test classes/weapons** that never touch the bot.

- **Public demo** — [https://4-mat.github.io/bd-autohost-bot-new/ability-editor/](https://4-mat.github.io/bd-autohost-bot-new/ability-editor/): edits stay in your browser; **Propose to Bot** opens a GitHub issue that a bot turns into a reviewed PR.
- **Local mode** — `npm run editor` → http://localhost:4700; edits mirror live to the test client, and **Save to Bot** rewrites `src/data/index.ts` with a minimal diff.
- Full workflow: [`abilityeditor/README.md`](abilityeditor/README.md).

