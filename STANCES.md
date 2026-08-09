# Stances (future design note)

> **Status: FUTURE / not implemented.** This document records intent only.

## What this is

A planned consolidation of related per-combat toggle mechanics into a single
"Stance" structure. Ownership today is mixed: subweapons are entity-level
(`Entity.subweapon`), moon phases are game-level (`Game.moonPhase`) -- whether
the unified stance lives on the entity, the game, or both is an open design
decision (see Goal / Migration plan). Currently these features exist as
separate, loosely-related pieces of state and syntax:

- **Moon phases** — `Game.moonPhase`, set by `"Phase: X"` effects, read by
  `"Phase is X"` condition clauses (`"New Moon:"`, `"Full Moon:"`, ...).
  Dark-class mechanic.
- **Subweapons** — `Entity.subweapon` (`gladius | scutum | pilum`), set by
  `"Switch to X"` / `"Start in X"` effects, read by `"Gladius:"`/`"Scutum:"`/
  `"Pilum:"` branch conditions and `"Requires X"` clauses. Fighter/Gladius
  mechanic.

## Goal

Unify these — and any similar per-combat toggles that arrive later — into one
structure (e.g. `entity.stance: { name, ... }` or similar) so that:

- state, snapshotting, and undo round-trip a single concept instead of N fields;
- the effect language (`"Phase is X"`, `"subweapon is X"`, `"Requires X"`,
  `"Switch to X"`) shares one parser/dispatch path;
- the UI renders one stance display instead of ad-hoc badges per mechanic.

## Trail markers

Code comments pointing here:

- `src/game/state.ts` — `Entity.subweapon` and `Game.moonPhase` field docs.

---

## Migration plan (concrete sketch)

### 1. State shape

Current (all separate):

- `Game.moonPhase?: string` — `src/game/state.ts` (game-level)
- `Entity.subweapon?: string` — `src/game/state.ts` (entity-level)

Target:

```ts
// src/game/state.ts
export type Stance =
  | { kind: "moon"; phase: string }          // "New Moon" | "Waxing" | ...
  | { kind: "subweapon"; weapon: string };   // "gladius" | "scutum" | "pilum"

interface Entity {
  stance?: Stance;   // replaces subweapon
}
interface Game {
  stance?: Stance;   // replaces moonPhase (or keep moonPhase here, see below)
}
```

Open question: moon phase is game-global (all entities share it), subweapon is
per-entity. Decide whether `Game.stance` stays a separate game-global slot or
both move onto the entity (phase broadcast per turn). Keep the two concepts
distinct inside the union so behavior stays identical.

### 2. Parser (`src/game/effects.ts`)

Clause-level changes only — no effect-type changes needed up front:

- `"Phase: X"` → currently `PhaseEffect { type: "phase", phase }`. Keep, but
  store the value in the new `stance` slot: `game.stance = { kind: "moon", phase }`.
- `"Switch to X"` / `"Start in X"` / `"Swap subweapons"` → `switchWeapon`
  effect. Equip: `user.stance = { kind: "subweapon", weapon }`.
- `"Gladius:"` / `"Scutum:"` / `"Pilum:"` branches → conditionals with
  `condition: "subweapon is X"`. Generalize `evaluateCondition` so
  `"subweapon is X"` and `"phase is X"` both read from the stance slot:
  - `"phase is X"` → `user/game.stance?.kind === "moon" && phase === X`
  - `"subweapon is X"` → `user.stance?.kind === "subweapon" && weapon === X`
- `"Requires X"` → `requires` effect. Resolve against `user.stance`.

Keep the raw clause strings (`subweapon is`, `phase is`, `Switch to`) as
parsed keywords — do not rename them in BD Lang itself (backwards compatible
with existing ability text).

### 3. Resolution (`src/game/resolve.ts`, `src/commands/*`)

- `extractCombatMetadata(effects, subweapon)` — already descends only into
  matching `"subweapon is X"` branches; generalize the param to the whole
  stance object so moon-gated branch mods (if any appear later) work too.
- The "Requires X" gates in `resolveAttackFlow` and `handleAttack` read
  `user.subweapon`; switch them to read the stance slot.
- `%setsubweapon` (`src/commands/host.ts`) — keep the command, write into the
  stance slot; a future `%setstance` would generalize it.

### 4. Snapshot / undo (`src/game/state.ts`)

- `serializeState` / `popSnapshot` already round-trip `subweapon`; add the
  stance slot in the same places (replace `subweapon: e.subweapon` with
  `stance: e.stance`). `moonPhase` is already game-level state — keep it in
  the game serialization path.

### 5. UI (`src/html/pages.ts`, `src/commands/player.ts`, `src/commands/game.ts`)

- `subweaponBadge(entity)` → `stanceBadge(entity)` rendering one badge for
  either kind (moon: e.g. `[Full Moon]`, subweapon: `[Pilum]`).
- `subweaponGated(ab, entity)` → `stanceGated(ab, entity)` (filter abilities
  whose `requires`/branch condition the current stance doesn't satisfy).
- `%info`/`%pl`/`%vs`/`%vl` subweapon suffixes become stance suffixes.

### 6. Tests

- Rename/extend the existing subweapon tests; add one moon-phase-via-stance
  test; snapshot round-trip test for the stance slot; `%setsubweapon` host
  command test stays green.

## Notes

- Do **not** start this work yet — current behavior is correct and tested;
  this is a deliberate, future refactor.
- When it lands, it should be behavior-preserving: existing effects, tests,
  and UI text must keep working unchanged.
