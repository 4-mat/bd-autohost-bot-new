# BD Lang v0.2 — English-Readable Battle Dome Notation

A plaintext notation and formal grammar for describing Battle Dome 4.4 abilities, effects, and mechanics in a way that reads like natural English while being machine-parseable.

---

## 1. Core Idea

BD Lang is standardized prose. Every game mechanic is described in plain English where one function is described by one term. Each term has exactly one meaning. There are no synonyms, no abbreviations in effect text, and no alternative wordings for the same function.

Every ability is described as a sequence of clauses. Each clause starts with a keyword and is followed by its arguments. Clauses can be joined with commas or "and". The result reads like English but follows strict rules.

---

## 2. The Ability Statement — Structure

```
[MOVE NAME] (Level N)
Frequency: ...
Miss Rate: ...
Damage: ...
Action: ...
Target: ...
Range: ...
Effect: ...
```

### Example — English-style

```
Bloodrush (Level 1)
Frequency: Every Turn.
Miss Rate: 2.
Damage: 2d8+4 Magical.
Action: Standard.
Target: 1 Foe.
Range: 4.
Effect: When used at maximum range, gain +5 damage and +1 MP for 1 round.
```

### Same ability — Compact form (for chaining)

```
Bloodrush [Level 1] Every Turn | MR 2 | 2d8+4 Magical | Standard | 1 Foe | Range 4 | At max range: +5 damage, +1 MP for 1 round.
```

---

## 3. Formal Grammar (EBNF)

