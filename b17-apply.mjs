import { readFileSync, writeFileSync } from "node:fs";

function patch(path, pairs) {
  let s = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of pairs) {
    if (!s.includes(from)) {
      console.error(`MISSING anchor in ${path}:`);
      console.error(from.slice(0, 180));
      process.exit(1);
    }
    s = s.replace(from, to);
  }
  writeFileSync(path, s);
  console.log(`patched ${path}`);
}

const cases = `    case "transfer":
      handleTransfer(room, user, full);
      break;
    case "fullheal":
      handleFullHeal(room, user, full);
      break;
    case "restoremp":
      handleRestoreMp(room, user, full);
      break;
    case "clearstatus":
      handleClearStatus(room, user, full);
      break;
    case "clearbuffs":
      handleClearBuffs(room, user, full);
      break;
    case "clearcooldowns":
    case "clearcds":
      handleClearCooldowns(room, user, full);
      break;
    case "clearuses":
      handleClearUses(room, user, full);
      break;
    case "setterrain":
      handleSetTerrain(room, user, full);
      break;
    case "reset":
      handleReset(room, user, full);
      break;`;

const handlers = `
// %fullheal [entity] - restore HP to full (host; default all living).
function handleFullHeal(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %fullheal.");
  }
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : null;
  if (ref && !entity) return sendPm(user.name, \`Unknown entity: \${ref}\`);
  const targets = entity ? [entity] : game.entities.filter((e) => e.curhp > 0);
  pushSnapshot(game);
  for (const e of targets) e.curhp = e.maxhp;
  send(game.room, \`**\${targets.map((e) => e.num).join(", ")}** restored to full HP.\`);
  broadcastPages(game);
}

// Max MP for an entity, recomputed from its current class + weapon.
function maxMpFor(entity: Entity, data: { classes: typeof classes; weapons: typeof weapons }): number {
  const c = data.classes.get(toId(entity.className));
  const w = data.weapons.get(toId(entity.weaponName));
  const sv = (s: string) => parseFloat(s) || 0;
  return (c ? sv(c.stats.mp) : 0) + (w ? sv(w.stats.mp) : 0);
}

// %restoremp [entity] - restore MP to max (host; default all living).
function handleRestoreMp(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %restoremp.");
  }
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : null;
  if (ref && !entity) return sendPm(user.name, \`Unknown entity: \${ref}\`);
  const targets = entity ? [entity] : game.entities.filter((e) => e.curhp > 0);
  const data = getVersionData(game.version);
  pushSnapshot(game);
  for (const e of targets) e.mp = maxMpFor(e, data);
  send(game.room, \`**\${targets.map((e) => e.num).join(", ")}** MP restored.\`);
  broadcastPages(game);
}

// %clearstatus [entity] - clear all statuses (host; default all).
function handleClearStatus(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %clearstatus.");
  }
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : null;
  if (ref && !entity) return sendPm(user.name, \`Unknown entity: \${ref}\`);
  const targets = entity ? [entity] : game.entities;
  pushSnapshot(game);
  let cleared = 0;
  for (const e of targets) {
    cleared += e.statuses.length;
    e.statuses = [];
  }
  send(game.room, \`Cleared \${cleared} status effect(s).\`);
  broadcastPages(game);
}

// %clearbuffs [entity] - clear all buffs (host; default all).
function handleClearBuffs(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %clearbuffs.");
  }
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : null;
  if (ref && !entity) return sendPm(user.name, \`Unknown entity: \${ref}\`);
  const targets = entity ? [entity] : game.entities;
  pushSnapshot(game);
  let cleared = 0;
  for (const e of targets) {
    cleared += e.buffs.length;
    e.buffs = [];
  }
  send(game.room, \`Cleared \${cleared} buff(s).\`);
  broadcastPages(game);
}

// %clearcooldowns [entity] - clear ability cooldowns (host; default all).
function handleClearCooldowns(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %clearcooldowns.");
  }
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : null;
  if (ref && !entity) return sendPm(user.name, \`Unknown entity: \${ref}\`);
  const targets = entity ? [entity] : game.entities;
  pushSnapshot(game);
  let cleared = 0;
  for (const e of targets) {
    cleared += Object.keys(e.cooldowns).length;
    e.cooldowns = {};
  }
  send(game.room, \`Cleared \${cleared} cooldown(s).\`);
  broadcastPages(game);
}

// %clearuses [entity] - reset ability uses (host; default all).
function handleClearUses(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %clearuses.");
  }
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : null;
  if (ref && !entity) return sendPm(user.name, \`Unknown entity: \${ref}\`);
  const targets = entity ? [entity] : game.entities;
  pushSnapshot(game);
  let cleared = 0;
  for (const e of targets) {
    cleared += Object.keys(e.usesUsed).length;
    e.usesUsed = {};
  }
  send(game.room, \`Cleared \${cleared} ability use(s).\`);
  broadcastPages(game);
}

// %setterrain <pos>,<terrain> - override a tile's terrain (host).
function handleSetTerrain(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %setterrain.");
  }
  const parts = args.split(",").map((s) => s.trim());
  const pos = parsePos(parts[0] ?? "");
  if (!pos || !parts[1]) {
    return sendPm(user.name, "Usage: %setterrain <pos>, <terrain> (e.g. %setterrain e4, lava)");
  }
  const [r, c] = pos;
  if (r < 0 || r >= game.map.length || c < 0 || c >= (game.map[0]?.length ?? 0)) {
    return sendPm(user.name, "Tile out of bounds.");
  }
  const name = parts[1].toLowerCase();
  const entry = Object.entries(TERRAIN_NAMES).find(([, v]) => v.toLowerCase() === name);
  if (!entry) {
    return sendPm(user.name, \`Unknown terrain: \${parts[1]}. Valid: \${Object.values(TERRAIN_NAMES).join(", ")}.\`);
  }
  const terrain = Number(entry[0]);
  pushSnapshot(game);
  game.map[r][c] = terrain;
  send(game.room, \`\${posToStr(r, c)} is now \${TERRAIN_NAMES[terrain]}.\`);
  broadcastPages(game);
}

// %reset [entity] - full reset: recalc stats, full HP/MP, clear statuses/buffs/cooldowns/uses/AFK/damage (host).
function handleReset(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can use %reset.");
  }
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : null;
  if (ref && !entity) return sendPm(user.name, \`Unknown entity: \${ref}\`);
  const targets = entity ? [entity] : game.entities;
  pushSnapshot(game);
  const data = getVersionData(game.version);
  for (const e of targets) {
    recalcEntityStats(e, data);
    e.curhp = e.maxhp;
    e.statuses = [];
    e.buffs = [];
    e.cooldowns = {};
    e.usesUsed = {};
    e.afk = false;
    e.damageDealt = 0;
    e.damageTaken = 0;
  }
  send(game.room, \`**\${targets.map((e) => e.num).join(", ")}** fully reset.\`);
  broadcastPages(game);
}`;

