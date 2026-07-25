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
  isStunned,
  isRooted,
  isSealed,
  isConfused,
  getEffectiveMp,
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

    case "confirm":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleConfirm(game, user);
      break;

    case "cancel":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleCancel(game, user);
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
      handleHp(game, user, full);
      break;

    case "cut":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleCut(game, user, full);
      break;

    case "checkrange":
    case "cr":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleCheckRange(game, user, full);
      break;

    case "status":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleStatus(game, user, full);
      break;

    case "regp":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleRegp(game, user, full);
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
  if (isStunned(entity)) {
    return sendPm(user.name, `${entity.num} is Stunned and cannot move.`);
  }
  if (isRooted(entity)) {
    return sendPm(user.name, `${entity.num} is Rooted and cannot move.`);
  }
  if (entity.movementUsed && cmd === "move") {
    return sendPm(user.name, `${entity.num} already moved this turn.`);
  }

  const pos = parsePos(posStr);
  if (!pos)
    return sendPm(user.name, "Invalid position. Use: %move e4[,entity]");

  const reachable = getReachableTiles(game, entity.pos, entity.mp, entity);
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
  if (isStunned(entity)) {
    return sendPm(
      user.name,
      `${entity.num} is Stunned and cannot use abilities.`,
    );
  }
  if (isSealed(entity)) {
    return sendPm(
      user.name,
      `${entity.num} is Sealed and cannot use abilities.`,
    );
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

  // Cooldown check
  if (entity.cooldowns[ability.name]) {
    return sendPm(
      user.name,
      `${ability.name} is on cooldown (${entity.cooldowns[ability.name]} turns left).`,
    );
  }

  // Max uses check
  if (ability.maxUses) {
    const used = entity.usesUsed[ability.name] ?? 0;
    if (used >= ability.maxUses) {
      return sendPm(user.name, `${ability.name} has no uses remaining.`);
    }
  }

  // Action type enforcement
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
      "Full action requires both Standard and Movement unused.",
    );
  }
  if (ability.actionType === "Free") {
    // Free actions always allowed (no slot consumed)
  } else if (
    ability.actionType === "Trigger" ||
    ability.actionType === "Reaction"
  ) {
    return sendPm(
      user.name,
      `${ability.actionType} abilities resolve automatically, not manually.`,
    );
  } else if (ability.actionType === "Passive") {
    return sendPm(user.name, "Passive abilities cannot be used manually.");
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

function handleConfirm(game: Game, user: User) {
  const isHost = toId(user.name) === toId(game.host);
  const entity = getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No active turn.");
  if (!isHost && toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }
  if (!entity.pendingAction) {
    return sendPm(user.name, "No action pending. Select an ability first.");
  }

  pushSnapshot(game);
  const step = resolveAction(game, entity);

if (step.done === false) {
  send(
    game.room,
    `${entity.num}: ${step.prompt.message}`,
  );

  if (step.prompt.kind === "target") {
    send(
      game.room,
      `Use %target <target>. Options: ${step.prompt.candidates.map(e => e.num).join(", ")}`
    );
  }

  return;
}

for (const msg of step.result.messages) {
  send(game.room, msg);
}

entity.pendingAction = null;

  const winner = checkGameOver(game);
  if (game.phase === "ended") {
    announceGameOver(game, winner);
    return;
  }

  broadcastPages(game);
}

function handleCancel(game: Game, user: User) {
  const isHost = toId(user.name) === toId(game.host);
  const entity = getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No active turn.");
  if (!isHost && toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }
  if (!entity.pendingAction) {
    return sendPm(user.name, "No action pending.");
  }

  const ability = entity.pendingAction.ability;
  if (ability.actionType === "Standard") entity.standardUsed = false;
  if (ability.actionType === "Swift") entity.swiftUsed = false;
  if (ability.actionType === "Full") {
    entity.standardUsed = false;
    entity.movementUsed = false;
  }

  entity.pendingAction = null;
  send(game.room, `/me ${entity.num} cancels ${ability.name}`);
  broadcastPages(game);
}

function handleAdvanceTurn(game: Game, user: User) {
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can advance turns.");
  }

  const entity = getCurrentEntity(game);
  if (!entity) return;

  pushSnapshot(game);

  // Stunned entities can't act — skip their action and clear pending
  if (isStunned(entity)) {
    if (entity.pendingAction) {
      send(game.room, `${entity.num} is **Stunned** — action wasted!`);
      entity.pendingAction = null;
    } else {
      send(game.room, `${entity.num} is **Stunned** — turn skipped.`);
    }
  } else if (entity.pendingAction) {
    const step = resolveAction(game, entity);

  if (step.done === false) {
    sendPm(
      user.name,
      step.prompt.message
    );
    return;
  }
  
  for (const msg of step.result.messages) {
    send(game.room, msg);
  }
  

    // Track kills
    for (const death of step.result.deaths) {
      if (entity.pendingAction === null) {
        // Only track kills from the attacker (not DoT deaths)
      }
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
  for (const msg of result.messages) {
    send(game.room, msg);
  }

  if (result.died || !result.entity) {
    const winner = checkGameOver(game);
    if (game.phase === "ended") {
      announceGameOver(game, winner);
      return;
    }
    // If entity died from DoT but game isn't over, advance again
    if (!result.entity) {
      const retry = nextTurn(game);
      for (const msg of retry.messages) {
        send(game.room, msg);
      }
      if (!retry.entity) {
        const winner = checkGameOver(game);
        announceGameOver(game, winner);
        return;
      }
      send(game.room, `**${retry.entity.num}'s turn!** (${retry.entity.name})`);
      broadcastPages(game);
      return;
    }
  }

  send(game.room, `**${result.entity.num}'s turn!** (${result.entity.name})`);
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
  sendPm(target, msg);
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
  // %hp <amount>, [entity] -- host manually adjusts HP
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %hp.");
  }

  const parts = args.split(",").map((s) => s.trim());
  let entity: Entity | null = null;
  let amount: number;

  if (parts.length >= 2 && parts[0] && parts[1]) {
    // %hp -25, P1
    amount = parseInt(parts[0]);
    entity = getEntity(game, parts[1]);
  } else if (parts.length === 1) {
    // %hp -25 (current entity)
    amount = parseInt(parts[0]);
    entity = getCurrentEntity(game);
  } else {
    return sendPm(user.name, "Usage: %hp <amount>, [entity]");
  }

  if (!entity) return sendPm(user.name, "No active entity.");
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
  // %cut <damage>, [entity] -- host deals raw damage
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %cut.");
  }

  const parts = args.split(",").map((s) => s.trim());
  let entity: Entity | null = null;
  let damage: number;

  if (parts.length >= 2 && parts[0] && parts[1]) {
    // %cut 10, P1
    damage = parseInt(parts[0]);
    entity = getEntity(game, parts[1]);
  } else if (parts.length === 1) {
    // %cut 10 (current entity)
    damage = parseInt(parts[0]);
    entity = getCurrentEntity(game);
  } else {
    return sendPm(user.name, "Usage: %cut <damage>, [entity]");
  }

  if (!entity) return sendPm(user.name, "No active entity.");
  if (isNaN(damage) || damage < 0)
    return sendPm(user.name, "Invalid damage amount.");

  pushSnapshot(game);
  const dmgResult = dealDamage(entity, damage);

  send(
    game.room,
    `${entity.num} takes **${damage}** damage -> ${entity.curhp}/${entity.maxhp} HP`,
  );

  if (dmgResult.shieldAbsorbed > 0) {
    send(
      game.room,
      `**Shield** absorbed **${dmgResult.shieldAbsorbed}** damage.${dmgResult.shieldBreaks ? " Shield broken!" : ""}`,
    );
  }

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

function handleStatus(game: Game, user: User, args: string) {
  // %status <entity>, <action>, [params]
  // Actions:
  //   add <name>, <dmg>/<rounds>  — add a status
  //   remove <name>               — remove a status
  //   list                        — list all statuses
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %status.");
  }

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0]) {
    return sendPm(
      user.name,
      "Usage: %status <entity>, add <name>, <dmg>/<rounds> | %status <entity>, remove <name> | %status <entity>, list",
    );
  }

  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);

  const action = parts[1].toLowerCase();
  if (action === "list") {
    if (entity.statuses.length === 0) {
      return sendPm(user.name, `${entity.num} has no statuses.`);
    }
    const list = entity.statuses
      .map(
        (s) =>
          `${s.name} ${s.damage > 0 ? s.damage + "/" : ""}${s.rounds}${s.removable ? "" : " (permanent)"}`,
      )
      .join(", ");
    return sendPm(user.name, `${entity.num} statuses: ${list}`);
  }

  if (action === "add") {
    // %status P1, add Bleed, 3/2
    const statusName = parts[2];
    if (!statusName) {
      return sendPm(
        user.name,
        "Usage: %status <entity>, add <name>, <dmg>/<rounds>",
      );
    }

    let damage = 0;
    let rounds = 1;

    if (parts[3]) {
      const slashParts = parts[3].split("/");
      damage = parseInt(slashParts[0]) || 0;
      rounds = parseInt(slashParts[1]) || 1;
    }

    pushSnapshot(game);
    entity.statuses.push({
      name: capitalize(statusName),
      damage,
      rounds,
      maxRounds: rounds,
      removable: true,
    });
    send(
      game.room,
      `${entity.num} afflicted with ${capitalize(statusName)}${damage > 0 ? ` (${damage}/${rounds})` : ` (${rounds} rounds)`}.`,
    );
    broadcastPages(game);
    return;
  }

  if (action === "remove") {
    const statusName = parts[2];
    if (!statusName) {
      return sendPm(user.name, "Usage: %status <entity>, remove <name>");
    }

    const id = toId(statusName);
    const idx = entity.statuses.findIndex((s) => toId(s.name) === id);
    if (idx === -1) {
      return sendPm(
        user.name,
        `${entity.num} does not have status: ${statusName}`,
      );
    }

    pushSnapshot(game);
    entity.statuses.splice(idx, 1);
    send(game.room, `${entity.num}'s ${capitalize(statusName)} removed.`);
    broadcastPages(game);
    return;
  }

  sendPm(
    user.name,
    `Unknown status action: ${action}. Use add, remove, or list.`,
  );
}

function handleRegp(game: Game, user: User, args: string) {
  // %regp <psuser>, <entity> — assign a PS user to control an entity
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %regp.");
  }

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %regp <psuser>, <entity>");
  }

  const psUser = parts[0];
  const entity = getEntity(game, parts[1]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[1]}`);

  pushSnapshot(game);
  entity.name = psUser;
  entity.id = toId(psUser);
  send(game.room, `${entity.num} is now controlled by **${psUser}**.`);
  broadcastPages(game);
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
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