```
(*=== Top Level ===*)

ability       = name_sig, newline,
                frequency_clause, newline,
                [mr_clause, newline],
                [damage_clause, newline],
                action_clause, newline,
                target_clause, newline,
                range_clause, newline,
                effect_clause ;

(* Compact single-line form *)
compact_ability = name_sig, "|", frequency, "|", [mr], "|", [damage_roll], "|",
                  action_type, "|", target_spec, "|", range_spec, "|", effect_text ;

name_sig       = ability_name, " (", "Level ", level, ")" ;
ability_name   = ? any text except newline or '[' ? ;
level          = number | "B" | "EX" , number ;

(*=== Frequency ===*)

frequency_clause = "Frequency:", " ", frequency ;
frequency      = "Every Turn"
               | "Every Other Turn"
               | "Every Third Turn"
               | "Once"
               | "Twice"
               | "Thrice"
               | "Twice, Every Other Turn"
               | "Twice, Every Third Turn"
               | "Thrice, Every Other Turn"
               | "Once (Permanent)"
               | "X per Game:", number
               | "Passive" ;

(*=== Miss Rate ===*)

mr_clause      = "Miss Rate:", " ", mr ;
mr             = number | "None" | "Automatic" ;

(*=== Damage ===*)

damage_clause = "Damage:", " ", damage_spec ;
damage_spec    = damage_roll, " ", damage_type ;
damage_roll    = dice_count, "d", dice_faces, [ "+", flat_bonus ]
               | "None" ;
dice_count     = number ;
dice_faces     = number ;
flat_bonus     = [ "+" | "-" ], number ;
damage_type    = "Physical" | "Magical" | "None" ;
dice_mod       = "with Advantage"
               | "with Disadvantage"
               | "with Bomb Dice"
               | "with Inverse Bomb Dice"
               | "with Critical Threshold", number
               | "Multi-Hit:", number ;

(*=== Action ===*)

action_clause  = "Action:", " ", action_type ;
action_type    = "Movement"
               | "Standard"
               | "Full"
               | "Swift"
               | "Free"
               | "Trigger"
               | "Reaction"
               | "Movement or Swift"
               | "Standard or Swift"
               | "Standard or Full"
               | "Standard or Movement" ;

(*=== Target ===*)

target_clause  = "Target:", " ", target_spec ;
target_spec    = target_count, " ", target_group
               | "AoE ", target_group ;
target_count   = number | "Self" | "All" ;
target_group   = "Any" | "Self" | "Ally" | "Allies" | "Foe" | "Foes" | "Tile" ;

(*=== Range ===*)

range_clause   = "Range:", " ", range_spec ;
range_spec     = single_range | aoe_range ;
single_range   = "Melee"
               | "Range ", number
               | "Homing ", number
               | "Line ", number
               | "Global" ;
aoe_range      = "Burst ", number
               | "Star ", number
               | "Pierce ", number
               | "Beam ", number
               | "Cone ", number
               | single_range, " with Splash Burst ", number
               | single_range, " with Splash Star ", number
               | single_range, " with Splash ", aoe_range_desc ;
aoe_range_desc = ? same as aoe_range but without nested Splash ? ;

(*=== Effect Clauses ===*)

effect_clause  = "Effect:", " ", effect_sequence ;
effect_sequence = effect, { ", ", effect }
                | effect, { " and ", effect } ;
effect         = stat_modifier
               | status_effect
               | displacement
               | resource_change
               | conditional_effect
               | special_effect
               | plain_english_text ;

(*--- Stat Modifiers ---*)

stat_modifier  = [ "Buff: " | "Debuff: " ],
                 ( "+" | "-" ), stat_name, number,
                 [ " for ", duration_spec ] ;
stat_name      = "HP" | "ATK" | "MAG" | "PD" | "MD" | "DEF"
               | "EVA" | "MP" | "ACC" | "CR" | "DMG" | "Range" ;

(*--- Status Effects ---*)

status_effect  = inflict_status | cleanse_status ;
inflict_status = "Inflict", " ", status_type,
                 [ " ", number ], " for ", duration_spec ;
status_type    = damaging_status | nondamaging_status ;
damaging_status = "Bleed" | "Burn" | "Curse" | "Poison" ;
nondamaging_status = "Confusion" | "Cripple" | "Root" | "Seal"
                   | "Slow" | "Stun" ;
cleanse_status = "Cleanse ", status_type, { " and ", status_type }
               | "Cleanse all statuses" ;

(*--- Duration ---*)

duration_spec  = number, " round" [ "s" ]
               | "until start of user's next turn"
               | "until end of target's next turn"
               | "until removed"
               | "permanent" ;
cooldown_spec  = "Cooldown: ", number, " rounds" ;

(*--- Displacement ---*)

displacement   = "Pull ", number
               | "Push ", number
               | "Teleport"
               | "Teleport to ", range_spec
               | "Swap positions"
               | "Move ", number
               | "Pull ", number, " toward user"
               | "Push ", number, " away from user" ;

(*--- Resource Changes ---*)

resource_change = ( "Gain" | "Spend" | "Lose" ), " ", number, " ",
                  resource_name,
                  [ "(", resource_threshold, ")" ] ;
resource_name  = "Rage" | "Qi" | "Mana" | "Blood" | "Resolve"
               | "Focus" | "Campaign" | "Coin" | "CP" | "Mark"
               | "Enrage" ;
resource_threshold = "requires ", number, " ", resource_name
                   | "active at ", number, "+" ;

(*--- Conditional Effects ---*)

conditional_effect = "If ", condition, ", ", effect_sequence,
                      [ " Otherwise, ", effect_sequence ] ;
condition      = range_condition
               | resource_condition
               | hit_condition
               | kill_condition
               | proximity_condition
               | state_condition ;
range_condition  = "at maximum range" | "at Range ", number, "+"
                  | "under Range ", number ;
resource_condition = resource_name, " >= ", number
                   | resource_name, " < ", number ;
hit_condition  = "on hit" | "on miss" | "on critical hit" ;
kill_condition = "if this kills the target" ;
proximity_condition = "target is in melee" | "target is ", number, "+ tiles away" ;
state_condition = "if ", target_group, " has ", status_type
                | "if ", target_group, " has buff"
                | "if ", target_group, " has debuff" ;

(*--- Special Effects ---*)

special_effect = "Delay ", number, " rounds"
               | "Shield ", number, " for ", duration_spec
               | "Recoil ", number, "%"
               | "Unremovable"
               | "Ignore Defense"
               | "Ignore Outside Factors"
               | "Immune to ", effect_immunity_list
               | "Apex: ", effect_sequence
               | "Thirst ", number, ": ", effect_sequence
               | "Phase: ", phase_name
               | "Channel: ", stat_modifier
               | "Choose: ", choice_list ;
effect_immunity_list = effect_name, { " and ", effect_name } ;
phase_name     = "New Moon" | "Waxing" | "Full Moon" | "Waning" ;
choice_list    = choice_option, { " or ", choice_option } ;
choice_option  = plain_english_text ;

(*--- Fallback ---*)

plain_english_text = ? any text that cannot be parsed by grammar above ? ;

(*=== Support: Numbers ===*)

number         = digit, { digit } ;
digit          = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;

(*=== Whitespace ===*)

newline        = ? line break ? ;
whitespace     = ? space or tab ? ;
```

