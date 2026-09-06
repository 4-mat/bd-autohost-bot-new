# Data Shape Audit

Audit of every hot path / core data structure in the bot: what the shape is,
how many items it holds (cardinality), how often it's accessed (frequency),
and whether the structure is the right one. Verdicts: ✅ correct / ⚠️ watch /
❌ wrong (fix).

Method: for each structure, ask three mechanical questions —
1. **Cardinality**: how many items?
2. **Access pattern**: keyed lookup? scan? iterate-all? mutated?
3. **Frequency**: per-command? per-attack? per-hit? per-turn? at load?

The verdict follows from those facts, not taste.

---

## Game data (load-once, immutable after load)

| Structure | Shape | Cardinality | Access | Verdict |
| --- | --- | --- | --- | --- |
| `classes` / `weapons` (src/data/index.ts:70-71) | `Map<string, X>` keyed by `toId(name)` | ~dozens | keyed lookup, per-command | ✅ correct — O(1) keyed lookup is exactly right |
| `branches` / `WhatIs` / `Reference` | `Map<string, string[] \| string>` | small | keyed lookup | ✅ correct |
| `MAPS` (src/data/maps.ts:14) | `Map<string, MapDef>` keyed by id | ~100s | keyed lookup in `%setmap` / `%listmaps` | ✅ correct |
| `GAMEMODE_MAPS` (gamemodes.ts) | `Record<GameModeId, string[]>` | 5 modes × ~10 maps | iterate-all in `%listmaps` | ✅ correct — arrays are right for lists |
| **`AbilityData.effect`** | **string, parsed on demand** | — | **re-parsed 3-4x per attack** | ❌ **wrong → fixed** (see below) |

### The one wrong structure: `AbilityData.effect` as a re-parsed string

**Before (#200):** the parsed `Effect[]` tree was rebuilt from the immutable
effect string on every attack — `parseEffects` in `resolveAttackFlow`
(resolve.ts:274), again inside the per-hit `resolveSingleTarget`, again in
`resolveNonDamaging`, plus a full `extractCombatMetadata` tree walk each time,
plus ad-hoc regex passes (`parsePushPull`, `parseMultiHit`, heal detection).

**Fix (PR #201):** `parseEffects` and `getCombatMetadataForEffect` are now
memoised by effect text (the string is immutable at runtime, so the parse is a
pure function). Every call after the first is an O(1) `Map` lookup.

**Lesson:** the *stored* form of a structure must match how it's *consumed*.
The data was consumed as a tree but stored as a string. Cardinality was small
but **frequency was enormous** (per-hit) — the wrong shape costs on every
access even when it's cheap to produce.

---

## Combat hot path (per-attack / per-hit)

| Structure | Shape | Cardinality | Access | Verdict |
| --- | --- | --- | --- | --- |
| `game.entities` | `Entity[]` | ≤ 8 players | `find`/`filter` scans in targeting | ✅ correct — array scan at N=8 is optimal (a Map would be slower) |
| `game.entities.find(e => e.num === ...)` (state.ts:364, 370) | linear scan | ≤ 8 | per-target prompt | ✅ correct at this N |
| `entity.statuses` | `StatusEffect[]` | ≤ ~10 | `find(s => toId(s.name) === ...)` | ✅ correct at this N |
| `entity.buffs` | array | ≤ ~10 | iterate-all in stat calc | ✅ correct |
| `entity.cooldowns` / `usesUsed` | `Record<string, number>` | per-ability | keyed by ability name | ✅ correct — plain object = string-keyed Map; right call |
| `entity.resources` | `Record<string, number>` | ~11 resource types | keyed lookup | ✅ correct |
| `game.map` grid | `string[][]` / tiles | ≤ 60×60 | tile targeting iterates all | ⚠️ watch — only on tile abilities; fine for now |

### Targeting scans at N ≤ 8
`getTargetCandidates` / `findTargets` / `getAoETargets` filter the whole
entity array per attack. At 8 players this is the *correct* choice — a
spatial index or per-team Map would be slower and more complex. Revisit only
if entity count grows past ~20.

---

## Infrastructure (per-command / per-message)

| Structure | Shape | Cardinality | Access | Verdict |
| --- | --- | --- | --- | --- |
| `rooms` (rooms.ts:7) | `Map<string, Room>` | few | keyed by room id | ✅ correct |
| `users` (users.ts:8) | `Map<string, User>` | per-connection | keyed by username/id | ✅ correct |
| Parse caches (effects.ts) | `Map<string, Effect[]>` / `Map<string, CombatMetadata>` | distinct effect strings (~100s, bounded) | hot path | ✅ correct — bounded by data size, no leak |

---

## Standing review rule (adopt in code reviews)

For every new or changed data structure, reviewers must answer three
questions before approving:

1. **Cardinality** — how many items does this hold (worst case)?
2. **Access pattern** — keyed lookup, scan, or iterate-all? Mutated in place?
3. **Frequency** — how often is it touched per command / per attack / per hit?

The right structure follows mechanically:

- **N ≤ ~10, scan/iterate** → array (a Map is slower)
- **Keyed lookup, any N** → `Map` / `Record` keyed by the natural id
- **Immutable input, computed repeatedly** → **parse/derive once, cache** (this is the #200 class of bug)
- **Membership tests in a loop** → `Set`
- **Ordered iteration** → array, not `Map` (unless insertion order is the point)

A wrong structure only matters when frequency is high — but per-hit combat
code *is* high frequency, so the shape question belongs in every review of
`src/game/`.

---

## Open items

- [x] **#200 / #201** — `AbilityData.effect` parse-once + combat metadata cache (done)
- [ ] **#182** — `getPassiveRangeBonus` / `getDefenderDiceMods` re-parse on the `inRange` hot path (may already be covered by #201's cache; verify)
- [ ] Consider precomputing `parsePushPull` / `parseMultiHit` / heal detection onto the cached parse instead of ad-hoc regexes
