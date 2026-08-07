# BD Lang v1.0 — Strict Prose-First Ability Language: Design Specification

Result of the complete-coverage design pass over the full Battle Dome corpus
(`_data/*.json`, 373 abilities), `_original_source/`, `move_sort_csv/` grids,
`EFFECT_SORT.md`, the draft specs, and the `src/game/effects.ts` executor.
Review context: PR #94, review-bdlang2 (Greptile review ID `b0638d02-62c0-419e-8602-9fb28f80debf`).

## 0. Design stance

Battle Dome abilities in the corpus are already prose. The three current specs pull in
three directions: slash notation, free prose, and a `plain_english_text` fallback that
swallows anything. BD Lang v1.0 collapses them into **one canonical dialect**:

1. **No fallback.** Any sentence that does not match a template is a parse error with
   `line:column`. The executor's `UnknownEffect` type is removed.
2. **Prose-first, template-fixed.** Every effect sentence is
   `[Timing] [Subject] Verb Arguments [for Duration] [if Condition] .` — one way to say each thing.
3. **Bounded vocabulary.** Every keyword is reserved, case-insensitive, and lives in one of:
   verbs, statuses, stats, resources, tile types, range shapes, action words, frequencies,
   conditions. Names outside the reserved vocabulary (abilities, subweapons, player-defined
   entities) must be quoted: `"Rising Hope"`.
4. **Grid-driven.** Each `move_sort_csv` category maps to exactly one canonical template.
   Several categories share a template through a mode slot (verb, target, mode).
5. **Executor-aware.** Each template is flagged `HANDLED` (parsed today in `src/game/effects.ts`),
   `PARTIAL` (parsed with gaps), or `NEW` (new executor support needed).

## 1. Sentence model

```
ability   = header + 7 fields (Frequency, Miss Rate, Damage, Action, Target, Range, Effect)
effect    = statement { "." statement }      -- statements may also join with "," or "and"
statement = [Timing] [Subject] Verb Arguments [Duration] [condition] "."
          | reaction | passive | conditional | thirst | apex | choose | binding
Timing    = Before Accuracy | Before Damage | On Hit | On Miss | Regardless of Hit
          | After Damage | After Push | After this ability lands
Subject   = "the user" | "the target" | "the user's <noun>"     (default: the user acts on the target)
Duration  = "/N" | "for N round[s]" | "this turn" | "until next turn" | "until user dies" | "permanent"
```

The 11-step resolution flow is the timing vocabulary: an effect with no Timing resolves
**on hit** (its default step).

## 2. EBNF grammar

