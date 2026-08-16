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

// state.ts — graveyard
patch("src/game/state.ts", [
  [
    `  /** Paused games block turn advancement until %resume. */
  paused?: boolean;`,
    `  /** Paused games block turn advancement until %resume. */
  paused?: boolean;
  /** Entities removed from the game (defeated/left/kicked). */
  graveyard?: { num: string; name: string }[];`,
  ],
  [
    `  if (game.turnIndex >= game.turnOrder.length) {
    game.turnIndex = 0;
  }
  // Drop any gamemode vote the removed entity had cast.
  delete game.votes[entity.id];`,
    `  if (game.turnIndex >= game.turnOrder.length) {
    game.turnIndex = 0;
  }
  const grave = game.graveyard ?? (game.graveyard = []);
  if (!grave.some((g) => g.num === entity.num)) {
    grave.push({ num: entity.num, name: entity.name });
  }
  // Drop any gamemode vote the removed entity had cast.
  delete game.votes[entity.id];`,
  ],
]);

// game.ts — %kills/%dead/%alive/%abilities/%mapinfo
patch("src/commands/game.ts", [
  [
    `import { getVersionData } from "../data/version43.js";`,
    `import { getVersionData } from "../data/version43.js";
import { resolveName } from "../data/index.js";`,
  ],
  [
    `    case "roominfo":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleRoomInfo(game, user);
      break;`,
    `    case "roominfo":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleRoomInfo(game, user);
      break;

    case "kills":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleKills(game, user);
      break;

    case "dead":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleDead(game, user);
      break;

    case "alive":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleAlive(game, user);
      break;

    case "abilities":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleAbilities(game, user, full);
      break;

    case "mapinfo":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleMapInfo(game, user);
      break;`,
  ],
  [
    `    \`Players: \${game.entities.length} | Round: \${game.round}\`,
  ];
  sendPm(user.name, lines.join("\\n"));
}`,
    `    \`Players: \${game.entities.length} | Round: \${game.round}\`,
  ];
  sendPm(user.name, lines.join("\\n"));
}

// %kills - kill leaderboard.
function handleKills(game: Game, user: User) {
  const rows = Object.entries(game.kills)
    .filter(([, k]) => k > 0)
    .sort((a, b) => b[1] - a[1]);
  const lines = rows.map(
    ([num, k], i) => \`\${i + 1}. \${num}: \${k} kill\${k > 1 ? "s" : ""}\`,
  );
  sendPm(user.name, lines.join("\\n") || "No kills yet.");
}

// %dead - entities removed from the game (defeated/left/kicked).
function handleDead(game: Game, user: User) {
  const grave = game.graveyard ?? [];
  const lines = grave.map((g) => \`\${g.num} (\${g.name})\`);
  sendPm(
    user.name,
    lines.length ? \`Defeated/removed:\\n\${lines.join("\\n")}\` : "No one is out yet.",
  );
}

// %alive - living entities.
function handleAlive(game: Game, user: User) {
  const alive = game.entities.filter((e) => e.curhp > 0);
  const lines = alive.map((e) => \`\${e.num} \${e.name}: HP \${e.curhp}/\${e.maxhp}\`);
  sendPm(user.name, lines.join("\\n") || "No entities.");
}

// %abilities <ref> - abilities of an entity, class, or weapon.
function handleAbilities(game: Game, user: User, args: string) {
  const ref = args.trim();
  if (!ref) return sendPm(user.name, "Usage: %abilities <entity|class|weapon>");
  const entity = getEntity(game, ref);
  if (entity) {
    const lines = entity.abilities.map(
      (a) =>
        \`Lv.\${a.level} \${a.name} (\${a.actionType}/\${a.frequency})\${a.effect ? ": " + a.effect : ""}\`,
    );
    sendPm(
      user.name,
      lines.length
        ? \`\${entity.num} \${entity.name} abilities:\\n\${lines.join("\\n")}\`
        : \`\${entity.num} has no abilities.\`,
    );
    return;
  }
  const data = getVersionData(game.version);
  const cls = resolveName(data.classes, ref).value;
  if (cls) {
    const lines = cls.abilities.map(
      (a) => \`Lv.\${a.level} \${a.name} (\${a.actionType}/\${a.frequency})\`,
    );
    sendPm(user.name, \`\${cls.name} abilities:\\n\${lines.join("\\n") || "(none)"}\`);
    return;
  }
  const wpn = resolveName(data.weapons, ref).value;
  if (wpn) {
    const lines = wpn.abilities.map(
      (a) => \`Lv.\${a.level} \${a.name} (\${a.actionType}/\${a.frequency})\`,
    );
    sendPm(user.name, \`\${wpn.name} abilities:\\n\${lines.join("\\n") || "(none)"}\`);
    return;
  }
  sendPm(user.name, \`No entity/class/weapon found for "\${ref}".\`);
}

// %mapinfo - map name, size, and terrain counts.
function handleMapInfo(game: Game, user: User) {
  if (game.map.length === 0) return sendPm(user.name, "No map set.");
  const counts: Record<string, number> = {};
  for (const row of game.map) {
    for (const t of row) {
      const name = TERRAIN_NAMES[t] ?? String(t);
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  const terrain = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => \`\${n}×\${c}\`)
    .join(", ");
  sendPm(
    user.name,
    \`\${game.mapName || "(unnamed)"} — \${game.map.length}×\${game.map[0].length}\\n\${terrain}\`,
  );
}`,
  ],
]);

