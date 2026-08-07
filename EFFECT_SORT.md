# BD Lang Effect Sorting Reference

All effect types sorted by category, with the standard wording pattern and every ability that uses it.

---

## 1. Triggers & Timing

### 1.1 Reactions — `"This may be used [condition]."`

The standard opener for all Reaction-type abilities.

**Inconsistent variants found:**
| Variant | Example |
|---------|---------|
| `This may be used...` | Attack of Opportunity, Staccato, Aegis, Rewind, Foresight, Phalanx, Defiance, Figure 8, Aftershock, Allez, Deflect, Parry, All for One |
| `If in Scutum, this may be used...` | Phalanx (condition before keyword) |
| `This move can be used when...` | Sanguine Explosion |
| `Once per turn, the user may choose to reroll...` | Card Counter |

**Standard form:** `This may be used [condition]. [effect].`

**Standard form (multi-condition):** `This may be used [condition]. This may also be used [condition].`

**All abilities:** Attack of Opportunity, Staccato, Aegis, Rewind, Foresight, Phalanx, Defiance, Figure 8, Aftershock, Allez, Deflect, Counter, Parry, All for One, Card Counter, Sanguine Explosion

### 1.2 Triggers — `"This may be used [condition]."`

Same opener as Reactions — some abilities are typed as `Trigger` or `Reaction or Trigger` rather than `Reaction`, but use the same wording.

**All abilities:** Bloodbind, Coronation, Totem of Blood, Totem of Bone, Totem of Soul, Terraform

### 1.3 Passives — Start with the condition or effect directly

No trigger keyword needed — passive effects describe what happens and when.

**Common openers:**

- `When [event]: [effect]` — Hunter's Mark, Ironclad, Reaper's Touch, Bloodlust, Attuned
- `Whenever [event]: [effect]` — Crimson Pact
- `Gain [benefit].` — Rising Hope, Qi Force, Hawkeye
- `May use [ability]. When [event]: [effect].` — En Pointe
- `After [event]: [effect]` — Qi Force, Bound Gauntlet
- Start of turn / End of turn effects

**All passives:** Backstep, Rising Hope, Ironclad, En Pointe, Qi Force, Adrenaline, Hunter's Mark, Bound Bow, Bound Gauntlet, Tactical Sniper, Hawkeye, Jackpot, Lunar Phase, Far Side of the Moon, Future Sight, Psychic Overlord, Crimson Pact, Black Magic, Total Depravity, Reaper's Touch, Immortal Coil, Quietus, Egregore, Triumvirate, Hastiliarius, Adaptive, Paragon, Aikido, Bloodlust, Vindictive, Swing Cycle, Unstoppable Force, Stonemason, Heavy Weapon, Plate Crusher, Fleet Footwork, Right to Rule, Declaration of War, Imperial Tyranny, Resolute Blade, Fallen Blade, Zanshin, Fudoshin, All-Terrain Master, Attuned, Ichorous, Catalysis, Conduit, Heaven's Will, Scoundrel, Swindler, Deathly Crew, Bloodthirst, The Urge, Nocturnal Predator, Ramping Magic, Jammed Blades, Silken Suit

---

## 2. Status Effects

### 2.1 Standard — `"inflict X [Status]/Y"`

| Status    | Meaning                 |
| --------- | ----------------------- |
| Bleed     | Damage per turn         |
| Burn      | Damage per turn (fire)  |
| Curse     | Damage on action        |
| Poison    | Damage per turn (toxin) |
| Cripple   | Stat reduction          |
| Slow      | Movement penalty        |
| Confusion | Random targeting        |
| Stun      | Skip turn               |
| Root      | Cannot move             |
| Seal      | Cannot use abilities    |

**Patterns found:**
| Pattern | Count | Example |
|---------|-------|---------|
| `inflict X [Status]/Y` | most common | `inflict 3 Bleed/1` |
| `inflict [Status]/Y` | some | `inflict Slow/1` |
| `inflicted with X [Status]/Y` | some | `inflicted with 3 Bleed/1` |
| `inflicted with [Status]/Y` | rare | `inflicted with Slow/1` |

