# BD Autohost Bot

A Pokemon Showdown autohost bot for **Battle Dome 4.4**. It connects to
`ws://sim.smogon.com:8000/showdown/websocket` as a PS user, auto-joins
`battledome`, and runs the full game loop: setup, turn-based combat,
and loot distribution.

---

## Architecture

```
Connection (ws)  →  Parser (protocol events)
                        ↓
                  Commands (user input)
                        ↓
                  Game Engine (state + resolve + effects)
                        ↓
                  Data (classes, weapons, maps)
```

A shared `src/utils.ts` provides send/Pm helpers, coordinate parsing,
and dice rolling. The command layer routes user input through four
sub-routers. The game engine is split into three files: state (types +
terrain + movement + damage), resolve (attack pipeline), and effects
(parsing + applying ability text).

---

## Utilities

### `src/utils.ts`

Every module imports from here. No circular dependency issues since
these are pure functions and wire-level helpers.

| Function                  | Purpose                                                |
| ------------------------- | ------------------------------------------------------ |
| `toId(s)`                 | lowercase + strip non-alphanumeric                     |
| `send(room, msg)`         | queue a message, drain at 400ms intervals (rate-limit) |
| `sendPm(user, msg)`       | send a PM via `/pm`                                    |
| `sendPmChunks(user, msg)` | split long PMs at 900-char boundaries                  |
| `splitMessage(msg)`       | parse `%cmd args, val` into `{ cmd, args, val }`       |
| `parseArgs(args)`         | split comma-separated string, filter empties           |
| `parsePos(s)`             | parse `"a,1"` → `[0,0]` (row, col)                     |
| `posToStr(r, c)`          | `[0,0]` → `"a,1"`                                      |
| `natList(arr)`            | natural-language join with "and"                       |
| `rollDice(formula)`       | `"2d6+3"` → `{ total, rolls, base }`                   |
| `setWs(w)`                | register the WebSocket for `send()`                    |

`parsePos`/`posToStr` are the coordinate bridge. The grid uses
`[row, col]` internally (0-indexed), but PS chat uses `"a,1"` (letters
for rows, 1-indexed columns). `parsePos("c,4")` → `[2, 3]`,
`posToStr(2, 3)` → `"c,4"`.

`rollDice` parses dice formulas like `"2d6+3"` and returns
`{ total, rolls, base }`. It handles `+`, `-`, and bare
modifiers. Used everywhere — hit resolution, damage, AI, loot.

---

## Commands

### `src/commands/index.ts`

The single router `handleCommand(room, user, cmd, args, val, pm?)`.
Normalizes `cmd` via `toId`, then dispatches to one of four sub-routers:

| Prefix check                                  | Routes to         | Commands           |
| --------------------------------------------- | ----------------- | ------------------ |
| `ping` / `help`                               | inline            | `%ping`, `%help`   |
| `wt` / `rf` / `wtm`                           | `infoCommand()`   | reference lookups  |
| `vs`, `vl`, `vi`, `loot`, `xp`, `gold`, `sco` | `playerCommand()` | character stats    |
| host commands (see below)                     | `hostCommand()`   | game setup         |
| game commands (see below)                     | `gameCommand()`   | in-play actions    |
| `sheets`                                      | `sheetsCommand()` | Google Sheets sync |

### `src/commands/host.ts`

All game setup commands, routed by `hostCommand()`:

