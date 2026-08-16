import {
  send,
  sendPm,
  sendPmChunks,
  toId,
  parseArgs,
  parsePos,
  posToStr,
} from "../utils.js";
import config from "../config.js";
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
  removeEntity,
  checkGameOver,
  calculateLoot,
  moveCost,
  TERRAIN_NAMES,
  dist,
  manhattan,
  chebyshev,
  hasLineOfSight,
  inRange,
  isStunned,
  isRooted,
  isSealed,
  isConfused,
  getEffectiveMp,
  parseFrequency,
  type Game,
  type Entity,
  type AbilityData,
} from "../game/state.js";
import { rollDice } from "../utils.js";
import { buildHostPage, buildPlayerPage, premoveSet } from "../html/pages.js";
import {
  resolveAction,
  respondToChoice,
  respondToTarget,
  respondToDir,
  respondToTile,
  startAttack,
  isValidTarget,
  type AttackStep,
} from "../game/resolve.js";
import { DIRECTION_LABELS } from "../game/state.js";
import {    normalizeVoteMode,
    pendingVoterIds,
    runoffOptions,
    tallyVotes,
  voteOptionsFor,
} from "../data/gamemodes.js";

export function gameCommand(
  room: Room | null,
  user: User,
  cmd: string,
  args: string,
  val: string,
  pm = false,
) {
  // PM routing: find game by entity/host name
  let game = room ? findGameForRoom(room.id) : null;
  if (!game && pm) {
    game = findGameForUser(user.name);
    if (!game) return sendPm(user.name, "No active game found.");
  }

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

    case "target":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleTarget(game, user, full);
      break;

    case "choose":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleChoose(game, user, full);
      break;

    case "vote":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleVote(game, user, full);
      break;

    case "votestatus":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleVoteStatus(game, user);
      break;

    case "unvote":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleUnvote(game, user);
      break;

    case "leave":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleLeave(game, user);
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

    case "passmove":
    case "pass":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handlePassMove(game, user);
      break;

    case "pl":
      if (!game) return sendPm(user.name, "No active game in this room.");
      sendPm(user.name, buildPlayerList(game));
      break;

    case "log":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleLog(game, user, args);
      break;

    case "to":
    case "turnorder":
      if (!game) return sendPm(user.name, "No active game in this room.");
      sendPm(user.name, buildTurnOrder(game));
      break;

    case "cooldowns":
    case "cds":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleCooldowns(game, user, full);
      break;

    case "terrain":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleTerrain(game, user, full);
      break;

    case "los":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleLos(game, user, full);
      break;

    case "moves":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleMoves(game, user, full);
      break;

    case "resources":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleResources(game, user, full);
      break;

    case "resource":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleResource(game, user, full);
      break;

    case "mp":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleMp(game, user, full);
      break;

    case "uses":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleUses(game, user, full);
      break;

    case "buffs":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleBuffs(game, user, full);
      break;

    case "cure":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleCure(game, user, full);
      break;

    case "hp":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleHp(game, user, full);
      break;

    case "cut":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleCut(game, user, full);
      break;
    case "timer":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleTimer(game, user, full);
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

    case "dir":
      if (!game) return sendPm(user.name, "No active game.");
      handleDirChoice(game, user, args);
      break;

    case "tile":
      if (!game) return sendPm(user.name, "No active game.");
      handleTileChoice(game, user, full);
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

function findGameForUser(username: string): Game | null {
  for (const game of games.values()) {
    if (toId(game.host) === toId(username)) return game;
    for (const e of game.entities) {
      if (toId(e.name) === toId(username) || toId(e.num) === toId(username))
        return game;
    }
  }
  return null;
}

function logEntry(game: Game, entity: Entity, description: string) {
  game.log.push({
    turn: game.round,
    entity: entity.num,
    description,
    snapshot: "",
  });
}

function failAct(game: Game, entity: Entity, reason: string) {
  logEntry(game, entity, `${entity.num} (${entity.name}) idles (${reason})`);
}

function handleMove(game: Game, user: User, cmd: string, args: string) {
  const isHost = toId(user.name) === toId(game.host);

  let entityName = "";
  let posStr = args;

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length >= 3) {
    entityName = parts[parts.length - 1];
    posStr = parts.slice(0, -1).join(",");
  } else if (
    parts.length === 2 &&
    (isNaN(parseInt(parts[1])) || getEntity(game, parts[1]))
  ) {
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
    failAct(game, entity, "Stunned");
    return sendPm(user.name, `${entity.num} is Stunned and cannot move.`);
  }
  if (isRooted(entity)) {
    failAct(game, entity, "Rooted");
    return sendPm(user.name, `${entity.num} is Rooted and cannot move.`);
  }
  if (entity.movementUsed) {
    failAct(game, entity, "already moved");
    return sendPm(user.name, `${entity.num} already moved this turn.`);
  }
  if (cmd === "dash" && entity.dashUsed) {
    failAct(game, entity, "already dashed");
    return sendPm(user.name, `${entity.num} already dashed this turn.`);
  }
  if (cmd === "dash" && entity.standardUsed) {
    failAct(game, entity, "Dash is a Full action");
    return sendPm(
      user.name,
      `${entity.num} already used their Standard — Dash is a Full action.`,
    );
  }

  const pos = parsePos(posStr);
  if (!pos)
    return sendPm(user.name, "Invalid position. Use: %move e4[,entity]");

  // Dash spends MP to move up to x1.5 tiles (rounded down). Full action.
  const dash = cmd === "dash";
  const mp = dash ? Math.floor(getEffectiveMp(entity) * 1.5) : entity.mp;
  const reachable = getReachableTiles(
    game,
    entity.pos,
    mp,
    dash ? undefined : entity,
  );
  const key = posToStr(pos[0], pos[1]);

  if (!reachable.has(key)) {
    failAct(game, entity, "tile not reachable");
    return sendPm(user.name, "That tile is not reachable with remaining MP.");
  }

  pushSnapshot(game);
  entity.pos = pos;
  entity.movementUsed = true;
  if (cmd === "dash") {
    entity.dashUsed = true;
    entity.standardUsed = true;
  }
  premoveSet.delete(entity.num);

  logEntry(
    game,
    entity,
    `${entity.num} (${entity.name}) ${dash ? "dashes" : "moves"} to ${key}`,
  );
  send(game.room, `/me moves ${entity.num} to ${key}`);
  broadcastPages(game);
}

