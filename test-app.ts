import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { loadGameData } from "./src/data/index.js";
import { rooms, type Room } from "./src/rooms.js";
import { users } from "./src/users.js";
import { handleCommand } from "./src/commands/index.js";
import { setWs, toId } from "./src/utils.js";
import {
  games,
  getCurrentEntity,
  type Entity,
  type Game,
} from "./src/game/state.js";

loadGameData();

const PORT = Number(process.env.PORT) || 4000;
const PREFIX = "%";

const browserClients = new Set<WebSocket>();

interface Session {
  username: string;
  authenticated: boolean;
  tabs: string[];
  spectating: boolean;
  team: number;
}

const sessions = new Map<WebSocket, Session>();

const REACTIONS: Record<string, string> = {
  cheer: "cheers!",
  boo: "boos.",
  clap: "claps.",
  hype: "is hyped!",
  gg: "says GG!",
  gasp: "gasps!",
};

function isTeamBattle(game: Game): boolean {
  return game.mode.toLowerCase().includes("v");
}

function getConnectedPlayers() {
  const players: Array<{ name: string; role: string }> = [];

  for (const session of sessions.values()) {
    if (!session.authenticated) continue;

    const tabs = getUserTabs(session.username);
    let role = tabs.includes("host")
      ? "Host"
      : tabs.includes("player")
        ? "Player"
        : "Spectator";

    if (session.team > 0) role += ` (Team ${session.team})`;

    players.push({ name: session.username, role });
  }

  return players;
}