| Command              | Function             | What it does                                                                                                                             |
| -------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `%host`              | `handleHost`         | Creates a new `Game` in the room with a default 12x12 map, FFA mode, setup phase                                                         |
| `%dehost`            | `handleDehost`       | Deletes the game (host only)                                                                                                             |
| `%setgame`           | `handleSetGame`      | Sets mode AND completes setup: picks a random map from the mode's pool (if none set), assigns teams (NvM), places players, generates turn order — then %start                                                                                                      |
| `%addp`              | `handleAddPlayer`    | Creates an `Entity` from a class + weapon + team, assigned a spawn position                                                              |
| `%addm`              | `handleAddMonster`   | Creates a monster entity with raw stats                                                                                                  |
| `%remp`              | `handleRemPlayer`    | Removes an entity                                                                                                                        |
| `%sc`                | `handleSwitchClass`  | Changes YOUR class (`%sc <class>`), recalculates stats + abilities; until the game starts             |
| `%sw`                | `handleSwitchWeapon` | Changes YOUR weapon (`%sw <weapon>`), recalculates stats + abilities; until the game starts             |
| `%setlevel` / `%sl`  | `handleSetLevel`     | Sets class/weapon level 1-10, unlocks abilities by level; `all` levels every player at once                                                                  |
| `%setteam`           | `handleSetTeam`      | Changes an entity's team number                                                                                                          |
| `%setmap`            | `handleSetMap`       | Sets a curated map by name, a random map from a gamemode pool (`%setmap pvp`), or `%setmap gen` for a procedural map (host starts with no map; %start requires one)                                                                             |
| `%listmaps`          | `handleListMaps`     | Lists available maps (filterable by size); shows recommended maps for the game mode                                                                                        |
| `%gento`             | `handleGenTurnOrder` | Rolls 1d20 + MP for each entity, sorts descending                                                                                        |
| `%open` / `%openbsu` | `handleOpen`         | Opens signups (`signupsOpen = true`), enabling `%join`; `openbsu` highlights                                                             |
| `%close`             | `handleClose`        | Closes signups and opens gamemode voting (`voteOpen = true`) for joined players                                                          || `%vote`              | `handleVote`         | Casts/changes a player's gamemode vote; bare `%vote` shows tallies; options filtered by lobby size (all BD 4.4 modes incl. 4v4/2v2v2/NvJ/PvPJ/PvP NTR); nudges host when everyone voted |
| `%votestatus`        | `handleVoteStatus`   | Anyone can check live tallies, runoff state, and who hasn't voted yet (`buildVoteStatus` + `pendingVoterIds`)                                |
| `%nudge`             | `handleNudge`        | Host-only: pings players who haven't voted (@Name) so the lobby can finish the vote                                             |
| `%unvote`            | `handleUnvote`       | Withdraws a player's gamemode vote                                                                                                                   |
| `%endvote`           | `handleEndVote`      | Closes voting, applies the winning mode; on a tie, keeps voting open as a runoff restricted to the tied modes (`game.voteRunoff`)   |
| `%join`              | `handleJoin`         | Self-service join with a chosen class/weapon while signups are open                                                                      |
| `%leave`             | `handleLeave`        | Player leaves the game: removes their entity, drops them from the turn order, withdraws their vote (`removeEntity`); host must use `%dehost` |
| `%genpos`            | `handleGenPos`       | Sets competitive starting positions: FFA `%genpos <N><mode>` (e.g. `4pffa`) spread symmetrically, or teams `%genpos <N>v<M>` (e.g. `2v2`) on mirrored halves with auto-assigned teams + mode |
| `%start`             | `handleStart`        | Starts the game, auto-gentos if needed, broadcasts HTML pages                                                                            |

`handleAddPlayer` parses flat stat strings (class stat + weapon stat),
filters abilities by level, and calls `findSpawnPosition` — a spiral-search
from map center for open Normal tiles. `%addp` and `%join` share the same
entity-building helper `createPlayerEntity`.

`%genpos` parses a player count + mode (e.g. `4pffa`) or a team match (e.g. `2v2`, auto-teams and sets the mode)
and PvE, and places the first N players at symmetric spawn slots derived
from map size (corners, then edges, then center), BFS-searching to the
nearest open Normal tile per slot.

`%start` sets `phase = "playing"`, generates turn order if needed (each
entity rolls `1d20 + MP` from `rollDice`), calls `nextTurn` to get the
first entity, and broadcasts HTML pages.

### `src/commands/game.ts`

In-play actions routed by `gameCommand()`:

