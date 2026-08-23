import { send, sendPm, toId, parsePos, posToStr, rollDice } from "../utils.js";
import type { Room } from "../rooms.js";
import type { User } from "../users.js";
import {
  games,
  getCurrentEntity,
  getEntity,
  getReachableTiles,
  pushSnapshot,
  nextTurn,
  removeEntity,
  type Game,
  type Entity,
  Terrain,
  isStandable,
} from "../game/state.js";
import { classes, weapons, loadGameData } from "../data/index.js";
import { getVersionData } from "../data/version43.js";
import type { GameVersion } from "../data/index.js";
import { getMapByName, listMaps } from "../data/maps.js";
import {
  GAMEMODE_MAPS,
  mapsForMode,
  modeIdFor,
  pendingVoterIds,
  randomMapForMode,
  recommendedMaps,
  normalizeVoteMode,
  tallyVotes,
  tieModes,
  voteOptionsFor,
} from "../data/gamemodes.js";
import { buildHostPage, buildPlayerPage } from "../html/pages.js";
import { broadcastPages, advanceAfterActorRemoval } from "./game.js";
import type { AbilityData } from "../data/index.js";

// Modes in which someone must be designated the Juggernaut (%setjugg).
const JUGG_MODES = new Set(["JUGG", "2vJ", "3vJ", "4vJ", "PvPJ"]);

// Extra setup hint for Juggernaut modes: someone must be designated with
// %setjugg; PvPJ also needs teams split first (one side gets the juggernaut).
function juggSetupHint(mode: string): string {
  if (!JUGG_MODES.has(mode)) return "";
  return mode === "PvPJ"
    ? " Split teams with %setteam, then designate the Juggernaut with %setjugg [entity]."
    : " Designate the Juggernaut with %setjugg [entity].";
}

function hasAbility(a: AbilityData, lvl: number, exOk: boolean) {
  return a.level === "EX1" || a.level === "EX2" ? exOk : a.level <= lvl;
}

// Whether a user may change this entity's class/weapon: hosts any time,
// players only their own entity until the game starts.
function mayChangeLoadout(user: User, game: Game, entity: Entity): boolean {
  if (toId(user.name) === toId(game.host)) return true;
  return !game.started && toId(entity.name) === toId(user.name);
}

// Recalculate an entity's maxhp/curhp, stats, and abilities from its current
// class + weapon. Returns the new max HP.
function recalcEntityStats(
  entity: Entity,
  data: { classes: typeof classes; weapons: typeof weapons },
): number {
  const classData = data.classes.get(toId(entity.className));
  const weaponData = data.weapons.get(toId(entity.weaponName));
  const sv = (s: string) => parseFloat(s) || 0;
  const newMaxhp =
    (classData ? parseInt(classData.stats.hp) : 0) +
    (weaponData ? parseInt(weaponData.stats.hp) : 0);
  entity.maxhp = newMaxhp;
  entity.curhp = Math.min(entity.curhp, newMaxhp);
  entity.atk =
    (classData ? sv(classData.stats.atk) : 0) +
    (weaponData ? sv(weaponData.stats.atk) : 0);
  entity.mag =
    (classData ? sv(classData.stats.mag) : 0) +
    (weaponData ? sv(weaponData.stats.mag) : 0);
  entity.pd =
    (classData ? sv(classData.stats.pd) : 0) +
    (weaponData ? sv(weaponData.stats.pd) : 0);
  entity.md =
    (classData ? sv(classData.stats.md) : 0) +
    (weaponData ? sv(weaponData.stats.md) : 0);
  entity.eva = Math.floor(
    (classData ? sv(classData.stats.eva) : 0) +
      (weaponData ? sv(weaponData.stats.eva) : 0),
  );
  entity.mp =
    (classData ? sv(classData.stats.mp) : 0) +
    (weaponData ? sv(weaponData.stats.mp) : 0);
  // classLevel and weaponLevel are always set together (createPlayerEntity,
  // %setlevel), so using classLevel here is equivalent to weaponLevel.
  const lvl = entity.classLevel;
  entity.abilities = [
    ...(classData
      ? classData.abilities.filter((a) =>
          hasAbility(a, lvl, !!entity.isJuggernaut),
        )
      : []),
    ...(weaponData
      ? weaponData.abilities.filter((a) =>
          hasAbility(a, lvl, !!entity.isJuggernaut),
        )
      : []),
  ] as any[];
  return newMaxhp;
}

function findGameForHost(username: string): Game | null {
  for (const game of games.values()) {
    if (toId(game.host) === toId(username)) return game;
  }
  return null;
}

export function hostCommand(
  room: Room | null,
  user: User,
  cmd: string,
  args: string,
  val: string,
  pm = false,
) {
  if (pm && (cmd === "host" || cmd === "dehost")) {
    sendPm(user.name, `${cmd} must be used in a room.`);
    return;
  }

  if (!room) {
    sendPm(user.name, "This command must be used in a room.");
    return;
  }

  const full = val ? `${args},${val}` : args;

  switch (cmd) {
    case "host":
      handleHost(room, user, args);
      break;
    case "dehost":
      handleDehost(room, user);
      break;
    case "setgame":
      handleSetGame(room, user, full);
      break;
    case "addp":
      handleAddPlayer(room, user, full);
      break;
    case "remp":
      handleRemPlayer(room, user, full);
      break;
    case "setmap":
      handleSetMap(room, user, full);
      break;
    case "setlevel":
    case "sl":
      handleSetLevel(room, user, full);
      break;
    case "setteam":
      handleSetTeam(room, user, full);
      break;
    case "gento":
      handleGenTurnOrder(room, user);
      break;
    case "start":
      handleStart(room, user);
      break;
    case "addm":
      handleAddMonster(room, user, full);
      break;
    case "sc":
      handleSwitchClass(room, user, full);
      break;
    case "sw":
      handleSwitchWeapon(room, user, full);
      break;
    case "sco":
      handleSelfLoadout(room, user, full);
      break;
    case "setclass":
      handleSetClass(room, user, full);
      break;
    case "setweapon":
      handleSetWeapon(room, user, full);
      break;
    case "setloadout":
      handleSetEntityLoadout(room, user, full);
      break;
    case "setjugg":
      handleSetJugg(room, user, full);
      break;
    case "listmaps":
      handleListMaps(room, user, full);
      break;
    case "open":
    case "openbsu":
      handleOpen(room, user, cmd === "openbsu");
      break;
    case "close":
      handleClose(room, user);
      break;
    case "endvote":
      handleEndVote(room, user);
      break;
    case "ffabtn":
      handleFfaButton(room, user);
      break;
    case "nudge":
      handleNudge(room, user);
      break;
    case "join":
      handleJoin(room, user, full);
      break;
    case "genpos":
      handleGenPos(room, user, full);
      break;
    default:
      sendPm(user.name, `Host command ${cmd}: not yet implemented.`);
  }
}

function findGameForRoom(roomid: string): Game | null {
  for (const game of games.values()) {
    if (game.room === roomid) return game;
  }
  return null;
}

// -- .host - Create a new game -------------------------------------------------