function refreshPlayerList() {
  const msg = JSON.stringify({
    type: "playerlist",
    players: getConnectedPlayers(),
  });

  for (const [ws, session] of sessions) {
    if (session.authenticated && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// Stores the latest GUI for every user
const userGui = new Map<
  string,
  {
    host?: string;
    player?: string;
    spectator?: string;
  }
>();

function broadcast(msg: string) {
  for (const client of browserClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

const BTN_STYLE =
  "padding:2px 8px;margin:2px;background:#333;color:white;border:1px solid #888;cursor:pointer;font-size:12px;font-family:Verdana,sans-serif";

function findSession(username: string): Session | null {
  const id = toId(username);

  for (const session of sessions.values()) {
    if (toId(session.username) === id) return session;
  }
  return null;
}

function spectatorWidget(team: number): string {
  const teamLabel = team > 0 ? `Team ${team}` : "None";

  const teamBtns = [1, 2, 0]
    .map(
      (t) =>
        `<button name="send" value="%pickteam ${t}" style="${BTN_STYLE}">Team ${t === 0 ? "None" : t}</button>`,
    )
    .join(" ");

  const reactBtns = Object.keys(REACTIONS)
    .map(
      (r) =>
        `<button name="send" value="%react ${r}" style="${BTN_STYLE}">${r}</button>`,
    )
    .join(" ");

  return `<div style="margin-top:8px;padding:8px;background:#16213e;border:1px solid #333;border-radius:4px">
<b style="color:#00aaff">Spectator</b> <span style="color:#888">(cheering: ${teamLabel})</span><br>
${teamBtns}<br>${reactBtns}
</div>`;
}

function sendSpectatorGui(username: string) {
  const saved = userGui.get(toId(username));

  const html =
    (saved?.spectator ||
      `
<div style="color:#888;padding:40px;text-align:center">
  No GUI data yet.<br><br>
  <span style="color:#00aaff">Quick start:</span><br>
  %host<br>
  %addp Player1, Bard, Crossbow<br>
  %addp Player2, Cleric, Longbow<br>
  %setlevel P1, 3<br>
  %start
</div>
`) + spectatorWidget(findSession(username)?.team ?? 0);

  sendToUser(username, {
    type: "gui",
    role: "spectator",
    html,
  });
}

function sendToUser(username: string, msg: object) {
  const id = toId(username);

  for (const [ws, session] of sessions) {
    if (
      session.authenticated &&
      toId(session.username) === id &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.send(JSON.stringify(msg));
    }
  }
}

setWs({
  send(raw: string) {
    if (raw.startsWith("|/pm ")) {
      const pmContent = raw.slice(1);
      if (pmContent.includes("/pminfobox ")) {
        const pmTarget = pmContent.match(/^\/pm ([^,]+),/)?.[1] ?? "";
        const html = pmContent.split("/pminfobox ")[1] ?? "";
        const id = toId(pmTarget);
        const saved = userGui.get(id) ?? {};
        saved.player = html;
        userGui.set(id, saved);
        // send immediately if online
        sendToUser(pmTarget, {
          type: "gui",
          role: "player",
          html,
        });
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

      let hostName: string | null = null;

      for (const game of games.values()) {
        if (game.host) {
          hostName = game.host;
          break;
        }
      }

      if (!hostName) return;

      const hostId = toId(hostName);

      const saved = userGui.get(hostId) ?? {};
      saved.host = html;
      userGui.set(hostId, saved);

      sendToUser(hostName, {
        type: "gui",
        role: "host",
        html,
      });

      // Send to all spectators
      for (const [ws, session] of sessions) {
        if (
          session.authenticated &&
          (session.tabs.includes("spectator") ||
            session.tabs.includes("player")) &&
          toId(session.username) !== hostId &&
          ws.readyState === WebSocket.OPEN
        ) {
          const specSaved = userGui.get(toId(session.username)) ?? {};
          const stripped = stripControls(html);
          specSaved.spectator = stripped;
          userGui.set(toId(session.username), specSaved);
          ws.send(
            JSON.stringify({
              type: "gui",
              role: "spectator",
              html: stripped + spectatorWidget(session.team),
            }),
          );
        }
      }

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

function stripControls(html: string): string {
  return html
    .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, "")
    .replace(/<[^>]*>\s*Controls\s*<\/[^>]*>/gi, "");
}

function findPlayerSlot(name: string): string | null {
  for (const game of games.values()) {
    if (game.host && toId(game.host) === toId(name)) {
      // if host is always player 1
      return "P1";
    }

    for (const e of game.entities) {
      if (toId(e.name) === toId(name)) {
        return e.num.toUpperCase();
      }
    }
  }

  return null;
}

function getUserTabs(username: string): string[] {
  const tabs: string[] = [];

  let isHost = false;

  for (const game of games.values()) {
    if (game.host && toId(game.host) === toId(username)) {
      isHost = true;
      break;
    }
  }

  if (isHost) {
    tabs.push("host");
  }

  const playerSlot = findPlayerSlot(username);

  if (playerSlot) {
    tabs.push("player");
  }

  // If they have no role, they are a spectator
  if (tabs.length === 0) {
    tabs.push("spectator");
  }

  tabs.push("players");

  // Team chat only appears for players during team battles
  const game = [...games.values()][0];
  if (game && isTeamBattle(game) && tabs.includes("player")) {
    tabs.push("teamchat");
  }

  return tabs;
}

function refreshAllTabs() {
  for (const [ws, session] of sessions) {
    if (session.authenticated && ws.readyState === WebSocket.OPEN) {
      const tabs = getUserTabs(session.username);

      session.tabs = tabs;

      ws.send(
        JSON.stringify({
          type: "tabs",
          tabs,
        }),
      );
    }
  }

  refreshPlayerList();
}

function controlsEntity(username: string, entity: Entity): boolean {
  if (toId(entity.name) === toId(username)) return true;
  const slot = findPlayerSlot(username);
  return !!slot && toId(entity.num) === toId(slot);
}

function broadcastTurn() {
  for (const game of games.values()) {
    const entity = getCurrentEntity(game);
    const info = entity
      ? { num: entity.num.toUpperCase(), name: entity.name }
      : null;

    for (const [ws, session] of sessions) {
      if (session.authenticated && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "turn",
            entity: info,
            yours: !!entity && controlsEntity(session.username, entity),
          }),
        );
      }
    }
  }
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

const ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='40' fill='%230f3460'/%3E%3Ctext x='96' y='124' font-size='76' font-family='monospace' font-weight='bold' text-anchor='middle' fill='%2300aaff'%3EBD%3C/text%3E%3C/svg%3E";

const MANIFEST = JSON.stringify({
  name: "BD Autohost Test Client",
  short_name: "BD Autohost",
  start_url: "/",
  display: "standalone",
  background_color: "#1a1a2e",
  theme_color: "#0f3460",
  icons: [
    { src: ICON, sizes: "192x192", type: "image/svg+xml", purpose: "any" },
  ],
});

const IS_RENDER = !!process.env.RENDER;
const DEPLOYED_AT = new Date().toLocaleString("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "short",
});

const server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url === "/manifest.webmanifest") {
    res.writeHead(200, { "Content-Type": "application/manifest+json" });
    res.end(MANIFEST);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(HTML_PAGE);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("WEBSOCKET CONNECTED");
  browserClients.add(ws);

  const session: Session = {
    username: "",
    authenticated: false,
    tabs: [],
    spectating: false,
    team: 0,
  };
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
        console.log("LOGIN RECEIVED:", msg);
        const username = String(msg.username ?? "").trim();
        if (!username) {
          ws.send(
            JSON.stringify({
              type: "system",
              text: "Username cannot be empty.",
            }),
          );
          return;
        }
        ensureUser(username);

        session.username = username;
        session.authenticated = true;
        session.tabs = getUserTabs(username);

        ws.send(
          JSON.stringify({
            type: "tabs",
            tabs: session.tabs,
          }),
        );

        if (session.tabs.includes("spectator")) {
          const savedSpec = userGui.get(toId(username));
          const specHtml =
            savedSpec?.spectator ||
            `
<div style="color:#888;padding:40px;text-align:center">
  No GUI data yet.<br><br>
  <span style="color:#00aaff">Quick start:</span><br>
  %host<br>
  %addp Player1, Bard, Crossbow<br>
  %addp Player2, Cleric, Longbow<br>
  %setlevel P1, 3<br>
  %start
</div>
`;
          ws.send(
            JSON.stringify({
              type: "gui",
              role: "spectator",
              html: specHtml + spectatorWidget(session.team),
            }),
          );
        }

        const savedGui = userGui.get(toId(username));

        if (savedGui?.host && session.tabs.includes("host")) {
          ws.send(
            JSON.stringify({
              type: "gui",
              role: "host",
              html: savedGui.host,
            }),
          );
        }

        if (savedGui?.player && session.tabs.includes("player")) {
          ws.send(
            JSON.stringify({
              type: "gui",
              role: "player",
              html: savedGui.player,
            }),
          );
        }

        ws.send(
          JSON.stringify({
            type: "nick",
            user: username,
          }),
        );

        broadcast(
          JSON.stringify({
            type: "join",
            user: username,
          }),
        );
        refreshPlayerList();
        broadcastTurn();
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

          const oldName = session.username;

          ensureUser(nick);
          session.username = nick;

          broadcast(
            JSON.stringify({
              type: "nick",
              user: nick,
            }),
          );

          broadcast(
            JSON.stringify({
              type: "system",
              text: `${oldName} renamed to ${nick}.`,
            }),
          );

          return;
        }

        if (text.startsWith("/t ")) {
          const message = text.slice(3).trim();
          if (!message) return;

          const game = [...games.values()][0];
          if (!game || !isTeamBattle(game)) {
            broadcast(
              JSON.stringify({
                type: "system",
                text: "No team battle active.",
              }),
            );
            return;
          }

          for (const [ws2, other] of sessions) {
            if (
              other.authenticated &&
              other.tabs.includes("player") &&
              ws2.readyState === WebSocket.OPEN
            ) {
              ws2.send(
                JSON.stringify({
                  type: "teamchat",
                  text: `${session.username}: ${message}`,
                }),
              );
            }
          }
          return;
        }

        if (text.startsWith("/me ")) {
          const action = text.slice(4).trim();
          if (!action) return;
          broadcast(
            JSON.stringify({
              type: "action",
              text: `${session.username} ${action}`,
            }),
          );
          return;
        }

        if (!text.startsWith(PREFIX)) {
          broadcast(
            JSON.stringify({
              type: "chat",
              text: `<span class="name">${escHtml(session.username)}</span>: ${escHtml(text)}`,
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

        broadcast(
          JSON.stringify({
            type: "chat",
            text: `<span class="name">${escHtml(session.username)}</span>: <span style="color:#999">${escHtml(text)}</span>`,
          }),
        );

        // WARNING: This is a temporary hack to allow spectators to view the GUI. HARDCODED COMMAND.
        if (cmd === "spectate") {
          session.spectating = true;

          if (!session.tabs.includes("spectator")) {
            session.tabs.push("spectator");
          }

          ws.send(
            JSON.stringify({
              type: "tabs",
              tabs: session.tabs,
            }),
          );

          sendSpectatorGui(session.username);
          broadcastTurn();

          return;
        }

        if (cmd === "pickteam") {
          const team = parseInt(args);
          if (isNaN(team) || team < 0 || team > 2) {
            sendToUser(session.username, {
              type: "system",
              text: "Usage: %pickteam <1|2|0>",
            });
            return;
          }
          session.team = team;
          sendToUser(session.username, {
            type: "system",
            text:
              team > 0 ? `You are cheering for Team ${team}.` : "Team cleared.",
          });
          refreshPlayerList();
          sendSpectatorGui(session.username);
          return;
        }

        if (cmd === "react") {
          const phrase = REACTIONS[args.trim().toLowerCase()];
          if (!phrase) {
            sendToUser(session.username, {
              type: "system",
              text: `Unknown reaction. Try: ${Object.keys(REACTIONS).join(", ")}`,
            });
            return;
          }
          broadcast(
            JSON.stringify({
              type: "react",
              user: session.username,
              emote: phrase,
            }),
          );
          return;
        }

        handleCommand(room, user, cmd, args, val);

        refreshAllTabs();
        broadcastTurn();
      }
    } catch (e) {
      console.error("Bad message:", e);
    }
  });

  ws.on("close", (code, reason) => {
    console.log("Socket closed:", code, reason.toString());
    const username = session.username;

    if (session.authenticated && username) {
      broadcast(
        JSON.stringify({
          type: "leave",
          user: username,
        }),
      );
    }

    sessions.delete(ws);
    browserClients.delete(ws);

    refreshPlayerList();

    console.log(`${username || "Unknown"} disconnected`);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Test app running on port ${PORT}`);
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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f3460">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="BD Autohost">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="${ICON}">
<title>BD Autohost - Test Client</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DejaVu Sans Mono', 'Courier New', monospace; background: #1a1a2e; color: #e0e0e0; height: 100vh; height: 100dvh; display: flex; flex-direction: column; }
  #header { background: #0f3460; padding: 6px 12px; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 12px; font-size: 12px; }
  #header .title { color: #00aaff; font-weight: bold; font-size: 14px; }
  #header .room { color: #ffcc00; }
  .sep { color: #333; }
  #container { flex: 1; display: flex; overflow: hidden; }
  #chat-panel { width: 420px; min-width: 250px; min-height: 0; display: flex; flex-direction: column; }
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
  .msg-react { color: #cc66ff; }
  #turn-indicator { display:none; color:#00aaff; font-size:11px; font-weight:bold; background:#0f3460; border:1px solid #333; border-radius:3px; padding:2px 8px; }
  #turn-indicator.yours { color:#ffcc00; border-color:#ffcc00; animation:tp 1s ease infinite; }
  @keyframes tp { 0%,100% { opacity:1 } 50% { opacity:.4 } }
  #header-tabs { display:none; align-items:center; gap:6px; }
  #mobile-tabs { display:none; gap:4px; }
  .mtab { display:none; padding:6px 18px; background:#0f3460; border:1px solid #333; border-radius:4px; cursor:pointer; font-size:12px; color:#8888aa; font-family:inherit; }
  .mtab.on { background:#00aaff; color:#fff; border-color:#00aaff; }
  .chat-badge { display:none; background:#cc0000; color:#fff; border-radius:9px; padding:1px 7px; font-size:13px; font-weight:bold; margin-left:6px; }
  .chat-badge.show { display:inline-block; }
  .toast-wrap { position:fixed; bottom:70px; left:0; right:0; padding:8px; pointer-events:none; z-index:9999; }
  .toast-msg { background:rgba(0,0,0,.88); color:#fff; padding:10px 14px; border-radius:8px; margin:4px 8px; font-size:14px; box-shadow:0 2px 8px rgba(0,0,0,.4); animation:ti .3s ease,to .3s ease 3.7s forwards; }
  .toast-turn { border:2px solid #ffcc00; background:rgba(0,40,20,.94); font-size:16px; font-weight:bold; text-align:center; }
  @keyframes ti{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  @keyframes to{from{opacity:1}to{opacity:0;transform:translateY(20px)}}
  #login-overlay { position:fixed; inset:0; background:rgba(0,0,0,.75); display:none; align-items:center; justify-content:center; z-index:10000; }
  #login-overlay.show { display:flex; }
  #login-card { background:#16213e; border:1px solid #333; border-radius:8px; padding:24px; text-align:center; min-width:280px; max-width:90vw; }
  #login-card h2 { color:#00aaff; font-size:16px; margin-bottom:16px; font-weight:bold; }
  #login-err { color:#ff6b6b; font-size:12px; min-height:16px; margin-bottom:8px; }
  #login-input { width:100%; background:#0f3460; border:1px solid #333; color:#e0e0e0; padding:10px 12px; font-family:inherit; font-size:14px; border-radius:3px; outline:none; margin-bottom:12px; }
  #login-input:focus { border-color:#00aaff; }
  #login-btn { width:100%; background:#00aaff; color:#fff; border:none; padding:10px 14px; font-family:inherit; font-size:14px; border-radius:3px; cursor:pointer; }
  #login-btn:hover { background:#0088cc; }
  @media (max-width:600px) {
    #header { padding:10px 12px; font-size:16px; flex-wrap:wrap; gap:8px; }
    #header .title { font-size:18px; }
    #header-tabs { display:flex; order:3; flex-basis:100%; justify-content:flex-start; padding:0 0 4px 8px; }
    #gui-header { display:none; }
    #mobile-tabs { display:flex; margin-left:auto; }
    .sep { display:none; }
    .mtab { display:block; font-size:18px; padding:10px 28px; }
    .chat-badge { font-size:14px; padding:2px 8px; }
    #container { flex-direction:column; }
    #chat-panel, #resize-handle { display:none; }
    #container.mobile-chat #chat-panel { display:flex; width:100% !important; flex:1; }
    #container.mobile-chat #gui-panel { display:none; }
    #container.mobile-game #gui-panel { flex:1; }
    #container.mobile-game #chat-panel { display:none; }
    #chat-messages { font-size:18px !important; padding:12px; padding-bottom:calc(env(safe-area-inset-bottom,0px) + 80px); }
    #chat-input-area { padding-bottom:calc(env(safe-area-inset-bottom,0px) + 8px); }
    #chat-input { font-size:18px !important; padding:12px !important; }
    #send-btn { font-size:18px !important; padding:12px 28px !important; }
    .gui-tab { font-size:16px !important; padding:8px 20px !important; }
    #gui-content { padding:4px; }
    #status { font-size:12px !important; }
    #turn-indicator { font-size:14px; padding:4px 10px; }
  }
</style>
</head>
<body>
<div id="header">
  <span class="title">BD Autohost Test Client</span>
  <span class="sep">|</span>
  <span class="room">#battledome</span>
  <span class="sep">|</span>
  <span style="color:#8888aa" id="current-user">HostUser</span>
  ${IS_RENDER ? `<span style="color:#8888aa;font-size:10px" title="Deployed at">Last Updated: ${DEPLOYED_AT} EST</span>` : ""}
  <div id="header-tabs"></div>
  <div id="mobile-tabs">
    <button class="mtab" data-view="game">Game</button>
    <button class="mtab" data-view="chat">Chat<span id="chat-badge" class="chat-badge"></span></button>
  </div>
  <span style="flex:1"></span>
  <span id="turn-indicator"></span>
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
      <div id="gui-tabs"></div>
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
<div id="login-overlay">
  <div id="login-card">
    <h2>BD Autohost</h2>
    <div id="login-err"></div>
    <input id="login-input" type="text" placeholder="Choose a username..." autocomplete="off" spellcheck="false" maxlength="24" />
    <button id="login-btn">Login</button>
  </div>
</div>
<script>
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const guiContent = document.getElementById('gui-content');
const statusEl = document.getElementById('status');
const userEl = document.getElementById('current-user');
const loginOverlay = document.getElementById('login-overlay');
const loginInput = document.getElementById('login-input');
const loginBtn = document.getElementById('login-btn');
const loginErr = document.getElementById('login-err');

let currentNick = 'HostUser';
let guiPages = {};
let activeTab = "";
let mobileView = 'game';
let connectedPlayers = [];
let teamChatLines = [];
let unread = 0;
let lastTurn = '';
const container = document.getElementById('container');

function renderPlayerList() {
  const rows = connectedPlayers.map(p =>
    '<div style="padding:3px 0">' + p.name + ' <span style="color:#888">(' + p.role + ')</span></div>'
  ).join('');
  guiPages.players = '<div style="padding:10px"><h3 style="color:#00aaff">Connected users</h3>' +
    (rows || '<div style="color:#888">No players connected.</div>') + '</div>';
  if (activeTab === "players") guiContent.innerHTML = guiPages.players;
}

function renderTeamChat() {
  const lines = teamChatLines.map(l =>
    '<div style="padding:3px 0"><span style="color:#00cc00">[TEAM]</span> ' + l + '</div>'
  ).join('');
  guiPages.teamchat = '<div style="padding:10px"><h3 style="color:#00aaff">Team Chat</h3>' +
    (lines || '<div style="color:#888">No team messages yet.</div>') + '</div>';
  if (activeTab === "teamchat") guiContent.innerHTML = guiPages.teamchat;
}

function isMobile() { return window.innerWidth <= 600; }

function updateBadge() {
  const b = document.getElementById('chat-badge');
  if (!b) return;
  b.textContent = unread > 9 ? '9+' : unread;
  b.classList.toggle('show', unread > 0);
}

function setView(v) {
  mobileView = v;
  if (!isMobile()) return;
  container.className = 'mobile-' + v;
  document.querySelectorAll('.mtab').forEach(b => {
    b.classList.toggle('on', b.dataset.view === v);
  });
  if (v === 'chat') {
    unread = 0;
    updateBadge();
    setTimeout(() => chatInput.focus(), 60);
  }
}

document.querySelectorAll('.mtab').forEach(b => {
  b.addEventListener('click', () => setView(b.dataset.view));
});

function showToast(text, tone) {
  let wrap = document.getElementById("toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "toast-wrap";
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  const t = document.createElement("div");
  t.className = tone ? "toast-msg toast-turn" : "toast-msg";
  t.textContent = text.replace(/<[^>]+>/g, "");
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function handleTurn(msg) {
  const e = msg.entity;
  const el = document.getElementById('turn-indicator');
  const key = e ? e.num : '';
  const label = e ? e.name + ' (' + e.num + ')' : '';
  if (el) {
    el.textContent = label;
    el.style.display = e ? 'inline-block' : 'none';
    el.classList.toggle('yours', !!e && !!msg.yours);
  }
  if (!e || key === lastTurn) {
    lastTurn = key;
    return;
  }
  lastTurn = key;
  if (msg.yours && isMobile()) {
    showToast('Your turn: ' + label, true);
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  }
}

window.addEventListener('resize', () => {
  if (isMobile()) setView(mobileView);
  else container.className = '';
});

function addLine(type, raw) {
  const div = document.createElement('div');
  if (type === 'system') { div.className = 'msg-system'; div.textContent = raw; }
  else if (type === 'action') { div.className = 'msg-action'; div.textContent = '\\u25B6 ' + raw; }
  else if (type === 'pm') { div.className = 'msg-pm'; div.textContent = raw; }
  else if (type === 'react') { div.className = 'msg-react'; div.textContent = '\\u2606 ' + raw; }
  else if (type === 'gui') { return; }
  else {
    div.className = 'msg-chat';
    div.innerHTML = raw.replace(/\\*\\*(.+?)\\*\\*/g, '<b style="color:#ffcc00">$1</b>');
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

guiContent.addEventListener('click', (e) => {
  const btn = e.target.closest('button[name="send"]');
  if (!btn) return;
  e.preventDefault();
  const cmd = btn.getAttribute('value');
  if (!cmd) return;
  ws.send(JSON.stringify({ type: 'chat', text: cmd }));
});
function createTabs(tabs) {
  const previousTab = activeTab;

  function renderTabs(container) {
    container.innerHTML = "";
    tabs.forEach(tab => {
      guiPages[tab] ??= "";
      const button = document.createElement("div");
      button.className = "gui-tab";
      button.dataset.role = tab;
      const label = tab === "players" ? "Connected users" : isMobile() && tab === "player" ? "Game" : tab.charAt(0).toUpperCase() + tab.slice(1);
      button.textContent = label;
      if (tab === "players") button.style.order = -1;
      button.onclick = () => {
        document.querySelectorAll(".gui-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll('.gui-tab[data-role="' + tab + '"]').forEach(t => t.classList.add("active"));
        activeTab = tab;
        guiContent.innerHTML = guiPages[tab] || '<div style="color:#888;padding:40px;text-align:center">No GUI yet.</div>';
        if (isMobile() && mobileView === 'chat') setView('game');
      };
      container.appendChild(button);
    });
  }

  const hc = document.getElementById("header-tabs");
  const gc = document.getElementById("gui-tabs");
  if (gc) renderTabs(gc);
  if (hc) renderTabs(hc);

  if (previousTab && tabs.includes(previousTab)) {
    document.querySelector('.gui-tab[data-role="' + previousTab + '"]')?.click();
  } else if (tabs.length > 0) {
    document.querySelector(".gui-tab")?.click();
  }
}

let ws;
const nickKey = 'bdUser';
let nick = '';

function loadNick() {
  try { return localStorage.getItem(nickKey) || ''; } catch (e) { return ''; }
}

function saveNick(n) {
  try { localStorage.setItem(nickKey, n); } catch (e) {}
}

function doLogin(username) {
  nick = username;
  saveNick(username);
  loginOverlay.classList.remove('show');
  console.log("Sending login:", username);
  ws.send(JSON.stringify({ type: 'login', username }));
}

function submitLogin() {
  const username = loginInput.value.trim();
  if (!username) {
    loginErr.textContent = 'Please enter a username.';
    loginInput.focus();
    return;
  }
  doLogin(username);
}

loginBtn.addEventListener('click', submitLogin);
loginInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitLogin();
});

function connect() {
  statusEl.textContent = 'connecting...';
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host);
  ws.onopen = () => {
    statusEl.textContent = 'connected';
    statusEl.style.color = '#00cc00';
    const saved = loadNick();
    if (saved) loginInput.value = saved;
    loginErr.textContent = '';
    loginOverlay.classList.add('show');
    loginInput.focus();
  };
  ws.onclose = () => {
    statusEl.textContent = 'disconnected';
    statusEl.style.color = '#cc0000';
    addLine('system', 'Disconnected. Reconnecting...');
    setTimeout(connect, 2000);
  };
  ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);

  if (msg.type === 'tabs') {
    createTabs(msg.tabs);
    return;
  }
  if (msg.type === 'gui') {
    guiPages[msg.role] = msg.html;
    if (activeTab === msg.role) {
      guiContent.innerHTML = msg.html;
    }
    } else if (msg.type === 'nick') {
      currentNick = msg.user;
      if (userEl) userEl.textContent = msg.user;
      saveNick(msg.user);
    } else if (msg.type === 'join') {
      addLine('system', msg.user + ' joined.');
    } else if (msg.type === 'leave') {
      addLine('system', msg.user + ' left.');
    } else if (msg.type === 'chat') {
      addLine('chat', msg.text);
      if (isMobile() && mobileView === 'game') {
        showToast(msg.text);
        unread++;
        updateBadge();
      }
    } else if (msg.type === 'turn') {
      handleTurn(msg);
    } else if (msg.type === 'action') {
      addLine('action', msg.text);
    } else if (msg.type === 'pm') {
      addLine('pm', msg.text);
    } else if (msg.type === 'playerlist') {
      connectedPlayers = msg.players;
      renderPlayerList();
    } else if (msg.type === 'teamchat') {
      teamChatLines.push(msg.text);
      if (teamChatLines.length > 100) teamChatLines.shift();
      addLine('system', '[TEAM] ' + msg.text);
      renderTeamChat();
    } else if (msg.type === 'react') {
      addLine('react', msg.user + ' ' + msg.emote);
    } else {
      addLine('system', msg.text);
    }
  };
}
connect();
setView(mobileView);

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