| Command                  | Function            | What it does                                                                                         |
| ------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------- |
| `%move` / `%dash`        | `handleMove`        | Moves entity to a reachable tile; calls `pushSnapshot` before mutating                               |
| `%attack` / `%use`       | `handleAttack`      | Selects an ability with optional `@ Target`, checks cooldowns/uses/action type, sets `pendingAction` |
| `%confirm`               | `handleConfirm`     | Calls `resolveAction` (wraps `startAttack`), checks game over                                        |
| `%cancel`                | `handleCancel`      | Clears `pendingAction`, refunds action flags                                                         |
| `%endturn` / `%next`     | `handleAdvanceTurn` | Resolves pending action, calls `nextTurn`, checks for DoT deaths and game over                       |
| `%back`                  | `handleBack`        | Calls `popSnapshot` — undoes last action                                                             |
| `%roll` / `%r` / `%dice` | `handleRoll`        | Rolls dice via `rollDice` (default 1d20)                                                             |
| `%info`                  | `handleInfo`        | Shows game summary or entity details + statuses + buffs                                              |
| `%map`                   | `broadcastPages`    | Refreshes HTML pages for all players                                                                 |
| `%premove`               | `handlePremove`     | Toggles pre-move ability view                                                                        |
| `%pl`                    | inline              | Player list via PM                                                                                   |
| `%to`                    | inline              | Turn order via PM                                                                                    |
| `%hp`                    | `handleHp`          | (Host) manually adjust HP                                                                            |
| `%cut`                   | `handleCut`         | (Host) shot clock on a player; `%cut off` cancels                                                    |
| `%timer`                 | `handleTimer`       | (Host) global countdown; `%timer off` cancels                                                         |
| `%cr` / `%checkrange`    | `handleCheckRange`  | Manhattan distance between two positions/entities                                                    |
| `%status`                | `handleStatus`      | (Host) add/remove/list status effects                                                                |
| `%regp`                  | `handleRegp`        | (Host) reassign an entity to a PS user                                                               |

**The confirm flow** is the core interaction loop:

1. `%attack` sets `entity.pendingAction = { type, ability, target }`
   and marks the action slot used (standardUsed, swiftUsed, etc.)
2. `%confirm` calls `resolveAction(game, entity)` → `startAttack` → the
   generator pipeline → returns `AttackStep`
3. If the step needs a target or selection, it returns `{ done: false, prompt }`
   and the host/user responds with `%target` or `%choose`
4. On `done: true`, the result messages are broadcast, `pendingAction` is
   cleared, and `checkGameOver` is evaluated

Every mutation goes through `pushSnapshot` first, so `%back` can undo.

`announceGameOver` sets `phase = "ended"`, announces the winner, and
prints loot (via `calculateLoot`) and kill summaries.

### `src/commands/player.ts`

Character viewer commands routed by `playerCommand()`:

| Command               | What it shows                                                        |
| --------------------- | -------------------------------------------------------------------- |
| `%vs` / `%viewstats`  | HP bar, stats, position, statuses, buffs, cooldowns                  |
| `%vl` / `%viewlevels` | Class/weapon levels, all abilities with remaining uses and cooldowns |
| `%vi` / `%viewitems`  | Stub                                                                 |
| `%sco`               | Combined loadout setter: `%sco <class>, <weapon>` (your own, until start) |
| `%setclass`          | Host-only: `%setclass <entity>, <class>` — set any entity's class (any time) |
| `%setweapon`         | Host-only: `%setweapon <entity>, <weapon>` — set any entity's weapon (any time) |
| `%setloadout`        | Host-only: `%setloadout <entity>, <class>, <weapon>` — set any entity's loadout (any time) |
| `%score`             | Score display: HP + ability usage counts                            |

Uses `findEntityInGames()` to locate the calling user's entity across
all active games.

### `src/commands/info.ts`

Reference lookups routed by `infoCommand()`:

- `%wt <term>` — checks `WhatIs` map, then game-mode descriptions (`%wt modes` lists all; `%wt pvpj` describes one), then `weapons`, then `classes`
- `%rf <term>` — checks `Reference` map for external links

