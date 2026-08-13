import WebSocket from "ws";
import { EventEmitter } from "events";
import config from "./config.js";
import { login } from "./login.js";
import { setWs, resumeSending } from "./utils.js";

export const bot = new EventEmitter();

/** Connect to the Pokemon Showdown WebSocket and wire up login and message handling. */
export function connect() {
  const proto = config.useTLS ? "wss" : "ws";
  const url = `${proto}://${config.server}:${config.port}/showdown/websocket`;
  const ws = new WebSocket(url);

  ws.on("open", () => {
    console.log(`Connected to ${config.server}`);
    // Flush anything queued while the previous socket was down.
    resumeSending();
  });

  ws.on("message", (data) => {
    const msg = data.toString();
    if (!msg.startsWith("|")) return;

    const parts = msg.split("|");
    const event = parts[1];

    if (event === "challstr") {
      const challstr = parts.slice(2).join("|");
      login(challstr);
    }

    bot.emit(event, parts);
  });

  ws.on("close", () => {
    console.log("Disconnected. Reconnecting in 5s...");
    setTimeout(connect, 5000);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });

  setWs({ send: (msg: string, cb) => ws.send(msg, cb) });
  return ws;
}
