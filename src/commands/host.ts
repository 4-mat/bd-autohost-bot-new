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
import {
  GAMEMODE_MAPS,
  modeIdFor,
  randomMapForMode,
  recommendedMaps,
} from "../data/gamemodes.js";
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
    case "open":
    case "openbsu":
      handleOpen(room, user, cmd === "openbsu");
      break;
    case "close":
      handleClose(room, user);
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
    phase: "setup",
    started: false,
    kills: {},
    winner: null,
    chatLog: [],
    toasts: [],
    signupsOpen: false,
  };

  games.set(id, game);
  send(room.id, `**${user.name}** is now hosting! (Game ID: ${id})`);
  sendPm(
    user.name,
    "Use %setgame, %addp, %setmap to configure, then %start. Pick a map with %setmap <name> (see %listmaps) or %setmap gen.",
  );
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
  const rec = recommendedMaps(game.mode);
  send(
    room.id,
    `Game mode set to **${game.mode}**.${rec ? " Use %listmaps for recommended maps." : ""}`,
  );
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
  send(room.id, `**Signups are now open!**${hl} Use %join to join.`);
  broadcastPages(game);
}

function handleClose(room: Room, user: User) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %close.");
  }

  game.signupsOpen = false;
  send(room.id, "**Signups are now closed.**");
  broadcastPages(game);
}

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
  if (game.map.length === 0) {
    return sendPm(
      user.name,
      "No map set. Use %setmap <name> (see %listmaps) or %setmap gen first.",
    );
  }

  const match = args
    .trim()
    .toLowerCase()
    .match(/^(\d+)\s*p?\s*([a-z0-9]+)$/);
  if (!match) {
    return sendPm(user.name, "Usage: %genpos <N><mode> (e.g. %genpos 4pffa).");
  }

  const n = parseInt(match[1]);
  const mode = match[2];

  if (mode.includes("v")) {
    return sendPm(user.name, "%genpos does not support team modes.");
  }
  if (mode.includes("pve")) {
    return sendPm(user.name, "%genpos does not support PvE.");
  }

  const players = game.entities.filter((e) => !e.isMonster);
  if (n > players.length) {
    return sendPm(
      user.name,
      `Only ${players.length} player(s) joined; cannot place ${n}.`,
    );
  }
  if (n > 9) {
    return sendPm(user.name, "%genpos supports up to 9 players.");
  }

  const placed = placePlayers(game, players.slice(0, n));
  if (!placed) {
    return sendPm(user.name, "Could not find open spawn tiles.");
  }

  pushSnapshot(game);
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

  for (let i = 0; i < players.length; i++) {
    const anchor = slots[i];
    const pos = findNearestOpenTile(game, anchor[0], anchor[1], used);
    if (!pos) return null;
    players[i].pos = pos;
    used.add(`${pos[0]},${pos[1]}`);
    out.push([players[i], pos]);
  }
  return out;
}

export function genPosSlots(
  rows: number,
  cols: number,
  n: number,
): [number, number][] {
  const top = 0;
  const bottom = Math.max(0, rows - 1);
  const left = 0;
  const right = Math.max(0, cols - 1);
  const midR = Math.floor(rows / 2);
  const midC = Math.floor(cols / 2);
  const corners: [number, number][] = [
    [top, left],
    [bottom, right],
    [top, right],
    [bottom, left],
  ];
  const edges: [number, number][] = [
    [top, midC],
    [bottom, midC],
    [midR, left],
    [midR, right],
  ];
  const center: [number, number] = [midR, midC];

  if (n === 1) return [center];
  if (n <= 4) return corners.slice(0, n);
  if (n === 5) return [...corners, center];
  if (n === 6) return [...corners, edges[0], edges[1]];
  if (n === 7) return [...corners, edges[0], edges[1], center];
  if (n === 8) return [...corners, ...edges];
  return [...corners, ...edges, center];
}

export function findNearestOpenTile(
  game: Game,
  r: number,
  c: number,
  used: Set<string>,
): [number, number] | null {
  const rows = game.map.length;
  const cols = game.map[0]?.length ?? 0;
  const seen = new Set<string>();
  const q: [number, number][] = [[r, c]];
  seen.add(`${r},${c}`);

  while (q.length > 0) {
    const [cr, cc] = q.shift()!;
    if (
      game.map[cr][cc] === Terrain.Normal &&
      !used.has(`${cr},${cc}`) &&
      !game.entities.some((e) => e.pos[0] === cr && e.pos[1] === cc)
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

  const classData = classes.get(toId(className));
  const weaponData = weapons.get(toId(weaponName));

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
      "Usage: %setmap <name> or %setmap gen [12|16|20]. Use %listmaps to see curated maps.",
    );

  const lower = mapName.toLowerCase();

  // %setmap <gamemode> — set a random curated map from that mode's pool
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
    const names = GAMEMODE_MAPS[modeId]
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
): void {
  game.map = def.grid.map((row) => [...row]);
  game.mapName = def.displayName;
  repositionEntities(game);
  broadcastPages(game);
  send(
    game.room,
    `Map set to **${def.displayName}** (${def.rows}x${def.cols})${note}.`,
  );
}

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
