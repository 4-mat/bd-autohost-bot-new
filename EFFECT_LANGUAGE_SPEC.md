# Battle Dome 4.4 Effect Language Standard

All ability effects must use these patterns. The goal is one way to say each thing.

## 1. Status Application

```
inflict X [Status]/Y
```

- X = damage per tick, Status = Bleed/Burn/Curse/Poison, Y = duration in rounds
- Non-damaging statuses use 0 for X (or omit): `inflict Cripple X/Y`, `inflict Slow/Y`
- Statuses with variable amount: `inflict X Bleed/Y` where X is defined in the condition

**Examples:**

- `inflict 3 Bleed/1`
- `inflict 6 Curse/2`
- `inflict 13 Burn/1`
- `inflict Cripple 4/1`

## 2. Numeric Buffs/Debuffs

```
gain ±X [Stat]/Y       (self or ally buff)
inflict ±X [Stat]/Y    (foe debuff)
```

- Stats: ATK, MAG, PDEF, MDEF, DEF, ACC, CR, DMG, EVA, MP, Range
- Y = duration in rounds (omit if permanent this turn, use `this turn` for same-turn)

**Examples:**

- `gain +4 ATK/1`
- `gain +1 ACC/1`
- `inflict -2 DEF/1`
- `gain +1 MP/1`
- `gain +5 DMG/1`

## 3. Dice Modifiers

```
+X dice         add X damage dice to the roll
+X dice faces   add X to each die face
+X base dice    add X to base dice count (before crit doubling)
+X CR           add X to crit range (lower crit threshold)
+X ACC          add X to accuracy
```

**Examples:**

- `gain +1 dice`
- `gain +4 dice faces`
- `gain +2 base dice`

## 4. Push/Pull

```
Push X      move target X tiles away
Pull X      move target X tiles toward user
```

- Include in Range column as `(Push X)` or `(Pull X)` when the range is a line
- In effects column when conditional: `Push X` or `Pull X`

## 5. Teleport

```
Teleport to [target]
Swap with [target]
```

**Examples:**

- `Teleport to tile`
- `Swap with target`
- `Teleport to tile in target's Melee`

## 6. Delay

```
Delay-X
```

- X = number of turns delayed
- Used in roll column or effect text

## 7. Multi-Hit

```
[X hits]
```

- In Roll column as parenthetical: `(Double Hit)`, `(Triple Hit)`, `(Quad. Hit)`
- In effect text: `gain +1 hit`, `this attack has X hits`

## 8. Resource Costs/Gains

```
Spend X [Resource]. [Effect].
Gain X [Resource].
```

**Examples:**

- `Spend 2 Rage.`
- `Spend 3 Mana.`
- `Gain 1 Qi.`
- `Sacrifice 10 HP.`

## 9. Resource Scaling

```
[Effect] per X [Resource].
X = [definition]
```

**Examples:**

- `gain +2 ATK per Qi`
- `X = 2.5 * Rage`

## 10. Conditional Effects

```
If [condition], [effect].
```

- Always use `If`, not `On`, `When`, `Whenever` (except for Passives which use `When`)
- Multiple conditions: `If [A], [X]. If [B], [Y].`

## 11. Choice Abilities

Always use "Choose" (not "Select", "Pick", etc.).

```
Choose: [A], [B], or [C].
```

- Colon after "Choose", options separated by commas
- If options have sub-effects: `A: [effect]. B: [effect].`
- For choosing a target from options: `Choose one: A, B, or C.`
- The word "Choose" must always be a verb directing a user action, not a description.

## 12. AoE Ranges

Use standard range shapes in Range column:

- `Burst X`, `Star X`, `Cone X`, `Beam X`, `Pierce X`
- Splash in Range column: `(Splash X)` appended after main range
- If user picks: `Varies` with explanation in effect

## 13. Frequency Notation

Standard frequencies (Frequency column only):

- `Every Turn` — no cooldown
- `EoT` — every other turn
- `E3T` — every third turn
- `Once` / `Twice` / `Thrice` — per-game use limit
- Combine: `Twice/EoT`, `Once/E3T`, `Thrice/E3T`, `Twice/E3T`

## 14. Damage Roll Column

Standard format: `XdY+Z`

- With modifiers: `XdY+Z (Double Hit)`
- For self-damage/heals: `XdY+Z` (Type = empty or `-`)
- For variable X: `XdY+Z` where X is defined in effect

## 15. Self-Reference

Always use `the user` (not `you`, not the weapon name).

## 16. Ignore/Immunity patterns

```
Ignores [factor].
Immune to [factor].
```

**Examples:**

- `Ignores DEF.`
- `Ignores outside damage factors.`
- `Ignores ATK/MAG.`
- `Ignores half DEF.`

## 17. Reaction/Trigger Conditions

```
Reaction: When [trigger condition], [effect].
Trigger: [effect].
```

## 18. Per-Turn Limitations

```
Once per turn: [effect].
Max X: [effect].
```

## Examples of Normalized Effects

Before → After:

- "Targets are inflicted with 3 Curse/1." → `inflict 3 Curse/1`
- "The user gains +5 DMG and +1 MP/1." → `gain +5 DMG/1 and +1 MP/1`
- "If the target has a Mark, this move has Splash 1." → `If target has Mark, Splash 1.`
- "For one round, the target cannot be inflicted with debuffs." → `Cannot be inflicted with debuffs/1.`
- "The user may spend 2 Rage per effect to gain any combination:" → `Spend 2 Rage per effect. Choose: +4d10, Splash 2, or -3 MR.`