function handleHost(room: Room, user: User, args: string) {
  const version = parseVersion(args);
  if (!version) {
    return sendPm(
      user.name,
      "Invalid version. Use %host for BD 4.4 or %host 4.3 for BD 4.3.",
    );
  }

  const existing = findGameForRoom(room.id);
  if (existing) {
    return sendPm(
      user.name,
      "A game already exists in this room. Use %dehost first.",
    );
  }

  const id = `game-${Date.now().toString(36)}`;
  const game: Game = {
    id,
    room: room.id,
    host: user.name,
    version,
    entities: [],
    // A freshly hosted game has NO map — the host must pick one
    // (%setmap <name> or %setmap gen) before %start will work.
    map: [],
    mapName: "",
    turnOrder: [],
    turnIndex: 0,
    round: 1,
    log: [],
    snapshots: [],
    mode: "FFA",
    modeChosen: false,
    phase: "setup",
    started: false,
    kills: {},
    winner: null,
    chatLog: [],
    toasts: [],
    signupsOpen: false,
    votes: {},
    voteOpen: false,
    voteRunoff: null,
    timer: null,
  };

  games.set(id, game);
  send(
    room.id,
    `**${user.name}** is now hosting **BD ${version}**! (Game ID: ${id})`,
  );
  sendPm(
    user.name,
    "Use %setgame, %addp, %setmap to configure, then %start. Pick a map with %setmap <name> (see %listmaps) or %setmap gen.",
  );
  // Push a fresh (empty) host page so the GUI never shows a previous game.
  broadcastPages(game);
}

function parseVersion(arg: string): GameVersion | null {
  const v = arg.trim().toLowerCase();
  if (v === "" || v === "4.4") return "4.4";
  if (v === "4.3") return "4.3";
  return null;
}

// -- .dehost - Remove the game -------------------------------------------------

function handleDehost(room: Room, user: User) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %dehost.");
  }

  games.delete(game.id);
  send(room.id, `**${user.name}** has closed the game.`);
}

// -- .setgame <mode> - Set game mode -------------------------------------------

function handleSetGame(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %setgame.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");

  const mode = args.trim();
  if (!mode)
    return sendPm(user.name, "Usage: %setgame <mode> (FFA, 2v2, 3v3, etc.)");

  const players = game.entities.filter((e) => !e.isMonster);
  if (players.length === 0) {
    return sendPm(
      user.name,
      "Add players first (%addp, or %open + %join), then %setgame <mode> to finish the setup.",
    );
  }

  // Validate team-count requirements BEFORE mutating anything.
  const teamMatch = mode.toUpperCase().match(/^(\d+)V(\d+)$/);
  if (teamMatch) {
    const a = parseInt(teamMatch[1]);
    const b = parseInt(teamMatch[2]);
    if (a < 1 || b < 1) {
      return sendPm(
        user.name,
        "Usage: %setgame <mode> (FFA, 2v2, 3v3, etc.) — team modes need at least 1 player per team.",
      );
    }
    if (players.length !== a + b) {
      return sendPm(
        user.name,
        `${a}v${b} needs exactly ${a + b} players, but ${players.length} joined.`,
      );
    }
  }

  game.mode = mode.toUpperCase();
  game.modeChosen = true;

  // Manually setting a mode supersedes any ongoing vote / runoff.
  const voteCancelled = game.voteOpen;
  game.voteOpen = false;
  game.votes = {};
  game.voteRunoff = null;

  // Pick a map only when none is chosen yet: random from the mode's
  // recommended pool, falling back to a procedural map.
  const mapMsg: string[] = [];
  if (game.map.length === 0) {
    const poolPick = randomMapForMode(mode);
    const poolDef = poolPick ? getMapByName(poolPick) : undefined;
    if (poolDef) {
      applyMap(game, poolDef, "", true);
      mapMsg.push(
        `Map: ${poolDef.displayName} (random ${modeIdFor(mode)!.toUpperCase()} pick)`,
      );
    } else {
      applyMap(
        game,
        {
          grid: generateDefaultMap(),
          displayName: "Procedural (12x12)",
          rows: 12,
          cols: 12,
        },
        "",
        true,
      );
      mapMsg.push("Map: Procedural (12x12)");
    }
  }

  pushSnapshot(game);

  // Team modes: split the players into two teams and place mirrored halves.
  let placedPairs: [Entity, [number, number]][] = [];
  if (teamMatch) {
    const a = parseInt(teamMatch[1]);
    const b = parseInt(teamMatch[2]);
    const teamA = players.slice(0, a);
    const teamB = players.slice(a, a + b);
    teamA.forEach((e) => (e.team = 1));
    teamB.forEach((e) => (e.team = 2));
    const placed = placeTeamPlayers(game, teamA, teamB);
    if (!placed) {
      broadcastPages(game); // keep the GUI in sync after the mode change
      return sendPm(user.name, "Could not find open spawn tiles.");
    }
    placedPairs = [...placed[0], ...placed[1]];
  } else {
    // FFA and other modes: clear leftover teams, spread everyone.
    players.forEach((e) => (e.team = 0));
    const placed = placePlayers(game, players);
    if (!placed) {
      broadcastPages(game); // keep the GUI in sync after the mode change
      return sendPm(user.name, "Could not find open spawn tiles.");
    }
    placedPairs = placed;
  }

  // Generate the turn order so only %start remains. This RENUMBERS entities
  // by roll (highest roller becomes P1), so the position list is built after
  // it to keep the announced numbers consistent with the turn order.
  handleGenTurnOrder(room, user);
  const spots = placedPairs.map(([e]) => {
    const teamTag = e.team > 0 ? ` (T${e.team})` : "";
    return `${e.num}${teamTag} at ${posToStr(e.pos[0], e.pos[1])}`;
  });
  const hint = juggSetupHint(game.mode);
  send(
    room.id,
    `**Game set up for ${game.mode}!${voteCancelled ? " (voting cancelled)" : ""}**${mapMsg.length ? ` ${mapMsg.join("; ")}.` : ""}\nPositions: ${spots.join(" | ")}\nRun %start to begin.${hint}`,
  );
  broadcastPages(game);
}

// -- .open / .openbsu / .close - Open/close signups ---------------------------

function handleOpen(room: Room, user: User, highlight = false) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %open.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");

  game.signupsOpen = true;
  const hl = highlight ? " (highlighted)" : "";
  send(
    room.id,
    `**Signups are now open!**${hl} Use %join to join, or click [[SIGNUP]] to open the sign-up page.`,
  );
  broadcastPages(game);
}

function handleClose(room: Room, user: User) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %close.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");

  game.signupsOpen = false;

  // Closing signups opens gamemode voting (unless there's nobody to vote).
  const players = game.entities.filter((e) => !e.isMonster);
  if (players.length >= 2) {
    game.voteOpen = true;
    game.votes = {};
    game.voteRunoff = null;
    const options = voteOptionsFor(players.length)
      .map((o) => o.id)
      .join(", ");
    send(
      room.id,
      `**Signups are now closed.** Gamemode voting is open — vote in the GUI or with %vote [mode] (available: ${options || "no modes fit this lobby size (max 8p)"}). Use %wt modes to learn what each mode is.`,
    );
  } else {
    send(room.id, "**Signups are now closed.**");
  }
  broadcastPages(game);
}

