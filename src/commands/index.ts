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
  if (id === "wt" || id === "rf" || id === "wtm") {
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
    id === "target" ||
    id === "choose"
  ) {
    gameCommand(room, user, id, args, val, pm);
    return;
  }

  // Loot/progression
  if (id === "loot" || id === "xp" || id === "gold" || id === "score") {
    playerCommand(user, id, args || val);
    return;
  }

  // Sheets/compliance
  if (id === "sheets") {
    sheetsCommand(user, id, args || val);
    return;
  }
}