`buildAbilityLine()` formats one ability as:
`**Name** (Lv.N) - freq, MR N, roll, type action, range: effect`

### `src/commands/sheets.ts`

Google Sheets integration:

- `%sheets` — checks for updates, shows diffs + compliance violations
- `%sheets all` — full BD Lang compliance scan of every sheet

Uses `checkAllUpdates()` and `checkAllSheets()` from the sheets modules.

---

## Game Engine

### `src/game/state.ts`

The core simulation module. Defines all types, terrain rules, movement,
damage, turns, and game-over conditions.

**Types**

The type hierarchy: `Game` owns `Entity[]`, each `Entity` has
`statuses`, `buffs`, `abilities`, `cooldowns`, and a `pendingAction`.
`Terrain` is an enum mapped to the grid.

**`Terrain`** — 13-value enum. Controls movement cost and passability.
**`StatusEffect`** — `name`, `damage`, `rounds`, `maxRounds`, `removable`. `damage` dealt per tick.
**`AbilityData`** — `name`, `level`, `freq`, `mr`, `roll`, `damageType`, `actionType`, `targetAmount`, `targetGroup`, `range`, `effect`, `maxUses?`. Loaded from class/weapon data.
**`PendingAction`** — `type`, `ability?`, `target?`, `targetPos?`, `position?`. Set by `%attack`, cleared by `%confirm`.

**`Entity`**

```
identifier: num, name, id, isMonster, isJuggernaut
stats:      curhp, maxhp, atk, mag, pd, md, eva, mp
position:   pos[2] (row, col), team
loadout:    className, weaponName, classLevel, weaponLevel, abilities[]
state:      statuses[], buffs[], cooldowns{}, usesUsed{}
actions:    pendingAction, dashUsed, standardUsed, movementUsed, swiftUsed
resolve:    pendingResolution?, pendingPromptKind?
```

`buffs` are ephemeral `{ stat, amount, rounds }` tuples. `statuses` are
persistent `{ name, damage, rounds }` with DoT and expiry.
`pendingResolution` is the live generator from `startAttack`.

**`Game`**

```
identity: id, room, host
state:    entities[], map[][], mapName, turnOrder[], turnIndex, round
phase:    "setup" | "playing" | "ended", started
history:  log[], snapshots[] (undo stack, max 20)
meta:     mode, kills{}, winner
```

`games` is a `Map<string, Game>` — the module-level registry.

---

**Terrain rules**

The grid is a `Terrain[][]` matrix. Each tile type affects movement and
gameplay:

| Terrain  | Movement cost | Passable  | Notes                                                                      |
| -------- | ------------- | --------- | -------------------------------------------------------------------------- |
| `Normal` | 1 MP          | yes       |                                                                            |
| `Stop`   | —             | no        | Impassable wall                                                            |
| `Water`  | 1 MP          | yes       |                                                                            |
| `Forest` | 1 MP          | yes       |                                                                            |
| `Ice`    | —             | no        | Impassable                                                                 |
| `Air`    | 1 MP          | yes       |                                                                            |
| `Sticky` | 2 MP          | yes       | Costs 1 extra MP                                                           |
| `Lava`   | —             | no (path) | Deals 30 damage when an entity ends its turn on it; BFS won't path through |
| `Broken` | —             | no        | Impassable                                                                 |
| `Bone`   | —             | no        | Impassable                                                                 |
| `Stone`  | —             | no        | Impassable                                                                 |
| `Hearth` | 1 MP          | yes       |                                                                            |
| `Boost`  | 0 MP (min)    | yes       | Costs 1 less MP (floor 0)                                                  |

`isObstruction(t)` returns true for Stop, Bone, Ice, Stone, and Broken.
`moveCost(t)` returns the MP cost to enter a tile.

---

**BFS pathfinding: `getReachableTiles`**

```
getReachableTiles(game, start, mp, entity?): Map<string, number>
```

