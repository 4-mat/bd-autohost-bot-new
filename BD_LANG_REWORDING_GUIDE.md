# BD Lang Rewording Guide — Converting Abilities for the Bot

A practical step-by-step guide for taking any ability from the Battle Dome homepage and writing it in BD Lang format.

---

## 1. The Template

Every ability follows this skeleton:

```
[Name] (Level N)
Frequency: ...
Miss Rate: ...
Damage: ...
Action: ...
Target: ...
Range: ...
Effect: ...
```

**Always fill all 7 fields.** If a field is absent in the source, write "None" or "—".

---

## 2. Field-by-Field Rules

### 2.1 Name and Level

Take the name from the first column and the level from the second column.

| Source                                   | Result                               |
| ---------------------------------------- | ------------------------------------ |
| `Bloodrush \| 1.0 \| ...`                | `Bloodrush (Level 1)`                |
| `Immortal Coil \| EX1 \| ...`            | `Immortal Coil (Level EX1)`          |
| `Right to Rule \| 1.0 \| Passive \| ...` | `Right to Rule (Level 1)` — see §2.2 |

Levels from the source are: `1.0`, `2.0`, ... `10.0`, `EX1`, `EX2`. Drop the `.0`.

### 2.2 Frequency

Third column in the source table. Map to English:

| Source        | Write                      |
| ------------- | -------------------------- |
| `Every Turn`  | `Every Turn`               |
| `EoT`         | `Every Other Turn`         |
| `E3T`         | `Every Third Turn`         |
| `Twice`       | `Twice`                    |
| `Once`        | `Once`                     |
| `Thrice`      | `Thrice`                   |
| `Twice/EoT`   | `Twice, Every Other Turn`  |
| `Twice/E3T`   | `Twice, Every Third Turn`  |
| `Thrice/EoT`  | `Thrice, Every Other Turn` |
| `Passive`     | `Passive`                  |
| `Twice / E3T` | `Twice, Every Third Turn`  |
| `Twice/E3T`   | `Twice, Every Third Turn`  |

### 2.3 Miss Rate

Fourth column. Three possibilities:

- If it's a number: `Miss Rate: <number>.`
- If it's `-`: `Miss Rate: None.`
- If the ability is Passive: `Miss Rate: —`

### 2.4 Damage

Fifth and sixth columns (roll + type). Map to:

```
Damage: <XdY+Z> <Type>.
```

Where type is `Physical`, `Magical`, or `None`.

- If roll is `-`: `Damage: None.`
- If type varies: `Damage: <XdY+Z> <Physical or Magical>.`
- Special rolls: `XdY-Z` works too, e.g. `1d4-2`
- Double Hit: `Damage: 2d4-1 Physical (Double Hit).`

### 2.5 Action

Seventh column (`Action`). Map:

| Source                 | Write                  |
| ---------------------- | ---------------------- |
| `Standard`             | `Standard`             |
| `Movement`             | `Movement`             |
| `Full`                 | `Full`                 |
| `Swift`                | `Swift`                |
| `Free`                 | `Free`                 |
| `Trigger`              | `Trigger`              |
| `Reaction`             | `Reaction`             |
| `Movement or Swift`    | `Movement or Swift`    |
| `Standard or Swift`    | `Standard or Swift`    |
| `Standard or Movement` | `Standard or Movement` |
| `Standard or Reaction` | `Standard or Reaction` |
| `Standard or Full`     | `Standard or Full`     |
| `Swift or Standard`    | `Swift or Standard`    |
| `Movement or Standard` | `Movement or Standard` |

### 2.6 Target

Eighth and ninth columns — `Amount` and `Group`.

**Amount:**

- Number like `1.0`, `2.0` → write as integer: `1`, `2`
- `AoE` → write `AoE`
- `Varies` → write `Varies`

**Group:**

- `Foe` / `Foes` → `Foe` / `Foes`
- `Ally` / `Allies` → `Ally` / `Allies`
- `Self` → `Self`
- `Tile` → `Tile`
- `Any` → `Any`
- `Self and Allies` → `Self and Allies`
- `Self or Ally` → `Self or Ally`
- `Self or Foe` → `Self or Foe`

Combine: `<Amount> <Group>`.

| Source (Amount + Group) | Write                 |
| ----------------------- | --------------------- |
| `1.0 / Foe`             | `1 Foe`               |
| `AoE / Foes`            | `AoE Foes`            |
| `2.0 / Foes`            | `2 Foes`              |
| `1.0 / Ally`            | `1 Ally`              |
| `0.0 / Foes`            | `0 Foes`              |
| `AoE / Self and Allies` | `AoE Self and Allies` |
| `Varies / Foe(s)`       | `Varies Foe(s)`       |