```
(*==================== TOKENS ====================*)
letter        = "A".."Z" | "a".."z" ;
digit         = "0".."9" ;
number        = digit, { digit } ;
decimal       = number, [ ".", number ] ;
dice_roll     = ( number | "X" ), "d", number, [ ( "+" | "-" ), number ] ;
word          = letter, { letter | digit } ;
esc           = "\", ( '"' | "'" | "\" | "n" | "t" ) ;
quoted_string = '"', { char - ('"' | "\") | esc }, '"'
              | "'", { char - ("'" | "\") | esc }, "'" ;
name          = word | quoted_string ;
ws            = ? space or tab ? ;
(* Keywords are reserved and matched case-insensitively. An unreserved word in a
   slot that requires a name is a parse error; such words must be quoted. *)

(*==================== ABILITY ====================*)
ability         = header, ( field_form | compact_form ) ;
header          = name, "(", "Level", level, ")" ;
level           = number | ( "EX", number ) ;

field_form      = "Frequency:", ws, frequency, ".",
                  [ "Miss Rate:", ws, miss_rate, "." ],
                  [ "Damage:", ws, damage_spec, "." ],
                  "Action:", ws, action, ".",
                  "Target:", ws, target, ".",
                  "Range:", ws, range, ".",
                  "Effect:", ws, effect, "." ;

compact_form    = name, "[Level", level, "]", "|", frequency, "|",
                  [ miss_rate ], "|", [ damage_spec ], "|", action, "|",
                  target, "|", range, "|", effect, "." ;

frequency       = "Every Turn" | "Every Other Turn" | "Every Third Turn"
                | "Once" | "Twice" | "Thrice" | "Passive"
                | "Twice, Every Other Turn" | "Twice, Every Third Turn"
                | "Thrice, Every Other Turn" | "Thrice, Every Third Turn" ;
miss_rate       = number | "None" | "Automatic" | "-" ;
damage_spec     = dice_roll, [ ws, damage_type ] | "None" ;
damage_type     = "Physical" | "Magical" | "Bomb" | "True" | "Pure"
                | "Physical or Magical" ;
action          = action_word, { "or", action_word } ;
action_word     = "Standard" | "Movement" | "Full" | "Swift" | "Free"
                | "Trigger" | "Reaction" ;
target          = ( number | "AoE" | "Varies" ), ws, target_group ;
target_group    = "Any" | "Self" | "Tile" | "Foe" | "Foes" | "Foe(s)"
                | "Ally" | "Allies" | "Foe or Ally" | "Ally or Foe"
                | "Self and Allies" | "Self or Ally" | "Self or Foe" ;
range           = range_primary, { range_modifier } ;
range_primary   = "Melee" | "Global" | "Varies"
                | "Range", ws, number | "Homing", ws, number
                | "Line", ws, number | "Burst", ws, number
                | "Star", ws, number | "Cone", ws, number
                | "Pierce", ws, number | "Beam", ws, number ;
range_modifier  = "(", ( "Splash", [ shape, ws ], [ number ] ), ")"
                | "(", ( "Push" | "Pull" ), ws, number, ")"
                | "(", "Teleport", ")" | "(", "Swap", ")" ;
shape           = "Star" | "Burst" | "Cone" | "Beam" | "Pierce" | "Line" ;

(*==================== EFFECT ====================*)
effect          = statement, { ( ws, ( "." | "," | "and" ), ws ), statement } ;
statement       = [ step_tag ], ( effect_clause | binding_clause )
                | reaction_statement | passive_statement
                | conditional_statement | thirst_statement
                | apex_statement | choose_statement ;
step_tag        = ( "Before Accuracy" | "Before Damage" | "On Hit" | "On Miss"
                  | "Regardless of Hit" | "After Damage" | "After Push"
                  | "After this ability lands" ), ws, [ ":" | "," ], ws ;
subject         = "the user" | "the target" ;
duration        = ( "/", ( number | "X" ) )
                | ( "for", ws, ( number | "X" ), ws, ( "round" | "rounds" ) )
                | "this turn" | "until next turn" | "until user dies"
                | "permanent" ;

(*--- Vocabulary: nouns and verbs ---*)
status_name     = "Bleed" | "Burn" | "Curse" | "Poison" | "Cripple"
                | "Slow" | "Confusion" | "Stun" | "Root" | "Seal" ;
stat_name       = "ATK" | "MAG" | "PD" | "MD" | "DEF" | "PDEF" | "MDEF"
                | "EVA" | "MP" | "ACC" | "CR" | "DMG" | "Range" ;
resource_name   = "HP" | "Rage" | "Qi" | "Mana" | "Blood" | "Resolve"
                | "Focus" | "Campaign" | "Coin" | "CP" | "Mark"
                | "Enrage" | "Phase" | "Dice" ;
tile_type       = "Normal" | "Air" | "Forest" | "Water" | "Stop" | "Bone"
                | "Broken" | "Ice" | "Lava" | "Sticky" | "Boost"
                | "Hearth" | "Stone" | "Totem" | "Bomb" ;
sign            = "+" | "-" ;
amount_expr     = number | "X" | ( number, "X" ) ;
actor_ref       = "the user" | "the target" | ( "the user's", ws, name ) ;

(*--- T01  Status inflict  (dmg_status, nondmg_status) ---*)
status_clause   = "inflict", ws, [ amount_expr, ws ], status_name,
                  [ ws, duration ] ;

(*--- T02  Buff  (buff) ---*)
buff_clause     = "gain", ws, stat_mod ;
(*--- T03  Debuff  (debuff) ---*)
debuff_clause   = "inflict", ws, stat_mod ;
stat_mod        = sign, number, [ "%" ], ws, stat_name, [ ws, duration ] ;
(* bare stat mods are valid statements: "+5 DMG/1" *)

(*--- T04  Damage Modifier  (dmg_mod) ---*)
dmg_mod_clause  = "gain", ws, sign, number, "%", ( "damage" | "healing" ) ;

(*--- T05  Dice Modifier  (dice_mod) ---*)
dice_mod_clause = "gain", ws, ( sign, number, ws, ( "dice" | "dice faces"
                    | "base dice" | "hit" ) )
                | ( "Advantage" | "Disadvantage" ), ws, "damage dice"
                | "Bomb dice" | "Inverse Bomb dice" ;

(*--- T37  Accuracy / Miss Rate  (acc_mod) ---*)
miss_rate_clause = "gain", ws, sign, number, ws, "Miss Rate" ;
(* +ACC / +CR buffs use the Buff template T02 *)

(*--- T06/T07  Resource change  (spend, gain) ---*)
resource_clause = ( "Spend" | "Gain" | "Lose" | "Sacrifice" ), ws,
                  ( number | "X" | ( "up to", ws, number ) | "all" ),
                  ws, resource_name ;

(*--- T08  Heal  (heal) ---*)
heal_clause     = "Heal", ws, ( number | dice_roll | ( number, "%", ws,
                  "of damage dealt" ) ), [ ws, "HP" ], [ "to", ws, actor_ref ] ;

(*--- T09  Shield  (shield) ---*)
shield_clause   = "Shield", ws, number, [ ws, "for", ws ], duration ;

(*--- T10-12  Displacement  (displace, self_displace, teleport) ---*)
displace_clause = [ subject, ws ],
                  ( "Push", ws, number, [ ws, "away from the user" ]
                  | "Pull", ws, number, [ ws, "toward", ws, name ]
                  | "Teleport to", ws, teleport_target
                  | "Swap", ws, ( "positions" | name, "and", name )
                  | "Move", [ "up to" ], ws, ( number | "their MP value" ),
                    [ ws, ( "tiles" | "MP" ) ] ) ;
teleport_target = "a tile" | ( "an unoccupied tile in", ws, range_primary )
                | ( "a chosen tile in", ws, range_primary )
                | "melee range of the target" | name ;

(*--- T13  Tile Placement  (tile) ---*)
tile_place_clause = ( "Place" | "Create" | "Summon" ), ws, [ number ], ws,
                    tile_type, ws, "tile", [ "s" ], [ "on", ws, actor_ref ],
                    [ "for", ws, duration ], [ "range", ws, number ] ;

(*--- T14  Tile Effect / trap zone  (trap) ---*)
tile_effect_clause = ( "Foes" | "Targets" | "Entities" ), ws,
                     "ending their turn in", ws, zone_ref, ws,
                     "take", ws, damage_spec, [ ws, "and are",
                     [ amount_expr ], status_name, ws, duration ] ;
zone_ref        = ( "this tile's Melee" | tile_type, ws, "tile's Melee"
                  | range_primary ) ;

(*--- T15  Conditional  (conditional) ---*)
conditional_statement = "If", ws, condition, [ ",", ws,
                        "Otherwise," ], effect ;
condition       = [ "not" | "no", ws ], condition
                | ( actor_ref, "has", [ "a" | "an" ], ws, status_name )
                | ( actor_ref, "has", ws, number, ws, resource_name )
                | ( number, ws, resource_name )        (* "10 Blood" *)
                | ( actor_ref, "has", ws, number, ws, "Marks" )
                | ( actor_ref, "'s", ws, stat_name, ws,
                    ( "positive" | "negative" | "zero" ) )
                | ( actor_ref, "'s", ws, stat_name, ws,
                    ( "greater than" | "less than" | "equal to" ), ws, number )
                | "the target is", ( "alive" | "dead" ) | "the target dies"
                | "at maximum range" | ( "at Range", ws, number, "+" )
                | ( "under Range", ws, number )
                | ( "at Range", ws, number, "to", ws, number )
                | "on hit" | "on miss" | "on critical hit"
                | "this kills the target"
                | ( "on accuracy rolls of", ws, number, "+" )
                | "the target cannot be moved the full distance" ;

(*--- T16  Choice  (choice) ---*)
choose_statement = ( "Choose one:", ws, option,
                     { ",", ws, option }, ( "or", ws, option ) )
                 | ( "Choose", ws, name, "or", name ), "." ;
option          = [ name, ":", ws ], effect ;

(*--- T17  Reaction / Trigger  (react) ---*)
reaction_statement = "This may be used", [ ws, "on", ws, name ],
                     [ ws, "that either:", ws, numbered_condition,
                       { ( "or" | ( ws, number, "." ) ), numbered_condition } ],
                     [ ws, "when", ws, event ], "." ;
numbered_condition = number, ".", condition ;
event           = "the user is attacked" | "after damage is rolled"
                | ( "a foe in the user's Melee uses a ranged attack"
                    "that doesn't target the user" )
                | "a foe leaves the user's Melee using Dash" ;
reaction_statement2 = "This may also be used", [ ws, "when", ws, event ], "." ;

(*--- T18  Passive  (passive) ---*)
passive_statement = ( "When" | "Whenever" | "After" ), ws, passive_event,
                    [ ":" | "," ], ws, effect
                  | ( "At the start" | "At the end" ), "of", ws,
                    actor_ref, "'s turn", [ ":" ], ws, effect ;
passive_event   = "the user's Crossbow attack resolves" | "this attack hits"
                | "the user is hit by an attack" | "damage is rolled"
                | name, ws, "resolves" | event ;

(*--- T19  Multi-hit  (multihit) ---*)
multihit_clause = ( "this attack has", ws, number, ws, "hits" )
                | ( "becomes" | "is" ), ws, ( "Double Hit" | "Triple Hit" )
                | "Multi-Hit:", ws, number ;

(*--- T20  Target Modifier  (range_mod) ---*)
target_mod_clause = ( "This attack may target", ws, target )
                  | ( "This attack targets", ws, number, ws, "Foes instead" )
                  | ( "may target", ws, number, ws, target_group,
                      "within", ws, range_primary ) ;

(*--- T21  Ignore  (def_ign, exdmg_ign, foe_ign) ---*)
ignore_clause   = "This attack ignores", ws, ignore_target, { ",", ws,
                  ignore_target } ;
ignore_target   = "DEF" | ( "half", ws, "DEF" ) | "ATK/MAG"
                | "outside damage factors" | "negative outside damage factors"
                | "Foes" | ( number, ws, "DEF" ) ;

(*--- T22  Immunity  (immune) ---*)
immunity_clause = ( "Cannot be inflicted with", ws, immunity_list,
                    [ ws, duration ] )
                | ( "The user cannot be", ws, status_verb_list )
                | ( "immune to", ws, immunity_list ) ;
immunity_list   = ( status_name | "statuses" | "debuffs" | "buffs" ),
                  { "and", ws, ( status_name | "statuses" | "debuffs" ) } ;
status_verb_list = ( "Slowed" | "Rooted" | "Sealed" | "Stunned" |
                    "Confused" ), { "or", ws, ... } ;

(*--- T23  Unremovable  (unrem) ---*)
unremovable_clause = "unremovable"
                   | ( "This", ( "status" | "buff" | "debuff" ),
                       "is unremovable" ) ;

(*--- T24  Remove / Cleanse  (remove) ---*)
remove_clause   = ( "Cleanse" | "Remove" ), ws, remove_target,
                  [ "from", ws, actor_ref ] ;
remove_target   = "all statuses" | "all statuses and numerical debuffs"
                | status_name, { "and", ws, status_name } ;

(*--- T25  Recoil  (recoil) ---*)
recoil_clause   = "Recoil", ws, number, "%"
                | "Sacrifice", ws, number, ws, "HP" ;

(*--- T26  Frequency Modifier  (freq_mod) ---*)
freq_mod_clause = ( "Once per turn:", ws, effect )
                | "This ability gains an extra use"
                | "This ability may be used an additional time"
                | ( "Reset", ws, name, "'s frequencies" ) ;

(*--- T27  Delay  (delay) ---*)
delay_clause    = "Delay", ws, number, [ "rounds" ] | "Delay-", number ;

(*--- T28  Thirst ---*)
thirst_statement = "Thirst", ws, number, [ ws, ":" ], ws, effect ;

(*--- T29  Apex ---*)
apex_statement  = "Apex:", ws, effect ;

(*--- T30  Channel ---*)
channel_clause  = "Channel", ws, stat_name, [ "for", ws, number, "rounds" ] ;

(*--- T31  Phase ---*)
phase_clause    = "Phase:", ws, ( "New Moon" | "Waxing" | "Full Moon"
                  | "Waning" ) ;

(*--- T32  Effect Modifier  (eff_mod) ---*)
eff_mod_clause  = ( "On" | "For" ), ws, name, ws, ",", ws, effect
                | name, ws, "becomes", ws, range_primary
                | name, ws, "grants", ws, effect ;

(*--- T33  Tunneling  (tunneling) ---*)
tunneling_clause = "Tunneling" ;

(*--- T34  Can be used while Sealed  (cbuws) ---*)
cbuws_clause    = "This move may be used while Sealed"
                | "Can be used while Sealed" ;

(*--- T35  Non-attack  (non_akt) ---*)
nonattack_clause = "This move may be used as a non-attack"
                 | "May be used as a non-attack" ;

(*--- T38  Optional Replacement ---*)
replacement_clause = "The user may", ( "negate" | "omit" ), ws, effect,
                     "to", ws, effect, "instead" ;

(*--- T39  Roll Accuracy Separately ---*)
separate_acc_clause = "Roll accuracy separately for each target" ;

(*--- T40  Dice Addend ---*)
dice_addend_clause = "gain", ws, dice_roll, ws, damage_type, ws, "damage"
                   | "deals", ws, dice_roll, ws, damage_type, ws, "damage" ;

(*--- T36  Variable Binding ---*)
binding_clause  = "X", ws, "=", ws, binding_expr, "." ;
binding_expr    = ( number, ws, "*", ws, binding_unit )
                | ( number, ws, "-", ws, binding_unit )
                | ( "Spent", ws, resource_name, "/", ws, decimal )
                | ( "half the damage from this attack's", ws, name )
                | ( "the amount of", ws, name, ws, "spent" )
                | "Marks on the target"
                | "the number of targets hit"
                | "the number of tiles the user moved with this attack"
                | "4 - the range this attack is used at"
                | "3 - the range this move is used at"
                | "the user's current", ws, resource_name ;
binding_unit    = ( "the user's current", ws, resource_name )
                | ( "the range this attack is used at" )
                | "the number of times they were targetted" ;

(*--- Strictness rule ---*)
(* A statement that matches no production is a PARSE ERROR carrying the
   line and column where the first unconsumable token begins. There is no
   plain_english_text production. *)
```

