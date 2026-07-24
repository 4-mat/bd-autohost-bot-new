import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { loadGameData } from "./src/data/index.js";
import { rooms, type Room } from "./src/rooms.js";
import { users } from "./src/users.js";
import { handleCommand } from "./src/commands/index.js";
import { setWs, toId } from "./src/utils.js";
import { games } from "./src/game/state.js";

loadGameData();

const PORT = Number(process.env.PORT) || 4000;
const PREFIX = "%";

let browserWs: WebSocket | null = null;

interface Session {
  username: string;
  authenticated: boolean;
}

const sessions = new Map<WebSocket, Session>();

function broadcast(msg: string) {
  if (browserWs?.readyState === WebSocket.OPEN) {
    browserWs.send(msg);
  }
}

setWs({
  send(raw: string) {
    if (raw.startsWith("|/pm ")) {
      const pmContent = raw.slice(1);
      if (pmContent.includes("/pminfobox ")) {
        const pmTarget = pmContent.match(/^\/pm ([^,]+),/)?.[1] ?? "";
        const html = pmContent.split("/pminfobox ")[1] ?? "";
        const tab = findPlayerTab(pmTarget);
        broadcast(JSON.stringify({ type: "gui", tab, html }));
      } else {
        broadcast(
          JSON.stringify({
            type: "chat",
            text: pmContent.replace(/^\/pm [^,]+, /, ""),
          }),
        );
      }
      return;
    }
    if (raw.startsWith("|/addhtmlbox ")) {
      const html = raw.slice("|/addhtmlbox ".length);
      broadcast(JSON.stringify({ type: "gui", tab: "host", html }));
      return;
    }
    const text = raw.replace(/^\|/, "");
    if (text.startsWith("/me ")) {
      broadcast(JSON.stringify({ type: "action", text: text.slice(4) }));
    } else {
      broadcast(JSON.stringify({ type: "chat", text }));
    }
  },
});

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function findPlayerTab(name: string): string {
  for (const game of games.values()) {
    for (const e of game.entities) {
      if (toId(e.name) === toId(name)) {
        return e.num.toLowerCase();
      }
    }
  }
  return "host";
}

function ensureUser(name: string) {
  const uid = toId(name);
  if (!users.has(uid)) {
    users.set(uid, {
      id: uid,
      name,
      rooms: { battledome: " " },
      last: Date.now(),
    });
  }
  return uid;
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(HTML_PAGE);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  browserWs = ws;

  const session: Session = { username: "", authenticated: false };
  sessions.set(ws, session);

  console.log("Browser connected");

  if (!rooms.has("battledome")) {
    rooms.set("battledome", {
      id: "battledome",
      type: "battle",
      users: ["HostUser"],
    });
  }
  if (!users.has("hostuser")) {
    users.set("hostuser", {
      id: "hostuser",
      name: "HostUser",
      rooms: { battledome: "@" },
      last: Date.now(),
    });
  }

  broadcast(
    JSON.stringify({
      type: "system",
      text: "Connected. Please log in with a username.",
    }),
  );

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const session = sessions.get(ws);
      if (!session) return;

      if (msg.type === "login") {
        const username = String(msg.username ?? "").trim();
        if (!username) {
          ws.send(
            JSON.stringify({ type: "system", text: "Username cannot be empty." }),
          );
          return;
        }
        ensureUser(username);
        session.username = username;
        session.authenticated = true;
        broadcast(JSON.stringify({ type: "nick", user: username }));
        broadcast(
          JSON.stringify({ type: "system", text: `Logged in as ${username}.` }),
        );
        return;
      }

      if (!session.authenticated) {
        ws.send(
          JSON.stringify({ type: "system", text: "Please log in first." }),
        );
        return;
      }

      if (msg.type === "chat") {
        const text: string = msg.text.trim();

        if (text.startsWith("/nick ")) {
          const nick = text.slice(6).trim();
          if (!nick) {
            broadcast(
              JSON.stringify({ type: "system", text: "Usage: /nick <name>" }),
            );
            return;
          }
          ensureUser(nick);
          session.username = nick;
          broadcast(JSON.stringify({ type: "nick", user: nick }));
          broadcast(
            JSON.stringify({
              type: "system",
              text: `Now talking as **${nick}**.`,
            }),
          );
          return;
        }

        if (!text.startsWith(PREFIX)) {
          broadcast(
            JSON.stringify({
              type: "chat",
              text: `<span class="name">${escHtml(session.username)}</span>${escHtml(text)}`,
            }),
          );
          return;
        }
        const cmdText = text.slice(PREFIX.length);
        const spaceIdx = cmdText.indexOf(" ");
        const cmd = spaceIdx >= 0 ? cmdText.slice(0, spaceIdx) : cmdText;
        const rest = spaceIdx >= 0 ? cmdText.slice(spaceIdx + 1) : "";
        const commaIdx = rest.indexOf(",");
        const args = commaIdx >= 0 ? rest.slice(0, commaIdx).trim() : rest;
        const val = commaIdx >= 0 ? rest.slice(commaIdx + 1).trim() : "";

        const room = rooms.get("battledome")!;
        const user = users.get(toId(session.username))!;

        handleCommand(room, user, cmd, args, val);
      }
    } catch (e) {
      console.error("Bad message:", e);
    }
  });

  ws.on("close", () => {
    sessions.delete(ws);
    browserWs = null;
    console.log("Browser disconnected");
  });
});