**Standard:** `inflict X [Status]/Y`

**Examples by status type:**

**Bleed:** Dissonance (`inflict 3 Bleed/1`), Serrated Arrows, Blood Moon, Gash, Two Handed, Catapult Campaign, Thrust, Plague, Enchanted Blade, Lasting Cuts

**Burn:** Tinker's Dam, Effigial Pyre, Fireball, Plague

**Curse:** Cursed Bolts (`inflict 3X Curse/1`), Defile, Blasphemy, Eventide, Blade of Woe, Plague, Enchanted Blade

**Poison:** Venom Shot (`inflict Poison/1`), Blood Moon, Pestilent Strike, Plague, Boot Pin

**Cripple:** Ironclad (`inflict 2 Cripple/1`), Mantrap, Crippling Shot, Gravity Crash, Exercitus, Knockback, Seismic Smash, Razor Rust, Patinando, Boot Pin, Lasting Cuts

**Slow:** Crippling Shot, Knockback, Storm Strike, Tomahawk Toss, Otherworldly Attraction, Night Visitor, Sanguine Explosion

**Confusion:** Tidal Wave, Hardwood Slam, Dazing Hook, Calamitous Trance, Seal of Solomon

**Stun:** Roulette, Stacked Deck, Holy Light, Thwack

**Seal:** Basic Attack, Roulette, Holy Light, Fatal Moonlight, Franciscate

---

## 3. Stat Modifiers

### 3.1 Buffs — `"gain +X [STAT]/Y"`

| Pattern                        | Example         | Count |
| ------------------------------ | --------------- | ----- |
| `gain +X [STAT]/Y`             | `gain +4 DEF/1` | most  |
| `gain +X [STAT]` (no duration) | `gain +1 MP`    | some  |
| `+X [STAT]/Y` (bare)           | `+5 DMG/1`      | few   |

**Standard:** `gain +X [STAT]/Y` (duration omitted if permanent or this turn)

**Stats used:** ATK, MAG, DEF, MDEF, PDEF, DMG, ACC, CR, MP, EVA, Range, dice, dice faces

### 3.2 Debuffs — `"inflict -X [STAT]/Y"`

| Pattern               | Count | Example            |
| --------------------- | ----- | ------------------ |
| `inflict -X [STAT]/Y` | most  | `inflict -2 DEF/1` |
| `-X [STAT]/Y` (bare)  | some  | `-3 DEF/1`         |

**Standard:** `inflict -X [STAT]/Y`

### 3.3 Temporary — `"until next turn"`, `"this turn"`, `"for Y rounds"`

**Standard:** `[effect]/Y` using slash notation. Use `until next turn` for effects that last until the user's next turn, and `this turn` for same-turn-only effects.

---

## 4. Resource Verbs

| Verb      | Standard Form        | Example           |
| --------- | -------------------- | ----------------- |
| Spend     | `Spend X [Resource]` | `Spend 2 Rage`    |
| Gain      | `gain X [Resource]`  | `gain 1 Qi`       |
| Lose      | `lose X [Resource]`  | `lose 1 Campaign` |
| Sacrifice | `Sacrifice X HP`     | `Sacrifice 10 HP` |

**Resources tracked:** Rage (Heavy), Qi (Monk), Mana (Sorcerer), Blood (Trophy), Resolve (Noble), Focus (Noble), Coin (Trophy), CP (Dark), Mark (Archer), Campaign (Noble), Enrage (Noble), Phase (Clairvoyant), Dice (Clairvoyant)

**Standard rule:** Capitalize when starting a sentence, lowercase in the middle. Use `Spend` (capitalized) as the standard verb over `pay`, `use`, `consume`.

---

## 5. Displacement

### 5.1 Push — `"Push N"`

**Standard:** `Push N` (capitalized, number after)