## 3. Canonical template inventory (one per grid category)

`effects.ts` status: **H** = HANDLED today, **P** = PARTIAL (gap listed), **N** = NEW (new executor support needed).

| #   | Grid category                        | Canonical template                                                                                                       | Parser must capture               | Exec                   |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ---------------------- |
| T01 | Damaging Status, Non-damaging Status | `inflict [N] <Status>[ /M \| for M round[s]]`                                                                            | status, amount (N/X/NX), duration | H literal / N variable |
| T02 | Buff                                 | `gain ±N[%] <Stat>[ /M]`                                                                                                 | sign, amount, %, stat, duration   | H                      |
| T03 | Debuff                               | `inflict ±N[%] <Stat>[ /M]`                                                                                              | same                              | H                      |
| T04 | Damage Modifier                      | `gain ±N% damage` / `gain ±N% healing`                                                                                   | percent; flat DMG is T02          | P                      |
| T05 | Dice Modifier                        | `gain ±N dice \| dice faces \| base dice \| hit`; `Advantage/Disadvantage damage dice`; `Bomb dice`; `Inverse Bomb dice` | die-kind, amount                  | N                      |
| T37 | Accuracy Modifier                    | `gain ±N Miss Rate` (+ACC/+CR are T02)                                                                                   | MR delta                          | N                      |
| T06 | Resource Loss                        | `Spend/Lose/Sacrifice N <Resource>`                                                                                      | verb, amount, resource            | P (Sacrifice → N)      |
| T07 | Resource Gain                        | `Gain N <Resource>`                                                                                                      | same                              | H                      |
| T08 | Heal                                 | `Heal N HP` \| `Heal <XdY> to <target>` \| `Heal N% of damage dealt`                                                     | amount, roll, %-of-damage         | P                      |
| T09 | Shield                               | `Shield N for M round[s]` / `Shield N/M`                                                                                 | amount, rounds                    | H                      |
| T10 | Target Displacement                  | `Push N [away from the user]`; `Pull N [toward <ref>]`                                                                   | verb, tiles, direction            | H / P                  |
| T11 | Self Displacement                    | `Move [up to] N tiles`; `the user teleports...`                                                                          | mode, amount                      | H                      |
| T12 | Teleport                             | `Teleport to <target>`; `Swap <A> and <B>`                                                                               | destination                       | H                      |
| T13 | Tile Placement                       | `Place N <TileType> tile[s] on <ref> [for M] [range N]`                                                                  | type, count, ref, duration, range | P                      |
| T14 | Tile Effect (trap)                   | `Foes ending their turn in <zone> take <XdY> <type> and are [N] <Status>/M`                                              | zone, damage, status              | N                      |
| T15 | Conditional                          | `If <cond>, <effect>. [Otherwise, <effect>.]`                                                                            | bounded condition; then/else      | P                      |
| T16 | Choice                               | `Choose one: <A>, <B>, or <C>.` / `Choose <X> or <Y>. <X>: <eff>. <Y>: <eff>.`                                           | options, sub-effects              | P                      |
| T17 | Reaction                             | `This may be used [on <ref>] [that either: N. cond or N. cond] [when <event>].`                                          | target, conditions, event         | N                      |
| T18 | Passive                              | `When/Whenever/After <event>: <effect>.`; `At the start/end of <ref>'s turn: <effect>.`; `Gain <benefit>.`               | trigger event, effect             | N                      |
| T19 | Multi-hit                            | `This attack has N hits.`; `becomes Double/Triple Hit`; `Multi-Hit: N`                                                   | hits                              | P                      |
| T20 | Target Modifier                      | `This attack may target N Foes within <range>.`                                                                          | count, group, range               | N                      |
| T21 | Ignore                               | `This attack ignores <DEF \| half DEF \| ATK/MAG \| outside damage factors \| negative outside damage factors \| Foes>.` | list                              | P                      |
| T22 | Immunity                             | `Cannot be inflicted with <list>[ for M].`; `The user cannot be <Slowed\|...>.`                                          | what, duration                    | N                      |
| T23 | Unremovable                          | `unremovable`                                                                                                            | marker                            | N                      |
| T24 | remove                               | `Cleanse <all statuses [and numerical debuffs] \| <Status>> [from <ref>].`                                               | target of cleanse                 | N                      |
| T25 | Recoil                               | `Recoil N%`; `Sacrifice N HP`                                                                                            | percent / amount                  | P                      |
| T26 | Frequency Modifier                   | `Once per turn: <eff>.`; `This ability gains an extra use.`                                                              | limit, bonus                      | N                      |
| T27 | Delay                                | `Delay N rounds` / `Delay-N`                                                                                             | rounds                            | H                      |
| T28 | Thirst                               | `Thirst N: <effect>.`                                                                                                    | threshold, effect                 | H                      |
| T29 | Apex                                 | `Apex: <effect>.`                                                                                                        | effect                            | H                      |
| T30 | Channel                              | `Channel <Stat> for N rounds.`                                                                                           | stat, rounds                      | H                      |
| T31 | Phase                                | `Phase: <New Moon\|Waxing\|Full Moon\|Waning>.`                                                                          | phase                             | H                      |
| T32 | Effect Modifier                      | `On/For <Ability>, <effect>.`; `<Ability> becomes <range>.`; `<Ability> grants <effect>.`                                | ability, effect                   | N                      |
| T33 | Tunneling                            | `Tunneling.`                                                                                                             | flag                              | N                      |
| T34 | Can be used while Sealed             | `This move may be used while Sealed.`                                                                                    | flag                              | N                      |
| T35 | non-attack                           | `This move may be used as a non-attack.`                                                                                 | flag                              | N                      |
| T36 | variable binding                     | `X = <expr>.` then `X`/`NX`/`X hits` reuse                                                                               | binding, expression               | N                      |
| T38 | optional replacement                 | `The user may negate <A> to <B> instead.`                                                                                | A, B                              | N                      |
| T39 | separate accuracy                    | `Roll accuracy separately for each target.`                                                                              | flag                              | N                      |
| T40 | dice addend                          | `gain/deals XdY <type> damage`                                                                                           | roll, type                        | N                      |