### 2.7 Range

Tenth column. Map:

| Source                      | Write                     |
| --------------------------- | ------------------------- |
| `Melee`                     | `Melee`                   |
| `Range 3`                   | `Range 3`                 |
| `Homing 6`                  | `Homing 6`                |
| `Line 6`                    | `Line 6`                  |
| `Global`                    | `Global`                  |
| `Burst 1`                   | `Burst 1`                 |
| `Burst 2`                   | `Burst 2`                 |
| `Star 2`                    | `Star 2`                  |
| `Star 3`                    | `Star 3`                  |
| `Pierce 4`                  | `Pierce 4`                |
| `Beam 2`                    | `Beam 2`                  |
| `Cone 1`                    | `Cone 1`                  |
| `Cone 2`                    | `Cone 2`                  |
| `Cone 3`                    | `Cone 3`                  |
| `Line 6 / (Pull 3)`         | `Line 6 (Pull 3)`         |
| `Range 4 / (Splash 1)`      | `Range 4 (Splash 1)`      |
| `Range 5 / (Splash Star 2)` | `Range 5 (Splash Star 2)` |
| `Homing 4`                  | `Homing 4`                |
| `Varies`                    | `Varies`                  |

For AoE ranges, the range field in the source is the AoE shape. Write it directly.

### 2.8 Effect

Eleventh column — the effect text. This is the hardest part. Follow these rules:

#### Rule A: Extract inline conditions

Many effects are embedded in the range or action column. Look for parentheses in the range column:

```
Range: Line 6 (Pull 3)
```

→ Move `(Pull 3)` into the effect or append to range as `Line 6, Pull 3`.

#### Rule B: Separate multiple effects with commas or "and"

```
Gain +5 damage, +1 MP for 1 round, and inflict Slow for 1 round.
```

#### Rule C: Use standard effect phrasing

| Source        | Write                             |
| ------------- | --------------------------------- |
| `+5 DMG/1`    | `Buff: +5 damage for 1 round.`    |
| `-4 DEF/1`    | `Debuff: -4 DEF for 1 round.`     |
| `5 Bleed/2`   | `Inflict Bleed 5 for 2 rounds.`   |
| `6 Curse/1`   | `Inflict Curse 6 for 1 round.`    |
| `Slow/1`      | `Inflict Slow for 1 round.`       |
| `Root/1`      | `Inflict Root for 1 round.`       |
| `Stun/1`      | `Inflict Stun for 1 round.`       |
| `Confusion/2` | `Inflict Confusion for 2 rounds.` |
| `Seal/1`      | `Inflict Seal for 1 round.`       |
| `Cripple 6/1` | `Inflict Cripple 6 for 1 round.`  |
| `Poison/2`    | `Inflict Poison for 2 rounds.`    |
| `(Push 2)`    | `Push 2.`                         |
| `(Pull 3)`    | `Pull 3.`                         |
| `(Splash 1)`  | `Splash 1.`                       |
| `(Teleport)`  | `Teleport.`                       |
| `(Swap)`      | `Swap positions.`                 |
| `Shield/1`    | `Shield for 1 round.`             |

#### Rule D: Resource changes

| Source         | Write                         |
| -------------- | ----------------------------- |
| `gain 2 Rage`  | `Gain 2 Rage.`                |
| `spend 3 Rage` | `Spend 3 Rage.`               |
| `Costs 3 Mana` | `Spend 3 Mana (only on hit).` |
| `+2 Blood`     | `Gain 2 Blood.`               |
| `lose 2 Blood` | `Lose 2 Blood.`               |

#### Rule E: Dice modifiers

| Source          | Write                         |
| --------------- | ----------------------------- |
| `+1 dice`       | `Gain +1 dice.`               |
| `+2 dice faces` | `Gain +2 dice faces.`         |
| `Advantage`     | `Advantage damage dice.`      |
| `Disadvantage`  | `Disadvantage damage dice.`   |
| `Bomb dice`     | `Bomb dice.`                  |
| `Inverse Bomb`  | `Inverse Bomb dice.`          |
| `+2 CR`         | `Gain +2 Critical Threshold.` |
| `CR/1`          | `Critical Threshold 1.`       |

#### Rule F: Conditional effects

```
If target is at maximum range: +5 damage and +1 MP for 1 round.
```

```
If user's Rage >= 4: This attack gains +2 dice and -2 Miss Rate.
```

```
Thirst 5: This move becomes Multi-Hit: 2.
```

```
On hit: Inflict Slow for 1 round.
On miss: Gain +1 MP for 1 round.
```

#### Rule G: Choices