**Variants:**
| Variant | Fix to |
|---------|--------|
| `Push N` | (already standard) |
| `push back N` | `Push N` |
| `+N Push` | `Push N` |
| `Push X where X = ...` | `Push X (X = ...)` |

**All abilities:** Tornado Bolt, Arcane Shot, Exercitus, Disengage, Knockback, Crush, Shockwave Slam, Fissure, Kip Up, Continental Crash, Kinetic Impact, Two Handed, Patinando, Windstorm, Sandstorm, Captain's Order, Handle Bash

### 5.2 Pull — `"Pull N"`

**Standard:** `Pull N` (same as Push)

**All abilities:** Void's Call, Forward Jab, Inertial Shift, Tomahawk Toss, Deflect, Rototill, Savage Spin-out, Handle Bash

### 5.3 Teleport — `"Teleport to [target]"`

**Standard:** `Teleport to [target]`

| Variant                            | Fix to                             |
| ---------------------------------- | ---------------------------------- |
| `Teleport to tile in X`            | (standard)                         |
| `Teleport to unoccupied tile in X` | `Teleport to unoccupied tile in X` |
| `teleport` (lowercase)             | `Teleport`                         |

**All abilities:** Warp, Pole Vault, Defiance, Storm Strike, Handle Bash

### 5.4 Swap — `"Swap [A] and [B]"`

**Standard:** `Swap [targets]`

**All abilities:** Heaven's Wind, Triumvirate, Tornado

---

## 6. Tile/Zone Placement

**Standard:** `Place [TileType] on [target]. [Duration]. [Zone effects].`

| Variant            | Fix to                                |
| ------------------ | ------------------------------------- |
| `Create X`         | `Place X`                             |
| `Place X`          | (standard)                            |
| `Replace X with Y` | `Replace X with Y` (different action) |

**All abilities:** Tinker's Dam, Mending Mantel, Wormhole, Whittle, Heredity, Terraform, Earth Render, Continental Crash, Windstorm, Cryosphere, Silk Cocoon, Whittle, Totem of Blood, Totem of Bone, Totem of Soul

---

## 7. Conditional Flow

| Prefix                          | When to use      | Example                                         |
| ------------------------------- | ---------------- | ----------------------------------------------- |
| `If [condition]:`               | State checks     | `If target has Mark: Splash 1`                  |
| `When [event]:`                 | Event triggers   | `When Crossbow attack resolves: gain 1 Mark`    |
| `This may be used [condition]:` | Reaction/Trigger | `This may be used on a foe in the user's Melee` |
| `Choose: [option] or [option]`  | Choices          | `Choose: +3 ATK/MAG, +1 ACC/CR, or +4 DEF`      |
| `On hit:` / `On miss:`          | Hit-dependent    | Embedded in timing                              |

---

## 8. Damage Notation

| Pattern       | Example                                 |
| ------------- | --------------------------------------- |
| Standard roll | `2d8+7`                                 |
| Multi-hit     | `1d8+1 (Double Hit)`                    |
| Damage type   | `2d8+7 Physical`                        |
| Variable      | `Xd4 Bomb damage (X = Marks on target)` |

**Damage types:** Physical, Magical, Bomb, True, Pure

---

## 9. Duration Notation

| Notation          | Meaning                     | Example              |
| ----------------- | --------------------------- | -------------------- |
| `/Y`              | Y rounds                    | `+4 DEF/1` = 1 round |
| `this turn`       | Same turn only              |                      |
| `until next turn` | Until user's next turn      |                      |
| `until user dies` | Permanent but lost on death |                      |
| `permanent`       | Never expires               |                      |
| `X rounds`        | Plain text variant          |                      |

**Standard:** `/Y` for round counts. Full words (`until next turn`, `this turn`) for non-numeric durations.

---

## 10. AoE Shapes

| Shape  | Pattern    | Example    |
| ------ | ---------- | ---------- |
| Burst  | `Burst N`  | `Burst 2`  |
| Star   | `Star N`   | `Star 4`   |
| Cone   | `Cone N`   | `Cone 2`   |
| Beam   | `Beam N`   | `Beam 2`   |
| Pierce | `Pierce N` | `Pierce 4` |
| Splash | `Splash N` | `Splash 1` |
| Line   | `Line N`   | `Line 6`   |

