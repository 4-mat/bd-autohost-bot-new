import WebSocket from "ws";
import { EventEmitter } from "events";
import config from "./config.js";
import { login } from "./login.js";
import { setWs, resumeSending } from "./utils.js";

export const bot = new EventEmitter();

const RECONNECT_DELAY_MS = 5000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
// The socket that owns the active connection. Handlers compare against it so
// a superseded socket (one that errored and was reconnected, or a late event
// from an older socket) can never schedule an overlapping reconnect or flush
// the outbound queue.
let currentWs: WebSocket | null = null;

/**
 * Schedule a reconnect. Single-flight: only one reconnect may be pending at a
 * time, and the timer is cleared once a socket actually opens.
 */
function scheduleReconnect() {
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
  currentWs = ws;

  // Install the wrapper before any event handler runs so the open handler's
  // resumeSending() (and any concurrent drain) can never reach a stale socket
  // from a previous reconnect or an unset wrapper on first connect.
  setWs({ send: (msg: string, cb) => ws.send(msg, cb) });

  ws.on("open", () => {
    if (ws !== currentWs) return;
    console.log(`Connected to ${config.server}`);
    // A stale reconnect may still be pending from a superseded socket;
    // cancel it now that a socket is actually up.
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Flush anything queued while the previous socket was down.
    resumeSending();
  });

  ws.on("message", (data) => {
    if (ws !== currentWs) return;
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
    if (ws !== currentWs) return;
    currentWs = null;
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
    if (ws !== currentWs) return;
    currentWs = null;
    // Some error paths never emit close: terminate the socket so a half-dead
    // connection can't linger and double up with the reconnected one, then
    // reconnect regardless.
    scheduleReconnect();
    ws.terminate();
  });

  return ws;
}