// -- .endvote - Close gamemode voting and apply the winner --------------------

function handleEndVote(room: Room, user: User) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %endvote.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");
  if (!game.voteOpen) {
    return sendPm(
      user.name,
      "No gamemode vote is open. Close signups with %close to start one.",
    );
  }

  const wasRunoff = game.voteRunoff !== null;
  const tally = tallyVotes(game.votes);
  game.votes = {};

  if (tally.length === 0) {
    game.voteOpen = false;
    game.voteRunoff = null;
    send(
      room.id,
      wasRunoff
        ? "**Voting closed.** No runoff votes were cast — pick a mode with %setgame."
        : "**Voting closed.** No votes were cast — pick a mode with %setgame.",
    );
    broadcastPages(game);
    return;
  }

  const summary = tally.map((t) => `${t.mode}: ${t.count}`).join(" | ");

  // Tied top: keep voting open as a runoff restricted to the tied modes.
  const tied = tieModes(tally);
  if (tied) {
    game.voteRunoff = tied;
    send(
      room.id,
      `**TIE — runoff!** ${summary}\nVote again, only between **${tied.join(" / ")}** (%vote [mode] or GUI). The winner is played.`,
    );
    broadcastPages(game);
    return;
  }

  const [top] = tally;
  game.voteOpen = false;
  game.voteRunoff = null;
  game.mode = top.mode.toUpperCase();
  game.modeChosen = true;
  const hint = juggSetupHint(top.mode);
  send(
    room.id,
    `**Voting closed.** ${summary}\nMode set to **${game.mode}** (won by ${wasRunoff ? "runoff" : "vote"}).${hint}`,
  );
  broadcastPages(game);
}

/**
 * %ffabtn — host-only: toggle the Setup panel's always-available %setgame ffa
 * shortcut. Some hosts never run FFA and prefer the panel to only show the
 * vote-winner action; this lets them hide the extra button per game.
 */
function handleFfaButton(room: Room, user: User) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %ffabtn.");
  }

  game.hideFfaShortcut = !game.hideFfaShortcut;
  send(
    room.id,
    game.hideFfaShortcut
      ? "The FFA shortcut is now hidden (use %ffabtn again to show it)."
      : "The FFA shortcut is now shown.",
  );
  broadcastPages(game);
}

/**
 * %nudge — host-only: pings the players who haven't voted yet so the lobby
 * can finish the vote. Mentions them by name so the chat client highlights
 * them (@Name).
 */
function handleNudge(room: Room, user: User) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %nudge.");
  }
  if (!game.voteOpen) {
    return sendPm(
      user.name,
      "No gamemode vote is open. Close signups with %close to start one.",
    );
  }

  const players = game.entities.filter((e) => !e.isMonster);
  const pending = pendingVoterIds(
    game.votes,
    players.map((p) => p.id),
  );

  if (pending.length === 0) {
    send(
      room.id,
      "Everyone has already voted! Run %endvote to apply the winning mode.",
    );
    return;
  }

  const names = pending
    .map((id) => {
      const p = players.find((e) => e.id === id);
      return p ? `@${p.name}` : "";
    })
    .filter(Boolean)
    .join(" ");
  const msg = `${names} — you haven't voted yet! Vote in the GUI or with %vote [mode].`;
  send(room.id, msg);
  game.toasts.push({ user: game.host, message: msg });
  broadcastPages(game);
}

// -- .vote <mode> - Cast/change a gamemode vote (in game.ts via gameCommand) --

// -- .join <class>, <weapon> - Join an open game -------------------------------

function handleJoin(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (game.started) return sendPm(user.name, "Game already started.");
  if (!game.signupsOpen) {
    return sendPm(user.name, "Signups are closed. Wait for the host to %open.");
  }

  const parts = args.split(",").map((s) => s.trim());
  const className = parts[0] || "Bard";
  const weaponName = parts[1] || "Crossbow";
  const team = game.entities.length + 1;
  const level = 1;

  const res = createPlayerEntity(
    game,
    user.name,
    className,
    weaponName,
    team,
    level,
  );
  if (res.err) return sendPm(user.name, res.err);
  const entity = res.entity!;

  game.entities.push(entity);
  send(
    room.id,
    `**${user.name}** joined as ${entity.num} - ${entity.className}/${entity.weaponName} Lv.${entity.classLevel} (${entity.maxhp} HP) at ${posToStr(entity.pos[0], entity.pos[1])}`,
  );
  broadcastPages(game);
}

// -- .genpos <N><mode> - Competitive starting positions ------------------------

function handleGenPos(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %genpos.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");
  if (game.map.length === 0) {
    return sendPm(
      user.name,
      "No map set. Use %setmap <name> (see %listmaps) or %setmap gen first.",
    );
  }

  const arg = args.trim().toLowerCase();

  if (game.map.length === 0) {
    return sendPm(
      user.name,
      "Set a map first (%setmap <name> or %setmap gen), then %genpos.",
    );
  }

  // Team mode: %genpos <N>v<M> (e.g. %genpos 2v2, %genpos 3v3)
  const teamMatch = arg.match(/^(\d+)\s*v\s*(\d+)$/);
  if (teamMatch) {
    const a = parseInt(teamMatch[1]);
    const b = parseInt(teamMatch[2]);
    if (a < 1 || b < 1 || a > 5 || b > 5) {
      return sendPm(
        user.name,
        "Usage: %genpos <N>v<M> with 1-5 per team (e.g. %genpos 2v2).",
      );
    }
    const players = game.entities.filter((e) => !e.isMonster);
    if (a + b !== players.length) {
      return sendPm(
        user.name,
        `${a}v${b} needs exactly ${a + b} players, but ${players.length} joined.`,
      );
    }

    const teamA = players.slice(0, a);
    const teamB = players.slice(a, a + b);

    pushSnapshot(game);
    const placed = placeTeamPlayers(game, teamA, teamB);
    if (!placed) {
      return sendPm(user.name, "Could not find open spawn tiles.");
    }
    teamA.forEach((e) => (e.team = 1));
    teamB.forEach((e) => (e.team = 2));
    game.mode = `${a}V${b}`;
    game.modeChosen = true;
    // Setting a mode directly supersedes any ongoing vote / runoff.
    game.voteOpen = false;
    game.votes = {};
    game.voteRunoff = null;
    const spots = [...placed[0], ...placed[1]]
      .map(([e, p]) => `${e.num} (T${e.team}) at ${posToStr(p[0], p[1])}`)
      .join(" | ");
    send(room.id, `**Positions set (${a}v${b}):** ${spots}`);
    broadcastPages(game);
    return;
  }

  // Free-for-all: %genpos <N>p<mode> (e.g. %genpos 4pffa)
  const match = arg.match(/^(\d+)\s*p?\s*([a-z0-9]+)$/);
  if (!match) {
    return sendPm(
      user.name,
      "Usage: %genpos <N><mode> (e.g. %genpos 4pffa) or %genpos <N>v<M> (e.g. %genpos 2v2).",
    );
  }

  const n = parseInt(match[1]);
  const mode = match[2];

  if (mode.includes("v")) {
    return sendPm(
      user.name,
      "Team modes use %genpos <N>v<M> (e.g. %genpos 2v2).",
    );
  }
  if (mode.includes("pve")) {
    return sendPm(user.name, "%genpos does not support PvE.");
  }

  const players = game.entities.filter((e) => !e.isMonster);
  if (n < 1) {
    return sendPm(
      user.name,
      "Usage: %genpos <N><mode> (e.g. %genpos 4pffa) or %genpos <N>v<M> (e.g. %genpos 2v2).",
    );
  }
  if (n > players.length) {
    return sendPm(
      user.name,
      `Only ${players.length} player(s) joined; cannot place ${n}.`,
    );
  }
  if (n > 9) {
    return sendPm(user.name, "%genpos supports up to 9 players.");
  }

  // Record the mode choice (FFA-style) so the header reflects it.
  game.mode = mode.toUpperCase();
  game.modeChosen = true;

  // Snapshot BEFORE clearing teams so %undo restores a prior team setup.
  pushSnapshot(game);
  players.forEach((e) => (e.team = 0));
  const placed = placePlayers(game, players.slice(0, n));
  if (!placed) {
    return sendPm(user.name, "Could not find open spawn tiles.");
  }

  const spots = placed
    .map(([e, p]) => `${e.num} at ${posToStr(p[0], p[1])}`)
    .join(" | ");
  send(
    room.id,
    `**Positions set (${n}-player ${mode.toUpperCase()}):** ${spots}`,
  );
  broadcastPages(game);
}