// Generic "Basic Abilities" available to every entity alongside their class
// and weapon kits: a melee Basic Attack and a self-healing Rest.
function getBasicAbility(name: string): AbilityData | null {
  const id = toId(name);
  if (id === "basicattack") {
    return {
      name: "Basic Attack",
      level: 1,
      frequency: "Every Turn",
      mr: 10,
      roll: "2d6",
      damageType: "Physical",
      actionType: "Standard",
      targetAmount: 1,
      targetGroup: "Foe",
      range: "Melee",
      effect: "",
    };
  }
  if (id === "rest") {
    return {
      name: "Rest",
      level: 1,
      frequency: "Every Turn",
      mr: 0,
      roll: "2d6",
      damageType: "",
      actionType: "Standard",
      targetAmount: 1,
      targetGroup: "Self",
      range: "Global",
      effect: "heal 2d6 HP",
    };
  }
  return null;
}

function handleAttack(game: Game, user: User, cmd: string, args: string) {
  const isHost = toId(user.name) === toId(game.host);

  let entityName = "";
  let abilityTarget = args;

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length >= 3) {
    entityName = parts[parts.length - 1];
    abilityTarget = parts.slice(0, -1).join(",");
  } else if (
    parts.length === 2 &&
    (isNaN(parseInt(parts[1])) || getEntity(game, parts[1]))
  ) {
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
    failAct(game, entity, "Stunned");
    return sendPm(
      user.name,
      `${entity.num} is Stunned and cannot use abilities.`,
    );
  }
  if (isSealed(entity)) {
    failAct(game, entity, "Sealed");
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

  const ability =
    entity.abilities.find((a) => toId(a.name) === toId(abilityName)) ??
    getBasicAbility(abilityName);
  if (!ability) return sendPm(user.name, `Unknown ability: ${abilityName}`);

  // Cooldown check
  if (entity.cooldowns[ability.name]) {
    failAct(game, entity, `${ability.name} on cooldown`);
    return sendPm(
      user.name,
      `${ability.name} is on cooldown (${entity.cooldowns[ability.name]} turns left).`,
    );
  }

  // Max uses check
  const maxUses = ability.maxUses ?? parseFrequency(ability.frequency).uses;
  if (maxUses) {
    const used = entity.usesUsed[ability.name] ?? 0;
    if (used >= maxUses) {
      failAct(game, entity, `${ability.name} out of uses`);
      return sendPm(user.name, `${ability.name} has no uses remaining.`);
    }
  }

  // Action type enforcement
  if (ability.actionType === "Standard" && entity.standardUsed) {
    failAct(game, entity, "Standard already used");
    return sendPm(user.name, "You already used your Standard action.");
  }
  if (ability.actionType === "Swift" && entity.swiftUsed) {
    failAct(game, entity, "Swift already used");
    return sendPm(user.name, "You already used your Swift action this turn.");
  }
  if (
    ability.actionType === "Full" &&
    (entity.standardUsed || entity.movementUsed)
  ) {
    failAct(game, entity, "Full action needs Movement+Standard");
    return sendPm(
      user.name,
      "Full action requires both Standard and Movement unused.",
    );
  }
  // Issue #3: Free/Swift/Trigger must be used before the Standard action.
  if (
    entity.standardUsed &&
    (ability.actionType === "Free" ||
      ability.actionType === "Swift" ||
      ability.actionType === "Trigger")
  ) {
    failAct(game, entity, "Free/Swift must come before Standard");
    return sendPm(
      user.name,
      `${ability.actionType} abilities must be used before your Standard action.`,
    );
  }
  if (ability.actionType === "Trigger") {
    // Trigger abilities are free-like: manual use, no slot consumed.
    // Using a trigger lets the entity manually resolve Reactions this turn.
  } else if (ability.actionType === "Reaction") {
    if (!entity.triggered) {
      failAct(game, entity, "no trigger active");
      return sendPm(
        user.name,
        "No trigger active this turn — Reaction abilities cannot be used manually.",
      );
    }
  } else if (ability.actionType === "Passive") {
    failAct(game, entity, "Passive cannot be used manually");
    return sendPm(user.name, "Passive abilities cannot be used manually.");
  }

  pushSnapshot(game);
  if (ability.actionType === "Standard") entity.standardUsed = true;
  if (ability.actionType === "Swift") entity.swiftUsed = true;
  if (ability.actionType === "Full") {
    entity.standardUsed = true;
    entity.movementUsed = true;
  }
  if (ability.actionType === "Trigger") entity.triggered = true;
  entity.pendingAction = {
    type: "attack",
    ability,
    target: targetName || undefined,
  };

  send(
    game.room,
    `/me selects ${ability.name}${targetName ? ` targeting ${targetName}` : ""}`,
  );

  // Auto-resolve Free/Swift actions without dice rolls
  const noDice = !ability.roll || ability.roll === "" || ability.roll === "—";
  if (
    noDice &&
    (ability.actionType === "Free" || ability.actionType === "Swift")
  ) {
    const step = resolveAction(game, entity);
    if (step.done === false) {
      send(game.room, `${entity.num}: ${step.prompt.message}`);
      return;
    }
    for (const msg of step.result.messages) {
      send(game.room, msg);
    }
    logEntry(game, entity, summarizeResult(game, entity, step.result.messages));
    entity.pendingAction = null;
    send(game.room, `**${ability.name}** resolved. Use %back to undo.`);
    broadcastPages(game);
    return;
  }

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
  finishStep(game, entity, step);
}