// info.ts — %items/%classes/%weapons
patch("src/commands/info.ts", [
  [
    `import { send, sendPm, toId } from "../utils.js";`,
    `import { send, sendPm, sendPmChunks, toId } from "../utils.js";`,
  ],
  [
    `  if (cmd === "rf") {`,
    `  if (cmd === "items") {
    const q = toId(args);
    const list = [...items.values()].filter(
      (it) => !q || toId(it.name).includes(q),
    );
    if (list.length === 0) {
      return sendPm(
        target,
        q ? \`No items match "\${args}".\` : "Items (beta): none defined yet.",
      );
    }
    const lines = list.map(
      (it) =>
        \`\${it.name} (\${it.rank || "-"}) — \${it.slots} slot\${it.slots === 1 ? "" : "s"}\${it.effect ? ", " + it.effect : ""}\`,
    );
    sendPmChunks(target, lines.join("\\n"));
    return;
  }

  if (cmd === "classes") {
    const list = [...classes.values()].map((c) => c.name);
    sendPm(target, \`Classes (\${list.length}):\\n\${list.join(", ")}\`);
    return;
  }

  if (cmd === "weapons") {
    const list = [...weapons.values()].map((w) => w.name);
    sendPm(target, \`Weapons (\${list.length}):\\n\${list.join(", ")}\`);
    return;
  }

  if (cmd === "rf") {`,
  ],
]);

// index.ts — routing, uptime, help
patch("src/commands/index.ts", [
  [
    `// One-line help for common commands, shown by \`%help <command>\`.
const COMMAND_HELP: Record<string, string> = {`,
    `const START = Date.now();

// One-line help for common commands, shown by \`%help <command>\`.
const COMMAND_HELP: Record<string, string> = {`,
  ],
  [
    `    id === "data" ||
    id === "freq" ||
    id === "find"
  ) {`,
    `    id === "data" ||
    id === "freq" ||
    id === "find" ||
    id === "items" ||
    id === "classes" ||
    id === "weapons"
  ) {`,
  ],
  [
    `    id === "return" ||
    id === "roominfo"
  ) {`,
    `    id === "return" ||
    id === "roominfo" ||
    id === "kills" ||
    id === "dead" ||
    id === "alive" ||
    id === "abilities" ||
    id === "mapinfo"
  ) {`,
  ],
  [
    `    sendPm(user.name, \`Picked: **\${options[Math.floor(Math.random() * options.length)]}**\`);
    return;
  }`,
    `    sendPm(user.name, \`Picked: **\${options[Math.floor(Math.random() * options.length)]}**\`);
    return;
  }

  if (id === "uptime") {
    const secs = Math.floor((Date.now() - START) / 1000);
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    sendPm(user.name, \`Uptime: \${d}d \${h}h \${m}m\`);
    return;
  }`,
  ],
  [
    `  roominfo: "Show room/game status (%roominfo).",
};`,
    `  roominfo: "Show room/game status (%roominfo).",
  kills: "Kill leaderboard (%kills).",
  dead: "List defeated/removed entities (%dead).",
  alive: "List living entities (%alive).",
  items: "List/filter the item catalog (%items [query]).",
  classes: "List all classes (%classes).",
  weapons: "List all weapons (%weapons).",
  abilities: "List a class/weapon/entity's abilities (%abilities <ref>).",
  mapinfo: "Map size + terrain counts (%mapinfo).",
  uptime: "Bot uptime (%uptime).",
};`,
  ],
]);

console.log("batch 16 applied");
