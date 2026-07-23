# Ice Kyubs, HTML Pages & GUI Guide

## Overview

This document guides the implementation of interactive HTML pages for the Battle Dome
autohost bot. The bot sends HTML to players and hosts via Pokemon Showdown's
`/addhtmlbox` (room chat) and `/pminfobox` (private message) commands.

**Your job**: Build the HTML page generators in `src/html/pages.ts` and any related
helper modules. The game engine (`src/game/state.ts`) and command system are already
in place — you consume their data to produce HTML strings.

---

## Pokemon Showdown HTML Constraints

PS renders HTML in an `<iframe>` with strict sandboxing. Here's what you CAN and
CANNOT do:

### Allowed

- Basic HTML tags: `<div>`, `<span>`, `<table>`, `<tr>`, `<td>`, `<th>`, `<p>`, `<b>`, `<i>`, `<u>`, `<h1>`-`<h6>`, `<br>`, `<hr>`, `<center>`, `<small>`, `<sub>`, `<sup>`
- Inline `style` attribute (most CSS properties work)
- **Interactive buttons**: `<button name="send" value="/command">Label</button>`
- Links: `<a href="URL">text</a>` (must be full URL)
- Images: `<img src="URL">`
- Background colors, text colors, borders, padding, margin, font-size, font-family, text-align, etc.

### NOT Allowed

- **No JavaScript** — no `<script>`, no `onclick`, no event handlers
- **No external stylesheets** — all CSS must be inline
- **No `<form>` elements** (except `<button name="send">`)
- **No `<input>`, `<textarea>`, `<select>`**
- **No `<iframe>`, `<embed>`, `<object>`**
- Max HTML size is roughly ~10KB per message (PS may truncate)

### Button Mechanics

```html
<button name="send" value=".move a,3">Move to a,3</button>
```

When clicked, PS sends the `value` as if the user typed it in chat.
So `.move a,3` will be sent as a chat message, which the bot's parser
picks up and routes to the `.move` command handler.

**Important**: The button `value` starts with the command prefix (default `.`).

---

## Architecture

### File: `src/html/pages.ts`

This file exports two main functions:

```typescript
export function buildHostPage(game: Game): string;
export function buildPlayerPage(game: Game, entity: Entity): string;
```

These return raw HTML strings that get sent via:

```typescript
send(game.room, `/addhtmlbox ${html}`); // room-wide
sendPm(entity.name, `/pminfobox ${html}`); // to a specific player
```

### How Pages Are Sent

In `src/commands/game.ts`, the `broadcastPages()` function is called after
every state change (move, attack, end turn, next, back). It:

1. Builds the host page and sends it to the room
2. Builds each player's page and PMs it to them

**You will need to modify `broadcastPages()`** to use `/pminfobox` instead
of `/addhtmlbox` for player pages, so only they see their buttons.

---

## Game State Types (from `src/game/state.ts`)

### `Game`

```typescript
{
  id: string            // game identifier
  room: string          // PS room id (e.g. "battledome")
  host: string          // host's username
  entities: Entity[]    // all players and monsters
  map: Terrain[][]      // 2D grid of terrain tiles
  mapName: string       // map identifier
  turnOrder: string[]   // entity nums in turn order
  turnIndex: number     // index into turnOrder
  round: number         // current round number
  log: ActionLogEntry[] // history of actions
  mode: string          // game mode (FFA, PvP, etc.)
  phase: "setup" | "playing" | "ended"
}
```

### `Entity`

```typescript
{
  num: string           // "P1", "P2", "M1", "M2", etc.
  name: string          // display name
  id: string            // sanitized id
  isMonster: boolean
  curhp: number
  maxhp: number
  atk: number           // attack stat
  mag: number           // magic stat
  pd: number            // physical defense
  md: number            // magical defense
  eva: number           // evasion
  mp: number            // movement points
  pos: [number, number] // [row, col] on the map
  team: number          // team number (0 = FFA)
  className: string     // e.g. "Bard"
  weaponName: string    // e.g. "Crossbow"
  classLevel: number
  weaponLevel: number
  abilities: AbilityData[]
  statuses: StatusEffect[]
  buffs: { stat: string; amount: number; rounds: number }[]
  cooldowns: Record<string, number>
  usesUsed: Record<string, number>
  pendingAction: PendingAction | null
  dashUsed: boolean
  standardUsed: boolean
  movementUsed: boolean
}
```

### `AbilityData`

```typescript
{
  name: string
  level: number
  frequency: string       // "Every Turn", "EoT", "E3T", "Once", "Twice", etc.
  mr: number             // miss rate
  roll: string           // e.g. "2d8+5"
  damageType: "Physical" | "Magical" | ""
  actionType: "Standard" | "Full" | "Movement" | "Swift" | "Free" | "Trigger" | "Reaction" | "Passive"
  targetAmount: number | "AoE"
  targetGroup: string    // "Foe", "Ally", "Self", "Any", "Tile"
  range: string          // "Melee", "Range 6", "Homing 4", "Global", "Burst 1", etc.
  effect: string
  maxUses?: number
}
```

### Terrain Types

