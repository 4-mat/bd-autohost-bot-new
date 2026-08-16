import { readFileSync, writeFileSync } from "node:fs";

function patch(path, pairs) {
  let s = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of pairs) {
    if (!s.includes(from)) {
      console.error(`MISSING anchor in ${path}:`);
      console.error(from.slice(0, 200));
      process.exit(1);
    }
    s = s.replace(from, to);
  }
  writeFileSync(path, s);
  console.log(`patched ${path}`);
}

const cases = `    case "me":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleMe(game, user);
      break;

    case "pos":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handlePos(game, user, full);
      break;

    case "team":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleTeam(game, user);
      break;

    case "targets":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleTargets(game, user);
      break;

    case "hint":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleHint(game, user);
      break;

    case "history":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleHistory(game, user, full);
      break;`;

const handlers = `// %me - your own entity's full info.
function handleMe(game: Game, user: User) {
  const entity = game.entities.find(
    (e) => !e.isMonster && toId(e.name) === toId(user.name),
  );
  if (!entity) return sendPm(user.name, "You are not in this game.");
  handleInfo(game, user, entity.num);
}

// %pos [entity] - an entity's board position (default current turn).
function handlePos(game: Game, user: User, args: string) {
  const ref = args.trim();
  const entity = ref ? getEntity(game, ref) : getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No entity found.");
  sendPm(
    user.name,
    \`\${entity.num} (\${entity.name}) is at \${posToStr(entity.pos[0], entity.pos[1])}\${entity.curhp <= 0 ? " (defeated)" : ""}.\`,
  );
}

// %team - your team's roster with status.
function handleTeam(game: Game, user: User) {
  const self = game.entities.find(
    (e) => !e.isMonster && toId(e.name) === toId(user.name),
  );
  if (!self) return sendPm(user.name, "You are not in this game.");
  const mates = game.entities
    .filter((e) => e.team === self.team)
    .sort((a, b) => a.num.localeCompare(b.num));
  const lines = mates.map((e) => {
    const state = e.curhp <= 0 ? "KO" : e.afk ? "AFK" : \`\${e.curhp}/\${e.maxhp} HP\`;
    return \`  \${e.num} (\${e.name}) — \${e.className}/\${e.weaponName} — \${state}\`;
  });
  sendPm(user.name, \`Team \${self.team}:\\n\${lines.join("\\n")}\`);
}

// %targets - living entities sorted by distance from the current entity.
function handleTargets(game: Game, user: User) {
  const self = getCurrentEntity(game);
  if (!self) return sendPm(user.name, "No active turn.");
  const foes = game.entities
    .filter((e) => e !== self && e.curhp > 0)
    .sort((a, b) => dist(self.pos, a.pos) - dist(self.pos, b.pos));
  if (foes.length === 0) return sendPm(user.name, "No other living entities.");
  const lines = foes.map(
    (e) => \`  \${e.num} (\${e.name}) — \${dist(self.pos, e.pos)} tiles away\`,
  );
  sendPm(user.name, \`From \${self.num}:\\n\${lines.join("\\n")}\`);
}

// %hint - contextual suggestion for the current player.
function handleHint(game: Game, user: User) {
  const isHost = toId(user.name) === toId(game.host);
  const entity = getCurrentEntity(game);
  if (!entity) return sendPm(user.name, "No active turn.");
  if (!isHost && toId(entity.name) !== toId(user.name)) {
    return sendPm(user.name, "It's not your turn yet.");
  }
  const reachable = getReachableTiles(game, entity.pos, entity.mp, entity).size;
  const abilities = entity.abilities.length;
  sendPm(
    user.name,
    \`\${entity.num} (\${entity.name}): HP \${entity.curhp}/\${entity.maxhp}, MP \${entity.mp}. \${reachable} reachable tile(s), \${abilities} ability/abilities. Use %move <tile>, %use <ability> @ <target>, or %endturn.\`,
  );
}

// %history [N] - last N log entries (default 5).
function handleHistory(game: Game, user: User, args: string) {
  const n = Math.min(20, Math.max(1, parseInt(args.trim()) || 5));
  if (game.log.length === 0) return sendPm(user.name, "Action log is empty.");
  const lines = game.log
    .slice(-n)
    .map((e) => \`[R\${e.turn}] \${e.entity}: \${e.description}\`)
    .join("\\n");
  sendPmChunks(user.name, lines);
}
`;

patch("src/commands/game.ts", [
  // switch: add me/pos/team/targets/hint/history after mode
  [
    `    case "mode":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleMode(game, user);
      break;

    default:`,
    `    case "mode":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleMode(game, user);
      break;

${cases}

    default:`,
  ],
  // turn alias for round
  [
    `    case "round":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleRound(game, user);
      break;`,
    `    case "round":
    case "turn":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleRound(game, user);
      break;`,
  ],
  // handlers: insert before %kills
  [
    `// %kills - kill leaderboard.
function handleKills(game: Game, user: User) {`,
    handlers + `// %kills - kill leaderboard.
function handleKills(game: Game, user: User) {`,
  ],
  // premove clear branch
  [
    `  if (args.trim().toLowerCase() === "list") {
    const list = [...premoveSet];
    return sendPm(
      user.name,
      list.length
        ? \`Pre-move view: \${list.join(", ")}\`
        : "No entities are viewing pre-move abilities."
    );
  }

  let entity: Entity | null = null;`,
    `  if (args.trim().toLowerCase() === "list") {
    const list = [...premoveSet];
    return sendPm(
      user.name,
      list.length
        ? \`Pre-move view: \${list.join(", ")}\`
        : "No entities are viewing pre-move abilities."
    );
  }

  if (args.trim().toLowerCase() === "clear") {
    const e = getCurrentEntity(game);
    if (!e) return sendPm(user.name, "No active turn.");
    if (!isHost && toId(e.name) !== toId(user.name)) {
      return sendPm(user.name, "It's not your turn.");
    }
    if (!premoveSet.has(e.num)) {
      return sendPm(user.name, \`\${e.num} has no pre-move set.\`);
    }
    premoveSet.delete(e.num);
    sendPm(user.name, \`\${e.num} pre-move cleared.\`);
    broadcastPages(game);
    return;
  }

  let entity: Entity | null = null;`,
  ],
]);

const helpEntries = `  mode: "Current mode and phase (%mode).",
  me: "Your own entity's full info (%me).",
  pos: "An entity's board position (%pos [entity]).",
  team: "Your team's roster with status (%team).",
  targets: "Living entities by distance from the current turn (%targets).",
  hint: "Contextual suggestion for the current player (%hint).",
  history: "Last N action-log entries (%history [N]).",
  turn: "Whose turn it is (alias: %round).",
};`;

patch("src/commands/index.ts", [
  [
    `    id === "mapinfo" ||
    id === "mode"
  ) {`,
    `    id === "mapinfo" ||
    id === "mode" ||
    id === "me" ||
    id === "pos" ||
    id === "team" ||
    id === "targets" ||
    id === "hint" ||
    id === "history" ||
    id === "turn"
  ) {`,
  ],
  [
    `  mode: "Current mode and phase (%mode).",
};`,
    helpEntries,
  ],
]);

console.log("batch 19 applied");
