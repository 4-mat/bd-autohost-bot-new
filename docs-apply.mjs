import { readFileSync, writeFileSync } from "node:fs";

const path = "CHECKLIST.md";
let s = readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const groups = `### P. Host tools (batch 15) — commit \`3edb45b\`
- [ ] 94. \`%kill <entity>\` — host force-defeat
- [ ] 95. \`%heal <entity>[,amount]\` — host heal (default full)
- [ ] 96. \`%setpos <entity>, <tile>\` — host relocate
- [ ] 97. \`%announce <msg>\` — host room broadcast
- [ ] 98. \`%pause\` — host pause turn advancement
- [ ] 99. \`%resume\` — host resume a paused game
- [ ] 100. \`%kick <entity>\` — host remove an entity entirely
- [ ] 101. \`%transfer <user>\` — host hand off the host role
- [ ] 102. \`%roominfo\` — room/game status

### Q. Lists & lookups (batch 16) — commit \`c5481a5\`
- [ ] 103. \`%kills\` — kill leaderboard
- [ ] 104. \`%dead\` — defeated/removed entities (graveyard)
- [ ] 105. \`%alive\` — living entities with HP
- [ ] 106. \`%items [query]\` — item catalog lookup
- [ ] 107. \`%classes\` — list all classes
- [ ] 108. \`%weapons\` — list all weapons
- [ ] 109. \`%abilities <ref>\` — abilities of entity/class/weapon
- [ ] 110. \`%mapinfo\` — map size + terrain counts
- [ ] 111. \`%uptime\` — bot uptime

### R. Host reset/clear (batch 17) — commit \`169c28c\`
- [ ] 112. \`%fullheal [entity]\` — restore HP to full
- [ ] 113. \`%restoremp [entity]\` — restore MP to max
- [ ] 114. \`%clearstatus [entity]\` — clear all statuses
- [ ] 115. \`%clearbuffs [entity]\` — clear all buffs
- [ ] 116. \`%clearcooldowns [entity]\` / \`%clearcds\`
- [ ] 117. \`%clearuses [entity]\` — reset ability uses
- [ ] 118. \`%setterrain <pos>, <terrain>\` — override a tile
- [ ] 119. \`%reset [entity]\` — full stat/status reset

### S. Fun & meta (batch 18) — commit \`c007d0a\`
- [ ] 120. \`%8ball <question>\` — magic 8-ball
- [ ] 121. \`%rps <move>\` — rock/paper/scissors vs bot
- [ ] 122. \`%time\` — local + UTC time
- [ ] 123. \`%rand <n>\` / \`%rand <min>, <max>\`
- [ ] 124. \`%shuffle <a>, <b>, ...\` — shuffled list
- [ ] 125. \`%note <text>\` / \`%note\` / \`%note clear\` — private note
- [ ] 126. \`%motd [text]\` — room message of the day
- [ ] 127. \`%mode\` — current mode + phase
- [ ] — (routing) batch 17 host commands wired into \`index.ts\`

### T. Player QoL (batch 19) — commit \`bfdc095\`
- [ ] 128. \`%me\` — your own entity's full info
- [ ] 129. \`%pos [entity]\` — board position
- [ ] 130. \`%team\` — your team's roster with status
- [ ] 131. \`%targets\` — living entities by distance
- [ ] 132. \`%hint\` — contextual suggestion
- [ ] 133. \`%history [N]\` — last N log entries
- [ ] 134. \`%turn\` — alias for \`%round\`
- [ ] 135. \`%premove clear\` — clear your pre-move

### U. Moderation & misc (batch 20) — commit \`9c5309a\`
- [ ] 136. \`%rules [text]\` — room rules (host sets)
- [ ] 137. \`%faq [text]\` — room FAQ (host sets)
- [ ] 138. \`%echo <text>\` — host repeat to room
- [ ] 139. \`%rolloff <a>, <b>\` — d20 rolloff
- [ ] 140. \`%mute <user>\` — host mute
- [ ] 141. \`%unmute <user>\` — host unmute
- [ ] 142. \`%warn <user>, <reason>\` — host warning PM
- [ ] 143. \`%commands\` — alias for \`%help\`

## Deferred ideas (not implemented)`;

const anchor = "## Deferred ideas (not implemented)";
if (!s.includes(anchor)) {
  console.error("MISSING anchor");
  process.exit(1);
}
s = s.replace(anchor, groups);
writeFileSync(path, s);
console.log("CHECKLIST.md updated");