Standard BFS over the grid starting from `pos`, limited by MP. Each step
costs `moveCost(terrain)`. Obstructions and Lava are skipped. If an
`entity` is provided, the effective MP is capped by
`getEffectiveMp(entity)` which subtracts Slow status reduction.

Returns a `Map<"r,c" -> cost>` of reachable tiles. Used by `handleMove`
to validate movement.

---

**Range and targeting**

`inRange(game, from, to, range): boolean` parses range pattern strings:

| Pattern    | Distance check                                  | LOS needed |
| ---------- | ----------------------------------------------- | ---------- |
| `melee`    | Chebyshev ≤ 1                                   | no         |
| `global`   | always true                                     | no         |
| `burst N`  | Chebyshev ≤ N                                   | no         |
| `star N`   | Manhattan ≤ N                                   | yes        |
| `range N`  | Manhattan ≤ N                                   | yes        |
| `homing N` | Manhattan ≤ N                                   | no         |
| `line N`   | onLine (cardinal or diagonal, diag = ceil(N/2)) | yes        |
| `pierce N` | same as line                                    | yes        |
| `beam N`   | inBeam (3 wide, N deep, cardinal)               | yes        |
| `cone N`   | inCone (triangle, widening by 1 per tile)       | yes        |

AoE tile generators (`getBurstTiles`, `getStarTiles`, `getConeTiles`,
`getLineTiles`, `getBeamTiles`) return raw tile coordinates for a
pattern. `getAoETargets` then filters entities on those tiles by
target group (foe/ally/self/any).

`getValidTargets` in the HTML layer reuses the same `inRange` logic
to present targeting buttons.

---

**Push/Pull**

```
pushEntity(game, target, source, amount): { moved, path }
pullEntity(game, target, source, amount): { moved, path }
```

Involuntarily moves an entity along the axis from source → target (push) or target →
source (pull). Diagonal movement preserves the diagonal line. Each step
checks `isPassable` (in bounds, not obstruction, not lava). Returns the
number of tiles actually moved and the path taken.

---

**Damage pipeline: `dealDamage`**

```
dealDamage(entity, damage): { actual, shieldAbsorbed, shieldBreaks }
```

1. If entity has a Shield status, absorb up to `shield.damage` from the
   incoming damage. Reduce shield HP. If shield reaches 0, remove it and
   set `shieldBreaks = true`.
2. Remaining damage goes to HP: `entity.curhp -= remaining`.
3. Returns `{ actual, shieldAbsorbed, shieldBreaks }`.

The returned struct is used by the resolve layer to print shield
absorption messages.

---

**Accuracy: `rollAccuracy`**

```
rollAccuracy(mr, eva, bonuses) → { hit, roll, crit }
```

Rolls `1d20 + bonuses`. Hit if result ≥ `MR + EVA`. Crit if roll ≥ 20
(before applying bonuses? the code checks `roll >= 20` where roll already
includes bonuses, so it's effectively natural 20 + bonuses).

---

**Turn processing: `nextTurn`, `processStartOfTurn`, `processEndOfTurn`**

```
nextTurn(game, { actorDied }): { entity, messages, died }
```

- `actorDied` (optional): set when the acting entity died mid-turn
  (recoil/confusion) and was already removed, so `nextTurn` does not
  advance past the entity that shifted into its slot. When any removal
  wraps the turn pointer back to slot 0 — the removed entity held the
  final slot — `removeEntity` advances `round` for the completed cycle
  (mid-turn deaths, start-of-turn deaths, and `%leave`/`%remp` of the
  current entity).

1. Ticks buffs of the entity whose turn is ending (`prev`).
2. Increments `turnIndex`. If past the end, wraps to 0 and increments
   `round`.
3. Calls `processEndOfTurn(game, prev)`; if `prev` dies, the turn pointer
   is corrected so the next entity is not skipped.
4. Gets the current entity from `turnOrder[turnIndex]`.
5. Resets per-turn flags: `dashUsed`, `standardUsed`, `movementUsed`,
   `swiftUsed`, `pendingAction`.
6. Calls `processStartOfTurn(game, entity)`; entities already dead when
   their turn starts are removed and skipped, never handed the turn.

```
processStartOfTurn(game, entity): { messages, died }
```

Before an entity can act, the following resolve in order:

1. **DoT damage**: each status with `damage > 0` deals its tick damage
   via `dealDamage` (statuses are removed at end of turn, not here).
2. **Status announcements**: prints Stun/Confuse/Root/Seal warnings.
3. **Death check**: if HP ≤ 0, removes entity and sets `died = true`.

```
processEndOfTurn(game, entity): { messages, died }
```

At the end of an entity's turn, the following resolve in order:

1. **Cooldown tick**: each cooldown counter decrements by 1; entries
   reaching 0 are deleted.
2. **Status duration tick**: each status's round counter decrements;
   expired statuses generate "wore off" messages and are removed.
3. **Lava damage**: if the entity ended its turn on a Lava tile, deals
   30 flat damage.
4. **Death check**: if HP ≤ 0, removes entity and sets `died = true`.

Buffs also tick down at the end of the buffed entity's turn (inside
`nextTurn`). Per the glossary, damaging statuses deal their damage just
before the affected entity's turn, while round counters and cooldowns
decrement when that entity's turn ends.

