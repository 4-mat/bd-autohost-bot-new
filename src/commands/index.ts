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

const START = Date.now();
const MOTD = new Map<string, string>();
const NOTES = new Map<string, string>();

function roomGame(roomId?: string): Game | null {
  if (!roomId) return null;
  for (const g of games.values()) if (g.room === roomId) return g;
  return null;
}

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
  kills: "Kill leaderboard (%kills).",
  dead: "List defeated/removed entities (%dead).",
  alive: "List living entities (%alive).",
  items: "List/filter the item catalog (%items [query]).",
  classes: "List all classes (%classes).",
  weapons: "List all weapons (%weapons).",
  abilities: "List a class/weapon/entity's abilities (%abilities <ref>).",
  mapinfo: "Map size + terrain counts (%mapinfo).",
  uptime: "Bot uptime (%uptime).",
  fullheal: "Host: restore HP to full (%fullheal [entity]).",
  restoremp: "Host: restore MP to max (%restoremp [entity]).",
  clearstatus: "Host: clear all statuses (%clearstatus [entity]).",
  clearbuffs: "Host: clear all buffs (%clearbuffs [entity]).",
  clearcooldowns: "Host: clear cooldowns (%clearcooldowns [entity]).",
  clearuses: "Host: reset ability uses (%clearuses [entity]).",
  setterrain: "Host: override a tile's terrain (%setterrain <pos>, <terrain>).",
  reset: "Host: full stat/status reset (%reset [entity]).",
  "8ball": "Ask the magic 8-ball (%8ball <question>).",
  rps: "Rock/paper/scissors vs the bot (%rps <move>).",
  time: "Current local and UTC time.",
  rand: "Random integer (%rand <n> or %rand <min>, <max>).",
  shuffle: "Shuffle a comma-separated list (%shuffle a, b, c).",
  note: "Save a private note (%note <text>, %note, %note clear).",
  motd: "Room message of the day (%motd, host sets %motd <text>).",
  mode: "Current mode and phase (%mode).",
  me: "Your own entity's full info (%me).",
  pos: "An entity's board position (%pos [entity]).",
  team: "Your team's roster with status (%team).",
  targets: "Living entities by distance from the current turn (%targets).",
  hint: "Contextual suggestion for the current player (%hint).",
  history: "Last N action-log entries (%history [N]).",
  turn: "Whose turn it is (alias: %round).",
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

  if (id === "uptime") {
    const secs = Math.floor((Date.now() - START) / 1000);
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    sendPm(user.name, `Uptime: ${d}d ${h}h ${m}m`);
    return;
  }
  if (id === "8ball") {
    const question = (args || val).trim();
    if (!question) return sendPm(user.name, "Ask a yes/no question: %8ball <question>");
    const answers = [
      "It is certain.",
      "Without a doubt.",
      "Yes, definitely.",
      "You may rely on it.",
      "Reply hazy, try again.",
      "Ask again later.",
      "Cannot predict now.",
      "Don't count on it.",
      "My sources say no.",
      "Very doubtful.",
    ];
    sendPm(user.name, `8-ball: ${answers[Math.floor(Math.random() * answers.length)]}`);
    return;
  }

  if (id === "rps") {
    const map: Record<string, string> = { r: "rock", p: "paper", s: "scissors" };
    const player = map[toId((args || val).trim())] ?? toId((args || val).trim());
    if (!["rock", "paper", "scissors"].includes(player)) {
      return sendPm(user.name, "Usage: %rps <rock|paper|scissors> (r/p/s work too)");
    }
    const bot = ["rock", "paper", "scissors"][Math.floor(Math.random() * 3)];
    const beats: Record<string, string> = { rock: "scissors", scissors: "paper", paper: "rock" };
    const result = player === bot ? "tie" : beats[player] === bot ? "win" : "lose";
    const label = { win: "You win!", lose: "You lose!", tie: "It's a tie!" }[result];
    sendPm(user.name, `You threw ${player}, bot threw ${bot}. ${label}`);
    return;
  }

  if (id === "time") {
    const now = new Date();
    sendPm(user.name, `Local: ${now.toLocaleString()} | UTC: ${now.toUTCString()}`);
    return;
  }

  if (id === "rand") {
    const parts = (args || val).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1) {
      const n = parseInt(parts[0], 10);
      if (isNaN(n) || n < 1) return sendPm(user.name, "Usage: %rand <n> or %rand <min>, <max>");
      return sendPm(user.name, `Rolled ${Math.floor(Math.random() * n) + 1} (1-${n})`);
    }
    if (parts.length >= 2) {
      const a = parseInt(parts[0], 10);
      const b = parseInt(parts[1], 10);
      if (isNaN(a) || isNaN(b) || a > b) return sendPm(user.name, "Usage: %rand <min>, <max>");
      return sendPm(user.name, `Rolled ${Math.floor(Math.random() * (b - a + 1)) + a} (${a}-${b})`);
    }
    return sendPm(user.name, "Usage: %rand <n> or %rand <min>, <max>");
  }

  if (id === "shuffle") {
    const list = (args || val).split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length < 2) return sendPm(user.name, "Usage: %shuffle <a>, <b>, <c>");
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    sendPm(user.name, `Shuffled: ${list.join(", ")}`);
    return;
  }

  if (id === "note") {
    const text = (args || val).trim();
    if (text.toLowerCase() === "clear") {
      NOTES.delete(user.id);
      sendPm(user.name, "Note cleared.");
      return;
    }
    if (!text) {
      const saved = NOTES.get(user.id);
      sendPm(user.name, saved ? `Your note: ${saved}` : "No note saved. Use %note <text>.");
      return;
    }
    NOTES.set(user.id, text);
    sendPm(user.name, "Note saved.");
    return;
  }

  if (id === "motd") {
    const text = (args || val).trim();
    if (!text) {
      const saved = room?.id ? MOTD.get(room.id) : undefined;
      sendPm(user.name, saved ? `**MOTD**: ${saved}` : "No MOTD set.");
      return;
    }
    if (!room?.id) return sendPm(user.name, "MOTD requires a room.");
    const g = roomGame(room.id);
    if (g && toId(g.host) !== toId(user.name)) {
      return sendPm(user.name, "Only the host can set the MOTD.");
    }
    MOTD.set(room.id, text);
    sendPm(user.name, "MOTD set.");
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
    id === "find" ||
    id === "items" ||
    id === "classes" ||
    id === "weapons"
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
    id === "fullheal" ||
    id === "restoremp" ||
    id === "clearstatus" ||
    id === "clearbuffs" ||
    id === "clearcooldowns" ||
    id === "clearcds" ||
    id === "clearuses" ||
    id === "setterrain" ||
    id === "reset" ||
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
    id === "roominfo" ||
    id === "kills" ||
    id === "dead" ||
    id === "alive" ||
    id === "abilities" ||
    id === "mapinfo" ||
    id === "mode" ||
    id === "me" ||
    id === "pos" ||
    id === "team" ||
    id === "targets" ||
    id === "hint" ||
    id === "history" ||
    id === "turn"
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
