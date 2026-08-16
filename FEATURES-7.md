# Feature Sprint 7 — Batches 15–20 (50 features, #94–143)

Seventh pass; none overlap with the first 93. All 50 implemented, in six
commits on `feat/feature-sprint`.

## Batch 15 — Host tools (commit `3edb45b`)
94. `%kill <entity>` — host force-defeat.
95. `%heal <entity>[,amount]` — host heal (default full).
96. `%setpos <entity>, <tile>` — host relocate (validates bounds/terrain/occupancy).
97. `%announce <msg>` — host room broadcast.
98. `%pause` — host pause turn advancement.
99. `%resume` — host resume a paused game.
100. `%kick <entity>` — host remove an entity entirely.
101. `%transfer <user>` — host hand off the host role.
102. `%roominfo` — room/game status summary.

## Batch 16 — Lists & lookups (commit `c5481a5`)
103. `%kills` — kill leaderboard.
104. `%dead` — defeated/removed entities (graveyard, `game.graveyard`).
105. `%alive` — living entities with HP.
106. `%items [query]` — item catalog lookup.
107. `%classes` — list all classes.
108. `%weapons` — list all weapons.
109. `%abilities <ref>` — abilities of entity/class/weapon.
110. `%mapinfo` — map size + terrain counts.
111. `%uptime` — bot uptime.

## Batch 17 — Host reset/clear (commit `169c28c`)
112. `%fullheal [entity]` — restore HP to full.
113. `%restoremp [entity]` — restore MP to max (recomputed from class+weapon).
114. `%clearstatus [entity]` — clear all statuses.
115. `%clearbuffs [entity]` — clear all buffs.
116. `%clearcooldowns [entity]` / `%clearcds`.
117. `%clearuses [entity]` — reset ability uses.
118. `%setterrain <pos>, <terrain>` — override a tile's terrain.
119. `%reset [entity]` — full stat/status/AFK/damage reset (recalc + clear).

All default to every (living) entity when no target is given; all are host-only.

## Batch 18 — Fun & meta (commit `c007d0a`)
120. `%8ball <question>` — magic 8-ball.
121. `%rps <move>` — rock/paper/scissors vs bot (r/p/s accepted).
122. `%time` — local + UTC time.
123. `%rand <n>` / `%rand <min>, <max>` — random integer.
124. `%shuffle <a>, <b>, ...` — Fisher-Yates shuffled list.
125. `%note <text>` / `%note` / `%note clear` — private note.
126. `%motd [text]` — room message of the day (host sets).
127. `%mode` — current mode + phase.
Also: routed the batch 17 host commands through `index.ts` (they were dead
without it).

## Batch 19 — Player QoL (commit `bfdc095`)
128. `%me` — your own entity's full info.
129. `%pos [entity]` — board position.
130. `%team` — your team's roster with status.
131. `%targets` — living entities sorted by distance from the current turn.
132. `%hint` — contextual suggestion (reachable tiles, ability count).
133. `%history [N]` — last N log entries (default 5, capped 20).
134. `%turn` — alias for `%round`.
135. `%premove clear` — clear your pre-move.

## Batch 20 — Moderation & misc (commit `9c5309a`)
136. `%rules [text]` — room rules (host sets, default shown otherwise).
137. `%faq [text]` — room FAQ (host sets, default shown otherwise).
138. `%echo <text>` — host repeat to room.
139. `%rolloff <a>, <b>` — d20 rolloff between two parties.
140. `%mute <user>` — host mute (silently blocks all commands).
141. `%unmute <user>` — host unmute.
142. `%warn <user>, <reason>` — host warning PM.
143. `%commands` — alias for `%help`.

## Notes
- Mute is a module-level in-memory set; muted users are silently ignored at the
  top of `handleCommand`.
- `%rules` / `%faq` / `%motd` / `%note` are in-memory (lost on restart), keyed
  by room id or user id. No persistence was requested.
- No gold/buy economy; `%buyitem` remains out of scope.

## Verification
- `tsc --noEmit` clean.
- 451/451 tests pass (20 files).