export function placePlayers(
  game: Game,
  players: Entity[],
): [Entity, [number, number]][] | null {
  const rows = game.map.length;
  const cols = game.map[0]?.length ?? 0;
  const slots = genPosSlots(rows, cols, players.length);
  const used = new Set<string>();
  const out: [Entity, [number, number]][] = [];
  // Ignore the being-placed players' PREVIOUS positions when finding open
  // tiles, so re-running %genpos doesn't let their old spots block the anchors.
  const placing = new Set(players.map((p) => p.id));

  for (let i = 0; i < players.length; i++) {
    const anchor = slots[i];
    const pos = findNearestOpenTile(game, anchor[0], anchor[1], used, placing);
    if (!pos) return null;
    players[i].pos = pos;
    used.add(`${pos[0]},${pos[1]}`);
    out.push([players[i], pos]);
  }
  return out;
}

// Build the perimeter ring of a map as an ordered list of [row, col] anchors,
// starting at the top-left corner and walking clockwise. Corner cells appear
// once; degenerate 1-row/1-col maps are deduped so no cell repeats. Used to
// place FFA players equidistantly around the map edge.
function perimeterRing(rows: number, cols: number): [number, number][] {
  const bottom = Math.max(0, rows - 1);
  const right = Math.max(0, cols - 1);
  const ring: [number, number][] = [];
  const seen = new Set<string>();
  const push = (r: number, c: number) => {
    const key = `${r},${c}`;
    if (seen.has(key)) return;
    seen.add(key);
    ring.push([r, c]);
  };
  for (let c = 0; c <= right; c++) push(0, c); // top edge
  for (let r = 1; r <= bottom; r++) push(r, right); // right edge
  for (let c = right - 1; c >= 0; c--) push(bottom, c); // bottom edge (skip corner)
  for (let r = bottom - 1; r > 0; r--) push(r, 0); // left edge (skip corners)
  return ring;
}

export function genPosSlots(
  rows: number,
  cols: number,
  n: number,
): [number, number][] {
  const midR = Math.floor(rows / 2);
  const midC = Math.floor(cols / 2);
  if (n === 1) return [[midR, midC]];

  // FFA: everyone starts ON the perimeter, spaced as evenly as the ring
  // allows — adjacent players are always ~perimeter/n apart, so all players
  // are equidistant from their neighbors around the map edge.
  const ring = perimeterRing(rows, cols);
  const total = ring.length;
  const out: [number, number][] = [];
  const used = new Set<string>();
  // Never claim more slots than the ring has cells (degenerate maps).
  const count = Math.min(n, total);
  for (let i = 0; i < count; i++) {
    let idx = Math.round((i * total) / count);
    // Avoid double-claiming a corner when rounding collides.
    while (idx >= total || used.has(`${ring[idx][0]},${ring[idx][1]}`)) {
      idx = (idx + 1) % total;
    }
    used.add(`${ring[idx][0]},${ring[idx][1]}`);
    out.push(ring[idx]);
  }
  return out;
}

/**
 * A tight corner cluster of `k` anchors: fills the smallest square block at
 * the corner (row-major), so 3 teammates sit at a1/b1/a2, 4 at a 2x2 block,
 * and larger teams spill along the edges — all staying adjacent in the corner.
 */
function cornerCluster(k: number): [number, number][] {
  const out: [number, number][] = [];
  const dim = Math.ceil(Math.sqrt(Math.max(1, k)));
  for (let r = 0; r < dim && out.length < k; r++) {
    for (let c = 0; c < dim && out.length < k; c++) {
      out.push([r, c]);
    }
  }
  return out;
}

/**
 * Symmetric team spawn anchors: team A clumps together in the top-left corner
 * (a1/b1/a2...), team B clumps mirrored in the bottom-right corner. 1v1 meets
 * at opposite corners; larger teams sit shoulder-to-shoulder facing each other
 * across the map, which is how BD team games are played.
 */
export function genTeamSlots(
  rows: number,
  cols: number,
  a: number,
  b: number,
): [top: [number, number][], bottom: [number, number][]] {
  const bottomRow = Math.max(0, rows - 1);
  const rightCol = Math.max(0, cols - 1);
  const top = cornerCluster(a);
  const bottom = cornerCluster(b).map(([r, c]): [number, number] => [
    bottomRow - r,
    rightCol - c,
  ]);
  return [top, bottom];
}

/**
 * Place two teams on mirrored map halves. Returns a pair of placed lists
 * (entity + position) or null when no open tiles are found.
 */
export function placeTeamPlayers(
  game: Game,
  teamA: Entity[],
  teamB: Entity[],
):
  | [
      placedA: [Entity, [number, number]][],
      placedB: [Entity, [number, number]][],
    ]
  | null {
  const rows = game.map.length;
  const cols = game.map[0]?.length ?? 0;
  const [top, bottom] = genTeamSlots(rows, cols, teamA.length, teamB.length);
  const used = new Set<string>();
  const outA: [Entity, [number, number]][] = [];
  const outB: [Entity, [number, number]][] = [];
  // See placePlayers: ignore the placed players' old positions so repeated
  // %genpos calls still hit the exact anchors.
  const placing = new Set([...teamA, ...teamB].map((e) => e.id));

  for (let i = 0; i < teamA.length; i++) {
    const pos = findNearestOpenTile(game, top[i][0], top[i][1], used, placing);
    if (!pos) return null;
    teamA[i].pos = pos;
    used.add(`${pos[0]},${pos[1]}`);
    outA.push([teamA[i], pos]);
  }
  for (let i = 0; i < teamB.length; i++) {
    const pos = findNearestOpenTile(
      game,
      bottom[i][0],
      bottom[i][1],
      used,
      placing,
    );
    if (!pos) return null;
    teamB[i].pos = pos;
    used.add(`${pos[0]},${pos[1]}`);
    outB.push([teamB[i], pos]);
  }
  return [outA, outB];
}