patch("src/commands/host.ts", [
  [
    `  Terrain,
  isStandable,
} from "../game/state.js";`,
    `  Terrain,
  TERRAIN_NAMES,
  isStandable,
} from "../game/state.js";`,
  ],
  [
    `    case "transfer":
      handleTransfer(room, user, full);
      break;
    case "sc":`,
    cases + `
    case "sc":`,
  ],
  [
    `function handleTransfer(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can transfer.");
  }
  const name = args.trim();
  if (!name) return sendPm(user.name, "Usage: %transfer <user>");
  game.host = name;
  send(game.room, \`**\${name}** is now the host.\`);
  broadcastPages(game);
}

// -- Map generators ------------------------------------------------------------`,
    `function handleTransfer(room: Room, user: User, args: string) {
  const game = findGameForRoom(room.id);
  if (!game) return sendPm(user.name, "No active game in this room.");
  if (toId(user.name) !== toId(game.host)) {
    return sendPm(user.name, "Only the host can transfer.");
  }
  const name = args.trim();
  if (!name) return sendPm(user.name, "Usage: %transfer <user>");
  game.host = name;
  send(game.room, \`**\${name}** is now the host.\`);
  broadcastPages(game);
}
${handlers}

// -- Map generators ------------------------------------------------------------`,
  ],
]);

console.log("batch 17 applied");
