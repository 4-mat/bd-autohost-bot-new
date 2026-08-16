import config from "./config.js";

/** Normalize a username/term to its PS id form: lowercase alphanumerics only. */
export function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** True when the given username is in config.devs (id-normalized). */
export function isDev(username: string): boolean {
  const id = toId(username);
  return config.devs.some((d) => toId(d) === id);
}

// Bound the outgoing queue so a burst or a stalled socket cannot
// accumulate unbounded stale messages. Oldest messages drop first.
const MAX_QUEUE = 100;
const MAX_AGE_MS = 30_000;

const sendQueue: Array<{ room: string; msg: string; at: number }> = [];
let sending = false;

/** Queue a room message, throttling sends and capping queue size/age. */
export function send(room: string, msg: string) {
  sendQueue.push({ room, msg, at: Date.now() });
  if (sendQueue.length > MAX_QUEUE) sendQueue.shift();
  if (!sending) drain();
}

function drain() {
  while (sendQueue.length && Date.now() - sendQueue[0].at > MAX_AGE_MS) {
    sendQueue.shift();
  }
  if (!sendQueue.length) {
    sending = false;
    return;
  }
  sending = true;
  const { room, msg } = sendQueue.shift()!;
  const prefix = room.startsWith("pm-") ? "" : `|`;
  ws.send(`${prefix}${msg}`);
  setTimeout(drain, 400);
}

/** Send a private message to a PS user (via the pm- room). */
export function sendPm(user: string, msg: string) {
  send(`pm-${toId(user)}`, `|/pm ${user}, ${msg}`);
}

const PM_CHUNK_LIMIT = 900;
export function sendPmChunks(user: string, msg: string) {
  if (msg.length <= PM_CHUNK_LIMIT) {
    sendPm(user, msg);
    return;
  }
  let start = 0;
  while (start < msg.length) {
    let end = start + PM_CHUNK_LIMIT;
    if (end < msg.length) {
      const newline = msg.lastIndexOf("\n", end);
      if (newline > start) end = newline + 1;
    }
    sendPm(user, msg.slice(start, end).trim());
    start = end;
  }
}

export function splitMessage(msg: string) {
  const trim = msg.trim();
  const spaceIdx = trim.indexOf(" ");
  if (spaceIdx === -1) return { cmd: trim, args: "", val: "" };
  const cmd = trim.slice(0, spaceIdx);
  const rest = trim.slice(spaceIdx + 1);
  const commaIdx = rest.indexOf(",");
  if (commaIdx === -1) return { cmd, args: rest, val: "" };
  return {
    cmd,
    args: rest.slice(0, commaIdx).trim(),
    val: rest.slice(commaIdx + 1).trim(),
  };
}

export function parseArgs(args: string): string[] {
  return args
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

// Map coordinates: letter = row (a-z), number = col
export function parsePos(s: string): [number, number] | null {
  const match = s.trim().match(/^([a-zA-Z])\s*,?\s*(\d+)$/);
  if (!match) return null;
  const row = match[1].toLowerCase().charCodeAt(0) - 97;
  const col = parseInt(match[2]) - 1;
  return [row, col];
}

export function posToStr(row: number, col: number): string {
  return `${String.fromCharCode(97 + row)},${col + 1}`;
}

export function natList(arr: string[]): string {
  if (arr.length === 0) return "";
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")} and ${arr[arr.length - 1]}`;
}

// Dice roller: parses XdY+Z, rolls, returns total and breakdown
export function rollDice(formula: string): {
  total: number;
  rolls: number[];
  base: number;
} {
  const match = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) return { total: 0, rolls: [], base: 0 };
  const count = parseInt(match[1]);
  const sides = parseInt(match[2]);
  const mod = match[3] ? parseInt(match[3]) : 0;
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }
  const base = rolls.reduce((a, b) => a + b, 0);
  return { total: base + mod, rolls, base };
}

// Dice statistics: min / average / max for a formula, without rolling.
export function diceStats(formula: string): {
  min: number;
  max: number;
  avg: number;
} | null {
  const m = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!m) return null;
  const count = parseInt(m[1]);
  const sides = parseInt(m[2]);
  const mod = m[3] ? parseInt(m[3]) : 0;
  return {
    min: count + mod,
    max: count * sides + mod,
    avg: (count * (sides + 1)) / 2 + mod,
  };
}

let ws: { send: (msg: string) => void };
/** Register the WebSocket used by send() to transmit messages. */
export function setWs(w: { send: (msg: string) => void }) {
  ws = w;
}
