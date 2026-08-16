import { bot } from "./connection.js";
import { send, sendPm, toId, splitMessage, parseArgs } from "./utils.js";
import config from "./config.js";
import { rooms, getRoom, type Room } from "./rooms.js";
import { users, type User } from "./users.js";
import { handleCommand } from "./commands/index.js";
import { handleKyubsInfo } from "./html/parse.js";
import { games } from "./game/state.js";

const PREFIX = config.char;

bot.on("updateuser", (parts: string[]) => {
  const name = parts[2];
  if (name && toId(name) === toId(config.username)) {
    console.log(`Logged in as ${name}`);
    for (const room of config.rooms) {
      send("", `/join ${room}`);
    }
  }
});

function handleChatMessage(roomid: string, username: string, message: string) {
  if (
    toId(username).includes("kyubs") &&
    (message.includes("/uhtml") || message.includes("/uhtmlchange")) &&
    message.includes("<summary>Map</summary>")
  ) {
    const htmlStart = message.indexOf(",<");
    if (htmlStart >= 0) {
      handleKyubsInfo(roomid, message.slice(htmlStart + 1));
    }
    return;
  }

  // Capture non-command messages to active game chat
  if (!message.startsWith(PREFIX)) {
    for (const game of games.values()) {
      if (game.room === roomid) {
        const entry = { user: username, message, time: Date.now() };
        game.chatLog.push(entry);
        game.toasts.push(entry);
        break;
      }
    }
    return;
  }

  const room = getRoom(roomid);
  const user = users.get(toId(username));
  const { cmd, args, val } = splitMessage(message.slice(PREFIX.length));

  handleCommand(room, user ?? null, cmd, args, val);
}

bot.on("c", (parts: string[]) => {
  const roomid = toId(parts[0].replace(">", "").trim());
  const username = parts[2];
  const message = parts.slice(3).join("|").trim();
  handleChatMessage(roomid, username, message);
});

bot.on("c:", (parts: string[]) => {
  const roomid = toId(parts[0].replace(">", "").trim());
  const username = parts[3];
  const message = parts.slice(4).join("|").trim();
  handleChatMessage(roomid, username, message);
});

bot.on("pm", (parts: string[]) => {
  const username = parts[2];
  const message = parts.slice(3).join("|").trim();

  if (!message.startsWith(PREFIX)) return;
  const { cmd, args, val } = splitMessage(message.slice(PREFIX.length));

  const user = users.get(toId(username));
  handleCommand(null, user ?? null, cmd, args, val, true);
});

bot.on("j", (parts: string[]) => {
  const roomid = toId(parts[0].replace(">", "").trim());
  const username = parts[2];
  const room = getRoom(roomid);
  const uid = toId(username);

  if (!users.has(uid)) {
    users.set(uid, { id: uid, name: username, rooms: {}, last: Date.now() });
  }
  const user = users.get(uid)!;
  const rank = username.startsWith(" ") ? " " : username.charAt(0);
  user.rooms[roomid] = rank;
  user.last = Date.now();

  // Spectator welcome: greet non-players joining a room with a live game.
  if (toId(username) !== toId(config.username)) {
    const game = Array.from(games.values()).find(
      (g) => g.room === roomid && g.started,
    );
    if (game) {
      const isPlayer = game.entities.some(
        (e) => !e.isMonster && toId(e.name) === uid,
      );
      if (!isPlayer && config.announcements.join) {
        sendPm(
          username,
          `Welcome to ${roomid}! **${game.id}** is in progress (${game.mode}, Round ${game.round}). You are spectating - %pl and %info to follow along.`,
        );
      }
    }
  }
});

bot.on("l", (parts: string[]) => {
  const roomid = toId(parts[0].replace(">", "").trim());
  const username = parts[2];
  const uid = toId(username);
  const user = users.get(uid);
  if (user) {
    delete user.rooms[roomid];
    user.last = Date.now();
  }
});

bot.on("n", (parts: string[]) => {
  const newName = parts[2];
  const oldName = parts[3];
  const uid = toId(oldName);
  const newId = toId(newName);

  const user = users.get(uid);
  if (!user) return;

  if (uid !== newId) {
    users.delete(uid);
    users.set(newId, user);
    user.id = newId;
  }
  user.name = newName;
  user.last = Date.now();
});

bot.on("init", (parts: string[]) => {
  const roomid = toId(parts[0].replace(">", "").trim());
  const roomType = parts[2];
  if (!rooms.has(roomid)) {
    rooms.set(roomid, { id: roomid, type: roomType, users: [] });
  }
});

bot.on("deinit", (parts: string[]) => {
  const roomid = toId(parts[0].replace(">", "").trim());
  rooms.delete(roomid);
});