---

**Game over: `checkGameOver`**

```
checkGameOver(game): Entity | null
```

- **FFA mode**: if ≤ 1 entity alive, game ends. Winner is the sole
  survivor.
- **Team mode** (mode contains "v"): groups alive entities by `team`.
  If only one team has survivors, game ends.

Does NOT set `game.phase` itself — the caller does it. (Actually looking
at the code, it DOES set `game.phase = "ended"` and `game.winner`.)

---

**Undo system: snapshots**

```
pushSnapshot(game)  → serializes entity state + turnIndex + round to JSON
popSnapshot(game)   → restores most recent snapshot, returns false if empty
```

`serializeState` captures a shallow copy of: `curhp`, `maxhp`, `pos`,
`statuses`, `buffs`, `cooldowns`, `usesUsed`, `dashUsed`, `standardUsed`,
`movementUsed`, `swiftUsed` for each entity, plus `turnIndex` and `round`.
Stack is capped at 20 entries.

Commands that mutate state (`move`, `hp`, `cut`, `status`, `confirm`,
`endturn`) call `pushSnapshot` before changing anything. `%back` calls
`popSnapshot` to revert.

---

### `src/game/resolve.ts`

Attack resolution pipeline. The centerpiece is a generator function
that can yield prompts for player input, then resume.

---

**Entry points**

```
resolveAction(game, entity): AttackStep
```

Legacy wrapper. Reads `entity.pendingAction`, calls `startAttack`.

```
startAttack(game, user, ability, target?): AttackStep
```

Creates a `resolveAttackFlow` generator and returns the first step.
The `AttackStep` type is a tagged union:

```typescript
type AttackStep =
  | { done: false; prompt: AttackPrompt }
  | { done: true; result: ResolutionResult };
```

Where `AttackPrompt` is either:

- `{ kind: "selection", message, options }` — the player must `%choose`
- `{ kind: "target", message, candidates }` — the player must `%target`

---

**Generator pipeline**

`resolveAttackFlow` processes these stages in order:

```
Declare → Selection/Costs → Target → Accuracy → Splash → Damage → Post-Damage
                                                          ↓
                                                    Effects (from effects.ts)
                                                          ↓
                                                    Push/Pull
                                                          ↓
                                                    Cooldowns + Uses
                                                          ↓
                                                    Win check
```

**Stage 1: Declare**
Prints the ability name and target to the room.

**Stage 2: Selection/Costs** (STUB)
If `abilityNeedsSelection` returns true, yields a "selection" prompt.
The selection/choice system is not yet implemented — the function always
returns false.

**Stage 3: Target**

- If the ability is AoE (burst/cone/line/pierce/beam/star), targets are
  auto-collected via `getAoETargets`.
