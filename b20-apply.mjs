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

const maps = `const MOTD = new Map<string, string>();
const NOTES = new Map<string, string>();
const RULES = new Map<string, string>();
const FAQ = new Map<string, string>();
const MUTED = new Set<string>();

const DEFAULT_RULES = "Standard BD autohost rules: be respectful, no griefing, hosts have the final say.";
const DEFAULT_FAQ = "No FAQ set. Ask the host.";

function roomGame(roomId?: string): Game | null {`;

const inline = `  if (id === "rules") {
    const text = (args || val).trim();
    if (!text) {
      const saved = room?.id ? RULES.get(room.id) : undefined;
      sendPm(user.name, saved ?? DEFAULT_RULES);
      return;
    }
    if (!room?.id) return sendPm(user.name, "Rules require a room.");
    const g = roomGame(room.id);
    if (g && toId(g.host) !== toId(user.name)) {
      return sendPm(user.name, "Only the host can set the rules.");
    }
    RULES.set(room.id, text);
    sendPm(user.name, "Rules set.");
    return;
  }

  if (id === "faq") {
    const text = (args || val).trim();
    if (!text) {
      const saved = room?.id ? FAQ.get(room.id) : undefined;
      sendPm(user.name, saved ?? DEFAULT_FAQ);
      return;
    }
    if (!room?.id) return sendPm(user.name, "FAQ requires a room.");
    const g = roomGame(room.id);
    if (g && toId(g.host) !== toId(user.name)) {
      return sendPm(user.name, "Only the host can set the FAQ.");
    }
    FAQ.set(room.id, text);
    sendPm(user.name, "FAQ set.");
    return;
  }

  if (id === "echo") {
    if (!room) return sendPm(user.name, "Echo requires a room.");
    const g = roomGame(room.id);
    if (!g || toId(g.host) !== toId(user.name)) {
      return sendPm(user.name, "Only the host can echo.");
    }
    const text = (args || val).trim();
    if (!text) return sendPm(user.name, "Usage: %echo <text>");
    send(room.id, text);
    return;
  }

  if (id === "rolloff") {
    const parts = (args || val).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return sendPm(user.name, "Usage: %rolloff <a>, <b>");
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const msg =
      a === b
        ? \`\${parts[0]} rolls \${a}, \${parts[1]} rolls \${b}. Tie!\`
        : \`\${parts[0]} rolls \${a}, \${parts[1]} rolls \${b}. \${a > b ? parts[0] : parts[1]} wins.\`;
    sendPm(user.name, msg);
    return;
  }

  if (id === "mute" || id === "unmute") {
    const target = toId((args || val).trim());
    if (!target) return sendPm(user.name, \`Usage: %\${id} <user>\`);
    const g = room?.id ? roomGame(room.id) : null;
    if (!g || toId(g.host) !== toId(user.name)) {
      return sendPm(user.name, "Only the host can mute/unmute.");
    }
    if (id === "mute") {
      if (target === toId(g.host)) return sendPm(user.name, "You can't mute yourself.");
      MUTED.add(target);
      sendPm(user.name, \`\${target} has been muted.\`);
    } else {
      MUTED.delete(target);
      sendPm(user.name, \`\${target} has been unmuted.\`);
    }
    return;
  }

  if (id === "warn") {
    const parts = (args || val).split(",").map((s) => s.trim()).filter(Boolean);
    const target = parts[0];
    if (!target) return sendPm(user.name, "Usage: %warn <user>, <reason>");
    const g = room?.id ? roomGame(room.id) : null;
    if (!g || toId(g.host) !== toId(user.name)) {
      return sendPm(user.name, "Only the host can warn.");
    }
    const reason = parts.slice(1).join(", ");
    sendPm(target, \`Warning from host \${user.name}: \${reason || "no reason given"}\`);
    sendPm(user.name, \`\${target} has been warned.\`);
    return;
  }`;

const helpEntries = `  turn: "Whose turn it is (alias: %round).",
  rules: "Room rules (%rules; host sets %rules <text>).",
  faq: "Room FAQ (%faq; host sets %faq <text>).",
  echo: "Host: repeat a message to the room (%echo <text>).",
  rolloff: "Roll 1d20 for two parties (%rolloff <a>, <b>).",
  mute: "Host: mute a user (%mute <user>).",
  unmute: "Host: unmute a user (%unmute <user>).",
  warn: "Host: PM a warning to a user (%warn <user>, <reason>).",
  commands: "List all commands (alias: %help).",
};`;

patch("src/commands/index.ts", [
  // add maps + defaults
  [
    `const MOTD = new Map<string, string>();
const NOTES = new Map<string, string>();

function roomGame(roomId?: string): Game | null {`,
    maps,
  ],
  // mute gate after id is computed
  [
    `  if (!user) return;
  user.last = Date.now();

  const id = toId(cmd);
`,
    `  if (!user) return;
  user.last = Date.now();

  const id = toId(cmd);

  if (MUTED.has(toId(user.name))) return;
`,
  ],
  // commands alias for help
  [
    `  if (id === "help" || id === "h") {`,
    `  if (id === "help" || id === "h" || id === "commands" || id === "cmds") {`,
  ],
  // inline handlers after motd
  [
    `    MOTD.set(room.id, text);
    sendPm(user.name, "MOTD set.");
    return;
  }

  // Dev-only diagnostics: active game list. Restricted to config.devs.`,
    `    MOTD.set(room.id, text);
    sendPm(user.name, "MOTD set.");
    return;
  }
${inline}

  // Dev-only diagnostics: active game list. Restricted to config.devs.`,
  ],
  // help entries
  [
    `  turn: "Whose turn it is (alias: %round).",
};`,
    helpEntries,
  ],
]);

console.log("batch 20 applied");
