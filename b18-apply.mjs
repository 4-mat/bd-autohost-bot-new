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

const helpers = `
const MOTD = new Map<string, string>();
const NOTES = new Map<string, string>();

function roomGame(roomId?: string): Game | null {
  if (!roomId) return null;
  for (const g of games.values()) if (g.room === roomId) return g;
  return null;
}`;

const inline = `  if (id === "8ball") {
    const question = (args || val).trim();
    if (!question) return sendPm(user.name, "Ask a yes/no question: %8ball <question>");
    const answers = [
      "It is certain.",
      "Without a doubt.",
      "Yes, definitely.",
      "You may rely on it.",
      "Reply hazy, try again.",
      "Ask again later.",
      "Cannot predict now.",
      "Don't count on it.",
      "My sources say no.",
      "Very doubtful.",
    ];
    sendPm(user.name, \`8-ball: \${answers[Math.floor(Math.random() * answers.length)]}\`);
    return;
  }

  if (id === "rps") {
    const map: Record<string, string> = { r: "rock", p: "paper", s: "scissors" };
    const player = map[toId((args || val).trim())] ?? toId((args || val).trim());
    if (!["rock", "paper", "scissors"].includes(player)) {
      return sendPm(user.name, "Usage: %rps <rock|paper|scissors> (r/p/s work too)");
    }
    const bot = ["rock", "paper", "scissors"][Math.floor(Math.random() * 3)];
    const beats: Record<string, string> = { rock: "scissors", scissors: "paper", paper: "rock" };
    const result = player === bot ? "tie" : beats[player] === bot ? "win" : "lose";
    const label = { win: "You win!", lose: "You lose!", tie: "It's a tie!" }[result];
    sendPm(user.name, \`You threw \${player}, bot threw \${bot}. \${label}\`);
    return;
  }

  if (id === "time") {
    const now = new Date();
    sendPm(user.name, \`Local: \${now.toLocaleString()} | UTC: \${now.toUTCString()}\`);
    return;
  }

  if (id === "rand") {
    const parts = (args || val).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length === 1) {
      const n = parseInt(parts[0], 10);
      if (isNaN(n) || n < 1) return sendPm(user.name, "Usage: %rand <n> or %rand <min>, <max>");
      return sendPm(user.name, \`Rolled \${Math.floor(Math.random() * n) + 1} (1-\${n})\`);
    }
    if (parts.length >= 2) {
      const a = parseInt(parts[0], 10);
      const b = parseInt(parts[1], 10);
      if (isNaN(a) || isNaN(b) || a > b) return sendPm(user.name, "Usage: %rand <min>, <max>");
      return sendPm(user.name, \`Rolled \${Math.floor(Math.random() * (b - a + 1)) + a} (\${a}-\${b})\`);
    }
    return sendPm(user.name, "Usage: %rand <n> or %rand <min>, <max>");
  }

  if (id === "shuffle") {
    const list = (args || val).split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length < 2) return sendPm(user.name, "Usage: %shuffle <a>, <b>, <c>");
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    sendPm(user.name, \`Shuffled: \${list.join(", ")}\`);
    return;
  }

  if (id === "note") {
    const text = (args || val).trim();
    if (text.toLowerCase() === "clear") {
      NOTES.delete(user.id);
      sendPm(user.name, "Note cleared.");
      return;
    }
    if (!text) {
      const saved = NOTES.get(user.id);
      sendPm(user.name, saved ? \`Your note: \${saved}\` : "No note saved. Use %note <text>.");
      return;
    }
    NOTES.set(user.id, text);
    sendPm(user.name, "Note saved.");
    return;
  }

  if (id === "motd") {
    const text = (args || val).trim();
    if (!text) {
      const saved = room?.id ? MOTD.get(room.id) : undefined;
      sendPm(user.name, saved ? \`**MOTD**: \${saved}\` : "No MOTD set.");
      return;
    }
    if (!room?.id) return sendPm(user.name, "MOTD requires a room.");
    const g = roomGame(room.id);
    if (g && toId(g.host) !== toId(user.name)) {
      return sendPm(user.name, "Only the host can set the MOTD.");
    }
    MOTD.set(room.id, text);
    sendPm(user.name, "MOTD set.");
    return;
  }`;

