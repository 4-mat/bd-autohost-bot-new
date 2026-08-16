# Feature Checklist — for PR selection

Everything below is **already implemented and committed** on the branch
`feat/feature-sprint` (worktree `bd-autohost-bot-new-wtfs`). The branch is
**ahead of `origin/master`** and **not pushed**; `master` is untouched. The
four earlier draft PRs (#245–#248) were closed and their remote branches
deleted.

> How to use this: check the features you want to ship, then ask an agent to
> split the corresponding commits from `feat/feature-sprint` into focused
> PRs targeting `master`. Each feature below lists its commit so it can be
> cherry-picked / diffed independently.

## Suggested PR groupings

Pick whole groups (or individual features) with `[x]`.

### A. Engine correctness — commit `e4b0062`
- [ ] 1. Clamp HP at 0 in `dealDamage`
- [ ] 2. Push/pull blocks when the destination tile is occupied
- [ ] 3. Declare Attack phase message
- [ ] 4. On Miss effect phase
- [ ] 5. Before Damage effect phase
- [ ] 6. Unify win-condition logic

### B. BDLang parser — commit `bba6a18`
- [ ] 7. Colon syntax `If COND: EFFECT`
- [ ] 8. `Spend 2+ Qi` amounts
- [ ] 9. Phase markers (New/Waxing/Full/Waning)
- [ ] 10. `Per hit` clauses
- [ ] 11. `When X` trigger clauses

### C. UX / commands — commit `b4ea9fe`
- [ ] 12. Team indicators in `%pl`
- [ ] 13. No-viable-target `%cancel` hint
- [ ] 14. `%choose` shows `id = label`
- [ ] 15. `%wt <ability>` targeted lookup
- [ ] 16. Spectator welcome on join
- [ ] 17. Kill-feed announcements
- [ ] 18. 10s shot-clock warning

### D. Quality / perf / config — commit `262ae31`
- [ ] 19. Bound send queue (cap + expiry)
- [ ] 20. Memoized effect parsing
- [ ] 21. `config.devs` → `%dev`
- [ ] 22. `turnTimerSeconds` config
- [ ] 23. `announcements.{kills,timer,join}` toggles
- [ ] 24. Docstrings on core utils

### E. New gameplay — commit `f8ca0de`
- [ ] 25. Basic Attack + Rest for every entity
- [ ] 26. Lava entry damage (already present; documented)
- [ ] 27. DoT summary at turn start
- [ ] 28. `%turnorder` alias
- [ ] 29. `%cooldowns` command
- [ ] 30. `%help <command>`

### F. Combat & targeting — commit `eb06ad1`
- [ ] 31. Directional AoE aiming
- [ ] 32. Block movement onto occupied tiles
- [ ] 33. `%terrain <pos>`
- [ ] 34. `%los <a>,<b>`
- [ ] 35. Auto-trigger reactions on hit
- [ ] 36. `%moves [entity]`

### G. Resources & status — commit `5564905`
- [ ] 37. `%resources [entity]`
- [ ] 38. `%resource <entity>,<name>,<delta>`
- [ ] 39. `%mp <delta>[,entity]`
- [ ] 40. `%uses [entity]`
- [ ] 41. `%buffs [entity]`
- [ ] 42. `%cure <entity>`

### H. Team / spectate / chat — commit `4bf98da`
- [ ] 43. `%teams`
- [ ] 44. `%spectate`
- [ ] 45. `%chat <msg>`
- [ ] 46. `%premove list`
- [ ] 47. `%round`
- [ ] 48. `%undo` alias

### I. Robustness & UX — commits `f679227` + `ceab7f8`
- [ ] 49. `%log tail <N>` / `%log clear`
- [ ] 50. Cap chat (200) / toasts (20)
- [ ] 51. `%pl` stable sort
- [ ] 52. `%info` cooldowns + uses
- [ ] 53. `%data` counts
- [ ] 54. **Routing fix** — 20 game commands were dead; now routed

### J. Data / mechanics — commit `5683418`
- [ ] 55. `%rollstats <formula>`
- [ ] 56. `%freq <ability>`
- [ ] 57. `%version`
- [ ] 58. `%statuses`
- [ ] 59. `%summary`
- [ ] 60. `%standings`

### K. Aliases & items (was PRs #245–#248) — commits `a596b32`, `367905e`, `3332e78`, `6ba8422`, `8735e45`
- [ ] 61. `%j` alias for `%join`
- [ ] 62. Short class/weapon name lookups (`resolveName`: exact → alias → unique prefix)
- [ ] 63. Editor `aliases` field on classes / weapons / abilities
- [ ] 64. Items workflow (beta): `ItemData` model, editor section, `%wt <item>`, `%vi`

### L. Loot, records & game flow (batch 11) — commit `96fbaee`
- [ ] 65. `%loot [entity]`
- [ ] 66. `%xp [entity]`
- [ ] 67. `%gold [entity]`
- [ ] 68. `%gems [entity]`
- [ ] 69. `%records [N]` lifetime leaderboard (`src/records.ts`)
- [ ] 70. `%surrender` / `%forfeit`
- [ ] 71. `%rematch`
- [ ] 72. `%coin`
- [ ] 73. `%pick`

### M. Records, lookups & export (batch 12) — commit `f5f43cf`
- [ ] 74. Records persistence to `records.json` (load on boot, save on game over)
- [ ] 75. `%records <name>` — one player's record
- [ ] 76. `%records reset` — dev-only clear
- [ ] 77. Ability alias/prefix resolution in `%wt` / `%freq`
- [ ] 78. `%find <query>` — search classes/weapons/abilities/items
- [ ] 79. `%export` — full action-log replay transcript

### N. Item equip & usage (batch 13) — commit `c5364de`
- [ ] 80. `parseItemStats` — stat-mod parsing (`ATK +2` / `+2 ATK`)
- [ ] 81. Entity inventory fields (`inventory` / `equipped` / `maxSlots`)
- [ ] 82. `%giveitem <entity>, <item>` — host grants an item
- [ ] 83. `%takeitem <entity>, <item>` — host removes an item
- [ ] 84. `%equip <item>` — equip with slot enforcement + stat mods
- [ ] 85. `%unequip <item>` — revert stat mods
- [ ] 86. `%inventory [entity]` — list items + slot usage
- [ ] 87. `%useitem <item>` — consume an item (heals if the effect implies one)

### O. Damage, team surrender & AFK (batch 14) — commit `f5c4944`
- [ ] 88. Damage tracking (`damageDealt` / `damageTaken` entity fields)
- [ ] 89. `%damage [entity]` — show damage dealt/taken
- [ ] 90. `%forfeit` — individual concede
- [ ] 91. `%surrender` — team majority vote (individual forfeit in FFA)
- [ ] 92. `%afk [entity]` — mark an entity away
- [ ] 93. `%return [entity]` + AFK auto-skip + "(AFK)" in `%summary`

### P. Host tools (batch 15) — commit `3edb45b`
- [ ] 94. `%kill <entity>` — host force-defeat
- [ ] 95. `%heal <entity>[,amount]` — host heal (default full)
- [ ] 96. `%setpos <entity>, <tile>` — host relocate
- [ ] 97. `%announce <msg>` — host room broadcast
- [ ] 98. `%pause` — host pause turn advancement
- [ ] 99. `%resume` — host resume a paused game
- [ ] 100. `%kick <entity>` — host remove an entity entirely
- [ ] 101. `%transfer <user>` — host hand off the host role
- [ ] 102. `%roominfo` — room/game status

### Q. Lists & lookups (batch 16) — commit `c5481a5`
- [ ] 103. `%kills` — kill leaderboard
- [ ] 104. `%dead` — defeated/removed entities (graveyard)
- [ ] 105. `%alive` — living entities with HP
- [ ] 106. `%items [query]` — item catalog lookup
- [ ] 107. `%classes` — list all classes
- [ ] 108. `%weapons` — list all weapons
- [ ] 109. `%abilities <ref>` — abilities of entity/class/weapon
- [ ] 110. `%mapinfo` — map size + terrain counts
- [ ] 111. `%uptime` — bot uptime

### R. Host reset/clear (batch 17) — commit `169c28c`
- [ ] 112. `%fullheal [entity]` — restore HP to full
- [ ] 113. `%restoremp [entity]` — restore MP to max
- [ ] 114. `%clearstatus [entity]` — clear all statuses
- [ ] 115. `%clearbuffs [entity]` — clear all buffs
- [ ] 116. `%clearcooldowns [entity]` / `%clearcds`
- [ ] 117. `%clearuses [entity]` — reset ability uses
- [ ] 118. `%setterrain <pos>, <terrain>` — override a tile
- [ ] 119. `%reset [entity]` — full stat/status reset

### S. Fun & meta (batch 18) — commit `c007d0a`
- [ ] 120. `%8ball <question>` — magic 8-ball
- [ ] 121. `%rps <move>` — rock/paper/scissors vs bot
- [ ] 122. `%time` — local + UTC time
- [ ] 123. `%rand <n>` / `%rand <min>, <max>`
- [ ] 124. `%shuffle <a>, <b>, ...` — shuffled list
- [ ] 125. `%note <text>` / `%note` / `%note clear` — private note
- [ ] 126. `%motd [text]` — room message of the day
- [ ] 127. `%mode` — current mode + phase
- [ ] — (routing) batch 17 host commands wired into `index.ts`

### T. Player QoL (batch 19) — commit `bfdc095`
- [ ] 128. `%me` — your own entity's full info
- [ ] 129. `%pos [entity]` — board position
- [ ] 130. `%team` — your team's roster with status
- [ ] 131. `%targets` — living entities by distance
- [ ] 132. `%hint` — contextual suggestion
- [ ] 133. `%history [N]` — last N log entries
- [ ] 134. `%turn` — alias for `%round`
- [ ] 135. `%premove clear` — clear your pre-move

### U. Moderation & misc (batch 20) — commit `9c5309a`
- [ ] 136. `%rules [text]` — room rules (host sets)
- [ ] 137. `%faq [text]` — room FAQ (host sets)
- [ ] 138. `%echo <text>` — host repeat to room
- [ ] 139. `%rolloff <a>, <b>` — d20 rolloff
- [ ] 140. `%mute <user>` — host mute
- [ ] 141. `%unmute <user>` — host unmute
- [ ] 142. `%warn <user>, <reason>` — host warning PM
- [ ] 143. `%commands` — alias for `%help`

## Deferred ideas (not implemented)
- [ ] Auto-skip on shot-clock expiry (timeout → auto-AFK; AFK is currently manual)
- [ ] Cross-game player profiles (carry records/xp/gold into a persistent account)
- [ ] Replay export to a shareable paste/file

> `%buyitem` / gold economy is intentionally out of scope (per request).

## Verification state (at time of writing)
- `tsc --noEmit` clean
- 451/451 tests pass (20 files)