```
Choose Push or Pull:
  - Push 2.
  - Pull 2.
```

#### Rule H: Multiple lines in source

If the effect spans multiple lines in the source table (continuation lines), join them into a single paragraph. Use the indentation to tell they're continuations.

---

## 3. Quick Reference Card

```
Field       Source Col    Map To
───────     ──────────    ──────
Name        Col 1         [Name] (Level N)
Frequency   Col 3         Every Turn / Every Other Turn / etc
Miss Rate   Col 4         Miss Rate: N / None / —
Damage      Col 5+6       Damage: XdY+Z [Physical|Magical]
Action      Col 7         Standard / Full / Swift / etc
Target      Col 8+9       N [Foe|Foes|Ally|Self|Tile]
Range       Col 10        Melee / Range N / Homing N / Burst N / etc
Effect      Col 11        See §2.8 above
```

---

## 4. Workflow

For each weapon/class:

1. Open the Homepage.txt section for that weapon.
2. Copy each ability row.
3. Fill in the template for each one. Use the fields in order — they're already in the right columns.
4. Write the Effect line last. This is where you need to reword.
5. For continuations (indented lines below the main row), fold them into the Effect.

---

## 5. Before and After

### Source (raw homepage row):

```
Bloodrush | 1.0 | Every Turn | 2.0 | 2d8+4 | Magical | Standard | 1.0 | Foe | Range 4 | This move has +5 DMG and +1 MP/1 at maximum range.
```

### After (BD Lang):

```
Bloodrush (Level 1)
Frequency: Every Turn.
Miss Rate: 2.
Damage: 2d8+4 Magical.
Action: Standard.
Target: 1 Foe.
Range: 4.
Effect: At maximum range, gain +5 damage and +1 MP for 1 round.
```

### Source with continuation:

```
Storm Strike | 2.0 | Every Turn | 3.0 | 2d10+6 | Physical | Standard | 1.0 | Foe | Range 5 / (Splash 1)
The user teleports to a chosen tile in the original target's Splash 1. Targets are Slowed/1.
```

### After:

```
Storm Strike (Level 2)
Frequency: Every Turn.
Miss Rate: 3.
Damage: 2d10+6 Physical.
Action: Standard.
Target: 1 Foe.
Range: 5 (Splash 1).
Effect: User teleports to a chosen tile in the original target's Splash. Inflict Slow for 1 round.
```

### Source with resource:

```
Whittle | 1.0 | Every Turn | - | - | - | Free | 1.0 | Tile | Homing 2 | The user sacrifices 10 HP to create a Totem tile on the target...
```

### After:

```
Whittle (Level 1)
Frequency: Every Turn.
Miss Rate: None.
Damage: None.
Action: Free.
Target: 1 Tile.
Range: Homing 2.
Effect: Sacrifice 10 HP to create a Totem tile on the target. Removes any existing Totem tile.
       Totems have Burst 1 range and can be Blood, Bone, or Soul type.
       Starts as Blood when placed. Totem tiles cannot be overwritten.
```

### Source with conditional and resource threshold:

```
Twin Fangs | 1.0 | Every Turn | 3.0 | 2d6+4 | Physical | Standard | 1.0 | Foe | Melee
Every time this move hits, the user loses 2 Blood.
Thirst 5: This move gains 3 MR and becomes Double Hit.
```

### After:

```
Twin Fangs (Level 1)
Frequency: Every Turn.
Miss Rate: 3.
Damage: 2d6+4 Physical.
Action: Standard.
Target: 1 Foe.
Range: Melee.
Effect: Lose 2 Blood on hit.
Thirst 5: Gain +3 Miss Rate and Multi-Hit: 2.
```

---

## 6. Review Checklist

Before marking an ability as done, check:

- [ ] All 7 fields filled (Name, Frequency, Miss Rate, Damage, Action, Target, Range)
- [ ] Miss Rate is `None` for automatic-hit moves, `—` for Passives
- [ ] Damage type matches source (`Physical`, `Magical`, `None`, or `Physical or Magical`)
- [ ] Action type matches source table (seventh column)
- [ ] Target count and group match (eighth and ninth columns)
- [ ] Range matches (tenth column, including AoE shapes and Splash)
- [ ] Inline parentheses from range moved into Effect or appended to range
- [ ] Status effects use `Inflict <type> <value> for <n> rounds` format
- [ ] Buffs/debuffs use `Buff: +/-<stat> <value> for <n> rounds`
- [ ] Resources use `Gain/Spend/Lose <N> <resource>`
- [ ] Conditions use `If ... :` or `Thirst N:` format
- [ ] Multiple effects separated by commas or "and"
- [ ] Continuation lines folded into Effect