function handleTarget(game: Game, user: User, args: string) {
  const isHost = toId(user.name) === toId(game.host);
  const entity = getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No active turn.");
  if (!isHost && toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }
  if (!args) return sendPm(user.name, "Usage: %target <target>");

  pushSnapshot(game);
  try {
    const step = respondToTarget(entity, args);
    finishStep(game, entity, step);
  } catch (e) {
    sendPm(user.name, e instanceof Error ? e.message : String(e));
  }
}

function handleChoose(game: Game, user: User, args: string) {
  const isHost = toId(user.name) === toId(game.host);
  const entity = getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No active turn.");
  if (!isHost && toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }
  if (!args) return sendPm(user.name, "Usage: %choose <option>");

  pushSnapshot(game);
  try {
    const step = respondToChoice(entity, args);
    finishStep(game, entity, step);
  } catch (e) {
    sendPm(user.name, e instanceof Error ? e.message : String(e));
  }
}

function handleVote(game: Game, user: User, args: string) {
  if (game.started) return sendPm(user.name, "Game already started.");
  if (!game.voteOpen) {
    return sendPm(
      user.name,
      "No gamemode vote is open. The host closes signups (%close) to start one.",
    );
  }

  // Only joined players may vote — keyed by their entity.
  const entity = game.entities.find(
    (e) => !e.isMonster && toId(e.name) === toId(user.name),
  );
  if (!entity) {
    return sendPm(user.name, "You're not in this game. Join first (%join).");
  }

  const arg = args.trim();
  const players = game.entities.filter((e) => !e.isMonster);
  // During a runoff only the tied modes are votable.
  const options = game.voteRunoff
    ? runoffOptions(game.voteRunoff)
    : voteOptionsFor(players.length);

  // Bare %vote: show current status + tallies + available options.
  if (!arg) {
    const lines = [buildVoteStatus(game)];
    const myVote = game.votes[entity.id];
    if (myVote) lines.push(`You voted: **${myVote}** (use %unvote to withdraw).`);
    const list = options.map((o) => o.id).join(", ");
    lines.push(`Vote with %vote <mode>${list ? ` — available: ${list}` : ""}.`);
    return sendPm(user.name, lines.join("\n"));
  }

  const mode = normalizeVoteMode(arg);
  if (!mode || !options.some((o) => o.id === mode)) {
    const list = options.map((o) => o.id).join(", ");
    return sendPm(
      user.name,
      `"${arg}" is not a valid mode${options.length ? ` for ${players.length} players` : ""}. Available: ${list}`,
    );
  }

  // Key by stable entity id — %gento renumbers nums, ids never change.
  const changed = game.votes[entity.id] !== undefined;
  const allVotedBefore = Object.keys(game.votes).length >= players.length;
  game.votes[entity.id] = mode;
  send(
    game.room,
    `${entity.num} (${entity.name}) ${changed ? "changed their vote to" : "voted for"} **${mode}**.`,
  );

  // Nudge the host only on the transition to everyone-voted (not on re-votes).
  const allVotedAfter = Object.keys(game.votes).length >= players.length;
  if (!allVotedBefore && allVotedAfter) {
    send(
      game.room,
      `**All ${players.length} player(s) have voted!** Host, run %endvote to apply the winning mode.`,
    );
  }

  broadcastPages(game);
}