## 4. Examples

**Example 1 — damage + status + ignore + conditional** (Dissonance, Classes corpus):

```
Dissonance (Level 3)
Frequency: Every Other Turn.
Miss Rate: 3.
Damage: 2d6 Magical.
Action: Swift.
Target: AoE Foes.
Range: Cone 2.
Effect: inflict 3 Bleed/1. This attack ignores ATK/MAG, half DEF, and outside damage factors. If a target is hit twice, gain +3 DMG/1.
```

**Example 2 — resource sacrifice + variable status** (Gash, Heavy corpus):

```
Gash (Level 7)
Frequency: Every Third Turn.
Miss Rate: 5.
Damage: 2d10+8 Physical.
Action: Standard.
Target: 1 Foe.
Range: Melee.
Effect: Spend X Rage. X = the amount of Rage spent. inflict 5 Bleed/X.
```

**Example 3 — Thirst + on-hit resource loss + multi-hit** (Twin Fangs, Trophy corpus):

```
Twin Fangs (Level 1)
Frequency: Every Turn.
Miss Rate: 3.
Damage: 2d6+4 Physical.
Action: Standard.
Target: 1 Foe.
Range: Melee.
Effect: On hit, lose 2 Blood. Thirst 5: gain +3 Miss Rate and Multi-Hit: 2.
```