server.listen(PORT, () => {
  console.log(`Test app running at http://localhost:${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("Restarting...");
  wss.close();
  server.close(() => process.exit(0));
});

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BD Autohost - Test Client</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DejaVu Sans Mono', 'Courier New', monospace; background: #1a1a2e; color: #e0e0e0; height: 100vh; display: flex; flex-direction: column; }
  #header { background: #0f3460; padding: 6px 12px; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 12px; font-size: 12px; }
  #header .title { color: #00aaff; font-weight: bold; font-size: 14px; }
  #header .room { color: #ffcc00; }
  #container { flex: 1; display: flex; overflow: hidden; }
  #chat-panel { width: 420px; min-width: 250px; display: flex; flex-direction: column; }
  #resize-handle { width: 4px; background: #333; cursor: col-resize; flex-shrink: 0; }
  #resize-handle:hover { background: #00aaff; }
  #gui-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  #gui-header { background: #16213e; padding: 4px 10px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; }
  #gui-header span { color: #8888aa; font-size: 11px; }
  #gui-tabs { display: flex; gap: 4px; }
  .gui-tab { padding: 2px 10px; background: #0f3460; border: 1px solid #333; border-radius: 3px; cursor: pointer; font-size: 10px; color: #8888aa; font-family: inherit; }
  .gui-tab.active { background: #00aaff; color: #fff; border-color: #00aaff; }
  #gui-content { flex: 1; overflow: auto; padding: 8px; background: #1a1a2e; }
  #chat-messages { flex: 1; overflow-y: auto; padding: 8px; font-size: 12px; line-height: 1.6; }
  #chat-input-area { padding: 6px 8px; background: #16213e; border-top: 1px solid #333; display: flex; gap: 6px; }
  #chat-input { flex: 1; background: #0f3460; border: 1px solid #333; color: #e0e0e0; padding: 5px 8px; font-family: inherit; font-size: 12px; border-radius: 3px; outline: none; }
  #chat-input:focus { border-color: #00aaff; }
  #send-btn { background: #00aaff; color: #fff; border: none; padding: 5px 14px; font-family: inherit; font-size: 12px; border-radius: 3px; cursor: pointer; }
  #send-btn:hover { background: #0088cc; }
  .msg-system { color: #8888aa; font-style: italic; }
  .msg-chat { color: #e0e0e0; }
  .msg-chat .name { color: #ffcc00; font-weight: bold; }
  .msg-pm { color: #cccc00; }
  .msg-action { color: #00cc00; }
</style>
</head>
<body>
<div id="header">
  <span class="title">BD Autohost Test Client</span>
  <span style="color:#333">|</span>
  <span class="room">#battledome</span>
  <span style="color:#333">|</span>
  <span style="color:#8888aa" id="current-user">HostUser</span>
  <span style="flex:1"></span>
  <span style="color:#8888aa;font-size:10px" id="status">connecting...</span>
</div>
<div id="container">
  <div id="chat-panel">
    <div id="chat-messages"></div>
    <div id="chat-input-area">
      <input id="chat-input" type="text" placeholder="Type %command or /nick name..." autocomplete="off" spellcheck="false" />
      <button id="send-btn">Send</button>
    </div>
  </div>
  <div id="resize-handle"></div>
  <div id="gui-panel">
    <div id="gui-header">
      <span>GUI Preview</span>
      <div id="gui-tabs">
        <div class="gui-tab active" data-tab="host">Host</div>
        <div class="gui-tab" data-tab="p1">P1</div>
        <div class="gui-tab" data-tab="p2">P2</div>
        <div class="gui-tab" data-tab="p3">P3</div>
      </div>
    </div>
    <div id="gui-content">
      <div style="color:#8888aa;padding:40px;text-align:center">
        No GUI data yet.<br><br>
        <span style="color:#00aaff">Quick start:</span><br>
        %host<br>
        %addp Player1, Bard, Crossbow<br>
        %addp Player2, Cleric, Longbow<br>
        %setlevel P1, 3<br>
        %start
      </div>
    </div>
  </div>
</div>
<script>
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const guiContent = document.getElementById('gui-content');
const statusEl = document.getElementById('status');
const userEl = document.getElementById('current-user');
let activeTab = 'host';
let currentNick = 'HostUser';
const tabHtml = { host: '', p1: '', p2: '', p3: '' };

function addLine(type, raw) {
  const div = document.createElement('div');
  if (type === 'system') { div.className = 'msg-system'; div.textContent = raw; }
  else if (type === 'action') { div.className = 'msg-action'; div.textContent = '\\u25B6 ' + raw; }
  else if (type === 'pm') { div.className = 'msg-pm'; div.textContent = raw; }
  else if (type === 'gui') { return; }
  else {
    div.className = 'msg-chat';
    div.innerHTML = raw.replace(/\\*\\*(.+?)\\*\\*/g, '<b style="color:#ffcc00">$1</b>');
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderGui() {
  const html = tabHtml[activeTab];
  if (html) { guiContent.innerHTML = html; }
  else { guiContent.innerHTML = '<div style="color:#8888aa;padding:40px;text-align:center">No data for this view yet.</div>'; }
}

guiContent.addEventListener('click', (e) => {
  const btn = e.target.closest('button[name="send"]');
  if (!btn) return;
  e.preventDefault();
  const cmd = btn.getAttribute('value');
  if (!cmd) return;
  ws.send(JSON.stringify({ type: 'chat', text: cmd }));
  addLine('chat', '<span class="name">' + currentNick + '</span> ' + cmd);
});

document.querySelectorAll('.gui-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.gui-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    renderGui();
  });
});

let ws;
function connect() {
  statusEl.textContent = 'connecting...';
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host);
  ws.onopen = () => {
    statusEl.textContent = 'connected';
    statusEl.style.color = '#00cc00';
    const username = prompt('Username?') || '';
    ws.send(JSON.stringify({ type: 'login', username }));
  };
  ws.onclose = () => {
    statusEl.textContent = 'disconnected';
    statusEl.style.color = '#cc0000';
    addLine('system', 'Disconnected. Reconnecting...');
    setTimeout(connect, 2000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'gui') {
      const tab = msg.tab || 'host';
      if (tabHtml.hasOwnProperty(tab)) tabHtml[tab] = msg.html;
      else tabHtml.host = msg.html;
      if (activeTab === tab) renderGui();
    } else if (msg.type === 'nick') {
      currentNick = msg.user;
      if (userEl) userEl.textContent = msg.user;
    } else if (msg.type === 'chat') {
      addLine('chat', msg.text);
    } else if (msg.type === 'action') {
      addLine('action', msg.text);
    } else if (msg.type === 'pm') {
      addLine('pm', msg.text);
    } else {
      addLine('system', msg.text);
    }
  };
}
connect();

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
  chatInput.value = '';
  chatInput.focus();
}

sendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

let dragging = false;
document.getElementById('resize-handle').addEventListener('mousedown', (e) => {
  dragging = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const w = Math.max(200, Math.min(e.clientX, window.innerWidth - 300));
  document.getElementById('chat-panel').style.width = w + 'px';
});
document.addEventListener('mouseup', () => { if (dragging) { dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; } });

addLine('system', 'Welcome to BD Autohost test client.');
addLine('system', 'Commands: %host, %setgame, %addp, %remp, %setmap, %setlevel, %gento, %start, %help');
addLine('system', 'Switch accounts: /nick <name>');
</script>
</body>
</html>`;
