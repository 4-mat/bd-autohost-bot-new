export function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Outbound messages are retained indefinitely while the socket is down
// (no expiry): the 400ms chain only advances after a successful send, and
// resumeSending() restarts it on reconnect. `resetSendQueueForTests` exists
// for the test suite to clear the queue between tests.
const sendQueue: Array<{ room: string; msg: string }> = [];
let sending = false;
let drainTimer: ReturnType<typeof setTimeout> | null = null;

export function send(room: string, msg: string) {
  sendQueue.push({ room, msg });
  if (!sending) drain();
}

function drain() {
  if (!sendQueue.length) {
    sending = false;
    drainTimer = null;
    return;
  }
  sending = true;
  const item = sendQueue[0];
  const prefix = item.room.startsWith("pm-") ? "" : `|`;
  try {
    ws.send(`${prefix}${item.msg}`);
  } catch {
    // Socket unavailable (not yet open / closed). Keep the message at the
    // front of the queue and stop draining; resumeSending() (called from
    // the WebSocket open handler) retries once the socket is back.
    sending = false;
    return;
  }
  sendQueue.shift();
  drainTimer = setTimeout(drain, 400);
}

/** Resume draining the outbound queue once the WebSocket (re)opens. */
export function resumeSending() {
  if (!sending) drain();
}

/**
 * Test-only: clear the outbound queue and cancel any in-flight drain so
 * send-queue tests start from a known state.
 */
export function resetSendQueueForTests() {
  if (drainTimer) clearTimeout(drainTimer);
  drainTimer = null;
  sendQueue.length = 0;
  sending = false;
}

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

let ws: { send: (msg: string) => void };
export function setWs(w: { send: (msg: string) => void }) {
  ws = w;
}
