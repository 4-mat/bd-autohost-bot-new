import { send, sendPm, toId, parseArgs, parsePos, posToStr } from "../utils.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";
import {
  games,
  getCurrentEntity,
  getEntity,
  getReachableTiles,
  pushSnapshot,
  popSnapshot,
  nextTurn,
  dealDamage,
  removeEntity,
  checkGameOver,
  calculateLoot,
  dist,
  inRange,
  type Game,
  type Entity,
} from "../game/state.js";
import { rollDice } from "../utils.js";
import { buildHostPage, buildPlayerPage, premoveSet } from "../html/pages.js";
import { resolveAction } from "../game/resolve.js";

export function gameCommand(
  room: Room | null,
  user: User,
  cmd: string,
  args: string,
  val: string,
  pm = false,
) {
  const game = room ? findGameForRoom(room.id) : null;

  const full = val ? `${args},${val}` : args;

  switch (cmd) {
    case "move":
    case "dash":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleMove(game, user, cmd, full);
      break;

    case "attack":
    case "use":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleAttack(game, user, cmd, full);
      break;

    case "endturn":
    case "next":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleAdvanceTurn(game, user);
      break;

    case "back":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleBack(game, user);
      break;

    case "r":
    case "roll":
    case "dice":
      handleRoll(user.name, args);
      break;

    case "info":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleInfo(game, user, args);
      break;

    case "map":
      if (!game) return sendPm(user.name, "No active game in this room.");
      broadcastPages(game);
      break;

    case "premove":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handlePremove(game, user);
      break;

    case "pl":
      if (!game) return sendPm(user.name, "No active game in this room.");
      sendPm(user.name, buildPlayerList(game));
      break;

    case "to":
      if (!game) return sendPm(user.name, "No active game in this room.");
      sendPm(user.name, buildTurnOrder(game));
      break;

    case "hp":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleHp(game, user, args);
      break;

    case "cut":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleCut(game, user, args);
      break;

    case "checkrange":
    case "cr":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleCheckRange(game, user, args);
      break;

    default:
      sendPm(user.name, `Game command ${cmd}: not yet implemented.`);
      break;
  }
}

function findGameForRoom(roomid: string): Game | null {
  for (const game of games.values()) {
    if (game.room === roomid) return game;
  }
  return null;
}

function handleMove(game: Game, user: User, cmd: string, args: string) {
  const isHost = toId(user.name) === toId(game.host);

  let entityName = "";
  let posStr = args;

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length >= 3) {
    entityName = parts[parts.length - 1];
    posStr = parts.slice(0, -1).join(",");
  } else if (parts.length === 2 && isNaN(parseInt(parts[1]))) {
    entityName = parts[1];
    posStr = parts[0];
  }

  let entity: Entity | null = null;
  if (entityName && isHost) {
    entity = getEntity(game, entityName);
    if (!entity) return sendPm(user.name, `Unknown entity: ${entityName}`);
  } else {
    entity = getCurrentEntity(game);
  }

  if (!entity) return sendPm(user.name, "No active turn.");

  if (!isHost && toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }
  if (entity.movementUsed && cmd === "move") {
    return sendPm(user.name, `${entity.num} already moved this turn.`);
  }

  const pos = parsePos(posStr);
  if (!pos)
    return sendPm(user.name, "Invalid position. Use: %move e4[,entity]");

  const reachable = getReachableTiles(game, entity.pos, entity.mp);
  const key = posToStr(pos[0], pos[1]);

  if (!reachable.has(key)) {
    return sendPm(user.name, "That tile is not reachable with remaining MP.");
  }

  pushSnapshot(game);
  entity.pos = pos;
  entity.movementUsed = true;
  if (cmd === "dash") entity.dashUsed = true;
  premoveSet.delete(entity.num);

  send(game.room, `/me moves ${entity.num} to ${key}`);
  broadcastPages(game);
}

