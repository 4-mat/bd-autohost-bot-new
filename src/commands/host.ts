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
import { buildHostPage, buildPlayerPage } from "../html/pages.js";
import { broadcastPages } from "./game.js";

export function hostCommand(
  room: Room | null,
  user: User,
  cmd: string,
  args: string,
  val: string,
) {
  if (!room) {
    sendPm(user.name, "This command must be used in a room.");
    return;
  }

  switch (cmd) {
    case "host":
      handleHost(room, user);
      break;
    case "dehost":
      handleDehost(room, user);
      break;
    case "setgame":
      handleSetGame(room, user, args);
      break;
    case "addp":
      handleAddPlayer(room, user, args);
      break;
    case "remp":
      handleRemPlayer(room, user, args);
      break;
    case "setmap":
      handleSetMap(room, user, args);
      break;
    case "gento":
      handleGenTurnOrder(room, user);
      break;
    case "start":
      handleStart(room, user);
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

// â”€â”€ .host â€” Create a new game â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  };

  games.set(id, game);
  send(room.id, `**${user.name}** is now hosting! (Game ID: ${id})`);
  sendPm(user.name, "Use %setgame, %addp, %setmap to configure, then %start.");
}

// â”€â”€ .dehost â€” Remove the game â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function handleDehost(room: Room, user: User) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %dehost.");
  }

  games.delete(game.id);
  send(room.id, `**${user.name}** has closed the game.`);
}

// â”€â”€ .setgame <mode> â€” Set game mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ .addp <name> [class] [weapon] [level] â€” Add a player â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function handleAddPlayer(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %addp.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");

  const parts = args.split(",").map((s) => s.trim());
  if (parts.length < 1 || !parts[0]) {
    return sendPm(user.name, "Usage: %addp <name>, [class], [weapon], [level]");
  }

  const name = parts[0];
  const className = parts[1] || "Bard";
  const weaponName = parts[2] || "Crossbow";
  const level = parseInt(parts[3]) || 1;

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

  // Parse stat strings (flat values — same at all levels)
  const lvl = Math.min(level, 10);
  const maxhp = parseInt(classData.stats.hp) + parseInt(weaponData.stats.hp);

  function statVal(statList: string): number {
    return parseFloat(statList) || 0;
  }

  // Determine next entity number
  const playerNum = game.entities.filter((e) => !e.isMonster).length + 1;
  const num = `P${playerNum}`;

  // Filter abilities by level
  const classAbilities = classData.abilities.filter((a) => a.level <= lvl);
  const weaponAbilities = weaponData.abilities.filter((a) => a.level <= lvl);
  const allAbilities = [...classAbilities, ...weaponAbilities] as any[];

  // Find a starting position (first open normal tile)
  const pos = findSpawnPosition(game);

  const entity: Entity = {
    num,
    name,
    id: toId(name),
    isMonster: false,
    curhp: maxhp,
    maxhp,
    atk: statVal(classData.stats.atk) + statVal(weaponData.stats.atk),
    mag: statVal(classData.stats.mag) + statVal(weaponData.stats.mag),
    pd: statVal(classData.stats.pd) + statVal(weaponData.stats.pd),
    md: statVal(classData.stats.md) + statVal(weaponData.stats.md),
    eva: statVal(classData.stats.eva) + statVal(weaponData.stats.eva),
    mp: statVal(classData.stats.mp) + statVal(weaponData.stats.mp),
    pos,
    team: 0,
    className: classData.name,
    weaponName: weaponData.name,
    classLevel: lvl,
    weaponLevel: lvl,
    abilities: allAbilities,
    statuses: [],
    buffs: [],
    cooldowns: {},
    usesUsed: {},
    pendingAction: null,
    dashUsed: false,
    standardUsed: false,
    movementUsed: false,
    swiftUsed: false,
  };

  game.entities.push(entity);
  send(
    room.id,
    `**${name}** added as ${num} â€” ${classData.name}/${weaponData.name} Lv.${lvl} (${maxhp} HP) at ${posToStr(pos[0], pos[1])}`,
  );
}

// â”€â”€ .remp <name> â€” Remove a player â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ .setmap <name> â€” Set the map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function handleSetMap(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %setmap.");
  }
  if (game.started) return sendPm(user.name, "Game already started.");

  const mapName = args.trim();
  if (!mapName) return sendPm(user.name, "Usage: %setmap <name>");

  // Try to load a map by name (for now, just support "default" and size-based maps)
  const lower = mapName.toLowerCase();
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
    return sendPm(user.name, "Unknown map. Available: small, medium, large");
  }

  send(
    room.id,
    `Map set to **${game.mapName}** (${game.map.length}x${game.map[0].length}).`,
  );
}

// â”€â”€ .gento â€” Generate turn order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  const rolls: { num: string; name: string; roll: number; mp: number }[] = [];
  for (const e of game.entities) {
    const d20 = rollDice("1d20").total;
    const total = d20 + e.mp;
    rolls.push({ num: e.num, name: e.name, roll: total, mp: e.mp });
  }

  rolls.sort((a, b) => b.roll - a.roll);

  game.turnOrder = rolls.map((r) => r.num);
  game.turnIndex = 0;
  game.round = 1;

  const orderStr = rolls
    .map((r) => `${r.num} (${r.name}) â€” ${r.roll} (1d20+${r.mp})`)
    .join(", ");

  send(room.id, `**Turn Order**: ${orderStr}`);
}

// â”€â”€ .start â€” Start the game â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Map generators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