---

## Full Ability List by Category

### TILE_PLACE (14)

Tinker's Dam, Mending Mantel, Wormhole, Whittle, Heredity, Egregore, Stonemason, Earth Render, Continental Crash, Terraform, Cryosphere, Windstorm, All-Terrain Master, Silk Cocoon

### DISPLACE (57)

Heaven's Wind, Conversion, Impasse, Warp, Wormhole, Tornado Bolt, Bolt Arsenal, Arcane Shot, Hook Shot, Stacked Deck, Gravity Crash, Void's Call, Triumvirate, Exercitus, Disengage, Forward Jab, Phalanx, Dual Wield, Inertial Shift, Pole Vault, Defiance, Gale Force, Knockback, Unstoppable Force, Storm Strike, Masonry, Crush, Gravity Well, Shockwave Slam, Collision Course, Aftershock, Fissure, Heavy Weapon, Tomahawk Toss, Kip Up, Repulse Slice, Continental Crash, Kinetic Impact, Two Handed, Supreme Strikes, Fleet Footwork, Deflect, Patinando, Rototill, Windstorm, Scorched Earth, Sandstorm, Tornado, Dirty Trick, Fancy Footwork, Captain's Order, Blood Whirl, Night Visitor, Sanguine Explosion, Ramping Magic, Savage Spin-out, Handle Bash

### STATUS (68)

Basic Attack, Dissonance, Staccato, Ironclad, Mantrap, Tinker's Dam, Ward, Impasse, Warp, Cursed Bolts, Serrated Arrows, Crippling Shot, Venom Shot, Roulette, Stacked Deck, Dark Reflection, Holy Light, Tidal Wave, Blood Moon, Gravity Crash, Fatal Moonlight, Eventide, Psychic Overlord, Defile, Pestilent Strike, Spirit Break, Left-Hand Path, Blasphemy, Effigial Pyre, Exercitus, Disengage, Thwack, Hardwood Slam, Exploit Feign, Calamitous Trance, Dazing Hook, Knockback, Franciscate, Gash, Storm Strike, Seismic Smash, Razor Rust, Tomahawk Toss, Two Handed, Catapult Campaign, War of Attrition, Blade of Woe, Delirium, Point-in-Line, Thrust, Patinando, Nature's Madness, Fireball, Plague, Absolution, Seal of Solomon, Judgment, Blinding Sheen, Boot Pin, Otherworldly Attraction, Blood Wave, Night Visitor, Sanguine Explosion, Lasting Cuts, Enchanted Blade, Weaver's Whirl, Thirteenfold Cut

### BUFF/DEBUFF (77)

Rising Hope, Primadonna, Staccato, Reforge, Mending Mantel, Ward, Martyrdom, Divertissement, Qi Force, Eightfold Shield, Conversion, Nirvana, Pavise, Impasse, Oathkeeper, Warp, Time's Edge, Outmaneuver, Tornado Bolt, Quiver of Thunder, Bound Bow, Swift Shot, Blessed Arrow, Hawkeye, Blitz, Windmill, Jackpot, Stacked Deck, Echo Burst, Prophecy, Psychic Overlord, Bloodrush, Covenant, Wither Soul, Coup de Grâce, Spirit Break, Totem of Blood, Left-Hand Path, Totem of Soul, Ancestral Wrath, Triumvirate, Disengage, Deus Vult, Impede, Adaptive, Exploit Feign, Reversal, Wear Down, Aikido, Franciscate, Discipline, Ambush, Entrench, Crusade, Declaration of War, Delirium, Giant Slayer, Point-in-Line, Parry, Rototill, Conduit, Resonate, Smite, Compass, Absolution, Seal of Solomon, Transcendence, Echo of Light, Heaven's Will, Judgment, Dirty Trick, Blinding Sheen, Boot Pin, Swashbuckler, Blood Wave, Weaver's Whirl, Thirteenfold Cut