function handleUnvote(game: Game, user: User) {
  if (game.started) return sendPm(user.name, "Game already started.");
  if (!game.voteOpen) {
    return sendPm(user.name, "No gamemode vote is open right now.");
  }

  const entity = game.entities.find(
    (e) => !e.isMonster && toId(e.name) === toId(user.name),
  );
  if (!entity) {
    return sendPm(user.name, "You're not in this game. Join first (%join).");
  }

  if (game.votes[entity.id] === undefined) {
    return sendPm(user.name, "You haven't voted yet.");
  }

  delete game.votes[entity.id];
  send(game.room, `${entity.num} (${entity.name}) withdrew their vote.`);
  broadcastPages(game);
}

/**
 * %leave — a player leaves the game they're in: removes their entity, drops
 * them from the turn order, and withdraws any vote they cast. The host must
 * use %dehost instead.
 */
function handleLeave(game: Game, user: User) {
  if (toId(user.name) === toId(game.host)) {
    return sendPm(
      user.name,
      "You're the host — use %dehost to close the game.",
    );
  }
  const entity = game.entities.find(
    (e) => !e.isMonster && toId(e.name) === toId(user.name),
  );
  if (!entity) {
    return sendPm(user.name, "You're not in this game. Join first (%join).");
  }
  removeEntity(game, entity);
  send(game.room, `**${entity.num} (${entity.name})** has left the game.`);
  broadcastPages(game);
}

// Chat status line for the open gamemode vote: tallies + the requester's vote.
function buildVoteStatus(game: Game): string {
  const players = game.entities.filter((e) => !e.isMonster);
  const tally = tallyVotes(game.votes);
  const summary =
    tally.length > 0
      ? tally.map((t) => `${t.mode}: ${t.count}`).join(" | ")
      : "no votes yet";
  const runoff = game.voteRunoff
    ? ` (RUNOFF: only **${game.voteRunoff.join(" / ")}** count)`
    : "";
  const pending = pendingVoterIds(
    game.votes,
    players.map((p) => p.id),
  );
  const pendingNames = pending
    .map((id) => players.find((p) => p.id === id)?.name ?? id)
    .join(", ");
  const pendingPart = pending.length
    ? ` | not voted: ${pendingNames}`
    : " | everyone has voted!";
  return `**Gamemode vote** (${Object.keys(game.votes).length}/${players.length} voted): ${summary}.${runoff}${pendingPart}`;
}

/**
 * %votestatus — anyone can check the live tally, runoff state, and who still
 * hasn't voted, without casting a vote themselves.
 */
function handleVoteStatus(game: Game, user: User) {
  if (!game.voteOpen) {
    return sendPm(
      user.name,
      "No gamemode vote is open. The host closes signups (%close) to start one.",
    );
  }
  sendPm(user.name, buildVoteStatus(game));
}

function finishStep(game: Game, entity: Entity, step: AttackStep) {
  if (step.done === false) {
    send(game.room, `${entity.num}: ${step.prompt.message}`);

    if (step.prompt.kind === "target") {
      if (step.prompt.candidates.length === 0) {
        send(
          game.room,
          `${entity.num} has no valid targets - use %cancel to cancel.`,
        );
      } else {
        send(
          game.room,
          `Use %target <target>. Options: ${step.prompt.candidates.map((e) => e.num).join(", ")}`,
        );
      }
    } else if (step.prompt.kind === "selection") {
      send(
        game.room,
        `Use %choose <option>. Options: ${step.prompt.options.map((o) => `${o.id} = ${o.label}`).join(" | ")}`,
      );
    } else if (step.prompt.kind === "direction") {
      send(
        game.room,
        `Use %dir <direction>. Options: ${step.prompt.candidates.join(", ")}`,
      );
    } else if (step.prompt.kind === "tile") {
      send(
        game.room,
        `Use %tile <tile>. Options: ${step.prompt.candidates.join(", ")}`,
      );
    }
    return;
  }

  for (const msg of step.result.messages) {
    send(game.room, msg);
  }

  logEntry(game, entity, summarizeResult(game, entity, step.result.messages));

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
  entity.pendingResolution = undefined;
  entity.pendingPromptKind = undefined;
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

  let acted = "";

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
      sendPm(user.name, step.prompt.message);
      return;
    }

    for (const msg of step.result.messages) {
      send(game.room, msg);
    }

    acted = summarizeResult(game, entity, step.result.messages);

    for (const dead of step.result.deaths) {
      game.kills[entity.num] = (game.kills[entity.num] ?? 0) + 1;
      if (config.announcements.kills) {
        send(game.room, `**${entity.num} eliminated ${dead.num} (${dead.name})!**`);
      }
    }

    const winner = checkGameOver(game);
    if (game.phase === "ended") {
      announceGameOver(game, winner);
      return;
    }
  }

  if (
    acted ||
    !game.log.some((e) => e.turn === game.round && e.entity === entity.num)
  ) {
    logEntry(
      game,
      entity,
      acted || `${entity.num} (${entity.name}) -- turn passed`,
    );
  }

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