```typescript
enum Terrain {
  Normal = 0,
  Stop = 1,
  Water = 2,
  Forest = 3,
  Ice = 4,
  Air = 5,
  Sticky = 6,
  Lava = 7,
  Broken = 8,
  Bone = 9,
  Stone = 10,
  Hearth = 11,
  Boost = 12,
}
```

Terrain colors are in `TERRAIN_COLORS` (hex strings).

### `ActionLogEntry`

```typescript
{ turn: number, entity: string, description: string, snapshot: string }
```

---

## Host Page Requirements

The host sees the full game state + controls. Layout:

```
┌─────────────────────────────────────────────┐
│ Game: {id} | {mode} | Round {round}         │
├─────────────────────────────────────────────┤
│                                             │
│  [FULL MAP - color coded grid]              │
│  Columns labeled a-z, rows 1-N             │
│  Entity nums (P1, M1) shown on tiles       │
│  Current turn entity highlighted           │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  [PLAYER LIST TABLE]                        │
│  # | Name | Class/Weapon | HP | A | M |     │
│    PD | MD | EVA | MP | Pos                 │
│  Current entity row bolded                  │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  [TURN ORDER]                               │
│  P1 → P2 → P3 → M1 → ...                   │
│  Current turn bolded                        │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  [ACTION LOG - scrollable, last 10-15]      │
│  [round] Player moved to d,5                │
│  [round] P2 attacks P1 with Arrow Flurry    │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  [CONTROLS]                                 │
│  [Next] [Back] [Roll 1d20] [Roll 2d8+5]    │
│                                             │
└─────────────────────────────────────────────┘
```

### Button Commands (host)

- **Next** → `.next` — resolves pending action, advances turn
- **Back** → `.back` — undoes last action
- **Roll 1d20** → `.r 1d20`
- **Roll 2d8+5** → `.r 2d8+5`
- Add more roll buttons for common formulas used in the game

### Map Rendering Rules

- Each tile is a `<td>` with background color from `TERRAIN_COLORS`
- Entity nums overlaid as text in the tile
- Current turn entity's tile gets a special highlight (e.g. bright green border)
- Column headers: a, b, c, d, ...
- Row headers: 1, 2, 3, 4, ...
- Keep tile cells small (~20px) so the map fits in the HTML box

---

## Player Page Requirements

The player sees their personal view with action buttons. Layout changes
based on whose turn it is and what phase they're in.

### When It's NOT Their Turn

```
┌─────────────────────────────────────────┐
│ P2 - Ocean (Cleric / Spellbook)         │
├─────────────────────────────────────────┤
│ HP: 65/80 | ATK: 4 | MAG: 7 | ...      │
│ Status: +3 DEF (2r), Burn 3/1           │
├─────────────────────────────────────────┤
│ [MINI MAP - their position highlighted] │
├─────────────────────────────────────────┤
│ Waiting for your turn...                │
│ Current: P1 (Taistelu)                  │
│ Turn Order: P1 → P2 → P3               │
└─────────────────────────────────────────┘
```

### When It's Their Turn — Movement Phase

```
┌─────────────────────────────────────────┐
│ P2 - Ocean (Cleric / Spellbook)         │
├─────────────────────────────────────────┤
│ HP: 65/80 | ATK: 4 | MAG: 7 | ...      │
│ Status: +3 DEF (2r), Burn 3/1           │
├─────────────────────────────────────────┤
│ [MINI MAP]                              │
├─────────────────────────────────────────┤
│ MOVEMENT PHASE: Click a tile to move    │
│                                         │
│ [a,3] [a,4] [b,3] [b,4] [b,5] [c,4]  │
│                                         │
│ [Dash]                                  │
├─────────────────────────────────────────┤
│ [End Turn]                              │
└─────────────────────────────────────────┘
```

Each `[a,3]` is a `<button name="send" value=".move a,3">a,3</button>`.
The move buttons show only tiles reachable within the entity's MP.

### When It's Their Turn — Action Phase (after moving)

```
┌─────────────────────────────────────────┐
│ P2 - Ocean (Cleric / Spellbook)         │
├─────────────────────────────────────────┤
│ HP: 65/80 | ATK: 4 | MAG: 7 | ...      │
│ Status: +3 DEF (2r)                     │
├─────────────────────────────────────────┤
│ [MINI MAP]                              │
├─────────────────────────────────────────┤
│ ACTION PHASE: Choose an ability         │
│                                         │
│ [First Aid (Swift, Range 3)]            │
│ [Ward (Swift, Burst 2)]                 │
│ [Heaven's Wind (Swift, Range 4)]        │
│                                         │
│ After choosing ability, target buttons  │
│ appear showing valid targets.           │
│                                         │
│ [End Turn]                              │
└─────────────────────────────────────────┘
```

Ability button format: `<button name="send" value=".attack AbilityName @ TargetNum">
AbilityName (ActionType, Range)</button>`

For abilities that need a target, you can either:

1. **Two-step**: First click selects ability, then target buttons appear
   (requires re-sending the page with updated state)
2. **Single button**: Each ability-target pair is its own button
   `.attack Arrow Flurry @ P3`