- If no initial target was provided, yields a "target" prompt with
  candidates filtered by `getTargetCandidates` (valid target group + in
  range). The host/user responds with `%target <entity>`.
- If an `initialTarget` was provided (e.g. `%use Fireball @ P2`), uses it
  directly.

**Stage 4: Loop over hits and targets**
For each target, for each hit (1 for single, 2 for double, 3 for triple):

```
resolveSingleTarget(game, user, ability, target, hitLabel, confusionAlreadyApplied)
```

**Stage 6: Accuracy**
`rollAccuracy(ability.mr, target.eva, user.accBonus)` → hit/miss/crit.
Miss means no damage, no effects.

**Stage 7: Damage**
On hit: `ability.roll(total) + offensiveStat - defensiveStat`.
Crit adds an extra roll of the same dice. Final damage is floored at 0.
Shield absorption messages are printed if applicable.

**Stage 8: Effects**
`parseEffects(ability.effect)` then `applyEffects(game, user, target, effects)`.
See effects.ts below.

**Stage 9: Push/Pull**
After each hit that lands, `parsePushPull` checks the effect text for
`/bpush N/` or `/bpull N/` (word-boundary guarded). Applied via
`pushEntity`/`pullEntity`.

**Stage 10: Splash**
After all targets resolve, if the ability has `splash N` in its range
string, splash damage is dealt to targets adjacent to the primary target.
Splash uses half PD/MD for defense.

**Stage 11: Cooldowns and uses**
`setCooldown(user, ability)` — Every Turn → no CD, EOT → 2 turns, E3T →
3 turns. `maxUses` is tracked via `usesUsed[ability.name]`.

**Stage 12: Win check**
If any deaths occurred, `checkGameOver(game)` runs once after all deaths
(not per death); when the game is over it prints the winner, or
"No survivors!" when every entity died.

---

**Generator lifecycle**

```
respondToChoice(user, choiceId): AttackStep
respondToTarget(user, targetRef): AttackStep
```

These feed the user's response back into the generator via
`flow.next(input)`. While the generator yields prompts, `pendingPromptKind`
tracks which kind is expected so the wrong response command errors out.

When the generator returns (`step.done === true`), `pendingResolution`
and `pendingPromptKind` are cleared.

---

**Damage formula detail**

```
base  = rollDice(ability.roll).total
       + offensiveStat(user, damageType)     // ATK for Phys, MAG for Mag
       - defensiveStat(target, damageType)   // PD for Phys, MD for Mag

crit  → base += rollDice(ability.roll).total

final = max(0, base)
```

`getEffectiveStat` sums base entity stats with all active buffs (positive
or negative) for the given stat name.

---

### `src/game/effects.ts`

Effect parser and applier. This module translates raw ability text into
typed effect objects and applies them to entities.

---

**Parse → Apply flow**

```typescript
parseEffects(text: string): Effect[]
applyEffects(game, caster, target, effects): string[]
```

`parseEffects` normalizes whitespace, splits on `.`, `,`, and `and`
(avoiding dice notation parentheses), then pattern-matches each clause.

`applyEffects` iterates the parsed effects and mutates the target entity,
returning log messages for broadcast.

---

**Clause splitting**

The splitter respects parentheses and brackets (used in dice notation like
`(2d6+3)`). It splits on:

- Periods not inside dice notation
- Commas not inside dice notation and not followed by `and`/`or`
- The word `and` not inside dice notation

Each resulting clause is parsed independently.

---

**Effect types in detail**

**`status`** — `/inflict N Status/M/`, `/Status\/M/`
Finds or creates a `StatusEffect`. Refreshes with max existing/new rounds/damage. Shield blocks non-damaging ones.

**`buff`** — `/+\d+ STAT\/M/`, `/+\d+% STAT/`
Adds `{ stat, amount, rounds }` to `target.buffs`. Percent buffs compute from base stat.

**`debuff`** — same patterns as buff but with `-`
Same as buff but negative amounts.

