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
} from "../game/state.js";
import { classes, weapons, loadGameData } from "../data/index.js";
import { getMapByName, listMaps } from "../data/maps.js";
import { buildHostPage, buildPlayerPage } from "../html/pages.js";
import { broadcastPages } from "./game.js";
import type { AbilityData } from "../data/index.js";

function hasAbility(a: AbilityData, lvl: number, exOk: boolean) {
  return a.level === "EX1" || a.level === "EX2" ? exOk : a.level <= lvl;
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
      handleHost(room, user);
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
    case "setjugg":
      handleSetJugg(room, user, full);
      break;
    case "listmaps":
      handleListMaps(room, user, full);
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

function handleHost(room: Room, user: User) {
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
    entities: [],
    map: generateDefaultMap(),
    mapName: "Default",
    turnOrder: [],
    turnIndex: 0,
    round: 1,
    log: [],
    snapshots: [],
    mode: "FFA",
    phase: "setup",
    started: false,
    kills: {},
    winner: null,
    chatLog: [],
    toasts: [],
  };

  games.set(id, game);
  send(room.id, `**${user.name}** is now hosting! (Game ID: ${id})`);
  sendPm(user.name, "Use %setgame, %addp, %setmap to configure, then %start.");
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

  game.mode = mode.toUpperCase();
  send(room.id, `Game mode set to **${game.mode}**.`);
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

  // Check if already added
  if (game.entities.some((e) => toId(e.name) === toId(name))) {
    return sendPm(user.name, `${name} is already in the game.`);
  }

  // Look up class and weapon data
  const classData = classes.get(toId(className));
  const weaponData = weapons.get(toId(weaponName));

  if (!classData) {
    return sendPm(
      user.name,
      `Unknown class: ${className}. Use %wt to look up.`,
    );
  }
  if (!weaponData) {
    return sendPm(
      user.name,
      `Unknown weapon: ${weaponName}. Use %wt to look up.`,
    );
  }

  if (isNaN(team) || team < 0) {
    return sendPm(user.name, "Team must be a non-negative number (0 = FFA).");
  }

  // Parse stat strings (flat values -- same at all levels)
  const lvl = Math.min(level, 10);
  const maxhp = parseInt(classData.stats.hp) + parseInt(weaponData.stats.hp);

  function statVal(statList: string): number {
    return parseFloat(statList) || 0;
  }

  // Determine next entity number
  const playerNum = game.entities.filter((e) => !e.isMonster).length + 1;
  const num = `P${playerNum}`;

  const classAbilities = classData.abilities.filter((a) =>
    hasAbility(a, lvl, false),
  );
  const weaponAbilities = weaponData.abilities.filter((a) =>
    hasAbility(a, lvl, false),
  );
  const allAbilities = [...classAbilities, ...weaponAbilities] as any[];

  // Find a starting position (first open normal tile)
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

  game.entities.push(entity);
  const teamStr = team > 0 ? ` Team ${team}` : "";
  send(
    room.id,
    `**${name}** added as ${num} - ${classData.name}/${weaponData.name} Lv.${lvl} (${maxhp} HP) at ${posToStr(pos[0], pos[1])}${teamStr}`,
  );
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

// -- .sc <entity>, <class> - Switch class --------------------------------------

function handleSwitchClass(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %sc.");
  }

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %sc <entity>, <class>");
  }

  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);

  const newClass = parts[1];
  const classData = classes.get(toId(newClass));
  if (!classData) {
    return sendPm(user.name, `Unknown class: ${newClass}. Use %wt to look up.`);
  }

  pushSnapshot(game);

  // Recalculate HP: old weapon + new class
  const weaponData = weapons.get(toId(entity.weaponName));
  const newMaxhp =
    parseInt(classData.stats.hp) +
    (weaponData ? parseInt(weaponData.stats.hp) : 0);

  const oldClass = entity.className;
  entity.className = classData.name;
  entity.maxhp = newMaxhp;
  entity.curhp = Math.min(entity.curhp, newMaxhp);

  // Recalculate stats
  const sv = (s: string) => parseFloat(s) || 0;
  entity.atk =
    sv(classData.stats.atk) + (weaponData ? sv(weaponData.stats.atk) : 0);
  entity.mag =
    sv(classData.stats.mag) + (weaponData ? sv(weaponData.stats.mag) : 0);
  entity.pd =
    sv(classData.stats.pd) + (weaponData ? sv(weaponData.stats.pd) : 0);
  entity.md =
    sv(classData.stats.md) + (weaponData ? sv(weaponData.stats.md) : 0);
  entity.eva = Math.floor(
    sv(classData.stats.eva) + (weaponData ? sv(weaponData.stats.eva) : 0),
  );
  entity.mp =
    sv(classData.stats.mp) + (weaponData ? sv(weaponData.stats.mp) : 0);

  // Update abilities to new class + existing weapon, filtered by level
  const lvl = entity.classLevel;
  entity.abilities = [
    ...classData.abilities.filter((a) =>
      hasAbility(a, lvl, !!entity.isJuggernaut),
    ),
    ...(weaponData
      ? weaponData.abilities.filter((a) =>
          hasAbility(a, lvl, !!entity.isJuggernaut),
        )
      : []),
  ] as any[];

  send(
    room.id,
    `${entity.num} (${entity.name}) class: ${oldClass} -> ${classData.name} (${newMaxhp} HP)`,
  );
  broadcastPages(game);
}

// -- .sw <entity>, <weapon> - Switch weapon ------------------------------------

