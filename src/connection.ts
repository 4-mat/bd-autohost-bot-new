import WebSocket from "ws";
import { EventEmitter } from "events";
import config from "./config.js";
import { login } from "./login.js";
import { setWs, resumeSending } from "./utils.js";

export const bot = new EventEmitter();

const RECONNECT_DELAY_MS = 5000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connected = false;

/**
 * Schedule a reconnect. Idempotent: only one reconnect may be pending at a
 * time, and a connected socket suppresses stale events from a superseded
 * socket (e.g. an error followed by a late close from the previous socket).
 */
function scheduleReconnect() {
  if (connected) return;
  if (reconnectTimer) return;
  console.log("Disconnected. Reconnecting in 5s...");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

/** Connect to the Pokemon Showdown WebSocket and wire up login and message handling. */
export function connect() {
  const proto = config.useTLS ? "wss" : "ws";
  const url = `${proto}://${config.server}:${config.port}/showdown/websocket`;
  const ws = new WebSocket(url);

  // Install the wrapper before any event handler runs so the open handler's
  // resumeSending() (and any concurrent drain) can never reach a stale socket
  // from a previous reconnect or an unset wrapper on first connect.
  setWs({ send: (msg: string, cb) => ws.send(msg, cb) });

  ws.on("open", () => {
    console.log(`Connected to ${config.server}`);
    // A stale reconnect may still be pending from a superseded socket;
    // cancel it now that a socket is actually up.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connected = true;
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
    connected = false;
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
    // Some error paths never emit close; reconnect regardless.
    connected = false;
    scheduleReconnect();
  });

  return ws;
}