**Weapon — Basic Attack** (type-variance, ATK/MAG scaling, anti-seal):

```
Basic Attack (Level 1)
Frequency: Every Turn.
Miss Rate: 2.
Damage: 1d10+2 Physical or Magical.
Action: Standard.
Target: 1 Foe.
Range: Melee.
Effect: This attack is Physical or Magical. This attack adds ATK/MAG to its damage roll and subtracts the target's PD/MD. This move's use cannot be prevented by any means, including Seal.
```

**Class — Heavy** (variable bindings, Apex, spend-with-X, MR/CR modifiers, displacement):

```
Power Swing (Level 7)
Frequency: Every Other Turn.
Miss Rate: 6.
Damage: 3d10+6 Physical.
Action: Standard.
Target: 1 Foe.
Range: Melee.
Effect: Spend X Rage. This attack gains -X Miss Rate and +2X CR.

Feral Chop (Level 1)
Frequency: Every Turn.
Miss Rate: 3.
Damage: 2d10+X Physical.
Action: Standard.
Target: 1 Foe.
Range: Melee.
Effect: X = 2.5 * the user's current Rage.

Tomahawk Toss (Level 6)
Frequency: Every Other Turn.
Miss Rate: 3.
Damage: 2d10+6 Physical.
Action: Standard.
Target: 1 Foe.
Range: Line 4 (Push X).
Effect: X = 4 - the range this attack is used at. Apex: Pull 3 and inflict Slow/1.
```