export function findNearestOpenTile(
  game: Game,
  r: number,
  c: number,
  used: Set<string>,
  placing?: Set<string>,
): [number, number] | null {
  const rows = game.map.length;
  const cols = game.map[0]?.length ?? 0;
  const seen = new Set<string>();
  const q: [number, number][] = [[r, c]];
  seen.add(`${r},${c}`);

  while (q.length > 0) {
    const [cr, cc] = q.shift()!;
    if (
      isStandable(game.map[cr][cc]) &&
      !used.has(`${cr},${cc}`) &&
      !game.entities.some(
        (e) =>
          e.pos[0] === cr && e.pos[1] === cc && !(placing && placing.has(e.id)),
      )
    ) {
      return [cr, cc];
    }
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const key = `${nr},${nc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      q.push([nr, nc]);
    }
  }
  return null;
}

// -- .addp <name>, [class], [weapon], [team] - Add a player --------------------

function handleAddPlayer(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %addp.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 1 || !parts[0]) {
    return sendPm(user.name, "Usage: %addp <name>, [class], [weapon], [team]");
  }

  const name = parts[0];
  const className = parts[1] || "Bard";
  const weaponName = parts[2] || "Crossbow";
  const team = parts[3] ? parseInt(parts[3]) : game.entities.length + 1;
  const level = 1;

  const res = createPlayerEntity(
    game,
    name,
    className,
    weaponName,
    team,
    level,
  );
  if (res.err) return sendPm(user.name, res.err);
  const entity = res.entity!;

  game.entities.push(entity);
  const teamStr = team > 0 ? ` Team ${team}` : "";
  send(
    room.id,
    `**${name}** added as ${entity.num} - ${entity.className}/${entity.weaponName} Lv.${entity.classLevel} (${entity.maxhp} HP) at ${posToStr(entity.pos[0], entity.pos[1])}${teamStr}`,
  );
  broadcastPages(game);
}

// Build a player entity (shared by %addp and %join)
function createPlayerEntity(
  game: Game,
  name: string,
  className: string,
  weaponName: string,
  team: number,
  level: number,
): { err?: string; entity?: Entity } {
  if (game.entities.some((e) => toId(e.name) === toId(name))) {
    return { err: `${name} is already in the game.` };
  }

  const data = getVersionData(game.version);
  const classData = data.classes.get(toId(className));
  const weaponData = data.weapons.get(toId(weaponName));

  if (!classData) {
    return { err: `Unknown class: ${className}. Use %wt to look up.` };
  }
  if (!weaponData) {
    return { err: `Unknown weapon: ${weaponName}. Use %wt to look up.` };
  }

  if (isNaN(team) || team < 0) {
    return { err: "Team must be a non-negative number (0 = FFA)." };
  }

  const lvl = Math.min(level, 10);
  const maxhp = parseInt(classData.stats.hp) + parseInt(weaponData.stats.hp);

  function statVal(statList: string): number {
    return parseFloat(statList) || 0;
  }

  const playerNum = game.entities.filter((e) => !e.isMonster).length + 1;
  const num = `P${playerNum}`;

  const classAbilities = classData.abilities.filter((a) =>
    hasAbility(a, lvl, false),
  );
  const weaponAbilities = weaponData.abilities.filter((a) =>
    hasAbility(a, lvl, false),
  );
  const allAbilities = [...classAbilities, ...weaponAbilities] as any[];

  const pos = findSpawnPosition(game);

  const entity: Entity = {
    num,
    name,
    id: toId(name),
    isMonster: false,
    isJuggernaut: false,
    curhp: maxhp,
    maxhp,
    atk: statVal(classData.stats.atk) + statVal(weaponData.stats.atk),
    mag: statVal(classData.stats.mag) + statVal(weaponData.stats.mag),
    pd: statVal(classData.stats.pd) + statVal(weaponData.stats.pd),
    md: statVal(classData.stats.md) + statVal(weaponData.stats.md),
    eva: Math.floor(
      statVal(classData.stats.eva) + statVal(weaponData.stats.eva),
    ),
    mp: statVal(classData.stats.mp) + statVal(weaponData.stats.mp),
    pos,
    team,
    className: classData.name,
    weaponName: weaponData.name,
    classLevel: lvl,
    weaponLevel: lvl,
    abilities: allAbilities,
    statuses: [],
    buffs: [],
    cooldowns: {},
    usesUsed: {},
    resources: {},
    pendingAction: null,
    dashUsed: false,
    standardUsed: false,
    movementUsed: false,
    swiftUsed: false,
  };

  return { entity };
}

// -- .addm <name>, <hp>, <atk>, <mag>, <pd>, <md>, <eva>, <mp> [, team] - Add a monster --

function handleAddMonster(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %addm.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 8 || !parts[0]) {
    return sendPm(
      user.name,
      "Usage: %addm <name>, <hp>, <atk>, <mag>, <pd>, <md>, <eva>, <mp> [, team]",
    );
  }

  const name = parts[0];
  const hp = parseInt(parts[1]);
  const atk = parseInt(parts[2]);
  const mag = parseInt(parts[3]);
  const pd = parseInt(parts[4]);
  const md = parseInt(parts[5]);
  const eva = parseInt(parts[6]);
  const mp = parseInt(parts[7]);
  const team = parts[8] ? parseInt(parts[8]) : 0;

  if ([hp, atk, mag, pd, md, eva, mp].some(isNaN)) {
    return sendPm(user.name, "All stat values must be numbers.");
  }
  if (isNaN(team) || team < 0) {
    return sendPm(user.name, "Team must be a non-negative number.");
  }

  // Check duplicate
  if (game.entities.some((e) => toId(e.name) === toId(name))) {
    return sendPm(user.name, `${name} is already in the game.`);
  }

  // Next monster number
  const monsterNum = game.entities.filter((e) => e.isMonster).length + 1;
  const num = `M${monsterNum}`;
  const pos = findSpawnPosition(game);

  const entity: Entity = {
    num,
    name,
    id: toId(name),
    isMonster: true,
    curhp: hp,
    maxhp: hp,
    atk,
    mag,
    pd,
    md,
    eva,
    mp,
    pos,
    team,
    className: "Monster",
    weaponName: "Natural",
    classLevel: 1,
    weaponLevel: 1,
    abilities: [],
    statuses: [],
    buffs: [],
    cooldowns: {},
    usesUsed: {},
    resources: {},
    pendingAction: null,
    dashUsed: false,
    standardUsed: false,
    movementUsed: false,
    swiftUsed: false,
  };

  game.entities.push(entity);
  const teamStr = team > 0 ? ` Team ${team}` : "";
  send(
    room.id,
    `**${name}** added as ${num} - Monster (${hp} HP, ATK:${atk} MAG:${mag} PD:${pd} MD:${md} EVA:${eva} MP:${mp}) at ${posToStr(pos[0], pos[1])}${teamStr}`,
  );
}

// Shared loadout-application helpers. Announce the change and refresh the GUI;
// return false when the requested class/weapon name is unknown.

function applyClassChange(
  game: Game,
  room: Room,
  entity: Entity,
  newClass: string,
): boolean {
  const data = getVersionData(game.version);
  const classData = data.classes.get(toId(newClass));
  if (!classData) return false;
  pushSnapshot(game);
  const oldClass = entity.className;
  entity.className = classData.name;
  const newMaxhp = recalcEntityStats(entity, data);
  send(
    room.id,
    `${entity.num} (${entity.name}) class: ${oldClass} -> ${classData.name} (${newMaxhp} HP)`,
  );
  broadcastPages(game);
  return true;
}

function applyWeaponChange(
  game: Game,
  room: Room,
  entity: Entity,
  newWeapon: string,
): boolean {
  const data = getVersionData(game.version);
  const weaponData = data.weapons.get(toId(newWeapon));
  if (!weaponData) return false;
  pushSnapshot(game);
  const oldWeapon = entity.weaponName;
  entity.weaponName = weaponData.name;
  const newMaxhp = recalcEntityStats(entity, data);
  send(
    room.id,
    `${entity.num} (${entity.name}) weapon: ${oldWeapon} -> ${weaponData.name} (${newMaxhp} HP)`,
  );
  broadcastPages(game);
  return true;
}

function applyLoadoutChange(
  game: Game,
  room: Room,
  entity: Entity,
  newClass: string,
  newWeapon: string,
): boolean {
  const data = getVersionData(game.version);
  const classData = data.classes.get(toId(newClass));
  const weaponData = data.weapons.get(toId(newWeapon));
  if (!classData || !weaponData) return false;
  pushSnapshot(game);
  const oldClass = entity.className;
  const oldWeapon = entity.weaponName;
  entity.className = classData.name;
  entity.weaponName = weaponData.name;
  const newMaxhp = recalcEntityStats(entity, data);
  send(
    room.id,
    `${entity.num} (${entity.name}) loadout: ${oldClass}/${oldWeapon} -> ${classData.name}/${weaponData.name} (${newMaxhp} HP)`,
  );
  broadcastPages(game);
  return true;
}

// -- .sc <class> - Switch your class (self-service) ---------------------------

function handleSwitchClass(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  const parts = args.split(",").map((s) => s.trim());
  if (!parts[0]) {
    return sendPm(user.name, "Usage: %sc <class>");
  }
  const entity = getEntity(game, user.name);
  if (!entity) return sendPm(user.name, `Unknown entity: ${user.name}`);
  if (!mayChangeLoadout(user, game, entity)) {
    return sendPm(user.name, "The game has already started.");
  }
  if (!applyClassChange(game, room, entity, parts[0])) {
    return sendPm(user.name, `Unknown class: ${parts[0]}. Use %wt to look up.`);
  }
}

// -- .sw <weapon> - Switch your weapon (self-service) -------------------------

function handleSwitchWeapon(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  const parts = args.split(",").map((s) => s.trim());
  if (!parts[0]) {
    return sendPm(user.name, "Usage: %sw <weapon>");
  }
  const entity = getEntity(game, user.name);
  if (!entity) return sendPm(user.name, `Unknown entity: ${user.name}`);
  if (!mayChangeLoadout(user, game, entity)) {
    return sendPm(user.name, "The game has already started.");
  }
  if (!applyWeaponChange(game, room, entity, parts[0])) {
    return sendPm(
      user.name,
      `Unknown weapon: ${parts[0]}. Use %wt to look up.`,
    );
  }
}

/**
 * %sco <class>, <weapon> — set your own class AND weapon in one go.
 * Same permissions as %sc/%sw: players may change their own until the
 * game starts.
 */
function handleSelfLoadout(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %sco <class>, <weapon>");
  }
  const entity = getEntity(game, user.name);
  if (!entity) return sendPm(user.name, `Unknown entity: ${user.name}`);
  if (!mayChangeLoadout(user, game, entity)) {
    return sendPm(user.name, "The game has already started.");
  }
  if (!applyLoadoutChange(game, room, entity, parts[0], parts[1])) {
    return sendPm(
      user.name,
      `Unknown class or weapon: ${parts[0]}/${parts[1]}. Use %wt to look up.`,
    );
  }
}

// -- .setclass <entity>, <class> - Host-only: set any entity's class ----------

function handleSetClass(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %setclass.");
  }
  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %setclass <entity>, <class>");
  }
  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);
  if (!applyClassChange(game, room, entity, parts[1])) {
    return sendPm(user.name, `Unknown class: ${parts[1]}. Use %wt to look up.`);
  }
}

// -- .setweapon <entity>, <weapon> - Host-only: set any entity's weapon --------

function handleSetWeapon(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %setweapon.");
  }
  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %setweapon <entity>, <weapon>");
  }
  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);
  if (!applyWeaponChange(game, room, entity, parts[1])) {
    return sendPm(
      user.name,
      `Unknown weapon: ${parts[1]}. Use %wt to look up.`,
    );
  }
}

// -- .setloadout <entity>, <class>, <weapon> - Host-only ----------------------

function handleSetEntityLoadout(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %setloadout.");
  }
  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
    return sendPm(user.name, "Usage: %setloadout <entity>, <class>, <weapon>");
  }
  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);
  if (!applyLoadoutChange(game, room, entity, parts[1], parts[2])) {
    return sendPm(
      user.name,
      `Unknown class or weapon: ${parts[1]}/${parts[2]}. Use %wt to look up.`,
    );
  }
}

// -- .setlevel <entity>, <level> - Set entity level ----------------------------

// Set an entity's class/weapon level, recomputing HP and abilities. Returns
// the previous level.
function applyEntityLevel(
  entity: Entity,
  level: number,
  data: { classes: typeof classes; weapons: typeof weapons },
): number {
  const classData = data.classes.get(toId(entity.className));
  const weaponData = data.weapons.get(toId(entity.weaponName));
  const maxhp =
    (classData ? parseInt(classData.stats.hp) : 0) +
    (weaponData ? parseInt(weaponData.stats.hp) : 0);
  const oldLvl = entity.classLevel;
  entity.classLevel = level;
  entity.weaponLevel = level;
  entity.curhp = Math.min(entity.curhp, maxhp);
  entity.maxhp = maxhp;
  entity.abilities = [
    ...(classData
      ? classData.abilities.filter((a) =>
          hasAbility(a, level, !!entity.isJuggernaut),
        )
      : []),
    ...(weaponData
      ? weaponData.abilities.filter((a) =>
          hasAbility(a, level, !!entity.isJuggernaut),
        )
      : []),
  ] as any[];
  return oldLvl;
}

function handleSetLevel(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %setlevel.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %setlevel <entity|all>, <level>");
  }

  const level = parseInt(parts[1]);
  if (isNaN(level) || level < 1 || level > 10) {
    return sendPm(user.name, "Level must be 1-10.");
  }

  // %setlevel all, <level> — level every player in one go.
  if (toId(parts[0]) === "all") {
    const players = game.entities.filter((e) => !e.isMonster);
    if (players.length === 0) {
      return sendPm(user.name, "No players in the game.");
    }
    pushSnapshot(game);
    const data = getVersionData(game.version);
    const rows = players.map((e) => {
      const oldLvl = applyEntityLevel(e, level, data);
      return `${e.num} (${e.name}) ${oldLvl} -> ${level}`;
    });
    send(
      room.id,
      `**All ${players.length} player(s) set to level ${level}.** ${rows.join(" | ")}`,
    );
    broadcastPages(game);
    return;
  }

  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);

  pushSnapshot(game);
  const data = getVersionData(game.version);
  const oldLvl = applyEntityLevel(entity, level, data);
  send(
    room.id,
    `${entity.num} (${entity.name}) level: ${oldLvl} -> ${level} (${entity.maxhp} HP)`,
  );
  broadcastPages(game);
}

// -- .setteam <entity>, <team> - Set entity team --------------------------------

function handleSetTeam(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %setteam.");
  }

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %setteam <entity>, <team>");
  }

  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);

  const team = parseInt(parts[1]);
  if (isNaN(team) || team < 0) {
    return sendPm(user.name, "Team must be a non-negative number.");
  }

  const oldTeam = entity.team;
  entity.team = team;
  send(room.id, `${entity.num} (${entity.name}) team: ${oldTeam} -> ${team}`);
  broadcastPages(game);
}

// -- .setjugg <entity> - Toggle juggernaut -------------------------------------

function handleSetJugg(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %setjugg.");
  }

  const entity = getEntity(game, args.trim());
  if (!entity) return sendPm(user.name, `Unknown entity: ${args.trim()}`);

  entity.isJuggernaut = !entity.isJuggernaut;

  // Re-filter abilities to include/exclude EX
  const data = getVersionData(game.version);
  const classData = data.classes.get(toId(entity.className));
  const weaponData = data.weapons.get(toId(entity.weaponName));
  const lvl = entity.classLevel;
  if (classData && weaponData) {
    entity.abilities = [
      ...classData.abilities.filter((a) =>
        hasAbility(a, lvl, entity.isJuggernaut!),
      ),
      ...weaponData.abilities.filter((a) =>
        hasAbility(a, lvl, entity.isJuggernaut!),
      ),
    ] as any[];
  }

  send(
    room.id,
    `${entity.num} (${entity.name}) is ${entity.isJuggernaut ? "now" : "no longer"} a Juggernaut.`,
  );
  broadcastPages(game);
}

// -- .remp <name> - Remove a player --------------------------------------------

function handleRemPlayer(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %remp.");
  }

  const name = args.trim();
  if (!name) return sendPm(user.name, "Usage: %remp <name>");

  const entity = getEntity(game, name);
  if (!entity) return sendPm(user.name, `${name} is not in the game.`);

  removeEntity(game, entity);
  send(room.id, `**${entity.num} (${entity.name})** has been removed.`);
  if (advanceAfterActorRemoval(game)) return;
  broadcastPages(game);
}

// -- .setmap <name> - Set the map ----------------------------------------------

function handleSetMap(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %setmap.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");

  const mapName = args.trim();
  if (!mapName)
    return sendPm(
      user.name,
      "Usage: %setmap <name> or %setmap gen [12|16|20]. Use %listmaps to see curated maps.",
    );

  const lower = mapName.toLowerCase();

  // %setmap <gamemode> — set a random map from that mode's pool (curated
  // recommendations plus any volunteer maps tagged for the mode).
  // (e.g. %setmap pvp, %setmap 1v1, %setmap 2v2).
  const modeId = modeIdFor(lower);
  if (modeId) {
    let pick = randomMapForMode(lower)!;
    // Avoid instantly re-setting the same map when the pool has options.
    if (GAMEMODE_MAPS[modeId].length > 1 && game.mapName) {
      for (let tries = 0; tries < 4; tries++) {
        if (getMapByName(pick)?.displayName !== game.mapName) break;
        pick = randomMapForMode(lower)!;
      }
    }
    const modeDef = getMapByName(pick);
    if (modeDef) {
      applyMap(game, modeDef, ` — random ${modeId.toUpperCase()} pick`);
      return;
    }
  }

  // Curated map database
  const def = getMapByName(lower);
  if (def) {
    applyMap(game, def);
    return;
  }

  // %setmap gen [12|16|20] — the ONLY procedural map trigger.
  if (lower === "gen" || lower.startsWith("gen ")) {
    const size = lower === "gen" ? 12 : parseInt(lower.slice(4));
    if (
      lower !== "gen" &&
      (isNaN(size) || (size !== 12 && size !== 16 && size !== 20))
    ) {
      return sendPm(user.name, "Usage: %setmap gen [12|16|20].");
    }
    let grid: Terrain[][];
    let displayName: string;
    if (size === 16) {
      grid = generateMediumMap();
      displayName = "Procedural (16x16)";
    } else if (size === 20) {
      grid = generateLargeMap();
      displayName = "Procedural (20x20)";
    } else {
      grid = generateDefaultMap();
      displayName = "Procedural (12x12)";
    }
    applyMap(game, {
      grid,
      displayName,
      rows: grid.length,
      cols: grid[0]?.length ?? 0,
    });
    return;
  }

  return sendPm(
    user.name,
    "Unknown map. Use %listmaps to see curated maps, or %setmap gen for a procedural map.",
  );
}

// -- .listmaps [size] - List available maps -----------------------------------

function handleListMaps(room: Room, user: User, args: string) {
  const filter = args.trim().toLowerCase();
  const game = findGameForRoom(room.id);
  const mode = game?.mode ?? "FFA";

  // `%listmaps <mode>` shows the recommended pool for that mode
  // (e.g. %listmaps pvp, %listmaps 1v1, %listmaps 2v2).
  const modeId = modeIdFor(filter);
  if (modeId) {
    const byName = new Map(listMaps().map((m) => [m.name, m]));
    const names = mapsForMode(filter)
      .map((n) => byName.get(n)?.displayName ?? n)
      .join(", ");
    return sendPm(
      user.name,
      `**Recommended ${modeId.toUpperCase()} maps:** ${names}`,
    );
  }

  let maps = listMaps();

  if (filter) {
    // Filter by size like "10x10" or "8x8"
    const sizeMatch = filter.match(/^(\d+)x(\d+)$/);
    if (sizeMatch) {
      const rows = parseInt(sizeMatch[1]);
      const cols = parseInt(sizeMatch[2]);
      maps = maps.filter((m) => m.rows === rows && m.cols === cols);
    } else {
      // Filter by name substring
      maps = maps.filter((m) => m.name.includes(filter));
    }
  }

  if (maps.length === 0) {
    return sendPm(user.name, "No maps found matching that filter.");
  }

  const lines: string[] = [];

  // Plain `%listmaps` surfaces the designated pool for the current game mode.
  if (!filter) {
    const rec = recommendedMaps(mode);
    if (rec && rec.length > 0) {
      const byName = new Map(maps.map((m) => [m.name, m]));
      const names = rec.map((n) => byName.get(n)?.displayName ?? n).join(", ");
      lines.push(`**Recommended for ${mode}:** ${names}`);
      lines.push("");
    }
  }

  // Group by size
  const bySize = new Map<string, typeof maps>();
  for (const m of maps) {
    const key = `${m.rows}x${m.cols}`;
    if (!bySize.has(key)) bySize.set(key, []);
    bySize.get(key)!.push(m);
  }

  lines.push(`**BD Maps** (${maps.length} total):`);
  for (const [size, sizeMaps] of [...bySize.entries()].sort()) {
    const names = sizeMaps.map((m) => m.displayName).join(", ");
    lines.push(`${size}: ${names}`);
  }

  sendPm(user.name, lines.join("\n"));
}

// -- .gento - Generate turn order ----------------------------------------------

function handleGenTurnOrder(room: Room, user: User) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %gento.");
  }
  if (game.map.length === 0) {
    return sendPm(
      user.name,
      "No map set. Use %setmap <name> (see %listmaps) or %setmap gen first.",
    );
  }
  if (game.entities.length === 0) {
    return sendPm(user.name, "No players in the game.");
  }
  // Roll 1d20 + MP for each entity, sort descending
  const rolls: { entity: Entity; roll: number; mp: number }[] = [];
  for (const e of game.entities) {
    const d20 = rollDice("1d20").total;
    const total = d20 + e.mp;
    rolls.push({ entity: e, roll: total, mp: e.mp });
  }

  rolls.sort((a, b) => b.roll - a.roll);
  let monster_count = 1;
  let player_count = 1;
  // Update e.num according to turn order position (1-indexed)
  rolls.forEach((r) => {
    if (r.entity.isMonster) {
      r.entity.num = `M${monster_count}`;
      monster_count++;
    } else {
      r.entity.num = `P${player_count}`;
      player_count++;
    }
  });

  game.turnOrder = rolls.map((r) => r.entity.num);
  game.turnIndex = 0;
  game.round = 1;

  const orderStr = rolls
    .map(
      (r) =>
        `${r.entity.num} (${r.entity.name}) - ${r.roll} (1d20+${r.entity.mp})`,
    )
    .join(", ");

  send(room.id, `**Turn Order**: ${orderStr}`);
}

// -- .start - Start the game ---------------------------------------------------

function handleStart(room: Room, user: User) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %start.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");
  if (game.map.length === 0) {
    return sendPm(
      user.name,
      "No map set. Use %setmap <name> (see %listmaps) or %setmap gen first.",
    );
  }
  if (game.entities.length < 2) {
    return sendPm(user.name, "Need at least 2 players to start.");
  }

  // Auto-generate turn order if not done
  if (game.turnOrder.length === 0) {
    handleGenTurnOrder(room, user);
  }

  game.started = true;
  game.phase = "playing";

  send(room.id, "**Game Started!**");
  send(
    room.id,
    `Mode: ${game.mode} | Map: ${game.mapName} | Players: ${game.entities.length}`,
  );

  // Announce first turn
  const first = getCurrentEntity(game);
  if (first) {
    send(room.id, `**${first.num}'s turn!** (${first.name})`);
  }

  broadcastPages(game);
}

