# Ice Kyubs Command Reference

Last updated by tenzhii (with help from SaltiestCactus43) on 2/1/2021

## General Commands

| Command                             | Description                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `%mail [user], [message]`           | Sends a message to the specified user that they can read when online. A mailbox has a maximum size of 10.               |
| `%checkmail`                        | Checks your inbox.                                                                                                      |
| `%readmail`                         | Shows the first message in your inbox.                                                                                  |
| `%rename [old name], [new name]`    | Renames a user. Staff only.                                                                                             |
| `%regp [player], [class], [weapon]` | Registers a player. Voice and up only.                                                                                  |
| `%timer [X]`                        | (Host) global countdown of X seconds (default 120). `%timer off` cancels.                                                |
| `%stop`                             | Stop a started timer.                                                                                                   |
| `%modchat [+/ac/off]`               | Turn on (or off) modchat with the specified settings. Staff only.                                                       |
| `%host [user]`                      | Gives the specified user hosting powers. Voices and up only. Approved hosts can use this command on themselves.         |
| `%eventhost [user]`                 | Gives the specified user hosting powers for a 1v1 elobattle; can be shortened to `%elohost`. Voices and up only.        |
| `%dehost [user]`                    | Removes hosting powers from the specified user. Hosts may dehost themselves. Only voices and up may dehost other hosts. |
| `%dehost elo [user]`                | Like dehost, except it indicates that the game was an elo game.                                                         |
| `%resetwin [winner], [loser]`       | Resets an elo game's results. Staff only; can be shortened to `%rwin`.                                                  |
| `%relo`                             | Used while playing an elo game to randomize the combos of both players.                                                 |
| `%roll [XdY+Z]`                     | Roll a random set of dice. X is the number of dice, Y the amount of sides and Z the added modifier.                     |
| `%reghelp`                          | PMs the user a list of available classes and weapons for registration.                                                  |
| `%quote`                            | Brings up a random quote from the bot database. Joke command.                                                           |
| `%joke`                             | Brings up a random joke from the bot database. Joke command.                                                            |
| `%seal`                             | Brings up a random fact about seals. Joke command.                                                                      |
| `%praise (input)`                   | Ice Kyubs praises whatever is input after the command. Joke command.                                                    |
| `%lynch`                            | Lynches a user. Joke command.                                                                                           |
| `%pick [option1], [option2], ...`   | Randomly select an option.                                                                                              |

## Reference Commands

| Command                                                                                                                                                  | Description                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `%rf [input]`                                                                                                                                            | Brings up a link for the input. Useful references: rules, changelog, home, items, glossary                                              |
| `%wt [input]`                                                                                                                                            | Gives you data for the input. e.g. `%wt cursed slice` for ability data, `%wt longbow` for weapon abilities, `%wt burn` for status data, `%wt modes` for all gamemode descriptions. |
| `%stats`                                                                                                                                                 | Returns a table with the stats for all weapons and classes at all levels.                                                               |
| `%addmove [name], [class and level], [frequency], [miss rate], [roll], [damage type/action type], [number of targets/target group/range], [description]` | Adds/Edits a move to Kyubs' database. Staff only.                                                                                       |
| `%addlink [name], [link]`                                                                                                                                | Adds/Edits a link to Kyubs' database. Staff only.                                                                                       |
| `%addtext [name], [text]`                                                                                                                                | Adds/Edits a text command to Kyubs' database. Staff only.                                                                               |

## Battle Commands

| Command                              | Description                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `%join [squad number]`               | Allows you to join a battle if the squad has been opened.                          |
| `%open`                              | Opens signups for your squad. Hosts only.                                          |
| `%openbsu`                           | Same as open, but automatically highlights the room. Hosts only.                   |
| `%close`                             | Closes signups for your squad AND opens gamemode voting. Hosts only.              |
| `%vote [mode]`                        | Cast/change your gamemode vote (FFA, 1v1, 2v2, 3v3, 4v4, 2v2v2, NTR, Juggernaut, 2vJ/3vJ/4vJ, PvPJ, PvP NTR) while voting is open; options filter by lobby size (2p offers only 1v1/NTR; modes defined up to 8p); bare `%vote` shows tallies. Use `%wt modes` or `%wt <mode>` to learn what each mode is. |
| `%votestatus`                         | Check the live vote: tallies, runoff state, and who hasn't voted yet. Anyone can use it.                                                          |
| `%unvote`                             | Withdraw your gamemode vote.                                                          |
| `%endvote`                            | Closes voting and applies the winning mode; on a tie, starts a runoff restricted to the tied modes. Hosts only.                            |
| `%nudge`                              | Pings the players who haven't voted yet (@Name) so they finish voting. Hosts only.                            |
| `%leave`                              | Leaves the game you're in: removes your entity, turn-order slot, and any vote. Hosts use %dehost.             |
| `%autoclose [value]`                 | Autoclose the game after the specified time in seconds. Hosts only.                |
| `%setgame [gamemode]`                | Sets up the game for the desired gamemode. Hosts only.                             |
| `%pos [pl]+[mode]`                   | Gives starting positions for the selected game mode and PL size (e.g. 8pffa, 2v2). |
| `%hp [value], [user1], [user2], ...` | Adjusts HP for the specified users.                                                |

