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
