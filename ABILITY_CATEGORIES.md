# Ability Categories — Pattern Analysis

All 373 abilities grouped by mechanical action class, documenting verb inconsistencies.

## 1. Tile/Zone Placement (14 abilities)

| Verb      | Example                                                         |
| --------- | --------------------------------------------------------------- |
| `Create`  | Tinker's Dam: "Create Stone wall on target"                     |
| `Place`   | Mending Mantel: "Place Hearth tile"                             |
| `Place`   | Wormhole: "Place Wormhole on target tile"                       |
| `create`  | Whittle: "create Totem tile on target"                          |
| `place`   | Heredity: "place one on target's tile"                          |
| `Place`   | Terraform: "Place up to 3 Forest or 3 Water tiles"              |
| `place`   | Earth Render: "place Broken tile" (also uses `replace`)         |
| `place`   | Continental Crash: "place Broken tile in target's Melee"        |
| `Place`   | Windstorm: "Place 4 Air, 4 Sticky, or 1 Boost tile(s)"          |
| `Create`  | Silk Cocoon: "Create Silk Cocoon (Star tile)"                   |
| `Replace` | Cryosphere: "Replace up to 3 Water/Stop/Stone tiles with Ice/2" |

**Inconsistencies:**

- `Create` vs `Place` for same action
- `on target` vs `on target tile` vs `on target's tile` vs `in target's Melee`
- Duration: `Removed after 2 rounds` / `Expires on use or after 2 rounds` / `Removed when user dies` / `/2` (slash notation) / unstated

---

## 2. Displacement (57 abilities)

### Push (25 abilities)

| Pattern                       | Count | Example                                     |
| ----------------------------- | ----- | ------------------------------------------- |
| `Push N`                      | most  | `Push 3`, `Push 1`                          |
| `push back N`                 | 1     | Disengage: "push back 1"                    |
| `+N Push`                     | 2     | Two Handed: "+2 Push"                       |
| `Push targets in [direction]` | 2     | Windstorm: "Push targets in cone direction" |

### Pull (11 abilities)

| Pattern                 | Example                                        |
| ----------------------- | ---------------------------------------------- |
| `Pull N`                | `Pull 3`, `Pull 7`                             |
| `Pull target towards X` | Void's Call: "Pull targets towards Totem tile" |

### Teleport (5 abilities)

| Pattern                            | Example              |
| ---------------------------------- | -------------------- |
| `Teleport to tile in X`            | Warp, Storm Strike   |
| `Teleport to unoccupied tile in X` | Pole Vault, Defiance |

### Swap (2 abilities)

| Pattern           | Example       |
| ----------------- | ------------- |
| `Swap targets`    | Heaven's Wind |
| `Swap subweapons` | Triumvirate   |

**Inconsistencies:**

- Push values: some `Push N`, some `+N Push`, some `push back N` (lowercase verb)
- Range-based Push: `Push 1d6` (dice roll vs fixed)
- Teleport target phrasing: `to tile in X` vs `to unoccupied tile in X`
- Swap target phrasing varies wildly

---

## 3. Status Application (68 abilities)

### Application Verbs

| Verb pattern           | Count | Example                                  |
| ---------------------- | ----- | ---------------------------------------- |
| `inflict X [Status]/Y` | most  | `inflict 3 Bleed/1`, `inflict -5 DEF/1`  |
| `inflict [Status]/Y`   | some  | `inflict Slow/1`, `inflict Confusion/1`  |
| `[Status]/1` (bare)    | few   | `Slow/1`, `Cripple/1` (in range columns) |

### Duration Notation

| Pattern            | Example                                  |
| ------------------ | ---------------------------------------- |
| `/1`, `/2` (slash) | `inflict 3 Bleed/1`                      |
| `for 1 round`      | "Confusion for 1 round"                  |
| `permanent`        | Judgment: "inflict Evil Eye permanently" |

**Inconsistencies:**

- `inflict X/Y` vs `inflict X for Y rounds` vs bare `X/Y`
- Non-damaging statuses: `inflict Slow/1` vs `Slow/1`
- Stacking unclear: some say "does not stack", some reapply, some say nothing

---

## 4. Stat Modifiers (77 abilities)

| Pattern                       | Example                                |
| ----------------------------- | -------------------------------------- |
| `gain +X [STAT]/Y`            | `gain +4 MAG/1`, `gain +1 MP/2`        |
| `gain +X [STAT] for Y rounds` | `gain +3 DEF for 1 round`              |
| `inflict -X [STAT]/Y`         | `inflict -2 DEF/1`, `inflict -5 DEF/1` |
| `+X [STAT]/Y` (bare)          | `+5 DMG/1`, `+1 ACC/1`                 |

