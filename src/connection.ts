import WebSocket from "ws";
import { EventEmitter } from "events";
import config from "./config.js";
import { login } from "./login.js";
import { setWs, toId } from "./utils.js";

export const bot = new EventEmitter();

export function connect() {
  const proto = config.useTLS ? "wss" : "ws";
  const url = `${proto}://${config.server}:${config.port}/showdown/websocket`;
  const ws = new WebSocket(url);

  ws.on("open", () => {
    console.log(`Connected to ${config.server}`);
  });

  ws.on("message", (data) => {
    const msg = data.toString();
    const lines = msg.split("\n");
    let room = "";

    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith(">")) {
        room = toId(line.slice(1).trim());
        continue;
      }
      if (!line.startsWith("|")) continue;

      const parts = line.split("|");
      const event = parts[1];

      if (event === "challstr") {
        const challstr = parts.slice(2).join("|");
        login(challstr);
      }

      if (room) {
        bot.emit(event, [room, ...parts.slice(1)]);
      } else {
        bot.emit(event, parts);
      }
    }
  });

  ws.on("close", () => {
    console.log("Disconnected. Reconnecting in 5s...");
    setTimeout(connect, 5000);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });

  setWs({ send: (msg: string) => ws.send(msg) });
  return ws;
}