function summarizeResult(
  game: Game,
  entity: Entity,
  messages: string[],
): string {
  const nm = (n: string) => game.entities.find((e) => e.num === n)?.name ?? n;
  const head = messages.find((m) => m.startsWith("/me "));
  let action = head ? head.slice(4).split(", MR")[0] : "action";
  action = action.replace(
    /@ (.*)$/,
    (_, t) => `@ ${t.split(", ").map(nm).join(", ")}`,
  );
  const dmg: string[] = [];
  for (const m of messages) {
    const d = m.match(/= \*\*(\d+)\*\* -> (\S+) \(/);
    if (d) {
      dmg.push(
        `${nm(d[2])} ${d[1]} ${m.includes("**Heal**") ? "heal" : "dmg"}`,
      );
      continue;
    }
    const s = m.match(/-> (\S+) \(.*= \*\*(\d+)\*\*$/);
    if (s) dmg.push(`${nm(s[1])} ${s[2]} dmg`);
  }
  const acc = messages
    .filter((m) => m.includes("**Accuracy**"))
    .map((m) => (m.includes("HIT") ? "HIT" : "MISS"));
  const hits = acc.length ? acc.join("/") : "";
  const tail = [hits, dmg.join(" ")].filter(Boolean).join(" ");
  return `${entity.name} ${action}${tail ? `: ${tail}` : ""}`;
}

function handleBack(game: Game, user: User) {
  if (popSnapshot(game)) {
    send(game.room, "Action undone.");
    broadcastPages(game);
  } else {
    send(game.room, "Nothing to undo.");
  }
}

function handleLog(game: Game, user: User, args: string) {
  if (game.log.length === 0) {
    sendPm(user.name, "Action log is empty.");
    return;
  }

  const text = game.log
    .map((e) => `[R${e.turn}] ${e.entity}: ${e.description}`)
    .join("\n");

  if (args === "paste" || args === "share") {
    void (async () => {
      const url = await pasteLog(text);
      if (url) {
        send(game.room, `${user.name} shared the action log: ${url}`);
      } else {
        sendPm(
          user.name,
          "Paste service unreachable — sending the log directly:",
        );
        sendPmChunks(user.name, text);
      }
    })();
    return;
  }

  sendPmChunks(user.name, text);
}

async function pasteLog(text: string): Promise<string | null> {
  try {
    const res = await fetch("https://paste.rs/", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: text,
    });
    if (!res.ok) return null;
    const url = (await res.text()).trim();
    return url.startsWith("http") ? url : null;
  } catch {
    return null;
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

// -- Direction / Tile choice handlers -----------------------------------------

function handleDirChoice(game: Game, user: User, dir: string) {
  const isHost = toId(user.name) === toId(game.host);
  const entity = getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No active turn.");
  if (!isHost && toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }
  if (!dir) return sendPm(user.name, "Usage: %dir <direction>");

  pushSnapshot(game);
  try {
    const step = respondToDir(entity, dir);
    finishStep(game, entity, step);
  } catch (e) {
    sendPm(user.name, e instanceof Error ? e.message : String(e));
  }
}

function handleTileChoice(game: Game, user: User, args: string) {
  const isHost = toId(user.name) === toId(game.host);
  const entity = getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No active turn.");
  if (!isHost && toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn.");
  }
  if (!args) return sendPm(user.name, "Usage: %tile <tile>");

  pushSnapshot(game);
  try {
    const step = respondToTile(entity, args);
    finishStep(game, entity, step);
  } catch (e) {
    sendPm(user.name, e instanceof Error ? e.message : String(e));
  }
}

function handlePassMove(game: Game, user: User) {
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

  pushSnapshot(game);
  entity.movementUsed = true;
  premoveSet.delete(entity.num);
  logEntry(game, entity, `${entity.num} (${entity.name}) passes movement`);
  send(game.room, `/me ${entity.num} passes movement`);
  broadcastPages(game);
}

// -- Display commands ----------------------------------------------------------

function handleInfo(game: Game, user: User, args: string) {
  const ref = args.trim();
  if (!ref) {
    // Show game info
    const lines = [
      `Game: ${game.id} | Mode: ${game.mode} | Phase: ${game.phase}`,
      `Host: ${game.host} | Map: ${game.mapName || "(none)"}`,
      `Players: ${game.entities.length} | Round: ${game.round}`,
    ];
    if (game.voteOpen) lines.push(buildVoteStatus(game));
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

// Active shot-clock timers. %cut puts one on a player, %timer starts a global
// countdown; the test-app server ticks the countdown and announces expiry.
const DEFAULT_TIMER_SECONDS = config.turnTimerSeconds;

// %cut 1 -> P1, %cut 2 -> M2, etc.: match an entity by bare digits.
// When digits are ambiguous (P2 vs M2), prefer the player entity.
function resolveEntityRef(game: Game, ref: string): Entity | null {
  const direct = getEntity(game, ref);
  if (direct) return direct;
  const digits = ref.replace(/[^0-9]/g, "");
  if (!digits) return null;
  return (
    game.entities.find(
      (e) => !e.isMonster && e.num.replace(/[^0-9]/g, "") === digits,
    ) ??
    game.entities.find((e) => e.num.replace(/[^0-9]/g, "") === digits) ??
    null
  );
}

function setGameTimer(game: Game, entity: Entity | null, seconds: number) {
  game.timer = {
    entity: entity?.num ?? null,
    endAt: Date.now() + seconds * 1000,
  };
  send(
    game.room,
    `**Timer: ${entity ? `${entity.num} (${entity.name}) — ${seconds}s` : `${seconds}s`}.** %cut off / %timer off to cancel.`,
  );
  broadcastPages(game);
}

function handleCut(game: Game, user: User, args: string) {
  // %cut <player> [seconds] — shot clock on a player (default 120s); %cut off cancels
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %cut.");
  }
  const parts = args.split(",").map((s) => s.trim());
  const ref = parts[0];
  if (toId(ref ?? "") === "off") {
    game.timer = null;
    send(game.room, "**Timer cancelled.**");
    broadcastPages(game);
    return;
  }
  const entity = ref ? resolveEntityRef(game, ref) : getCurrentEntity(game);
  if (!entity) {
    return sendPm(
      user.name,
      ref ? `Unknown entity: ${ref}` : "No active entity.",
    );
  }
  const seconds = parseInt(parts[1] ?? "");
  const secs = isNaN(seconds) || seconds <= 0 ? DEFAULT_TIMER_SECONDS : seconds;
  setGameTimer(game, entity, secs);
}

function handleTimer(game: Game, user: User, args: string) {
  // %timer [X] — global countdown of X seconds (default 120s); %timer off cancels
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %timer.");
  }
  const arg = args.trim();
  if (toId(arg) === "off") {
    game.timer = null;
    send(game.room, "**Timer cancelled.**");
    broadcastPages(game);
    return;
  }
  if (!arg) {
    setGameTimer(game, null, DEFAULT_TIMER_SECONDS);
    return;
  }
  const seconds = parseInt(arg);
  if (isNaN(seconds) || seconds <= 0) {
    return sendPm(user.name, "Usage: %timer <seconds> (e.g. %timer 60)");
  }
  setGameTimer(game, null, seconds);
}

// Formats an entity list for %checkrange results.
// inRange doesn't understand "or" combos (e.g. "range 3 or melee") — the
// engine splits them before calling it (resolve.ts). Mirror that here.
function inRangeInParts(
  game: Game,
  from: [number, number],
  to: [number, number],
  range: string,
): boolean {
  const parts = range.toLowerCase().includes(" or ")
    ? range.split(/\s+or\s+/i)
    : [range];
  return parts.some((rp) => inRange(game, from, to, rp.trim()));
}

function formatRangeList(list: Entity[]): string {
  if (list.length === 0) return "none";
  return list
    .map((e) => `${e.num} at ${posToStr(e.pos[0], e.pos[1])}`)
    .join(", ");
}

/**
 * %checkrange / %cr -- inspect reachability from the current entity.
 *
 * Three modes (plus the original two-position form):
 *   %cr <pos1>, <pos2>          -- distance between two positions/entities
 *   %checkrange <entity|tile>   -- distance, LOS, and which abilities can hit it
 *   %checkrange <ability>       -- which entities that ability can currently reach
 *   %checkrange <range string>  -- which entities are within that range type
 *
 * The source is the current turn's entity (or the caller's own if it is their
 * turn); the host can prefix an entity to check from, e.g. %cr P2 -> target.
 */
function handleCheckRange(game: Game, user: User, args: string) {
  const arg = args.trim();
  if (!arg) {
    return sendPm(
      user.name,
      "Usage: %checkrange <entity|tile|ability|range> — e.g. %checkrange P2, %checkrange e4, %checkrange Fireball, %checkrange range 5, or %cr a1, b2 for a raw distance.",
    );
  }

  // --- Original two-position form: %cr <from>, <to> ---
  const commaParts = arg.split(",").map((s) => s.trim());
  if (commaParts.length >= 2 && commaParts[0] && commaParts[1]) {
    const fromEntity = getEntity(game, commaParts[0]);
    const toEntity = getEntity(game, commaParts[1]);
    const fromPos = fromEntity?.pos ?? parsePos(commaParts[0]);
    const toPos = toEntity?.pos ?? parsePos(commaParts[1]);
    if (fromPos && toPos) {
      const d = dist(fromPos, toPos);
      const fromLabel = fromEntity?.num ?? posToStr(fromPos[0], fromPos[1]);
      const toLabel = toEntity?.num ?? posToStr(toPos[0], toPos[1]);
      return sendPm(
        user.name,
        `Distance ${fromLabel} -> ${toLabel}: ${d} tiles (Manhattan)`,
      );
    }
  }

  // Resolve the source entity. Deliberately prefer the caller's own entity
  // (mine) over the turn's entity even on someone else's turn: %checkrange is
  // a planning tool, so a non-active player should see THEIR reach, not the
  // active player's. When the caller is the active player (or a spectator
  // with no entity), fall back to the current turn's entity.
  const current = getCurrentEntity(game);
  const mine = getEntity(game, user.name);
  const source =
    current && (!mine || toId(current.name) === toId(user.name))
      ? current
      : mine ?? current;
  if (!source) {
    return sendPm(user.name, "No entity to check range from.");
  }

  // --- Mode 1: target entity/tile ---
  const targetEntity = getEntity(game, arg);
  const tilePos = !targetEntity ? parsePos(arg) : null;
  if (targetEntity || tilePos) {
    const toPos = targetEntity ? targetEntity.pos : tilePos!;
    const label = targetEntity
      ? `${targetEntity.num} (${targetEntity.name})`
      : posToStr(toPos[0], toPos[1]);
    const md = manhattan(source.pos, toPos);
    const cd = chebyshev(source.pos, toPos);
    const los = hasLineOfSight(game, source.pos, toPos);
    // Respect the ability's target group too: geometry alone isn't enough
    // (a heal that reaches a foe is not "can hit" in any meaningful sense).
    // Tile targets can't be group-filtered, so entity targets only.
    const hitAbilities = source.abilities.filter(
      (a) =>
        inRangeInParts(game, source.pos, toPos, a.range) &&
        (!targetEntity || isValidTarget(source, targetEntity, a.targetGroup)),
    );
    return sendPm(
      user.name,
      `${source.num} -> ${label}: ${md} tiles Manhattan / ${cd} Chebyshev, LOS ${los ? "clear" : "blocked"}. Abilities that can hit: ${hitAbilities.length ? hitAbilities.map((a) => a.name).join(", ") : "none"}.`,
    );
  }

  // --- Mode 2: ability name ---
  const ability = source.abilities.find((a) => toId(a.name) === toId(arg));
  if (ability) {
    // isValidTarget already rejects dead entities (curhp <= 0).
    const reachable = game.entities.filter(
      (e) =>
        e.num !== source.num &&
        isValidTarget(source, e, ability.targetGroup) &&
        inRangeInParts(game, source.pos, e.pos, ability.range),
    );
    const groupLabel = ability.targetGroup || "any";
    return sendPm(
      user.name,
      `${source.num} ${ability.name} (${ability.range}, targets: ${groupLabel}): ${formatRangeList(reachable)}.`,
    );
  }

  // --- Mode 3: raw range string (e.g. "range 5", "melee", "line 3",
  // or "or" combos like "range 3 or melee", mirroring the engine) ---
  const rangeStr = arg.toLowerCase().trim();
  const rangeParts = rangeStr.split(/\s+or\s+/i).map((s) => s.trim());
  const validRangePart = (s: string) =>
    s === "melee" ||
    s === "global" ||
    /^(range|homing|line|pierce|burst|star|beam|cone)\s*\d+$/i.test(s);
  if (rangeParts.length > 0 && rangeParts.every(validRangePart)) {
    const reachable = game.entities.filter(
      (e) =>
        e.num !== source.num &&
        e.curhp > 0 &&
        rangeParts.some((rp) => inRange(game, source.pos, e.pos, rp)),
    );
    return sendPm(
      user.name,
      `${source.num} within ${rangeStr}: ${formatRangeList(reachable)}.`,
    );
  }

  return sendPm(
    user.name,
    `Could not resolve "${arg}". Usage: %checkrange <entity|tile|ability|range> (e.g. %checkrange P2, %checkrange Fireball, %checkrange range 5).`,
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
    const teamTag = e.team > 0 ? ` | T${e.team}` : "";
    lines.push(
      `${hpColor} **${e.num}** ${e.name} -- ${e.className}/${e.weaponName} (${e.classLevel}/${e.weaponLevel}) | HP: ${e.curhp}/${e.maxhp} | ATK:${e.atk} MAG:${e.mag} PD:${e.pd} MD:${e.md} EVA:${e.eva} MP:${e.mp} | ${posToStr(e.pos[0], e.pos[1])}${teamTag}${marker}`,
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

// %resources [entity] - show resource pools (Qi/Blood/Rage/etc).
function handleResources(game: Game, user: User, args: string) {
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No entity found.");
  const entries = Object.entries(entity.resources).filter(([, v]) => v !== 0);
  sendPm(
    user.name,
    entries.length
      ? `${entity.num} resources: ${entries.map(([k, v]) => `${k} ${v}`).join(", ")}`
      : `${entity.num} has no resources.`
  );
}

// %resource <entity>,<name>,<delta> - host adjusts a resource pool.
function handleResource(game: Game, user: User, args: string) {
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %resource.");
  }
  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
    return sendPm(
      user.name,
      "Usage: %resource <entity>, <name>, <delta> (e.g. %resource P1, qi, +2)"
    );
  }
  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);
  const name = toId(parts[1]);
  const delta = parseInt(parts[2]);
  if (isNaN(delta)) return sendPm(user.name, "Invalid delta.");
  pushSnapshot(game);
  const cur = entity.resources[name] ?? 0;
  entity.resources[name] = Math.max(0, cur + delta);
  send(
    game.room,
    `${entity.num} ${name}: ${cur} -> ${entity.resources[name]} (${delta >= 0 ? "+" : ""}${delta})`
  );
  broadcastPages(game);
}

// %mp <delta>[,entity] - host adjusts MP.
function handleMp(game: Game, user: User, args: string) {
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %mp.");
  }
  const parts = args.split(",").map((s) => s.trim());
  let entity: Entity | null = null;
  let amount: number;
  if (parts.length >= 2 && parts[0] && parts[1]) {
    amount = parseInt(parts[0]);
    entity = getEntity(game, parts[1]);
  } else if (parts.length === 1) {
    amount = parseInt(parts[0]);
    entity = getCurrentEntity(game);
  } else {
    return sendPm(user.name, "Usage: %mp <delta>[,entity]");
  }
  if (!entity) return sendPm(user.name, "No active entity.");
  if (isNaN(amount)) return sendPm(user.name, "Invalid MP amount.");
  pushSnapshot(game);
  entity.mp = Math.max(0, entity.mp + amount);
  send(game.room, `${entity.num} MP: ${entity.mp} (${amount >= 0 ? "+" : ""}${amount})`);
  broadcastPages(game);
}

// %uses [entity] - show remaining ability uses.
function handleUses(game: Game, user: User, args: string) {
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No entity found.");
  const lines = entity.abilities
    .map((a) => {
      const maxUses = a.maxUses ?? parseFrequency(a.frequency).uses;
      if (!maxUses) return null;
      const used = entity.usesUsed[a.name] ?? 0;
      return `  ${a.name}: ${maxUses - used}/${maxUses}`;
    })
    .filter((x): x is string => x !== null);
  sendPm(
    user.name,
    lines.length
      ? `${entity.num} uses:\n${lines.join("\n")}`
      : `${entity.num} has no limited-use abilities.`
  );
}

// %buffs [entity] - show active buffs.
function handleBuffs(game: Game, user: User, args: string) {
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No entity found.");
  if (entity.buffs.length === 0) return sendPm(user.name, `${entity.num} has no buffs.`);
  const lines = entity.buffs.map(
    (b) => `  ${b.amount > 0 ? "+" : ""}${b.amount} ${b.stat} (${b.rounds}r)`
  );
  sendPm(user.name, `${entity.num} buffs:\n${lines.join("\n")}`);
}

// %cure <entity> - clear removable statuses (host).
function handleCure(game: Game, user: User, args: string) {
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %cure.");
  }
  const entity = getEntity(game, args.trim());
  if (!entity) return sendPm(user.name, "Usage: %cure <entity>");
  const removed = entity.statuses.filter((s) => s.removable);
  if (removed.length === 0) {
    return sendPm(user.name, `${entity.num} has no removable statuses.`);
  }
  pushSnapshot(game);
  entity.statuses = entity.statuses.filter((s) => !s.removable);
  send(game.room, `${entity.num} cured of ${removed.map((s) => s.name).join(", ")}.`);
  broadcastPages(game);
}

// %terrain <pos> - report a tile's terrain type and move cost.
function handleTerrain(game: Game, user: User, args: string) {
  const pos = parsePos(args);
  if (!pos) return sendPm(user.name, "Usage: %terrain <pos> (e.g. %terrain e4)");
  const t = game.map[pos[0]]?.[pos[1]];
  if (t === undefined) return sendPm(user.name, `Out of bounds: ${args}`);
  const name = TERRAIN_NAMES[t] ?? String(t);
  sendPm(
    user.name,
    `${posToStr(pos[0], pos[1])} is ${name} (move cost ${moveCost(t)}).`
  );
}

// %los <a>,<b> - check line of sight between two positions or entities.
function handleLos(game: Game, user: User, args: string) {
  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %los <a>, <b> (e.g. %los P1, e4)");
  }
  const a = resolvePos(game, parts[0]);
  const b = resolvePos(game, parts[1]);
  if (!a || !b) return sendPm(user.name, "Could not resolve a position.");
  const clear = hasLineOfSight(game, a, b);
  sendPm(
    user.name,
    `LOS ${posToStr(a[0], a[1])} -> ${posToStr(b[0], b[1])}: ${clear ? "clear" : "blocked"}.`
  );
}