## 5. Coverage audit

### 5.1 Corpus sentence patterns → templates

Counts are unique abilities whose effect text matches the pattern (case-insensitive substring);
a single ability can match several rows.

| Corpus sentence pattern                                                                        | Template | Count (unique) | Exec              |
| ---------------------------------------------------------------------------------------------- | -------- | -------------- | ----------------- |
| `inflict N Status/M` · `N Status/M` · `Status/M` · `inflicted with N Status/M`                 | T01      | 74             | H/N               |
| `gain ±N Stat/M` · `±N Stat/M` · `gain +1 MP` (incl. ATK/MAG, ACC/CR compounds)                | T02/T03  | 77             | H (compounds → N) |
| `gain/Spend/Lose N <Resource>` · `Costs N ...` · `spend all Resolve`                           | T06/T07  | 87             | H/P               |
| `Choose/Select ... or ...` · `Choose Trip or Slip. Trip: ...`                                  | T16      | 43             | P                 |
| `Push N` / `Pull N` / `Teleport to ...` / `Swap` / `Move N`                                    | T10–T12  | 57             | H                 |
| `If <cond>, <eff> [Otherwise, <eff>]`                                                          | T15      | 99             | P                 |
| `This may be used <cond>.`                                                                     | T17      | 28             | N                 |
| `When/Whenever/After/At the start of ...: <eff>` · `Gain <benefit>.`                           | T18      | 58             | N                 |
| `Heal N HP` · heal roll `3d4+6` · `Heal N% of damage dealt`                                    | T08      | 33             | P                 |
| `ignore(s) DEF / ATK/MAG / outside damage factors / Foes`                                      | T21      | 39             | P                 |
| `+N dice` · `+N dice faces` · `+N base dice` · Advantage/Bomb                                  | T05      | 40             | N                 |
| `Before accuracy, <eff>` / `Before damage: <eff>`                                              | step_tag | 16 + 7         | N                 |
| `Delay N` / `Delay-N`                                                                          | T27      | 15             | H                 |
| `Thirst N:`                                                                                    | T28      | 9              | H                 |
| `Apex: <eff>`                                                                                  | T29      | 13             | H                 |
| `(Double Hit)` / `(Triple Hit)` / `+1 hit`                                                     | T19      | 10             | P                 |
| `Place/Create <Tile> tile[s]` · `Foes ending their turn in ... take N damage and are <Status>` | T13/T14  | 14 + 10        | P/N               |
| `Sacrifice N HP` · `Recoil N%` · `takes N damage`                                              | T25      | 18             | P                 |
| `Cannot be inflicted with ...` · `immune to ...` · `unremovable`                               | T22/T23  | 28             | N                 |
| `Cleanse/Remove all statuses ...`                                                              | T24      | 11             | N                 |
| `Once per turn:` · `extra use` · `reset frequencies`                                           | T26      | 28             | N                 |
| `Channel <Stat>` · `Phase: <Moon>`                                                             | T30/T31  | 10 / 11        | H                 |
| `This move may be used as a non-attack` / `while Sealed`                                       | T35/T34  | 8              | N                 |
| `X = <expr>.` + `X`/`NX`/`X hits` reuse                                                        | T36      | 16             | N                 |
| `may target 2 Foes` · `targets N Foes instead`                                                 | T20      | 12             | N                 |
| `On <Ability>, <eff>` · `<Ability> becomes <shape>` · `<Ability> grants <eff>`                 | T32      | 48             | N                 |
| `Tunneling`                                                                                    | T33      | 1              | N                 |
| `This move's use cannot be prevented by any means, including Seal`                             | T22      | 9              | N                 |
| `Roll accuracy separately for each target`                                                     | T39      | 4              | N                 |
| `Roll a 1d14 for an effect` / random tables                                                    | **hole** | 1              | —                 |

