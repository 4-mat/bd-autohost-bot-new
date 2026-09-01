import { send, sendPm, toId } from "../utils.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";
import { hostCommand } from "./host.js";
import { gameCommand } from "./game.js";
import { infoCommand } from "./info.js";
import { playerCommand } from "./player.js";
import { sheetsCommand } from "./sheets.js";
import { calcCommand } from "./calc.js";

type Handler = (
  room: Room | null,
  user: User,
  id: string,
  args: string,
  val: string,
  pm: boolean,
) => void;

/** Commands handled by the host module (game setup + management). */
const HOST_COMMANDS = new Set([
  "host",
  "dehost",
  "setgame",
  "addp",
  "addm",
  "remp",
  "setmap",
  "listmaps",
  "setlevel",
  "sl",
  "setteam",
  "setjugg",
  "gento",
  "start",
  "sc",
  "sw",
  "sco",
  "setclass",
  "setweapon",
  "setloadout",
  "open",
  "openbsu",
  "close",
  "endvote",
  "ffabtn",
  "nudge",
  "join",
  "genpos",
]);

/** Commands handled by the game module (movement, attacks, display). */
const GAME_COMMANDS = new Set([
  "info",
  "map",
  "pl",
  "to",
  "move",
  "attack",
  "use",
  "dash",
  "confirm",
  "cancel",
  "target",
  "choose",
  "vote",
  "votestatus",
  "unvote",
  "leave",
  "endturn",
  "next",
  "back",
  "r",
  "roll",
  "dice",
  "hp",
  "cut",
  "timer",
  "checkrange",
  "cr",
  "premove",
  "passmove",
  "pass",
  "status",
  "regp",
  "log",
  "dir",
  "tile",
]);

/** Character/loot commands handled by the player module. */
const PLAYER_COMMANDS = new Set([
  "vs",
  "vl",
  "vi",
  "viewstats",
  "viewlevels",
  "viewitems",
  "loot",
  "xp",
  "gold",
  "score",
]);

const HANDLERS: Record<string, Handler> = {
  ping(room, user, _id, _args, _val, pm) {
    send(
      pm ? `pm-${user.id}` : (room?.id ?? ""),
      pm ? `|/pm ${user.name}, pong!` : "|pong!",
    );
  },
  help(_room, user, _id, _args, _val, _pm) {
    const help = [
      "**Host Commands**: %host, %setgame, %addp, %addm, %remp, %setmap, %setlevel, %setteam, %setjugg, %gento, %start, %dehost, %listmaps, %close, %endvote, %nudge, %setclass, %setweapon, %setloadout",
      "**In-Game (Host)**: %info, %map, %pl, %to, %status, %regp, %hp, %cut, %cr, %timer",
      "**In-Game (Player)**: %move, %use, %dash, %target, %choose, %confirm, %cancel, %endturn, %premove, %r, %vote, %votestatus, %unvote, %leave",
      "**Character**: %vs, %vl, %vi, %sc, %sw, %sco",
      "**Reference**: %wt, %rf, %wtm",
      "**Sheets**: %sheets, %sheets all, %sheets approve",
    ];
    sendPm(user.name, help.join("\n"));
  },
  calc(_room, user, _id, args, val, _pm) {
    calcCommand(user, (args || val).trim());
  },
  wt(_room, user, id, args, val, _pm) {
    infoCommand(user, id, args || val);
  },
  rf(_room, user, id, args, val, _pm) {
    infoCommand(user, id, args || val);
  },
  wtm(_room, user, id, args, val, _pm) {
    infoCommand(user, id, args || val);
  },
  sheets(_room, user, id, args, val, _pm) {
    sheetsCommand(user, id, args || val);
  },
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

  const handler = HANDLERS[id] ?? HANDLERS[toId(id)];
  if (handler) {
    handler(room, user, id, args, val, pm);
    return;
  }
  if (id === "h") return HANDLERS.help(room, user, id, args, val, pm);
  if (HOST_COMMANDS.has(id)) {
    hostCommand(room, user, id, args, val, pm);
    return;
  }
  if (GAME_COMMANDS.has(id)) {
    gameCommand(room, user, id, args, val, pm);
    return;
  }
  if (PLAYER_COMMANDS.has(id)) {
    playerCommand(user, id, args || val);
  }
}
