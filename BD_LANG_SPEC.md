# BD Lang v0.2 — English-Readable Battle Dome Notation

A plaintext notation and formal grammar for describing Battle Dome 4.4 abilities, effects, and mechanics in a way that reads like natural English while being machine-parseable.

---

## 1. Core Idea

Every ability is described as a sequence of **clauses**. Each clause starts with a keyword and is followed by its arguments. Clauses can be joined with commas or "and". The result reads like English but follows strict rules.

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

Every Standard/Full attack follows this sequence in order. Effects are written as `@<Step>: <effect>`. If no step is given, the default is `@OnHit`.

```
@Declare:       Ability is declared, action slot consumed.
@Cost:          Selection, choices, sacrifices, and cost payments.
                If costs cannot be paid, the attack stops here.
@Target:        Target selection and validation.
                If no valid target can be chosen, the attack stops.
@BeforeAcc:     Effects that resolve before the accuracy roll.
@Acc:           The accuracy roll itself (1d20 vs MR + EVA).
                On miss → skip to @OnMiss.
@BeforeDMG:     Effects that modify the damage roll before it's rolled.
@DMG:           The damage roll itself.
@OnHit:         Effects that trigger when the attack hits.
@OnMiss:        Effects that trigger when the attack misses.
@Always:        Effects that happen regardless of hit or miss.
@Resolved:      Cleanup / aftermath / endstep.
                Cooldown ticks, resource caps, buff expiration, death checks.
```

```
┌─────────────────────────────────────────────────────────┐
│ 1. @Declare                                             │
│    Ability name declared, action slot consumed           │
├─────────────────────────────────────────────────────────┤
│ 2. @Cost                                                │
│    Selection, choices, sacrifices, cost payments.        │
│    If costs cannot be paid, attack stops here.           │
├─────────────────────────────────────────────────────────┤
│ 3. @Target                                              │
│    Choose targets. If none valid, attack stops.          │
├─────────────────────────────────────────────────────────┤
│ 4. @BeforeAcc                                           │
│    Pre-accuracy effects, buffs/debuffs, stat changes     │
├─────────────────────────────────────────────────────────┤
│ 5. @Acc                                                 │
│    1d20 >= MR + target EVA → hit                         │
│    1d20 < MR + target EVA → miss                         │
│    ┌─ Hit ──────────────────┐  ┌─ Miss ───────────────┐ │
│    │ 6. @BeforeDMG          │  │ 9. @OnMiss            │ │
│    │    Dice modifiers,      │  │    Effects that       │ │
│    │    advantage, etc       │  │    trigger on miss    │ │
│    ├─────────────────────────┤  └──────────────────────┘ │
│    │ 7. @DMG                │                             │
│    │    Roll XdY+Z           │                             │
│    ├─────────────────────────┤                             │
│    │ 8. @OnHit              │                             │
│    │    Statuses, buffs,     │                             │
│    │    displacement, etc    │                             │
│    └─────────────────────────┘                             │
├─────────────────────────────────────────────────────────┤
│ 10. @Always (Regardless of Hit/Miss)                     │
│    Effects that happen either way                        │
├─────────────────────────────────────────────────────────┤
│ 11. @Resolved (Cleanup / Aftermath)                      │
│    Cooldown ticks, resource caps, buff expiration,        │
│    death/faint checks, effect cleanup                     │
└─────────────────────────────────────────────────────────┘
```

### Effect Clause Grammar — Updated

```
effect         = [ "@", timing_step, ":" ], effect_text ;
timing_step    = "Declare"
               | "Cost"
               | "Target"
               | "BeforeAcc"
               | "Acc"
               | "BeforeDMG"
               | "DMG"
               | "OnHit"
               | "OnMiss"
               | "Always"
               | "Resolved" ;
effect_text    = simple_effect | compound_effect | conditional_effect ;
compound_effect = "{", effect_sequence, "}"
               | effect_sequence ;
```

### Rewording Rules by Step