Untagged after family pass: ~30 (e.g. `Duet`, `Rising Hope`, `Smokescreen`, `Hastiliarius`,
`Silken Suit`) — these parse via sub-sentence patterns once the effect is tokenized into
statements (e.g. Rising Hope = `Gain +1 ACC and +1 CR` passive form, T18+T02).

### 5.2 Nasty sentences and their exact rewrites

| Corpus sentence (verbatim)                                                                                                                                                           | Rewrite (canonical)                                                                                                                      | Template             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `The target is inflicted with 3X Curse/1, where X is Marks on the target.`                                                                                                           | `X = Marks on the target. inflict 3X Curse/1.`                                                                                           | T36 + T01            |
| `X = 2.5 * the user's current Rage.`                                                                                                                                                 | unchanged (canonical already)                                                                                                            | T36                  |
| `Every time this move hits, the user loses 2 Blood. Thirst 5 : ...`                                                                                                                  | `On hit, lose 2 Blood. Thirst 5: ...`                                                                                                    | T06 + T28            |
| `This may be used on a foe in the user's Melee that either: 1. uses a ranged attack that doesn't target the user (after damage is rolled) or 2. leaves the user's Melee using Dash.` | unchanged — numbered conditions are first-class in T17                                                                                   | T17                  |
| `Select a bonus: +3 ATK/MAG, +1 ACC/CR, +4 DEF.`                                                                                                                                     | `Choose one: gain +3 ATK/MAG, gain +1 ACC/CR, or gain +4 DEF.`                                                                           | T16                  |
| `The user may spend 2 Rage per effect to gain any combination:`                                                                                                                      | `Choose one or more: Spend 2 Rage and gain +4d10. Spend 2 Rage and gain Splash 2. Spend 2 Rage and gain -3 Miss Rate.`                   | T16                  |
| `The user may negate the Push to teleport a tile away from the target.`                                                                                                              | `The user may negate Push 1 to Teleport to a tile 1 tile away from the target instead.`                                                  | T38                  |
| `Targets are pulled towards the user's Totem tile instead of the user, if one exists.`                                                                                               | `Pull 2 toward the user's Totem tile. If the user has no Totem tile, Pull 2 toward the user.`                                            | T10                  |
| `For one round, Bloodlust gives an extra Rage per instance of damage.`                                                                                                               | `For 1 round, On Bloodlust, gain +1 Rage per instance of damage.`                                                                        | T32                  |
| `Rising Hope becomes Star 2 and additionally grants the bonuses selected during this and prior uses of Fantasia.`                                                                    | `On Fantasia, "Rising Hope" becomes Star 2. On Fantasia, "Rising Hope" grants the bonuses chosen by Fantasia.`                           | T32                  |
| `Damage on targets hit twice is increased by 3 for one round.`                                                                                                                       | `If a target is hit twice, gain +3 DMG/1.`                                                                                               | T15 + T02            |
| `Within range, the user may place either: 4 Air, 4 Sticky, or 1 Boost tile(s).`                                                                                                      | `Choose one: Place 4 Air tiles, Place 4 Sticky tiles, or Place 1 Boost tile.`                                                            | T16 + T13            |
| `After Push, the user places a Broken tile in the target's Melee lasting for 3 rounds. ... Foes ending their turn in this tile's Melee take 10 damage.`                              | `After Push, Place 1 Broken tile in the target's Melee for 3 rounds. Foes ending their turn in the Broken tile's Melee take 10 damage.`  | step_tag + T13 + T14 |
| `If unoccupied, the targeted tile becomes a Stone tile, which functions like Ice, but with 30 HP and 1 EVA.`                                                                         | `If the target tile is unoccupied, Place 1 Stone tile on the target. The Stone tile has 30 HP and 1 EVA and functions like Ice.`         | T15 + T13            |
| `The user's next 2 Fangs attacks on foes cannot cause the user to lose Blood and gain "Thirst X: ..."`                                                                               | `On the user's next 2 Fangs attacks on foes, the user cannot lose Blood. On the user's next 2 Fangs attacks on foes, gain Thirst X: ...` | T32                  |
| `In place of an accuracy roll, roll a 1d14 for an effect. 1. ... 14. ...`                                                                                                            | **hole** (see §7); `effect: [extension "tabled-roll" 1d14]`                                                                              | T41 ext.             |