---

## 4. Effect Clause Reference

### 4.1 Stat Modifiers

```
Buff: +ATK 3 for 1 round.
Debuff: -DEF 4 for 2 rounds.
Buff: +DMG 5 until start of user's next turn.
```

### 4.2 Status Effects (Damaging)

```
Inflict Bleed 5 for 1 round.
Inflict Burn 3 for 2 rounds.
Inflict Curse 4 for 1 round.
Inflict Poison 2 for 1 round.
```

Damaging statuses tick just before the affected entity's turn. They don't stack — new one overrides (or does nothing, unless the new one is Unremovable and old isn't).

### 4.3 Status Effects (Non-Damaging)

```
Inflict Confusion for 1 round.
    -> On accuracy 16+, the affected player takes self-damage equal to their higher of ATK or MAG.
Inflict Cripple 6 for 2 rounds.
    -> Lose 6 HP per tile willingly moved.
Inflict Root for 1 round.
    -> Cannot use Movement action.
Inflict Seal for 1 round.
    -> Can only use Basic abilities (except Attack of Opportunity).
Inflict Slow for 1 round.
    -> Movement halved (rounded up).
Inflict Stun for 1 round.
    -> Cannot use any action including Reactions.
```

### 4.4 Displacement

```
Pull 3 toward user.
Push 2 away from user.
Target is pushed 2 tiles.
User teleports to target tile.
User and target swap positions.
User moves up to their Movement Points.
User teleports to melee range of target.
```

### 4.5 Resource Effects

```
Gain 2 Rage.
Spend 3 Qi.
Lose 1 Campaign.
Gain 1 Focus.
Spend 2 Mana (only on hit).
Gain 5 Crimson Pact.
Target gains 1 Mark.
```

### 4.6 Threshold Effects

```
If Rage >= 2, gain +1 dice on this attack.
Thirst 5: This move becomes Double Hit.
When Rage is spent, each point gives +1 damage.
```

### 4.7 Conditionals

```
If at maximum range, inflict Slow for 1 round.
Otherwise, gain +1 MP for 1 round.

If target is below 25% HP, this attack automatically hits and kills.

If target has 3+ Marks, this move ignores outside damage factors.

On critical hit, the user gains Moonblast's effect.
```

### 4.8 Delay

```
Delay 1 round.
    -> Damage and effects are delayed 1 round, landing at start of user's turn.
    -> Damage is rolled when the move is used.

Delay 2 rounds.
    -> Can choose Delay 2 for an additional bonus.
```

### 4.9 Shield

```
Shield 10 for 1 round.
    -> Absorbs 10 damage instead of user's HP.
    -> While active, cannot be inflicted with non-damaging statuses.
```

### 4.10 Apex (Tomahawk mechanic)

```
Apex: This attack has Pull 3 and inflicts Slow for 1 round.
Apex: For each tile the target moves toward the user, increase by 1.
```

### 4.11 Choices

```
Choose one:
  - Push 2 tiles.
  - Inflict Bleed 6 for 1 round.
  - User gains Shield 5 for 1 round.

Choose War or Peace:
  War: Physical, +dice per Campaign.
  Peace: Magical, -MP and -ATK/MAG debuff on target.
```

---

## 5. Examples

### Example 1: Simple Attack

```
Arrow Flurry (Level 1)
Frequency: Every Turn.
Miss Rate: 3.
Damage: 2d8+7 Physical.
Action: Standard.
Target: 1 Foe.
Range: 6.
Effect: If target has a Mark, gains Splash Burst 1. If target has 3+ Marks, gains Splash Burst 2 instead.
```

### Example 2: AoE with Push

```
Cyclone Sweep (Level 1)
Frequency: Every Turn.
Miss Rate: 3.
Damage: 1d8+8 Physical.
Action: Standard.
Target: AoE Foes.
Range: Cone 1, Push 2.
Effect: Gain +1 dice for each target hit.
```

### Example 3: Resource Spender

```
Power Swing (Level 3)
Frequency: Every Other Turn.
Miss Rate: 6.
Damage: 3d10+6 Physical.
Action: Standard.
Target: 1 Foe.
Range: Melee.
Effect: Spend X Rage. This attack gains -X Miss Rate and +2X Critical Threshold.
```

### Example 4: Threshold (Thirst)

```
Twin Fangs (Level 1)
Frequency: Every Turn.
Miss Rate: 3.
Damage: 2d6+4 Physical.
Action: Standard.
Target: 1 Foe.
Range: Melee.
Effect: Lose 2 Blood on hit.
Thirst 5: This attack gains +3 Miss Rate and becomes Multi-Hit: 2.
```

### Example 5: Delay

```
Eventide (Level 2)
Frequency: Every Other Turn.
Miss Rate: 4.
Damage: 3d6+4 Magical.
Action: Standard.
Target: 1 Foe.
Range: 7.
Effect: Delay 1 round. Inflict Curse 3 for 1 round before Eventide lands.
May choose Delay 2 to increase Curse's defense reduction by 2.
```

### Example 6: Conditional with Choices

```
Hardwood Slam (Level 6)
Frequency: Every Other Turn.
Miss Rate: 3.
Damage: 2d8+4 Physical.
Action: Standard.
Target: 1 Foe.
Range: Melee.
Effect: Choose the status based on conditions:
  - If user's accuracy modifier is negative or target has increased EVA: Inflict Poison 5 for 2 rounds.
  - If target's accuracy caused them to hit an unintended attack: Inflict Confusion for 2 rounds.
  - If target has critically hit the user or allies: Inflict Bleed 6 for 2 rounds.
```

### Example 7: Complex Setup

```
Fractal Division (Level 4)
Frequency: Twice, Every Other Turn.
Action: Swift.
Target: Self.
Effect: This turn, the user's next single-target attack may target 2 Foes.
Targets must be within Range 4. Attack loses Splash.
```

### Example 8: Reaction

```
Deflect (Level 3)
Frequency: Every Other Turn.
Miss Rate: 2.
Damage: 1d6+3 (no damage type).
Action: Reaction.
Target: 1 Foe.
Range: Global.
Effect: May be used on a Foe attacking the user. Attack loses 10% of its damage.
User stores a Focus equal to the lost value.
If the attack moves the user, this has Pull 2 after the attack resolves.
Ignores non-Rapier outside factors.
```

---

## 6. Parsing Rules

### 6.1 Line Breaks

Each clause starts on a new line after its label. For compact form, clauses are separated by `|` with no line breaks.

### 6.2 Effect Composition

Multiple effects within a single Effect clause are separated by commas or "and":

```
Gain +3 damage, +1 ACC, and inflict Bleed 5 for 1 round.
```

### 6.3 Priority

- Specific parsed clauses override generic `plain_english_text`.
- If a clause matches a grammar rule, it MUST be parsed as that rule. Otherwise it falls through to plain English.
- `plain_english_text` is preserved verbatim for human reading.

### 6.4 Numbers

All numbers are integers or floats. Dice notation `XdY+Z` supports negative Z (e.g., `2d8-3`).

### 6.5 Duration Interpretation

Durations are based on the entity's turn cycle:

- "for 1 round" = until end of user's next turn (if applied on user's turn)
- "for 1 round" = until everyone's turn passes (if applied outside user's turn)
- Permanent effects last until game end unless removed.

