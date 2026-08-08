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

## Ability Editor (GitHub Pages)

The ability editor is a browser GUI for editing classes, weapons, and abilities. It also supports temporary custom test classes and weapons. Custom data is stored in the browser and is not written to the bot.

Two modes are available:

- **Public demo** ([https://4-mat.github.io/bd-autohost-bot-new/ability-editor/](https://4-mat.github.io/bd-autohost-bot-new/ability-editor/)): edits stay in the browser. **Propose to Bot** creates a GitHub issue that a bot converts into a reviewed pull request.
- **Local mode** (`npm run editor`, http://localhost:4700): edits are mirrored to the test client. **Save to Bot** writes changes to `src/data/index.ts` with a minimal diff.

For the full workflow, see [`abilityeditor/README.md`](abilityeditor/README.md).
(feat: subweapons (requires/switch/branches), dice-crit-MR mods, stance enforcement, %setsubweapon, no-arg loadout commands)
