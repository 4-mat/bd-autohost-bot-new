import { send, sendPm, toId, isDev } from "../utils.js";
import { games, type Game } from "../game/state.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";
import { hostCommand } from "./host.js";
import { gameCommand } from "./game.js";
import { infoCommand } from "./info.js";
import { playerCommand } from "./player.js";
import { sheetsCommand } from "./sheets.js";
import { calcCommand } from "./calc.js";

// One-line help for common commands, shown by `%help <command>`.
const COMMAND_HELP: Record<string, string> = {
  move: "Move your entity to a reachable tile (%move e4).",
  dash: "Spend MP to move up to 1.5x tiles as a Full action (%dash e4).",
  use: "Use an ability (%use Fireball @ P2).",
  attack: "Alias for %use.",
  target: "Pick a target for a pending attack (%target P2).",
  choose: "Pick an option for a pending choice (%choose <id>).",
  confirm: "Confirm and resolve the pending action.",
  cancel: "Cancel the pending action.",
  endturn: "Pass to the next entity in turn order.",
  premove: "Queue a move to run at the start of your turn.",
  info: "Show game or entity info (%info [entity]).",
  pl: "List all players and their stats.",
  to: "Show the turn order (alias: %turnorder).",
  turnorder: "Show the turn order (alias: %to).",
  cooldowns: "Show ability cooldown counts (%cooldowns [entity]).",
  wt: "Look up an ability, item, status, tile, or mode.",
  timer: "Start a global shot clock (%timer 60).",
  cut: "Put a shot clock on a player (%cut P1 60).",
  vote: "Vote for a gamemode (%vote <mode>).",
  leave: "Leave the game.",
  loot: "Show XP/gold/gems earned this game (%loot [entity]).",
  xp: "Show XP earned this game (%xp [entity]).",
  gold: "Show gold earned this game (%gold [entity]).",
  gems: "Show gems earned this game (%gems [entity]).",
  records: "Lifetime leaderboard (%records [N | <name> | reset]).",
  surrender: "Team vote to surrender (%surrender).",
  forfeit: "Concede and leave the game (%forfeit).",
  rematch: "Host: reset the board and restart (%rematch).",
  coin: "Flip a coin.",
  pick: "Pick one option at random (%pick a, b, c).",
  find: "Search classes/weapons/abilities/items (%find <query>).",
  export: "Dump the full action log as a replay transcript.",
  equip: "Equip an item from your inventory (%equip <item>).",
  unequip: "Unequip an item (%unequip <item>).",
  useitem: "Use a consumable item (%useitem <item>).",
  inventory: "List your items (%inventory [entity]).",
  giveitem: "Host: grant an item (%giveitem <entity>, <item>).",
  damage: "Show damage dealt/taken (%damage [entity]).",
  afk: "Mark yourself away; your turns are auto-skipped (%afk).",
  return: "Clear your AFK flag (%return).",
  kill: "Host: force-defeat an entity (%kill <entity>).",
  heal: "Host: heal an entity (%heal <entity>[,amount]).",
  setpos: "Host: relocate an entity (%setpos <entity>, <tile>).",
  announce: "Host: broadcast an announcement (%announce <msg>).",
  pause: "Host: pause turn advancement (%pause).",
  resume: "Host: resume a paused game (%resume).",
  kick: "Host: remove an entity (%kick <entity>).",
  transfer: "Host: hand off host role (%transfer <user>).",
  roominfo: "Show room/game status (%roominfo).",
};