### RESOURCE (87)

Qi Force, Eightfold Shield, Conversion, Nirvana, Hunter's Mark, Arrow Net, Tornado Bolt, Final Hour, Bolt Arsenal, Quiver of Thunder, Crimson Pact, Purloin Youth, Sanctified Blade, Massacre, Covenant, Total Depravity, Bloodbind, Whittle, Totem of Blood, Bloodlust, Power Swing, Wide Slash, Vindictive, Knockback, Franciscate, Gash, Sever, Amped Strike, Swing Cycle, Wrath, Right to Rule, Coronation, Ambush, Entrench, Declaration of War, Resolute Blade, Cursed Slice, Lunge, Blade of Woe, Fallen Blade, Kensei, Lotus Strike, Delirium, Provoke, Bloodspill, Bushido, Rising Sun, Giant Slayer, Zanshin, Point-in-Line, Thrust, Deflect, En Garde, Feint, Parry, Patinando, Moulinet, Redoublement, One for All, All for One, Attuned, Fireball, Hex, Plague, Sandstorm, Faith, Scourge, Tornado, Fog, Maelstrom, Ichorous, Catalysis, Scoundrel, Blinding Sheen, Swindler, Shady Bet, Buy Time, Deathly Crew, Bloodthirst, Twin Fangs, Uninvited Guest, Blood Wave, Indulge, Blood Whirl, Night Visitor, Sky Turns Red, Sanguine Explosion

### HEAL (33)

Mending Mantel, First Aid, Martyrdom, Vestments, Oathkeeper, Blessed Arrow, Stacked Deck, Harvest Moon, Psychic Overlord, Siphon Soul, Bloodbind, Reaper's Touch, Reap, Hades' Toll, Haunted Swing, Wither Soul, Pestilent Strike, Coup de Grâce, Memento Mori, Phantasmal Shield, Stroke of Midnight, Phantom Blade, Heredity, Ancestral Wrath, Hardwood Slam, Rising Sun, Moulinet, Flower Crown, All-Terrain Master, Faith, Judgment, Indulge, Sky Turns Red

### REACTION (22)

Attack of Opportunity, Staccato, Mantrap, Fouetté, Aegis, Rewind, Superposition, Time's Edge, Stacked Deck, Foresight, Phalanx, Defiance, Figure 8, Aftershock, Coronation, Allez, Deflect, Counter, En Garde, Parry, All for One, Sanguine Explosion

### MULTI_HIT (10)

Staccato, Blitz, Salvo, Overdraw, Exploit Feign, Calamitous Trance, Supreme Strikes, Bloodthirst, Twin Fangs, Night Visitor

### CHOICE (43)

Fantasia, Reforge, Vestments, Impasse, Lightspeed, Bolt Arsenal, Blackjack, Craps, Stacked Deck, Lunar Phase, Far Side of the Moon, Scry, Fateweave, Psychic Overlord, Egregore, Dual Wield, Hardwood Slam, Yin Yang, Tempest Sweep, Wrath, Gravity Well, The Art of War, Lunge, Bushido, Nature's Madness, Plague, Spellweave, Scourge, Maelstrom, Smite, Absolution, Seal of Solomon, Providence, Scoundrel, Dirty Trick, Fancy Footwork, Scallywag Slice, Boot Pin, Shady Bet, High Ground, Swashbuckler, Captain's Order, Thirteenfold Cut

### AOE (124)