// -- Map generators ------------------------------------------------------------

function generateDefaultMap(): Terrain[][] {
  // 12x12 map with varied terrain
  const rows = 12;
  const cols = 12;
  const map: Terrain[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: Terrain[] = [];
    for (let c = 0; c < cols; c++) {
      // Random terrain features (open edges, no Stop ring)
      const rng = Math.random();
      if (rng < 0.05) row.push(Terrain.Water);
      else if (rng < 0.08) row.push(Terrain.Forest);
      else if (rng < 0.1) row.push(Terrain.Ice);
      else if (rng < 0.11) row.push(Terrain.Sticky);
      else row.push(Terrain.Normal);
    }
    map.push(row);
  }

  // Add some air tiles in the middle
  const midR = Math.floor(rows / 2);
  const midC = Math.floor(cols / 2);
  map[midR][midC] = Terrain.Air;
  map[midR][midC - 1] = Terrain.Air;
  map[midR][midC + 1] = Terrain.Air;

  return map;
}

function generateMediumMap(): Terrain[][] {
  const rows = 16;
  const cols = 16;
  const map: Terrain[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: Terrain[] = [];
    for (let c = 0; c < cols; c++) {
      // Random terrain features (open edges, no Stop ring)
      const rng = Math.random();
      if (rng < 0.06) row.push(Terrain.Water);
      else if (rng < 0.09) row.push(Terrain.Forest);
      else if (rng < 0.11) row.push(Terrain.Ice);
      else if (rng < 0.12) row.push(Terrain.Sticky);
      else if (rng < 0.13) row.push(Terrain.Lava);
      else row.push(Terrain.Normal);
    }
    map.push(row);
  }

  return map;
}