## Bot Game Commands (from new bot)

### Host Commands

| Command                                    | Description                            |
| ------------------------------------------ | -------------------------------------- |
| `%host`                                    | Create a new game in the current room. |
| `%dehost`                                  | Close and remove the game.             |
| `%setgame [mode]`                          | Set mode AND complete setup: random map from the mode's pool (if none set), teams (NvM), positions, turn order — then %start. |
| `%addp [name], [class], [weapon], [level]` | Add a player to the game.              |
| `%remp [name]`                             | Remove a player from the game.         |
| `%setmap [name\|gamemode\|gen [12\|16\|20]]` | Set a curated map, a random map from a gamemode pool (pvp, 1v1...), or generate a procedural map (gen). `%start` requires a map. |
| `%listmaps [mode]`                         | List maps; shows recommended maps for the game mode (or a specific mode). |
| `%genpos [4pffa\|2v2\|3v3...]`           | Set starting positions: FFA spread symmetrically, or team matches (NvM) on mirrored halves with auto-teams + mode. |
| `%gento`                                   | Generate turn order.                   |
| `%start`                                   | Start the game.                        |

### Player Commands

| Command                              | Description                                   |
| ------------------------------------ | --------------------------------------------- |
| `%move [pos][,player]`               | Move to a tile. Host can specify player.      |
| `%dash [,player]`                    | Dash (1.5x MP). Host can specify player.      |
| `%passmove`                          | Skip movement and go to the action phase.     |
| `%use [ability] @ [target][,player]` | Use an ability. Host can specify player.      |
| `%endturn`                           | End current turn. Host bypass available.      |
| `%next`                              | Resolve current turn and advance (host only). |
| `%back`                              | Undo last action.                             |
| `%leave`                             | Leave the game you're in (removes your entity, turn-order slot, and any vote). The host uses %dehost instead. |

### Display Commands

| Command          | Description               |
| ---------------- | ------------------------- |
| `%info [entity]` | Show game or entity info. |
| `%map`           | Re-display the map.       |
| `%pl`            | Show player list.         |
| `%to`            | Show turn order.          |

### Utility Commands

| Command                   | Description                           |
| ------------------------- | ------------------------------------- |
| `%r [XdY+Z]`              | Roll dice.                            |
| `%hp [entity], [amount]`  | Host manually adjusts HP.             |
| `%cut [entity], [seconds]` | (Host) shot clock on a player (default 120s). `%cut off` cancels. |
| `%cr [from], [to]`        | Check distance between two positions. |

### Reference Commands

| Command        | Description                             |
| -------------- | --------------------------------------- |
| `%wt [input]`  | Look up weapon/class/ability data.      |
| `%rf [input]`  | Look up reference links.                |
| `%wtm [input]` | Look up ability data in BD Lang format. |

### Character Commands

| Command                             | Description             |
| ----------------------------------- | ----------------------- |
| `%vs [player]`                      | View player stats.      |
| `%vl [player]`                      | View player levels.     |
| `%vi [player]`                      | View player items.      |
| `%sc [class]`                       | Change YOUR class until the game starts.    |
| `%sw [weapon]`                      | Change YOUR weapon until the game starts.   |
| `%sco [class], [weapon]`            | Set YOUR class AND weapon in one go until the game starts. |
| `%setclass [player], [class]`       | Host-only: set any player's class (any time).              |
| `%setweapon [player], [weapon]`     | Host-only: set any player's weapon (any time).             |
| `%setloadout [player], [class], [weapon]` | Host-only: set any player's class AND weapon (any time).     |
| `%regp [player], [class], [weapon]` | Register a player.      |

### Loot/Progression Commands

| Command                    | Description             |
| -------------------------- | ----------------------- |
| `%loot [player]`           | Roll loot for a player. |
| `%xp [player], [amount]`   | Give XP to a player.    |
| `%gold [player], [amount]` | Give gold to a player.  |

> **Note**: The Character Commands and Loot/Progression Commands sections above are stub routes in `src/commands/player.ts` — they will **not** be implemented. They exist as routing placeholders only.