export function handleCommand(
  room: Room | null,
  user: User | null,
  cmd: string,
  args: string,
  val: string,
  pm = false,
) {
  if (!user) return;
  user.last = Date.now();

  const id = toId(cmd);

  // General commands
  if (id === "ping") {
    send(
      pm ? `pm-${user.id}` : (room?.id ?? ""),
      pm ? `|/pm ${user.name}, pong!` : "|pong!",
    );
    return;
  }

  if (id === "coin") {
    sendPm(user.name, `Coin flip: **${Math.random() < 0.5 ? "Heads" : "Tails"}**.`);
    return;
  }

  if (id === "pick") {
    const options = (args || val)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (options.length === 0) {
      return sendPm(user.name, "Usage: %pick <a>, <b>, <c>");
    }
    sendPm(user.name, `Picked: **${options[Math.floor(Math.random() * options.length)]}**`);
    return;
  }

  // Dev-only diagnostics: active game list. Restricted to config.devs.
  if (id === "dev") {
    if (!isDev(user.name)) return;
    const active = [...games.values()];
    const lines = [
      `Active games: ${active.length}`
    ];
    for (const g of active) {
      lines.push(
        `  ${g.id} (${g.room}) mode=${g.mode} phase=${g.phase} round=${g.round} players=${g.entities.length}`
      );
    }
    sendPm(user.name, lines.join("\n"));
    return;
  }

  if (id === "help" || id === "h") {
    const topic = toId((args || val).trim());
    if (topic) {
      const entry = COMMAND_HELP[topic];
      sendPm(
        user.name,
        entry
          ? `**%${topic}** - ${entry}`
          : `No help for "%${topic}". Use %help for the command list.`,
      );
      return;
    }
    const help = [
      "**Host Commands**: %host, %setgame, %addp, %addm, %remp, %setmap, %setlevel, %setteam, %setjugg, %gento, %start, %dehost, %listmaps, %close, %endvote, %nudge, %setclass, %setweapon, %setloadout",
      "**In-Game (Host)**: %info, %map, %pl, %to, %status, %regp, %hp, %cut, %cr, %timer",
      "**In-Game (Player)**: %move, %use, %dash, %target, %choose, %confirm, %cancel, %endturn, %premove, %r, %vote, %votestatus, %unvote, %leave",
      "**Character**: %vs, %vl, %vi, %sc, %sw, %sco",
      "**Reference**: %wt, %rf, %wtm",
      "**Sheets**: %sheets, %sheets all, %sheets approve",
    ];
    sendPm(user.name, help.join("\n"));
    return;
  }

  if (id === "calc") {
    calcCommand(user, (args || val).trim());
    return;
  }

  // Info/reference commands
  if (
    id === "wt" ||
    id === "rf" ||
    id === "wtm" ||
    id === "data" ||
    id === "freq" ||
    id === "find"
  ) {
    infoCommand(user, id, args || val);
    return;
  }

  // Character commands
  if (
    id === "vs" ||
    id === "vl" ||
    id === "vi" ||
    id === "viewstats" ||
    id === "viewlevels" ||
    id === "viewitems"
  ) {
    playerCommand(user, id, args || val);
    return;
  }

  // Host commands (game setup + management)
  if (
    id === "host" ||
    id === "dehost" ||
    id === "setgame" ||
    id === "addp" ||
    id === "addm" ||
    id === "remp" ||
    id === "setmap" ||
    id === "listmaps" ||
    id === "setlevel" ||
    id === "sl" ||
    id === "setteam" ||
    id === "setjugg" ||
    id === "gento" ||
    id === "start" ||
    id === "sc" ||
    id === "sw" ||
    id === "sco" ||
    id === "setclass" ||
    id === "setweapon" ||
    id === "setloadout" ||
    id === "open" ||
    id === "openbsu" ||
    id === "close" ||
    id === "endvote" ||
    id === "ffabtn" ||
    id === "nudge" ||
    id === "join" ||
    id === "j" ||
    id === "rematch" ||
    id === "giveitem" ||
    id === "takeitem" ||
    id === "kill" ||
    id === "heal" ||
    id === "setpos" ||
    id === "announce" ||
    id === "pause" ||
    id === "resume" ||
    id === "kick" ||
    id === "transfer" ||
    id === "genpos"
  ) {
    hostCommand(room, user, id, args, val, pm);
    return;
  }

  // Game commands (movement, attacks, display)
  if (
    id === "info" ||
    id === "map" ||
    id === "pl" ||
    id === "to" ||
    id === "move" ||
    id === "attack" ||
    id === "use" ||
    id === "dash" ||
    id === "confirm" ||
    id === "cancel" ||
    id === "target" ||
    id === "choose" ||
    id === "vote" ||
    id === "votestatus" ||
    id === "unvote" ||
    id === "leave" ||
    id === "endturn" ||
    id === "next" ||
    id === "back" ||
    id === "r" ||
    id === "roll" ||
    id === "dice" ||
    id === "hp" ||
    id === "cut" ||
    id === "timer" ||
    id === "checkrange" ||
    id === "cr" ||
    id === "premove" ||
    id === "passmove" ||
    id === "pass" ||
    id === "status" ||
    id === "regp" ||
    id === "undo" ||
    id === "surrender" ||
    id === "forfeit" ||
    id === "log" ||
    id === "turnorder" ||
    id === "cooldowns" ||
    id === "cds" ||
    id === "terrain" ||
    id === "los" ||
    id === "moves" ||
    id === "resources" ||
    id === "resource" ||
    id === "mp" ||
    id === "uses" ||
    id === "buffs" ||
    id === "cure" ||
    id === "teams" ||
    id === "spectate" ||
    id === "chat" ||
    id === "round" ||
    id === "dir" ||
    id === "tile" ||
    id === "rollstats" ||
    id === "statuses" ||
    id === "summary" ||
    id === "standings" ||
    id === "version" ||
    id === "export" ||
    id === "equip" ||
    id === "unequip" ||
    id === "useitem" ||
    id === "inventory" ||
    id === "damage" ||
    id === "afk" ||
    id === "return" ||
    id === "roominfo"
  ) {
    gameCommand(room, user, id, args, val, pm);
    return;
  }

  // Loot/progression
  if (
    id === "loot" ||
    id === "xp" ||
    id === "gold" ||
    id === "gems" ||
    id === "records" ||
    id === "score"
  ) {
    playerCommand(user, id, args || val);
    return;
  }

  // Sheets/compliance
  if (id === "sheets") {
    sheetsCommand(user, id, args || val);
    return;
  }
}