**Inconsistencies:**

- `gain +X/Y` vs `+X/Y` vs `gain +X for Y rounds`
- `inflict -X` for debuffs (same verb as statuses — ambiguous: is it a stat debuff or a status?)
- `/Y` (round count) vs `for Y rounds` vs `until next turn`

---

## 5. Resource Verbs (87 abilities)

| Verb        | Count | Example                             |
| ----------- | ----- | ----------------------------------- |
| `Spend`     | most  | `Spend 2 Rage`, `Spend 3 Mana`      |
| `Gain`      | many  | `gain 1 Qi`, `gain 1 Rage`          |
| `Lose`      | some  | `lose 2 Blood`, `Lose 1 Campaign`   |
| `Sacrifice` | few   | `sacrifice 10 HP`, `sacrifice 5 HP` |

**Inconsistencies:**

- `Spend` vs lowercase `spend` (inconsistent capitalization mid-sentence)
- `Gain` vs `gain` (same issue)
- `Sacrifice` vs `sacrifice` (sometimes capitalized, sometimes not)
- Some use `Spend X [Resource]` as standalone, others embed it: `Spend 2 Rage per effect`

---

## 6. Conditional Patterns

| Prefix           | Count | Usage                                           |
| ---------------- | ----- | ----------------------------------------------- |
| `If`             | 82    | State checks: "If target has Mark"              |
| `When`           | 22    | Event triggers: "When Crossbow attack resolves" |
| `Reaction: When` | 17    | Reaction triggers                               |
| `Choose:`        | 4     | Choice effects                                  |
| `On`             | 3     | Hit/miss triggers                               |

**Inconsistencies:**

- `If` vs `When` used interchangeably for similar triggers
- `Reaction: When X` vs bare `Reaction: X`
- `On hit` vs `OnHit` vs embedded in other text

---

## 7. Duration/Timing Notation

Multiple competing schemes:

| Scheme            | Example                         | Used in                           |
| ----------------- | ------------------------------- | --------------------------------- |
| `/Y`              | `+1 ACC/1`, `inflict 3 Bleed/1` | EFFECT_LANGUAGE_SPEC.md           |
| `for Y rounds`    | `for 1 round`, `for 2 rounds`   | BD_LANG_SPEC.md, many raw effects |
| `this turn`       | for same-turn effects           | many                              |
| `until next turn` | ongoing buffs                   | many                              |
| `permanent`       | permanent effects               | few                               |
| `until removed`   | spawns/tiles                    | few                               |
| `Delay-Y`         | Delay notation                  | Clairvoyant weapons               |

---

## 8. Other Notable Groups

- **Reactions** (22): All start with "Reaction: When" but some omit "When"
- **Multi-hit** (10): `(Double Hit)`, `(Triple Hit)`, `+1 hit`, `gains +1 hit`
- **Choice** (43): Mostly `Choose:` but also `May choose` and freeform
- **Ignore/Immunity** (diffuse): `Ignores DEF`, `Ignores ATK/MAG`, `Immune to`, `cannot be prevented`
- **Healing** (33): `Heal X` vs `heal X HP` vs `gain X HP`
- **Dice modifiers** (70): `+1 dice`, `+1 base dice`, `+X dice faces`, `Bomb dice`, `Inverse Bomb dice`

---

## Summary of Standardization Needed

| Category     | Current verb variants                         | Proposed                                             |
| ------------ | --------------------------------------------- | ---------------------------------------------------- |
| Tile place   | Create, Place, Replace                        | **Place**                                            |
| Displacement | Push, pull, Push targets, push back           | **Push N**                                           |
| Teleport     | Teleport to tile, Teleport to unoccupied tile | **Teleport to [target]**                             |
| Status apply | inflict, bare, "for 1 round"                  | **inflict X [Status]/Y**                             |
| Buff/debuff  | gain +X/Y, +X/Y, gain +X for Y rounds         | **gain +X [STAT]/Y**                                 |
| Resources    | Spend, Gain, Lose, Sacrifice                  | **Spend/Gain/Lose/Sacrifice N [Resource]**           |
| Conditionals | If, When, On, Reaction: When                  | **If** (state), **When** (event), **Reaction: When** |
| Duration     | /Y, for Y rounds, this turn                   | **/Y**                                               |
| Multi-hit    | (Double Hit), +1 hit, gains +1 hit            | **(Double Hit)**                                     |