function handleSwitchWeapon(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %sw.");
  }

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %sw <entity>, <weapon>");
  }

  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);

  const newWeapon = parts[1];
  const weaponData = weapons.get(toId(newWeapon));
  if (!weaponData) {
    return sendPm(
      user.name,
      `Unknown weapon: ${newWeapon}. Use %wt to look up.`,
    );
  }

  pushSnapshot(game);

  // Recalculate HP: existing class + new weapon
  const classData = classes.get(toId(entity.className));
  const newMaxhp =
    (classData ? parseInt(classData.stats.hp) : 0) +
    parseInt(weaponData.stats.hp);

  const oldWeapon = entity.weaponName;
  entity.weaponName = weaponData.name;
  entity.maxhp = newMaxhp;
  entity.curhp = Math.min(entity.curhp, newMaxhp);

  // Recalculate stats
  const sv = (s: string) => parseFloat(s) || 0;
  entity.atk =
    (classData ? sv(classData.stats.atk) : 0) + sv(weaponData.stats.atk);
  entity.mag =
    (classData ? sv(classData.stats.mag) : 0) + sv(weaponData.stats.mag);
  entity.pd =
    (classData ? sv(classData.stats.pd) : 0) + sv(weaponData.stats.pd);
  entity.md =
    (classData ? sv(classData.stats.md) : 0) + sv(weaponData.stats.md);
  entity.eva = Math.floor(
    (classData ? sv(classData.stats.eva) : 0) + sv(weaponData.stats.eva),
  );
  entity.mp =
    (classData ? sv(classData.stats.mp) : 0) + sv(weaponData.stats.mp);

  // Update abilities to existing class + new weapon, filtered by level
  const lvl = entity.weaponLevel;
  entity.abilities = [
    ...(classData
      ? classData.abilities.filter((a) =>
          hasAbility(a, lvl, !!entity.isJuggernaut),
        )
      : []),
    ...weaponData.abilities.filter((a) =>
      hasAbility(a, lvl, !!entity.isJuggernaut),
    ),
  ] as any[];

  send(
    room.id,
    `${entity.num} (${entity.name}) weapon: ${oldWeapon} -> ${weaponData.name} (${newMaxhp} HP)`,
  );
  broadcastPages(game);
}

// -- .setlevel <entity>, <level> - Set entity level ----------------------------

function handleSetLevel(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %setlevel.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return sendPm(user.name, "Usage: %setlevel <entity>, <level>");
  }

  const entity = getEntity(game, parts[0]);
  if (!entity) return sendPm(user.name, `Unknown entity: ${parts[0]}`);

  const level = parseInt(parts[1]);
  if (isNaN(level) || level < 1 || level > 10) {
    return sendPm(user.name, "Level must be 1-10.");
  }

  // Recalculate HP from class + weapon base
  const classData = classes.get(toId(entity.className));
  const weaponData = weapons.get(toId(entity.weaponName));
  if (!classData || !weaponData) {
    return sendPm(user.name, "Could not look up class/weapon data.");
  }

  const maxhp = parseInt(classData.stats.hp) + parseInt(weaponData.stats.hp);
  const oldLvl = entity.classLevel;
  entity.classLevel = level;
  entity.weaponLevel = level;
  entity.curhp = Math.min(entity.curhp, maxhp);
  entity.maxhp = maxhp;

  // Update abilities to match new level
  entity.abilities = [
    ...classData.abilities.filter((a) =>
      hasAbility(a, level, !!entity.isJuggernaut),
    ),
    ...weaponData.abilities.filter((a) =>
      hasAbility(a, level, !!entity.isJuggernaut),
    ),
  ] as any[];

  send(
    room.id,
    `${entity.num} (${entity.name}) level: ${oldLvl} -> ${level} (${maxhp} HP)`,
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
  const classData = classes.get(toId(entity.className));
  const weaponData = weapons.get(toId(entity.weaponName));
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
      "Usage: %setmap <name>. Use %listmaps to see available maps.",
    );

  const lower = mapName.toLowerCase();

  // Try the curated map database first
  const def = getMapByName(lower);
  if (def) {
    game.map = def.grid.map((row) => [...row]);
    game.mapName = def.displayName;
    send(
      room.id,
      `Map set to **${def.displayName}** (${def.rows}x${def.cols}).`,
    );
    return;
  }

  // Fallback to procedural maps
  if (lower === "default" || lower === "small") {
    game.map = generateDefaultMap();
    game.mapName = "Small (12x12)";
  } else if (lower === "medium" || lower === "md") {
    game.map = generateMediumMap();
    game.mapName = "Medium (16x16)";
  } else if (lower === "large" || lower === "lg") {
    game.map = generateLargeMap();
    game.mapName = "Large (20x20)";
  } else {
    return sendPm(
      user.name,
      "Unknown map. Use %listmaps to see available maps, or small/medium/large for procedural maps.",
    );
  }

  send(
    room.id,
    `Map set to **${game.mapName}** (${game.map.length}x${game.map[0].length}).`,
  );
}

// -- .listmaps [size] - List available maps -----------------------------------

function handleListMaps(room: Room, user: User, args: string) {
  const filter = args.trim().toLowerCase();
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

  // Group by size
  const bySize = new Map<string, typeof maps>();
  for (const m of maps) {
    const key = `${m.rows}x${m.cols}`;
    if (!bySize.has(key)) bySize.set(key, []);
    bySize.get(key)!.push(m);
  }

  const lines: string[] = [];
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
      // Borders are stop
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        row.push(Terrain.Stop);
        continue;
      }
      // Random terrain features
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
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        row.push(Terrain.Stop);
        continue;
      }
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
      if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
        row.push(Terrain.Stop);
        continue;
      }
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

function findSpawnPosition(game: Game): [number, number] {
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
        if (game.map[r][c] !== Terrain.Normal) continue;
        if (game.entities.some((e) => e.pos[0] === r && e.pos[1] === c))
          continue;
        return [r, c];
      }
    }
  }

  // Fallback
  return [1, 1];
}