| Step         | What goes here                                           | Example                                                             |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `@Declare`   | Ability name, action type spent                          | `@Declare: Bloodrush declared as Standard action.`                  |
| `@Cost`      | Selection, choices, sacrifices, cost payments            | `@Cost: Spend 2 Mana. Choose Physical or Magical. Sacrifice 10 HP.` |
| `@Target`    | Target filters, validation                               | `@Target: 1 Foe within Range 4. Must be visible.`                   |
| `@BeforeAcc` | Pre-accuracy effects, stat changes                       | `@BeforeAcc: If target has Mark, gain +1 dice.`                     |
| `@Acc`       | Accuracy roll only                                       | `@Acc: 1d20 >= 2 + target EVA.`                                     |
| `@BeforeDMG` | Dice modifiers before rolling                            | `@BeforeDMG: +2 dice. Advantage dice.`                              |
| `@DMG`       | Damage roll                                              | `@DMG: 2d8+4 Magical.`                                              |
| `@OnHit`     | Statuses, displacement, buffs/debuffs, secondary effects | `@OnHit: Inflict Bleed 5 for 1 round. Push 2.`                      |
| `@OnMiss`    | Miss-only effects                                        | `@OnMiss: Gain 2 Rage.`                                             |
| `@Always`    | Effects regardless of hit/miss                           | `@Always: Lose 1 Campaign. Teleport to tile.`                       |
| `@Resolved`  | Cooldowns, resource caps, death checks                   | `@Resolved: Cap Rage at 20. Check death.`                           |

### Example — Full Timing Breakdown

```
Eventide (Level 2)
Frequency: Every Other Turn.
Miss Rate: 4.
Action: Standard.
Target: 1 Foe.
Range: 7.

@Declare: Declare Eventide. Action slot consumed.
@Target: Choose 1 Foe in Range 7.
@BeforeAcc: Choose Delay 1 or Delay 2. If Delay 2, +2 Curse reduction.
@Acc: 1d20 >= 4 + target EVA.
@OnHit:  Inflict Curse 3 for 1 round. Delay 1 round.
         If Delay 2: Curse's DEF reduction increased by 2.
@Always: —
@Cleanup: Reduce Eventide cooldown by 1 round.
```

### Example — Simple Attack

```
Arrow Flurry (Level 1)
Frequency: Every Turn.
Miss Rate: 3.
Damage: 2d8+7 Physical.
Action: Standard.
Target: 1 Foe.
Range: 6.

@Target:  1 Foe in Range 6.
@BeforeAcc: If target has 3+ Marks, gain Splash Burst 2.
            Else if target has 1+ Marks, gain Splash Burst 1.
@Acc: 1d20 >= 3 + target EVA.
@DMG: 2d8+7 Physical.
@OnHit: —
@OnMiss: —
@Always: —
@Cleanup: —
```

### Example — Resource Spender

```
Power Swing (Level 3)
Frequency: Every Other Turn.
Miss Rate: 6.
Damage: 3d10+6 Physical.
Action: Standard.
Target: 1 Foe.
Range: Melee.

@BeforeAcc: Spend X Rage. This attack gains -X Miss Rate and +2X Critical Threshold.
@Acc: 1d20 >= (6 - X) + target EVA.
@BeforeDMG: +2X Critical Threshold.
@DMG: 3d10+6 Physical.
@OnHit: —
@OnMiss: —
@Always: —
@Cleanup: Reduce cooldown by 1 round.
```

### Default Step

If an effect line has no `@Step:` prefix, it defaults to `@OnHit`. The earlier steps (`@Declare`, `@Target`, `@BeforeAcc`, `@Acc`, `@BeforeDMG`, `@DMG`) are usually only written out when the ability has effects at those steps. For simple abilities, you can omit them.

### Timing Notes

- **Sacrifices** (HP, resources) go in `@BeforeAcc` unless the ability says otherwise.
- **Choices** go in `@BeforeAcc` (the player decides before the roll).
- **Delay** damage goes in `@OnHit` with `Delay N rounds`.
- **Reactions** have their own timing that interrupts the above flow (see §Reactions).
- **Thirst/Threshold** checks happen at the step they modify — e.g., `Thirst 5: +3 MR` in `@BeforeAcc`.

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