function generateLargeMap(): Terrain[][] {
  const rows = 20;
  const cols = 20;
  const map: Terrain[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: Terrain[] = [];
    for (let c = 0; c < cols; c++) {
      // Random terrain features (open edges, no Stop ring)
      const rng = Math.random();
      if (rng < 0.07) row.push(Terrain.Water);
      else if (rng < 0.1) row.push(Terrain.Forest);
      else if (rng < 0.12) row.push(Terrain.Ice);
      else if (rng < 0.13) row.push(Terrain.Sticky);
      else if (rng < 0.14) row.push(Terrain.Lava);
      else if (rng < 0.15) row.push(Terrain.Bone);
      else row.push(Terrain.Normal);
    }
    map.push(row);
  }

  return map;
}

// -- Helpers -------------------------------------------------------------------

// Re-place every entity on the (new) map so no one is left standing on a tile
// that no longer exists after %setmap. findSpawnPosition skips occupied tiles,
// so sequential assignment spreads entities out.
function repositionEntities(game: Game): void {
  for (const e of game.entities) {
    e.pos = findSpawnPosition(game);
  }
}

// Apply a new map to the game: copy the grid, remember the name, re-place any
// entities, refresh the pages, and announce it. `note` is appended to the
// announcement (e.g. " — random PVP pick").
function applyMap(
  game: Game,
  def: { grid: Terrain[][]; displayName: string; rows: number; cols: number },
  note = "",
  quiet = false,
): void {
  game.map = def.grid.map((row) => [...row]);
  game.mapName = def.displayName;
  repositionEntities(game);
  if (quiet) return;
  broadcastPages(game);
  send(
    game.room,
    `Map set to **${def.displayName}** (${def.rows}x${def.cols})${note}.`,
  );
}

export function findSpawnPosition(game: Game): [number, number] {
  const rows = game.map.length;
  const cols = game.map[0]?.length ?? 0;

  // Spiral outward from center looking for open normal tiles
  const centerR = Math.floor(rows / 2);
  const centerC = Math.floor(cols / 2);

  for (let radius = 0; radius < Math.max(rows, cols); radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.abs(dr) !== radius && Math.abs(dc) !== radius) continue;
        const r = centerR + dr;
        const c = centerC + dc;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        if (!isStandable(game.map[r][c])) continue;
        if (game.entities.some((e) => e.pos[0] === r && e.pos[1] === c))
          continue;
        return [r, c];
      }
    }
  }

  // Fallback: scan the whole map for ANY standable, unoccupied tile — never
  // dump a spawn onto Broken/Lava/obstruction blindly.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isStandable(game.map[r][c])) continue;
      if (game.entities.some((e) => e.pos[0] === r && e.pos[1] === c)) continue;
      return [r, c];
    }
  }
  return [1, 1];
}