const helpEntries = `  uptime: "Bot uptime (%uptime).",
  fullheal: "Host: restore HP to full (%fullheal [entity]).",
  restoremp: "Host: restore MP to max (%restoremp [entity]).",
  clearstatus: "Host: clear all statuses (%clearstatus [entity]).",
  clearbuffs: "Host: clear all buffs (%clearbuffs [entity]).",
  clearcooldowns: "Host: clear cooldowns (%clearcooldowns [entity]).",
  clearuses: "Host: reset ability uses (%clearuses [entity]).",
  setterrain: "Host: override a tile's terrain (%setterrain <pos>, <terrain>).",
  reset: "Host: full stat/status reset (%reset [entity]).",
  "8ball": "Ask the magic 8-ball (%8ball <question>).",
  rps: "Rock/paper/scissors vs the bot (%rps <move>).",
  time: "Current local and UTC time.",
  rand: "Random integer (%rand <n> or %rand <min>, <max>).",
  shuffle: "Shuffle a comma-separated list (%shuffle a, b, c).",
  note: "Save a private note (%note <text>, %note, %note clear).",
  motd: "Room message of the day (%motd, host sets %motd <text>).",
  mode: "Current mode and phase (%mode).",
};`;

patch("src/commands/index.ts", [
  // module-level maps + roomGame helper
  [
    `const START = Date.now();`,
    `const START = Date.now();${helpers}`,
  ],
  // inline fun/meta commands (insert after uptime handler)
  [
    `  if (id === "uptime") {
    const secs = Math.floor((Date.now() - START) / 1000);
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    sendPm(user.name, \`Uptime: \${d}d \${h}h \${m}m\`);
    return;
  }

  // Dev-only diagnostics: active game list. Restricted to config.devs.`,
    `  if (id === "uptime") {
    const secs = Math.floor((Date.now() - START) / 1000);
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    sendPm(user.name, \`Uptime: \${d}d \${h}h \${m}m\`);
    return;
  }
${inline}

  // Dev-only diagnostics: active game list. Restricted to config.devs.`,
  ],
  // host routing: add batch 17 commands
  [
    `    id === "kick" ||
    id === "transfer" ||
    id === "genpos"
  ) {`,
    `    id === "kick" ||
    id === "transfer" ||
    id === "fullheal" ||
    id === "restoremp" ||
    id === "clearstatus" ||
    id === "clearbuffs" ||
    id === "clearcooldowns" ||
    id === "clearcds" ||
    id === "clearuses" ||
    id === "setterrain" ||
    id === "reset" ||
    id === "genpos"
  ) {`,
  ],
  // game routing: add mode
  [
    `    id === "alive" ||
    id === "abilities" ||
    id === "mapinfo"
  ) {`,
    `    id === "alive" ||
    id === "abilities" ||
    id === "mapinfo" ||
    id === "mode"
  ) {`,
  ],
  // help entries
  [
    `  uptime: "Bot uptime (%uptime).",
};`,
    helpEntries,
  ],
]);

patch("src/commands/game.ts", [
  [
    `    case "mapinfo":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleMapInfo(game, user);
      break;

    default:`,
    `    case "mapinfo":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleMapInfo(game, user);
      break;

    case "mode":
      if (!game) return sendPm(user.name, "No active game in this room.");
      handleMode(game, user);
      break;

    default:`,
  ],
  [
    `// %kills - kill leaderboard.
function handleKills(game: Game, user: User) {`,
    `// %mode - current mode and phase.
function handleMode(game: Game, user: User) {
  sendPm(
    user.name,
    \`Mode: \${game.mode} | Phase: \${game.phase}\${game.paused ? " (paused)" : ""} | Round: \${game.round}\`,
  );
}

// %kills - kill leaderboard.
function handleKills(game: Game, user: User) {`,
  ],
]);

console.log("batch 18 applied");