**Recommended**: Use single buttons (option 2) since we can't do JS state.
Group them visually: show ability name as a header, then target buttons below.

### Ability Button Filtering Rules

- Only show abilities the entity has access to (level requirement met)
- Skip Passive and Reaction abilities (not clickable actions)
- Skip abilities on cooldown (check `entity.cooldowns[ability.name]`)
- Skip abilities with no uses left (check `entity.usesUsed[ability.name]` vs `ability.maxUses`)
- If `standardUsed` is true, only show Swift and Free actions
- Mark abilities with their remaining uses if limited

### Target Button Rules

- **Foe**: only show living enemies
- **Ally**: only show living allies (not self, unless ability targets self)
- **Self**: only the entity itself
- **Any**: all living entities
- **Tile**: show valid tile coordinates (for tile-targeting abilities)
- Check range from entity's position to target's position

---

## Mini Map (Player View)

A smaller version of the map focused on the entity:

- Show the full map but at a smaller cell size (~14px)
- Highlight the entity's own tile in green
- Highlight enemies in red
- Highlight allies in blue
- No column/row headers needed (saves space)

---

## Helper Functions You'll Need

### `isTargetValid(game, ability, caster, target)` → boolean

Checks if `target` entity is a valid target for `ability` from `caster`.
Validates: alive, correct group (foe/ally/self), within range.

### `getValidTargets(game, ability, caster)` → Entity[]

Returns all entities that are valid targets for the ability.

### `getValidTiles(game, ability, caster)` → [number, number][]

For tile-targeting abilities, returns valid tile positions.

### `getAvailableAbilities(entity)` → AbilityData[]

Filters the entity's abilities to only show usable ones based on:

- Level requirements
- Cooldowns
- Uses remaining
- Action type restrictions (standard used? etc.)

---

## Styling Guide

Use inline styles. Keep it clean and game-UI-like:

### Colors

```
Background: #1a1a2e (dark navy) or #f0f0f0 (light)
Text: #e0e0e0 (dark bg) or #1a1a2e (light bg)
Headers: #00aaff (blue accent)
HP Green: #00cc00
HP Yellow: #cccc00
HP Red: #cc0000
Current turn: #ffcc00 (gold)
Enemy: #ff4444
Ally: #4488ff
Self: #44cc44
Buttons: #2a2a4e bg, #00aaff border, white text
```

### Font

```
font-family: monospace or "Courier New", monospace
font-size: 11px for tables, 12px for headers
```

### Buttons

```css
/* Conceptual — must be inline */
padding: 3px 8px;
margin: 2px;
background: #2a2a4e;
color: #ffffff;
border: 1px solid #00aaff;
cursor: pointer;
font-size: 11px;
font-family: monospace;
```

### Tables

```css
border-collapse: collapse;
border: 1px solid #555;
```

### Responsive Width

- Host page: `max-width: 900px`
- Player page: `max-width: 600px`

---

## Current State of `src/html/pages.ts`

The file has a basic implementation with:

- `buildHostPage()` — map, player list, turn order, action log, controls
- `buildPlayerPage()` — stats, mini map, ability buttons, move buttons
- Helper functions for map rendering, player list, turn order, etc.

**What needs improvement**:

1. Target selection buttons (ability → target two-step or inline)
2. Better styling (the current version is functional but plain)
3. Status effect display (icons/colors for different statuses)
4. Action type indicators on buttons (Standard vs Swift vs Free)
5. Cooldown/uses-remaining display on ability buttons
6. Range indicator in the mini map (show which tiles are in range)
7. Reaction prompts (when a reaction is available, show reaction buttons)
8. Game setup phase pages (before the game starts — signup, mode voting, etc.)

---

## How to Test

Since PS HTML can't be previewed outside the bot, test by:

1. Running the bot: `npm run dev` (after `npm install`)
2. Having the bot join the `battledome` room
3. Creating a game and observing the HTML output
4. Checking browser DevTools in the PS client for rendering issues

You can also log the HTML to console for debugging:

```typescript
console.log("Host HTML length:", hostHtml.length);
console.log("Player HTML length:", playerHtml.length);
```

---

## Key Files Reference

| File                   | Purpose                                         |
| ---------------------- | ----------------------------------------------- |
| `src/html/pages.ts`    | **YOUR FILE** — HTML page generators            |
| `src/game/state.ts`    | Game state types and engine                     |
| `src/commands/game.ts` | Command handlers that call broadcastPages()     |
| `src/utils.ts`         | Helpers: toId, send, sendPm, posToStr, rollDice |
| `src/data/index.ts`    | Game data: classes, weapons, abilities          |

---

## Summary

Your task is to make `src/html/pages.ts` produce beautiful, functional HTML pages
that work within PS's constraints. The host page is a dashboard. The player page
is an interactive action selector with context-dependent buttons.

Focus on:

1. **Clarity** — players need to quickly understand their options
2. **Correctness** — buttons must send the right commands
3. **Compactness** — PS truncates large HTML, keep it under ~8KB
4. **Style** — make it look like a game UI, not raw HTML
