# Battle Dome Ability Editor

A browser-based GUI for editing the bot's classes, weapons and abilities, and
for creating **temporary custom test classes/weapons** that are never added to
the bot permanently.

```bash
npm run editor            # → http://localhost:4700
PORT=8080 npm run editor  # different port
HOST=0.0.0.0 npm run editor  # expose on your LAN (default: 127.0.0.1 only)
```

## How it works

```
abilityeditor/
  server.ts          # local server (tsx). Loads src/data/index.ts into the
                     #   same in-memory classes/weapons Maps the bot uses.
  index.html         # the GUI (PS light theme, single file)
  customs.local.json # gitignored — your custom test classes/weapons, so they
                     #   survive editor restarts. Never committed.
  runtime-data.json  # gitignored — live snapshot mirrored to game processes.
```

- The server is the authoritative in-memory data. Every edit is applied
  immediately and mirrored to `runtime-data.json`.
- The **test client** (`npm run testapp` → localhost:4000) reads that snapshot
  at startup, re-applies it whenever the file changes (2s poll), or on demand
  with `%reloaddata`.
- **Save to Bot** rewrites `src/data/index.ts` with a **minimal diff**: only
  entries that actually changed are regenerated, in the file's existing format.
  Custom test items are excluded — they can never leak into the bot.
- **Revert** reloads everything from `src/data/index.ts` (customs are kept and
  re-registered from `customs.local.json`).

## Workflow: permanent ability edit (PR-ready)

1. `npm run editor` and open http://localhost:4700.
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
| `/api/ability` | POST | add / save / remove an ability |
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
- `cost` is serialized inline (`cost: { type: "Resource", resource: "Qi",
  amount: 2, prompt: true }`) and `choices` as a multi-line array, matching
  the existing file style.