Rising Hope, Dissonance, Primadonna, Fantasia, Staccato, Mantrap, Smokescreen, Mending Mantel, Ward, Emboîté, Pavise, Oathkeeper, Warp, Fractal Division, Arrow Flurry, Pierce, Explosive Shot, Bolt Arsenal, Blessed Arrow, Scatter Shot, Volley, Tactical Sniper, Windmill, Trick Shot, Sagittarian Pride, Overdraw, Double or Nothing, Craps, Lunar Phase, Tidal Wave, Celestial Blessing, Future Sight, Echo Burst, Scry, Prophecy, Defile, Pentagram, Total Depravity, Haunted Swing, Wither Soul, Whittle, Totem of Bone, Blasphemy, Effigial Pyre, Triumvirate, Disengage, Breach, Shield Wall, Invigorate, Weapon Crash, Impede, Pole Vault, Gale Force, Tempest Sweep, Wide Slash, Amped Strike, Swing Cycle, Wrath, Cyclone Sweep, Storm Strike, Earth Render, Lagging Spin, Gravity Well, Shockwave Slam, Aftershock, Fissure, Heavy Weapon, Razor Rust, Continental Crash, Discipline, Supreme Strikes, Line Out, Right to Rule, Coronation, Bastion, Catapult Campaign, Ambush, Crusade, War of Attrition, Shock and Awe, Declaration of War, Imperial Tyranny, Kensei, Bloodspill, Point-in-Line, Feint, One for All, Terraform, Bioturbation, Blackthorn, Bloom, Cryosphere, Hydrolysis, Wildfire, Nature's Madness, Windstorm, Scorched Earth, Attuned, Plague, Sandstorm, Ichorous, Absolution, Providence, Echo of Light, Heaven's Will, Judgment, Dirty Trick, Boot Pin, High Ground, Blood Wave, Blood Whirl, Night Visitor, Sanguine Explosion, Ramping Magic, Lasting Cuts, Savage Spin-out, Silk Cocoon, Piercing Jab, Enchanted Blade, Handle Bash, Weaver's Whirl, Thirteenfold Cut, Guillotine, Jammed Blades

### PASSIVE (58)

Backstep, Rising Hope, Ironclad, En Pointe, Qi Force, Adrenaline, Hunter's Mark, Bound Bow, Bound Gauntlet, Tactical Sniper, Hawkeye, Jackpot, Lunar Phase, Far Side of the Moon, Future Sight, Psychic Overlord, Crimson Pact, Black Magic, Total Depravity, Reaper's Touch, Immortal Coil, Quietus, Egregore, Triumvirate, Hastiliarius, Adaptive, Paragon, Aikido, Bloodlust, Vindictive, Swing Cycle, Unstoppable Force, Stonemason, Heavy Weapon, Plate Crusher, Fleet Footwork, Right to Rule, Declaration of War, Imperial Tyranny, Resolute Blade, Fallen Blade, Zanshin, Fudoshin, All-Terrain Master, Attuned, Ichorous, Catalysis, Conduit, Heaven's Will, Scoundrel, Swindler, Deathly Crew, Bloodthirst, The Urge, Nocturnal Predator, Ramping Magic, Jammed Blades, Silken Suit

### DICE_MOD (70)

Primadonna, Divertissement, Nirvana, Rewind, Bolt Compaction, Final Hour, Swift Shot, Fireworks, Tactical Sniper, Blitz, Splinter, Surge, Arrow Storm, Shrapnel Tip, Overdraw, Blackjack, Craps, Jackpot, Slots Spin, Hi-Lo, Stacked Deck, Card Counter, Lunar Phase, Double Tide, Gravity Crash, Black Magic, Totem of Soul, Sacrificial Lamb, Triumvirate, Forward Jab, Phalanx, Iberian Steel, Weapon Crash, Hastiliarius, Thwack, Grave of Titans, Inertial Shift, Hardwood Slam, Stance Breaker, Calamitous Trance, Disarm, Dazing Hook, Cyclone Sweep, Lagging Spin, Kinetic Impact, Right to Rule, Bastion, The Art of War, Resolute Blade, Fallen Blade, Delirium, Fudoshin, Allez, Point-in-Line, Parry, Patinando, Rototill, Blackthorn, Hydrolysis, Fireball, Hex, Conduit, Serpent's Gate, Swindler, Swashbuckler, The Urge, Draw Blood, Piercing Jab, Guillotine, Jammed Blades
