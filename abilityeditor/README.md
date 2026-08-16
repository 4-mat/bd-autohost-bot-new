# Battle Dome Ability Editor

A browser-based GUI for editing the bot's classes, weapons and abilities, and
for creating **temporary custom test classes/weapons** that are never added to
the bot permanently.

```bash
bun run editor            # → http://localhost:4700
PORT=8080 bun run editor  # different port
HOST=0.0.0.0 bun run editor  # expose on your LAN (default: 127.0.0.1 only)
```

## How it works

```text
abilityeditor/
  server.ts          # local server (Bun). Loads src/data/index.ts into the
                     #   same in-memory classes/weapons Maps the bot uses.
  index.html         # the GUI (PS light theme, single file)
  customs.local.json # gitignored — your custom test classes/weapons, so they
                     #   survive editor restarts. Never committed.
  runtime-data.json  # gitignored — live snapshot mirrored to game processes.
```

- The server is the authoritative in-memory data. Every edit is applied
  immediately and mirrored to `runtime-data.json`.
- The **test client** (`bun run testapp` → localhost:4000) reads that snapshot
  at startup, re-applies it whenever the file changes (2s poll), or on demand
  with `%reloaddata`.
- **Save to Bot** rewrites `src/data/index.ts` with a **minimal diff**: only
  entries that actually changed are regenerated, in the file's existing format.
  Custom test items are excluded — they can never leak into the bot.
- **Revert** reloads everything from `src/data/index.ts` (customs are kept and
  re-registered from `customs.local.json`).

## Workflow: permanent ability edit (PR-ready)

1. `bun run editor` and open http://localhost:4700.
2. Pick a class or weapon → edit stats or expand an ability card and edit it.
   Changes apply to the running data instantly.
3. Click **Save to Bot**. The server regenerates `src/data/index.ts` and tells
   you which entries changed. `git diff src/data/index.ts` now shows exactly
   your edit — that's what goes in the PR.
4. Restart/reload anything that loaded data before (the test client re-applies
   automatically).

## Workflow: temporary custom test class/weapon

1. Click **＋ New** in the sidebar, give it a name. It appears with a purple
   `CUSTOM` badge.
2. Fill in stats, add abilities (＋ Add ability), edit the effect text in BD
   Lang. Everything is available immediately:
   - in the **test client**: `%addp Alice, MyTestClass, MyTestWeapon`, or pick
     them from the sign-in dropdown when signups are open;
   - via `%wt MyTestClass` reference lookups.
3. Customs live in memory + `abilityeditor/customs.local.json` (gitignored) —
   they survive restarts but are **never** written to `src/data/index.ts`, so
   they never become part of the bot. **Delete custom** removes one; deleting
   the `customs.local.json` file clears them all.

## API

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/data` | GET | full class/weapon snapshot + custom name list |
| `/api/status` | GET | pending-regen flag, custom count |
| `/api/update` | POST | patch a class/weapon (name, stats, description, branch) |
| `/api/ability` | POST | add / save / remove / **move** / **duplicate** an ability |
| `/api/validate` | POST | run the game's BD Lang parser over an effect; return unparsed clauses |
| `/api/custom` | POST | add a custom class/weapon |
| `/api/custom/remove` | POST | remove a custom class/weapon |
| `/api/regenerate` | POST | rewrite `src/data/index.ts` (minimal diff) |
| `/api/reset` | POST | reload data from `src/data/index.ts` (keeps customs) |

Mutations are only accepted from a `localhost` origin matching the server port.

## Notes

- Ability fields follow the `AbilityData` shape: name, level (1–10 / EX1 / EX2),
  frequency, MR, roll, damage type, action type, target amount (number or
  `AoE`), target group, range, effect (BD Lang), optional max uses, cost and
  choices.
- Ability cards have **▲/▼ reorder** buttons (order is what the game uses),
  a **Duplicate** button (names the copy "… Copy" / "… Copy 2"), and live
  **effect parsing**: unparsed BD Lang clauses are shown under the Effect box.
  Clearing the **Max Uses** field removes the key rather than saving a 1.
- **Choices** are edited as structured id/label rows (incomplete rows are
  dropped); each editor also has an **edit as JSON** escape hatch.
- `cost` is serialized inline (`cost: { type: "Resource", resource: "Qi",
  amount: 2, prompt: true }`) and `choices` as a multi-line array, matching
  the existing file style.

## Public demo (GitHub Pages)

The same GUI is published as a **static demo** — no server needed — so anyone
can try the editor without touching the repo:

```bash
bun run editor:demo:build   # → dist-editor/index.html
```

The build (`scripts/build-editor-demo.ts`) embeds the current class/weapon
data into a self-contained `index.html`. GitHub Actions (`pages.yml`) rebuilds
and deploys it whenever the data or the editor changes.

In the demo:

- **No backend**: edits stay in the page's memory; custom test classes/weapons
  persist in that browser's `localStorage` (key `bd-editor-demo:v1`), so a
  visitor's customs survive reloads — but nothing is ever written to the repo.
- **Propose to Bot** (the demo's replacement for **Save to Bot**) diffs your
  edits against the embedded snapshot and opens a pre-filled GitHub issue
  whose body contains a `json` payload: edits to built-in entries plus any
  new custom entries.
- **`ability-pr.yml`** (triggered by issues titled `Ability: ...`) validates the
  payload with `scripts/apply-editor-proposal.ts` and, if it's clean and actually
  changes something, opens a PR applying the changes to `src/data/index.ts` as
  a minimal diff — the same guarantee as the local **Save to Bot**.

To enable deployment once: repo **Settings → Pages → Source: GitHub Actions**.