---

## 7. Tile Notation

Tiles on a BD map are one-character codes in a grid:

```
. = Normal    A = Air       F = Forest   W = Water
S = Stop      B = Bone      K = Broken   I = Ice
L = Lava      K = Sticky    O = Boost    H = Hearth
```

Example map:

```
. . . . . . . .
. F F . . W W .
. F . . . . W .
. . . S . . . .
. . . . O . . .
```

---

## 8. Action Economy Reference

| Action   | Per Turn      | Notes                                            |
| -------- | ------------- | ------------------------------------------------ |
| Movement | 1 per turn    | Used before Standard (except Juggernaut)         |
| Standard | 1 per turn    | Turn ends when none remain                       |
| Full     | Replaces both | Uses Movement + Standard slot                    |
| Swift    | 1 per turn    | Cannot use with Free                             |
| Free     | Multiple      | Each Free once per turn, cannot use with Swift   |
| Trigger  | 1 per turn    | Can use with Free or Swift. Some have conditions |
| Reaction | 1 per action  | 30-second window. Cannot react to Reactions      |

---

## 9. Standard Action Resolution Steps

Every Standard or Full attack follows these eleven steps in order. No ability may skip steps, though steps may be empty. Effects are written in prose using the step's name as a natural language time marker.

**Declare.** The ability is declared by name. The action slot (Standard or Full) is consumed. The ability's frequency is decremented. No targets are chosen, no costs are paid, and no effects resolve yet.