**`damageMod`** — `/+\d+% damage/`, `/+\d+ DMG\/M/`
Printed as a marker. No mechanical effect yet.

**`heal`** — `/Heal \d+ HP/`
Adds HP up to `maxhp`. No amount → "manual resolution needed".

**`shield`** — `/Shield N for M rounds/`, `/N Shield\/M/`
Adds or refreshes a Shield status with given HP and duration.

**`push`** — `/Push N toward user/`, `/Push N/`
Calls `pushEntity` from caster pos. "toward user" = toward caster.

**`pull`** — `/Pull N toward user/`, `/Pull N/`
Calls `pullEntity` toward caster.

**`teleport`** — `/Teleport to range/`
Needs host to pick a tile manually.

**`swap`** — `/Swap positions/`
Swaps caster and target positions directly, no passability check.

**`move`** — `/Move up to N tiles/`
Needs host to pick a tile.

**`resource`** — `/Gain/Spend/Lose N resource/`
Resource system not mechanically implemented.

**`recoil`** — `/Recoil N%/`
Implementation pending.

**`delay`** — `/Delay N rounds/`
Prints message.

**`ignore`** — `/Ignores X/`
Prints message.

**`channel`** — `/Channel STAT for N rounds/`
Prints message.

**`phase`** — `/Phase: moon phase/`
Prints message.

**`conditional`** — `/If CONDITION, EFFECT/`
Applies then-effects (and optionally else-effects). Condition evaluation is TODO.

**`thirst`** — `/Thirst N: EFFECT/`
Applies sub-effects. Threshold evaluation is TODO.

**`apex`** — `/Apex: EFFECT/`
Applies sub-effects. Distance evaluation is TODO.

**`choose`** — `/Choose: A or B or C/`
Prints all options. Player choice not yet interactive.

**`unknown`** — fallback
Raw text passthrough for unparseable clauses.

---

**Status refresh rules**

When applying a status that the target already has:

- `rounds` = max(existing.rounds, new.rounds)
- `damage` = max(existing.damage, new.damage)

This means applying a weaker version doesn't downgrade the existing one.

---

**Shield blocking**

Non-damaging status effects (those with `damage === 0`) are blocked by an
active Shield. Damaging statuses (DoTs) pass through Shield since they are
dealt via `dealDamage` which already handles shield absorption.

---

**Stat calculation for percent buffs**

```
amount = floor(baseStat * (percent / 100))
```

Percent buffs/debuffs are computed from the entity's base stat (before
other buffs), then stored as a flat `{ stat, amount, rounds }` entry in
`buffs[]`. This means percent buffs snapshot at application time.

---

**Displacement physics**

Push, pull, and swap all bypass normal movement rules:

- Push/pull slide the target along cardinal or diagonal lines, stopping
  at the first obstruction or map edge
- Push "toward user" pushes the target toward the caster (same direction
  as pull but using the push function)
- Swap directly exchanges position tuples with no passability check

---

**Parser priority**

The parser checks clause patterns in this order, returning on the first
match:

1. Conditional (`If...`)
2. Thirst (`Thirst N:`)
3. Apex (`Apex:`)
4. Choose (`Choose:`)
5. Channel (`Channel STAT`)
6. Phase (`Phase:`)
7. Delay (`Delay N rounds`)
8. Recoil (`Recoil N%`)
9. Ignore (`Ignores X`)
10. Multi-hit (`Multi-Hit: N`)
11. Status inflict patterns (5 sub-patterns, most specific first)
12. Stat mods (`+N STAT/M`)
13. Damage mod (`+N% damage`)
14. Displacement (push/pull/teleport/swap/move)
15. Resource (gain/spend/lose)
16. Heal (`Heal N HP`)
17. Shield (`Shield N for M`)
18. Unknown (fallback)

The status inflict function tries 7 patterns in order: formal
("inflict N Status for M"), slash ("inflict N Status/M"), standalone
("N Status/M"), non-damage ("Status/M"), inflict-slash ("inflict Status/M"),
bare inflict ("inflict Status"), then falls through.