## 6. Ordered implementation steps (small TypeScript codebase)

1. **Vocabulary module** — export the reserved-word tables (verbs, statuses, stats, resources,
   tile types, shapes, actions, frequencies, conditions) mirroring `effects.ts` lists
   (`STATUS_NAMES`, `STAT_NAMES`, `RESOURCE_NAMES`). Single source of truth for parser and executor.
2. **Tokenizer** — case-insensitive scanner producing tokens with `line:column`; handles quoted
   strings + escapes, numbers, dice rolls, `X`, slash-durations, symbols `+ - % / ( ) : . , |`.
   Fail hard on any unparseable character.
3. **Statement splitter** — depth-aware splitter (port `splitClauses`) splitting `.`, `,`, `and`
   only at depth 0 and never inside `XdY` or parentheses; now grammar-directed, not heuristic.
4. **Template matcher layer** — one matcher per template T01–T40, tried in fixed order
   (longest-match / most-specific first: binding before status, status before stat, etc.).
   Each returns typed slots; the final fallthrough raises `ParseError(line, col, expected)`.
5. **AST → executor type mapper** — map slots onto the `Effect` union; extend it with the NEW
   types: `diceMod`, `missRateMod`, `variableBind`, `reaction`, `passive`, `timingTag`,
   `immunity`, `cleanse`, `freqMod`, `targetMod`, `tileZone`, `effectMod`, `unremovable`,
   `cbuws`, `nonAttack`, `tunneling`, `optionalReplace`, `separateAccuracy`, `diceAddend`,
   `sacrifice`.
6. **Round-trip validator** — parse all 373 unique corpus abilities → serialize each back to
   canonical prose → re-parse → assert the ASTs are identical and zero `unknown` effects remain.
   This is the acceptance test; it IS the definition of "full coverage".
7. **Executor extension** — implement the NEW effect types: dice modifiers, MR modifiers,
   sacrifice, roll-based heal, %-of-damage heal, variable resolution (scoped `bindings` map
   threaded through `applyEffectStream`), timing tags (gate by step in the 11-step resolver),
   reactions, passives, immunity/cleanse, frequency mods, target mods, tile zones, effect mods,
   tunneling, cbuws, non-attack, optional replacements, separate accuracy.
8. **Condition evaluator completion** — extend `evaluateCondition` so every condition the grammar
   admits resolves to then/else; any condition reaching "unknown" is now an authoring error.
9. **Corpus rewrite script + CI gate** — apply §5.2 rewrites mechanically; re-run the round-trip
   validator in CI (guard: run from the package dir, not repo root).

## 7. Grammar holes deliberately left open

1. **Random/tabled effects** — `Stacked Deck`'s 1d14, `random position change`, `Card Flip` flips.
   Use an extension template `[extension "tabled-roll"] <N>d<M>: <N entries>` executed by a
   dedicated engine hook, or flag the ability `[manual]`.
2. **Event-history / world-state conditions** — "was attacked multiple times during their
   previous turn", "has been attacked in the last round", "damaged this game", "the last attack
   had Apex". Model as a bounded `event_history` condition slot; full event-log evaluation is
   engine work. Until then: `[history: <event> <relation> <count>]`.
3. **Future/promise conditions** — "until Eventide lands", "if a foe with a Bomb targets another
   foe", "next attack applies that Apex". Declarative `On <trigger> ...` covers most; the copying
   of another ability's effects (Apex carry, "Rising Hope becomes Star 2") needs effect-reference
   resolution not in v1.0.
4. **HP-percentage and HP-value conditions** — "below 25% HP", "foes with over 200 HP are
   considered 200 HP". Add a `% HP` condition slot later; v1.0 rewrites use `[manual]`.
5. **Damage redirection/redistribution** — "50% of this attack's damage is dealt to a random foe
   instead", "swap current HP". Marked `[manual]` until damage-pipeline hooks exist.
6. **Subweapon- and class-dependent effects** — `Invigorate`'s Gladius/Scutum/Pilum branches.
   Handled as a `Choose one` resolved at load time from a subweapon config, or `[subweapon: <table>]`.
7. **Turn-order/phase manipulation beyond the Phase resource** (T31 covers the Clairvoyant moon
   phases only).
8. **Bespoke passive prose with free pronouns** — "they" in `Bloodthirst`. Canonical form
   rewrites pronouns to `the user`/`the target`; anything left ambiguous is a parse error on
   purpose.

Everything else — statuses, buffs, debuffs, damage mods, dice mods, resources, heals, shields,
displacement/teleport/swap, tiles and traps, conditionals, choices, reactions, passives,
multi-hit, ignore, immunity, cleanse, recoil, frequency mods, delay, Thirst, Apex, Channel,
Phase, tunneling, Sealed-use, non-attacks, variables, separate accuracy, optional replacements,
and the defensive base abilities — has exactly one canonical template and is covered by the
round-trip validator.