**Cost.** All costs, selections, and sacrifices are resolved in this step. This includes spending resources (such as Rage, Mana, Qi, Blood, or Coins), sacrificing HP, choosing between options, or paying any other price the ability lists. If a cost cannot be paid, the ability ends here. No targets have been chosen yet, so costs are not contingent on targets.

**Target.** A target or targets are chosen and validated against the ability's range and targeting rules. If no valid target can be chosen, the ability ends here.

**Before Accuracy.** Effects listed in the ability that resolve before the accuracy roll take place here. This includes pre-accuracy buffs, debuffs, conditional dice modifications, or any effect the ability explicitly places before accuracy. If the ability says "before accuracy" or "before the accuracy roll," it resolves in this step.

**Accuracy.** The accuracy roll is made. A single d20 is rolled and compared to the ability's Miss Rate plus the target's EVA. If the roll is greater than or equal to this value, the attack hits. If the roll is less, the attack misses and skips to On Miss.

**Before Damage.** If the attack hits, effects that modify the damage roll before it is rolled take place here. This includes dice modifiers, advantage, disadvantage, bomb dice, and any effect that explicitly occurs before damage. If the ability says "before damage" or "before the damage roll," it resolves in this step.

**Damage.** The damage roll is made. The ability's listed dice (XdY+Z) are rolled, modified by any effects from Before Damage, and the damage type (Physical, Magical, Bomb, True, or Pure) is applied. The target's relevant defense (PD, MD, or equivalent) is subtracted. If the ability ignores defense or outside factors, those rules apply now.

**On Hit.** If the attack hit, all effects listed as triggering on a hit resolve now. This includes inflicting statuses, applying debuffs, displacing targets, gaining resources, healing, or any secondary effect the ability describes as occurring on hit. If the ability says "on hit" or does not specify a step, it resolves here.

**On Miss.** If the attack missed, all effects listed as triggering on a miss resolve now. If the ability has no miss effects, this step is empty.

**Regardless of Hit.** Effects that resolve regardless of whether the attack hit or missed take place here. If the ability says "regardless of hit or miss" or describes an effect that applies in either case, it resolves in this step.

**Resolved.** After all other steps have completed, the ability fully resolves. Cooldowns tick, buff and debuff durations decrement, resource caps are enforced, and death or faint checks are performed. Any effect that lasts until the start of the user's next turn begins its countdown here.

### Default Step

If an effect does not specify a step, it resolves on hit. The steps before accuracy are usually only written out when the ability has effects at those steps. For simple abilities, only the on-hit effects need to be stated.

### Timing Notes

Sacrifices (HP, resources) resolve at Cost unless the ability says otherwise. Choices resolve at Cost (the player decides before the roll). Delay damage resolves on hit with a delay of N rounds. Reactions have their own timing that interrupts the above flow. Thirst and threshold checks resolve at the step they modify.

### Examples

**Eventide (Level 2)** — Declare Eventide, consume Standard. Choose Delay 1 or Delay 2 at Cost. Roll accuracy against Miss Rate 4 plus target EVA. On hit, inflict 3 Curse for 1 round and delay the damage by 1 round. If Delay 2 was chosen, the Curse's defense reduction increases by 2. Resolve cooldown.

**Arrow Flurry (Level 1)** — Declare Arrow Flurry, consume Standard. On hit, if the target has three or more Marks, gain Splash Burst 2. If the target has one or more Marks, gain Splash Burst 1 instead. Roll accuracy against Miss Rate 3 plus target EVA. Roll 2d8+7 Physical damage on hit.

**Power Swing (Level 3)** — Declare Power Swing, consume Standard. At Cost, spend Rage to reduce Miss Rate and increase Critical Threshold. Roll accuracy. Before damage, apply Critical Threshold modifiers. Roll 3d10+6 Physical damage on hit. Resolve cooldown.

---

## 10. Status Stacking Rules

- **Damaging statuses do not stack.** New one overrides old. If new is Unremovable and old isn't, new wins. Otherwise, if a damaging status is already active, a new one cannot be applied.
- **Non-damaging statuses** reapply with new duration on reapplication.
- **Buffs/Debuffs** of the same stat do stack (additive) but each has its own duration.

