import { send, sendPm, toId } from "../utils.js";
import { games, type Game } from "../game/state.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";
import { hostCommand } from "./host.js";
import { gameCommand } from "./game.js";
import { infoCommand } from "./info.js";
import { playerCommand } from "./player.js";
import { sheetsCommand } from "./sheets.js";
import { calcCommand } from "./calc.js";

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

  if (id === "help" || id === "h") {
    const help = [
      "**Host Commands**: %host [4.3], %setgame, %addp, %addm, %remp, %setmap, %setlevel, %setteam, %setjugg, %gento, %start, %dehost, %listmaps, %close, %endvote, %nudge, %setclass, %setweapon, %setloadout",
      "**In-Game (Host)**: %info, %map, %pl, %to, %status, %regp, %hp, %cut, %cr, %timer",
      "**In-Game (Player)**: %move, %use, %dash, %target, %choose, %confirm, %cancel, %endturn, %premove, %passmove, %pathstep, %confirmmove, %cancelpath, %viewreach, %dashmode, %r, %vote, %votestatus, %unvote, %leave",
      "**Character**: %vs, %vl, %vi, %sc, %sw, %sco",
      "**Reference**: %wt, %rf, %wtm",
      "**Sheets**: %sheets, %sheets all",
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
    id === "pathstep" ||
    id === "confirmmove" ||
    id === "cancelpath" ||
    id === "viewreach" ||
    id === "dashmode" ||
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
