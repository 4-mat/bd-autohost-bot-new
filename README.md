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

## Ability Editor

A browser GUI for editing Battle Dome classes/weapons/abilities and for
creating temporary custom test classes and weapons. It runs as a standalone
local server (like the map editor):

```bash
npm run editor        # → http://localhost:4700
```

- **Edits apply live**: every change is applied to the in-memory data and
  mirrored to `abilityeditor/runtime-data.json`, which the test client
  (`npm run testapp` → localhost:4000) picks up automatically (or with
  `%reloaddata`). Add a custom class in the editor, then `%addp Alice, MyClass, MyWeapon`
  in the test client to try it.
- **Save to Bot** regenerates `src/data/index.ts` with a minimal diff — only
  the entries you actually changed are rewritten, so a PR shows exactly what
  was edited. (Custom test classes/weapons are never written to source.)
- **Revert** reloads the in-memory data from `src/data/index.ts`, discarding
  unsaved edits. Custom test items are kept (`abilityeditor/customs.local.json`,
  gitignored).

See `abilityeditor/README.md` for the full workflow.

---

## Ability Editor — public demo

The editor is also published as a **static demo** on GitHub Pages — zero backend,
anyone can try it in their browser (data embedded at build time, edits and
custom test classes/weapons stay in the visitor's `localStorage`, and
**Propose to Bot** drafts a GitHub issue instead of touching the repo):

```bash
npm run editor:demo:build   # → dist-editor/index.html (self-contained)
```

- `scripts/build-editor-demo.ts` embeds the current class/weapon data into a
  single `index.html`; GitHub Actions (`pages.yml`) rebuilds + deploys it
  whenever the data or the editor changes.
- The demo's **Propose to Bot** diffs your edits against the embedded snapshot
  and opens a pre-filled GitHub issue. `ability-pr.yml` validates the issue
  payload (via `scripts/apply-editor-proposal.ts`) and opens a PR that applies
  the changes to `src/data/index.ts` as a minimal diff — the same guarantee as
  the local **Save to Bot**.

To enable deployment once: repo **Settings → Pages → Source: GitHub Actions**.