---

## 11. Edge Cases & Clarifications

| Situation                      | Rule                                                            |
| ------------------------------ | --------------------------------------------------------------- |
| Melee targeting diagonally     | Can go through 2 obstructions if at least 1 is an entity        |
| Line through corner of 4 tiles | Corner is obstructed if 2+ adjacent tiles are obstructions      |
| Apex (Tomahawk)                | Applies at maximum listed range of the ability                  |
| Delay and user death           | Delay still lands (Orb: Future Sight guarantees it)             |
| Splash hit/miss                | Hits/misses all targets based on original target's accuracy     |
| Ice Clause                     | Effects (except "X", Multihit, Splash) don't apply to Ice tiles |
| Damage order with % and flat   | Flat modifiers occur BEFORE percentage modifiers                |

---

## 12. Full Ability Index by Type

### Single-Target Damage

Basic Attack, Bloodrush, Arrow Flurry, Cursed Bolts, Swift Shot, Crippling Shot, Sniper's Focus, Reap, Cursed Slice, Lunge, and most weapon Standards.

### AoE Damage

Cyclone Sweep, Wide Slash, Blood Whirl, Volley, Scatter Shot, Sagittarian Pride, Plague, Maelstrom, and Beam/Cone/Pierce attacks.

### Healing

First Aid, Faith, Pas de Deux (sort of), Mending Mantel, Bloom (conditional), Flower Crown, En Garde (Focus-to-heal).

### Resource Generators

Crimson Pact (CP), Attuned (Mana), Bloodthirst (Blood), Resolute Blade (Resolve), Allez+Deflect (Focus), Bloodlust (Rage), Right to Rule (Campaign), Scoundrel (Coin).

### Resource Spenders

Power Swing (Rage), Nirvana (Qi), Delirium (Resolve), Redoublement (Focus), Mana costs, Oblation (CP).

### Buffs

Rising Hope, Fantasia, En Pointe, Emboîté, Radiance, Vestments, Pavise, Black Magic, Conduit, Providence.

### Debuffs

Dissonance, Crippling Shot, Hex, War of Attrition, Dark Reflection, Gravity Crash (New Moon), Blade of Woe.

### Displacement

Push (Hammer, Tomahawk, Tonfa), Pull (Gladius, Athame, Tonfa), Teleport (Rifter, Cleric, Shillelagh), Swap (Heaven's Wind).

### Control/Denial

Smokescreen, Mantrap, Fog, Ward, Totem of Bone, Scourge, Quiver of Thunder.

### Reactions

Attack of Opportunity, Aegis, Figure 8, Deflect, Counter, Rewind, Allez, Defiance.

### Setup / Delayed

All Orb abilities (Augur, Eventide, Echo Burst, etc.), Spellweave, Memento Mori.

### Summons / Traps

Totems (Whittle, Animatus, Egregore), Silk Cocoon, Wormhole, Mantrap.

---

## 13. Converting Between Forms

### Compact -> Readable

```
Bloodrush | Every Turn | MR 2 | 2d8+4 Magical | Standard | 1 Foe | Range 4 | At max range: +5 damage and +1 MP for 1 round.
```

becomes:

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

### Readable -> Compact

```
Eventide (Level 2)
Frequency: Every Other Turn.
Miss Rate: 4.
Damage: 3d6+4 Magical.
Action: Standard.
Target: 1 Foe.
Range: 7.
Effect: Delay 1 round. Inflict Curse 3 for 1 round before landing. May choose Delay 2: inflict +2 Curse reduction.
```

becomes:

```
Eventide [Level 2] Every Other Turn | MR 4 | 3d6+4 Magical | Standard | 1 Foe | Range 7 | Delay 1 round, Curse 3 for 1 round before landing. If Delay 2: Curse +2.
```

---

## 14. Next Steps

- [ ] Build a parser from the EBNF grammar
- [ ] Implement an engine that evaluates BD Lang against game state
- [ ] Add formal definitions for all 30+ weapons and 8 classes in BD Lang
- [ ] Build a simulator for testing ability interactions
- [ ] Add PvE monster definitions
- [ ] Implement damage calculation with all modifiers (Advantage, DEF, outside factors)
- [ ] Add range/pathfinding evaluation (Range Rule, Homing, Line, AoE shapes)