function handleAttack(game: Game, user: User, cmd: string, args: string) {
  const isHost = toId(user.name) === toId(game.host);

  let entityName = "";
  let abilityTarget = args;

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length >= 3) {
    entityName = parts[parts.length - 1];
    abilityTarget = parts.slice(0, -1).join(",");
  } else if (parts.length === 2 && isNaN(parseInt(parts[1]))) {
    entityName = parts[1];
    abilityTarget = parts[0];
  }

  let entity: Entity | null = null;
  if (entityName && isHost) {
    entity = getEntity(game, entityName);
    if (!entity) return sendPm(user.name, `Unknown entity: ${entityName}`);
  } else {
    entity = getCurrentEntity(game);
  }

  if (!entity) return sendPm(user.name, "No active turn.");

  if (!isHost && toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }

  // Parse: ability name @ target
  const atIdx = abilityTarget.indexOf("@");
  const abilityName = (
    atIdx >= 0 ? abilityTarget.slice(0, atIdx) : abilityTarget
  ).trim();
  const targetName = atIdx >= 0 ? abilityTarget.slice(atIdx + 1).trim() : "";

  if (!abilityName)
    return sendPm(user.name, "Specify an ability. Use: %use Ability @ Target");

  const ability = entity.abilities.find(
    (a) => toId(a.name) === toId(abilityName),
  );
  if (!ability) return sendPm(user.name, `Unknown ability: ${abilityName}`);

  if (ability.actionType === "Standard" && entity.standardUsed) {
    return sendPm(user.name, "You already used your Standard action.");
  }
  if (ability.actionType === "Swift" && entity.swiftUsed) {
    return sendPm(user.name, "You already used your Swift action this turn.");
  }
  if (
    ability.actionType === "Full" &&
    (entity.standardUsed || entity.movementUsed)
  ) {
    return sendPm(
      user.name,
      "You already used your Standard or Movement action.",
    );
  }

  pushSnapshot(game);
  if (ability.actionType === "Standard") entity.standardUsed = true;
  if (ability.actionType === "Swift") entity.swiftUsed = true;
  if (ability.actionType === "Full") {
    entity.standardUsed = true;
    entity.movementUsed = true;
  }
  entity.pendingAction = {
    type: "attack",
    ability,
    target: targetName || undefined,
  };

  send(
    game.room,
    `/me selects ${ability.name}${targetName ? ` targeting ${targetName}` : ""}`,
  );
  broadcastPages(game);
}

function handleAdvanceTurn(game: Game, user: User) {
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can advance turns.");
  }

  const entity = getCurrentEntity(game);
  if (!entity) return;

  pushSnapshot(game);

  if (entity.pendingAction) {
    const res = resolveAction(game, entity);
    for (const msg of res.messages) {
      send(game.room, msg);
    }

    const winner = checkGameOver(game);
    if (game.phase === "ended") {
      announceGameOver(game, winner);
      return;
    }
  }

  game.log.push({
    turn: game.round,
    entity: entity.num,
    description: `${entity.num} (${entity.name}) -- turn passed`,
    snapshot: "",
  });

  const result = nextTurn(game);
  if (!result) {
    const winner = checkGameOver(game);
    announceGameOver(game, winner);
    return;
  }
  send(game.room, `**${result.num}'s turn!** (${result.name})`);
  broadcastPages(game);
}

function handleBack(game: Game, user: User) {
  if (popSnapshot(game)) {
    send(game.room, "Action undone.");
    broadcastPages(game);
  } else {
    send(game.room, "Nothing to undo.");
  }
}

function handleRoll(target: string, args: string) {
  const formula = args.trim() || "1d20";
  const result = rollDice(formula);
  const detail = result.rolls.join("+");
  const msg = `[roll] ${formula}: **${result.total}** (${detail})`;
  send(target, msg);
}

function handlePremove(game: Game, user: User) {
  const isHost = toId(user.name) === toId(game.host);

  let entity: Entity | null = null;
  if (isHost) {
    entity = getCurrentEntity(game);
  } else {
    entity = getCurrentEntity(game);
  }

  if (!entity) return sendPm(user.name, "No active turn.");
  if (!isHost && toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }
  if (entity.movementUsed) {
    return sendPm(user.name, "You already moved this turn.");
  }

  if (premoveSet.has(entity.num)) {
    premoveSet.delete(entity.num);
    send(game.room, `/me ${entity.num} back to movement view`);
  } else {
    premoveSet.add(entity.num);
    send(game.room, `/me ${entity.num} viewing pre-move abilities`);
  }
  broadcastPages(game);
}