// Resolve an entity ref or tile coordinate to a [row, col] position.
function resolvePos(game: Game, ref: string): [number, number] | null {
  const entity = getEntity(game, ref);
  if (entity) return entity.pos;
  return parsePos(ref);
}

// %moves [entity] - list an entity's abilities with roll/type/range.
function handleMoves(game: Game, user: User, args: string) {
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No entity found.");
  const lines = entity.abilities.map(
    (a) =>
      `  Lv.${a.level} ${a.name} (${a.actionType}/${a.frequency}) ${a.roll || "-"} ${a.damageType || "-"} ${a.range || "-"}: ${a.effect}`
  );
  sendPm(
    user.name,
    `${entity.num} abilities:\n${lines.join("\n") || "  (none)"}`
  );
}

// %cooldowns [entity] - show ability cooldown counts for an entity (or all).
function handleCooldowns(game: Game, user: User, args: string) {
  const ref = args.trim();
  if (ref) {
    const entity = getEntity(game, ref);
    if (!entity) return sendPm(user.name, `Unknown entity: ${ref}`);
    return sendPm(user.name, formatCooldowns(entity));
  }
  const lines = game.entities
    .filter((e) => Object.keys(e.cooldowns).length > 0)
    .map(formatCooldowns);
  sendPm(user.name, lines.length ? lines.join("\n") : "No cooldowns active.");
}

function formatCooldowns(entity: Entity): string {
  const cds = Object.entries(entity.cooldowns)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return `${entity.num} cooldowns: ${cds || "none"}`;
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

  game.toasts = [];
}