// -- Display commands ----------------------------------------------------------

function handleInfo(game: Game, user: User, args: string) {
  const ref = args.trim();
  if (!ref) {
    // Show game info
    const lines = [
      `Game: ${game.id} | Mode: ${game.mode} | Phase: ${game.phase}`,
      `Host: ${game.host} | Map: ${game.mapName}`,
      `Players: ${game.entities.length} | Round: ${game.round}`,
    ];
    if (game.turnOrder.length > 0) {
      const cur = getCurrentEntity(game);
      if (cur) lines.push(`Current turn: ${cur.num} (${cur.name})`);
    }
    return sendPm(user.name, lines.join("\n"));
  }

  // Lookup entity info
  const entity = getEntity(game, ref);
  if (!entity) return sendPm(user.name, `Unknown entity: ${ref}`);

  const lines = [
    `${entity.num} (${entity.name}) -- ${entity.className}/${entity.weaponName} Lv.${entity.classLevel}/${entity.weaponLevel}`,
    `HP: ${entity.curhp}/${entity.maxhp} | ATK: ${entity.atk} | MAG: ${entity.mag} | PD: ${entity.pd} | MD: ${entity.md} | EVA: ${entity.eva} | MP: ${entity.mp}`,
    `Pos: ${posToStr(entity.pos[0], entity.pos[1])} | Team: ${entity.team}`,
    `Abilities: ${entity.abilities.map((a) => a.name).join(", ") || "None"}`,
  ];

  if (entity.statuses.length > 0) {
    lines.push(
      `Statuses: ${entity.statuses.map((s) => `${s.name} ${s.damage > 0 ? s.damage + "/" : ""}${s.rounds}`).join(", ")}`,
    );
  }
  if (entity.buffs.length > 0) {
    lines.push(
      `Buffs: ${entity.buffs.map((b) => `${b.amount > 0 ? "+" : ""}${b.amount} ${b.stat} (${b.rounds}r)`).join(", ")}`,
    );
  }

  sendPm(user.name, lines.join("\n"));
}

function handleHp(game: Game, user: User, args: string) {
  // %hp <entity> <amount> -- host manually adjusts HP
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %hp.");
  }

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %hp <entity>, <amount>");
  }

  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);

  const amount = parseInt(parts[1]);
  if (isNaN(amount)) return sendPm(user.name, "Invalid HP amount.");

  pushSnapshot(game);
  if (amount < 0) {
    entity.curhp = Math.max(0, entity.curhp + amount);
  } else {
    entity.curhp = Math.min(entity.maxhp, entity.curhp + amount);
  }

  send(
    game.room,
    `${entity.num} HP: ${entity.curhp}/${entity.maxhp} (${amount > 0 ? "+" : ""}${amount})`,
  );

  if (entity.curhp <= 0) {
    removeEntity(game, entity);
    send(game.room, `**${entity.num} (${entity.name}) has been defeated!**`);

    const winner = checkGameOver(game);
    if (game.phase === "ended") {
      announceGameOver(game, winner);
      return;
    }
  }

  broadcastPages(game);
}

function handleCut(game: Game, user: User, args: string) {
  // %cut <entity> <damage> -- host deals raw damage
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %cut.");
  }

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %cut <entity>, <damage>");
  }

  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);

  const damage = parseInt(parts[1]);
  if (isNaN(damage) || damage < 0)
    return sendPm(user.name, "Invalid damage amount.");

  pushSnapshot(game);
  dealDamage(entity, damage);

  send(
    game.room,
    `${entity.num} takes **${damage}** damage -> ${entity.curhp}/${entity.maxhp} HP`,
  );

  if (entity.curhp <= 0) {
    removeEntity(game, entity);
    send(game.room, `**${entity.num} (${entity.name}) has been defeated!**`);

    const winner = checkGameOver(game);
    if (game.phase === "ended") {
      announceGameOver(game, winner);
      return;
    }
  }

  broadcastPages(game);
}

function handleCheckRange(game: Game, user: User, args: string) {
  // %cr <from>, <to> -- check if two positions are in range
  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(
      user.name,
      "Usage: %cr <pos1>, <pos2> or %cr <entity1>, <entity2>",
    );
  }

  const fromEntity = getEntity(game, parts[0]);
  const toEntity = getEntity(game, parts[1]);
  const fromPos = fromEntity?.pos ?? parsePos(parts[0]);
  const toPos = toEntity?.pos ?? parsePos(parts[1]);

  if (!fromPos || !toPos) {
    return sendPm(user.name, "Could not resolve positions.");
  }

  const d = dist(fromPos, toPos);
  const fromLabel = fromEntity?.num ?? posToStr(fromPos[0], fromPos[1]);
  const toLabel = toEntity?.num ?? posToStr(toPos[0], toPos[1]);

  sendPm(
    user.name,
    `Distance ${fromLabel} -> ${toLabel}: ${d} tiles (Manhattan)`,
  );
}

function buildPlayerList(game: Game): string {
  const curNum = game.turnOrder[game.turnIndex];
  const lines: string[] = [];

  for (const e of game.entities) {
    const isCur = e.num === curNum;
    const hpPct = Math.max(0, (e.curhp / e.maxhp) * 100);
    const marker = isCur ? " " : "";
    const hpColor = hpPct > 50 ? "[+]" : hpPct > 25 ? "[~]" : "[-]";
    lines.push(
      `${hpColor} **${e.num}** ${e.name} -- ${e.className}/${e.weaponName} (${e.classLevel}/${e.weaponLevel}) | HP: ${e.curhp}/${e.maxhp} | ATK:${e.atk} MAG:${e.mag} PD:${e.pd} MD:${e.md} EVA:${e.eva} MP:${e.mp} | ${posToStr(e.pos[0], e.pos[1])}${marker}`,
    );
  }

  return lines.join("\n") || "No players.";
}

function buildTurnOrder(game: Game): string {
  if (game.turnOrder.length === 0) return "No turn order generated yet.";

  const parts: string[] = [];
  for (let i = 0; i < game.turnOrder.length; i++) {
    const entity = game.entities.find((e) => e.num === game.turnOrder[i]);
    if (!entity) continue;
    if (i === game.turnIndex) {
      parts.push(`**${entity.num}**`);
    } else {
      parts.push(entity.num);
    }
  }

  return `Turn Order: ${parts.join(" -> ")}`;
}

export function announceGameOver(game: Game, winner: Entity | null) {
  game.phase = "ended";

  if (winner) {
    send(
      game.room,
      `[WIN] **Game Over! ${winner.num} (${winner.name}) wins!** -- ${winner.className}/${winner.weaponName}`,
    );
  } else {
    send(game.room, "**Game Over!** No survivors!");
  }

  send(
    game.room,
    `Mode: ${game.mode} | Rounds: ${game.round} | Players: ${game.entities.length}`,
  );

  // Loot summary
  const loot = calculateLoot(game);
  if (loot.length > 0) {
    const lines = loot.map(
      (l) =>
        `${l.entity.num} ${l.entity.name}: +${l.xp} XP, +${l.gold} Gold, +${l.gems} Gems`,
    );
    send(game.room, `**Loot**: ${lines.join(" | ")}`);
  }

  // Kill summary
  const killEntries = Object.entries(game.kills)
    .filter(([, k]) => k > 0)
    .sort((a, b) => b[1] - a[1]);
  if (killEntries.length > 0) {
    const lines = killEntries.map(
      ([num, k]) => `${num}: ${k} kill${k > 1 ? "s" : ""}`,
    );
    send(game.room, `**Kills**: ${lines.join(", ")}`);
  }

  send(game.room, "Use %dehost to close the game.");

  broadcastPages(game);
}

export function broadcastPages(game: Game) {
  const hostHtml = buildHostPage(game);
  send(game.room, `/addhtmlbox ${hostHtml}`);

  for (const entity of game.entities) {
    if (!entity.isMonster) {
      const playerHtml = buildPlayerPage(game, entity);
      sendPm(entity.name, `/pminfobox ${playerHtml}`);
    }
  }
}
