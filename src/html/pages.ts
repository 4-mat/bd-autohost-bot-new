import {
  TERRAIN_COLORS,
  TERRAIN_NAMES,
  getReachableTiles,
  getEffectiveMp,
  hasLineOfSight,
  inRange,
  dist,
  DIRECTION_LABELS,
  parseFrequency,
  formatChatTime,
  type Game,
  type Entity,
  type AbilityData,
} from "../game/state.js";
import { posToStr } from "../utils.js";
import { eva43 } from "../game/resolve.js";
import { getVersionData } from "../data/version43.js";
import {
  runoffOptions,
  tallyVotes,
  tieModes,
  voteOptionsFor,
} from "../data/gamemodes.js";

// -- Premove Mode Tracking -----------------------------------------------------

export const premoveSet = new Set<string>();

// -- Toast CSS -----------------------------------------------------------------

const TCSS = `.tw{position:fixed;bottom:0;left:0;right:0;padding:8px;padding-bottom:calc(env(safe-area-inset-bottom,0px)+60px);pointer-events:none;z-index:1000}
.t{background:rgba(0,0,0,.88);color:#fff;padding:8px 14px;border-radius:8px;margin:4px 8px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.4);animation:ti .3s ease,t .3s ease 3.7s forwards}
@keyframes ti{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes t{from{opacity:1}to{opacity:0;transform:translateY(20px)}}
.toast-wrap{position:fixed;bottom:0;left:0;right:0;padding:8px;padding-bottom:calc(env(safe-area-inset-bottom,0px)+60px);pointer-events:none;z-index:1000}
.toast{background:rgba(0,0,0,.88);color:#fff;padding:8px 14px;border-radius:8px;margin:4px 8px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.4);animation:ti .3s ease,to .3s ease 3.7s forwards}`;

// -- Mobile-friendly responsive CSS -------------------------------------------

const R = `<style>
@media (max-width:600px) {
  .bdg button { padding:8px 12px !important; font-size:14px !important; }
  .bdg .tile { width:36px !important; height:36px !important; font-size:14px !important; }
  .bdg .hcell { width:36px !important; min-width:36px !important; font-size:14px !important; }
  .bdg .mcell { width:36px !important; height:36px !important; font-size:14px !important; }
  .bdg td, .bdg th { padding:6px 4px !important; font-size:13px !important; }
  .bdg .stat { display:block !important; margin:4px 0 !important; }
  .bdg .wrap { margin:8px !important; }
  .bdg .log { max-width:100% !important; }
}
</style>`;

const TILE =
  "width:22px;height:22px;padding:0;text-align:center;vertical-align:middle";

const HEADER_CELL =
  "width:22px;min-width:22px;padding:0;text-align:center;vertical-align:middle";

const MAP_CELL =
  "width:22px;height:22px;padding:0;text-align:center;vertical-align:middle";

const TABLE_STYLE =
  "border-spacing:0px;border-collapse:collapse;border:1px solid #888;background:rgba(120,120,225,0.10)";

const TABLE_BORDER = `style="${TABLE_STYLE}"`;

const PLAYER_LABEL =
  "font-size:10px;font-weight:bold;color:black;text-shadow:-1px -1px 0 #BBB,1px -1px 0 #BBB,-1px 1px 0 #BBB,1px 1px 0 #BBB";

// -- Gamemode Vote Panel ------------------------------------------------------
// Shown while game.voteOpen is true (between %close and %endvote). Players get
// one button per valid option plus a live tally; the host gets the full tally
// and an "End Vote" button that applies the winner.

function buildVotePanel(game: Game, entity: Entity | null): string {
  if (!game.voteOpen) return "";

  const players = game.entities.filter((e) => !e.isMonster);
  // During a runoff only the tied modes are shown/votable.
  const runoff = game.voteRunoff;
  const options = runoff
    ? runoffOptions(runoff)
    : voteOptionsFor(players.length);
  const tally = new Map(tallyVotes(game.votes).map((t) => [t.mode, t.count]));
  const voted = Object.keys(game.votes).length;

  let html =
    '<div style="margin:6px 0;padding:6px 10px;border:1px solid #a0c;border-left:3px solid #a0c;background:rgba(160,0,204,0.08)">';
  const heading = runoff
    ? `<b style="color:#c33">GAMEMODE VOTE — RUNOFF</b> <span style="color:#888">tie! only ${runoff.join(" / ")} count</span>`
    : `<b style="color:#a0c">GAMEMODE VOTE</b>`;
  html += `${heading} <span style="color:#888">(${voted}/${players.length} voted)</span><br>`;
  html += `<span style="color:#888;font-size:10px">New to a mode? Hover the buttons, or use %wt modes to learn them all.</span><br>`;

  if (options.length === 0) {
    html +=
      '<span style="color:#888"><i>No valid modes for this lobby size (modes are defined for up to 8 players).</i></span>';
  }

  if (entity !== null) {
    // Player view: clickable vote button (tooltip explains the mode).
    for (const opt of options) {
      const count = tally.get(opt.id) ?? 0;
      const mine = game.votes[entity.id] === opt.id;
      const suffix = count > 0 ? ` (${count})` : "";
      const style = mine
        ? "background:#a0c;color:#fff;border-color:#a0c;font-weight:bold;"
        : "";
      html += btn(
        `%vote ${opt.id}`,
        `${opt.label}${suffix}`,
        style,
        opt.description,
      );
    }

    // Player view: show their current vote and let them retract it.
    const myVote = game.votes[entity.id];
    if (myVote) {
      html += `<div style="margin-top:4px;color:#a0c"><b>Your vote:</b> ${esc(myVote)} ${btn("%unvote", "Unvote")}</div>`;
    }
  } else {
    // Host view: per-mode tally summary.
    const tallySummary =
      tally.size > 0
        ? [...tally.entries()]
            .map(([m, c]) => `${esc(m)}: ${c}`)
            .join(" &nbsp;|")
        : "no votes yet";
    html += `<div style="margin:4px 0"><b>Tally:</b> ${tallySummary}</div>`;

    // Host view: a table of every player and their vote status.
    html += `<table style="border-collapse:collapse;margin:4px 0"><tr style="height:20px"><th style="padding:0px 8px;text-align:left">Player</th><th style="padding:0px 8px;text-align:left">Vote</th></tr>`;
    for (const p of players) {
      const v = game.votes[p.id];
      const voteCell = v
        ? `<span style="color:#0c0">&#10003; ${esc(v)}</span>`
        : `<span style="color:#c33">&#10007; not voted</span>`;
      html += `<tr style="height:20px"><td style="padding:0px 8px"><b>${esc(p.num)}</b> ${esc(p.name)}</td><td style="padding:0px 8px">${voteCell}</td></tr>`;
    }
    html += `</table>`;

    html += `<div style="margin-top:6px">${btn("%endvote", "End Vote & Apply Winner")} ${btn("%nudge", "Nudge Unvoted")}</div>`;
  }
  html += "</div>";
  return html;
}

// -- Toast helpers ------------------------------------------------------------

function buildToasts(game: Game): string {
  if (game.toasts.length === 0) return "";
  const items = game.toasts
    .map((e) => {
      const timeTag = formatChatTime(e.time)
        ? `<span style="color:#999">${formatChatTime(e.time)}</span> `
        : "";
      return `<div class="toast">${timeTag}<b>${esc(e.user)}:</b> ${esc(e.message)}</div>`;
    })
    .join("");
  return `<div class="toast-wrap">${items}</div>`;
}

// -- Helpers ------------------------------------------------------------------

function btn(value: string, label: string, extra = "", title = ""): string {
  const titleAttr = title ? ` title="${esc(title)}"` : "";
  return `<button 
name="send" 
value="${esc(value)}"${titleAttr}
style="padding:2px 8px;margin:2px;background:#333;color:white;border:1px solid #888;cursor:pointer;font-size:12px;font-family:Verdana,sans-serif;${extra}">
${esc(label)}
</button>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// -- Host Page ----------------------------------------------------------------

export function buildHostPage(game: Game): string {
  const map = buildMap(game);
  const pl = buildPlayerDataTable(game);
  const log = buildActionLog(game);
  // Controls (Next Turn / Undo / d20) only matter once the battle is running.
  const controls = game.started ? buildControls(game) : "";
  // Setup shortcuts (%setgame ffa / %setlevel all) only matter pre-start.
  const setup = game.started ? "" : buildSetupPanel(game);
  // "FFA" is just the placeholder until a mode is actually chosen (%setgame, the
  // vote, or %genpos) — don't claim a mode in the header before then.
  const modeSeg =
    game.modeChosen || game.started ? ` -- ${esc(game.mode)} --` : "";

  return `${R}<style>${TCSS}</style><div class="bdg wrap" style="margin:35px;font-size:12px;font-family:Verdana,sans-serif;padding-bottom:calc(env(safe-area-inset-bottom, 0px) + 60px)">
  <b>Game: ${esc(game.id)}</b>${modeSeg} Round <b>${game.round}</b> -- Phase: ${esc(game.phase)}
  <hr>${setup}${buildVotePanel(game, null)}${map}<hr>${pl}<hr>${log}${controls ? `<hr>${controls}` : ""}
  ${buildToasts(game)}
</div>`;
}

// -- Player Page --------------------------------------------------------------

export function buildPlayerPage(game: Game, entity: Entity): string {
  const isTurn = game.turnOrder[game.turnIndex] === entity.num;

  const map = buildMiniMap(game, entity);
  const stats = buildEntityStats(entity);
  const pl = buildPlayerDataTable(game);
  const log = buildActionLog(game, true);

  let phase = "";
  let actions = "";
  let prompt = "";

  if (entity.pendingPrompt) {
    const pp = entity.pendingPrompt;
    if (pp.kind === "selection") {
      const opts = pp.options
        .map((o) => btn(`%choose ${o.id}`, o.label))
        .join("");
      prompt = `<div style="margin:6px 0;padding:4px 8px;border-left:3px solid #a0c;background:rgba(160,0,204,0.10)"><b style="color:#a0c">CHOOSE</b> ${esc(pp.message)}<div style="margin-top:4px">${opts}</div></div>`;
    } else {
      const opts = pp.candidates
        .map((e) => btn(`%target ${e.num}`, e.num))
        .join("");
      prompt = `<div style="margin:6px 0;padding:4px 8px;border-left:3px solid #a0c;background:rgba(160,0,204,0.10)"><b style="color:#a0c">TARGET</b> ${esc(pp.message)}<div style="margin-top:4px">${opts}</div></div>`;
    }
  }

  if (isTurn) {
    const inPremove = premoveSet.has(entity.num);

    if (!entity.movementUsed && inPremove) {
      phase = `<div style="margin:6px 0;padding:4px 8px;border-left:3px solid #00cc00;background:rgba(0,204,0,0.10)"><b style="color:#00cc00">PRE-MOVE ABILITIES</b> <span style="color:#888">Free / Swift / Trigger before movement</span></div>`;
      actions = buildPreMoveAbilities(game, entity);
      actions += `<div style="margin-top:6px">${btn("%premove", "Back to Movement")}</div>`;
    } else if (!entity.movementUsed) {
      phase = `<div style="margin:6px 0;padding:4px 8px;border-left:3px solid #cc0;background:rgba(204,204,0,0.10)"><b style="color:#cc0">MOVEMENT PHASE</b> <span style="color:#888">Click a tile to move</span></div>`;
      actions = buildMoveButtons(game, entity);
      actions += buildDashButtons(game, entity);
      actions += `<div style="margin-top:4px">${btn("%premove", "Abilities Before Move")} ${btn("%passmove", "Pass Movement")}</div>`;
    } else {
      phase = `<div style="margin:6px 0;padding:4px 8px;border-left:3px solid #08c;background:rgba(0,136,204,0.10)"><b style="color:#08c">ACTION PHASE</b> <span style="color:#888">Choose an ability</span></div>`;
      actions = buildAbilityButtons(game, entity);
    }
    // Direction prompt buttons
    if (entity.pendingPromptKind === "direction") {
      const dirs = ["up", "down", "left", "right"];
      actions += `<div style="margin:4px 0;padding:4px 8px;border-left:3px solid #f80;background:rgba(255,136,0,0.10)"><b style="color:#f80">CHOOSE DIRECTION</b><br>`;
      for (const d of dirs) {
        const label = DIRECTION_LABELS[d] ?? d;
        actions += btn(`%dir ${d}`, label, "font-size:12px;padding:4px 12px");
      }
      actions += `</div>`;
    }

    // Tile prompt buttons
    if (entity.pendingPromptKind === "tile") {
      actions += `<div style="margin:4px 0;padding:4px 8px;border-left:3px solid #80f;background:rgba(136,0,255,0.10)"><b style="color:#80f">CHOOSE TILE</b><br><span style="color:#888;font-size:10px">Use %tile &lt;ref&gt; to pick a tile</span></div>`;
    }

    if (entity.pendingAction) {
      const pa = entity.pendingAction;
      const targetStr = pa.target ? ` targeting ${pa.target}` : "";
      actions += `<div style="margin:4px 0;padding:4px 8px;border-left:3px solid #0c0;background:rgba(0,204,0,0.10)"><b style="color:#0c0">PENDING:</b> ${esc(pa.ability.name)}${targetStr}</div>`;
      actions += `<div style="margin-top:4px">${btn("%confirm", "Confirm")} ${btn("%cancel", "Cancel")}</div>`;
    }
    actions += `<div style="margin-top:6px">${btn("%endturn", "End Turn")}</div>`;
  } else {
    const cur = getCurrentTurnEntity(game);
    const curLabel = cur ? `${cur.num} (${cur.name})` : "...";
    phase = `<div style="margin:6px 0;padding:4px 8px;border-left:3px solid #888"><i style="color:#888">Waiting for your turn...</i> <b>${esc(curLabel)}</b></div>`;
  }

  // Until the game starts, players can change their own class/weapon
  // (e.g. after the gamemode vote decides the mode, before the map is set).
  let loadout = "";
  if (!game.started) {
    const data = getVersionData(game.version);
    const classOpts = [...data.classes.values()]
      .map(
        (c) =>
          `<option value="${esc(c.name)}"${c.name === entity.className ? " selected" : ""}>${esc(c.name)}</option>`,
      )
      .join("");
    const weaponOpts = [...data.weapons.values()]
      .map(
        (w) =>
          `<option value="${esc(w.name)}"${w.name === entity.weaponName ? " selected" : ""}>${esc(w.name)}</option>`,
      )
      .join("");
    loadout = `<div style="margin:6px 0;padding:6px 8px;border:1px dashed #57a;border-radius:4px"><b style="color:#8af">Change Loadout</b> <span style="color:#888">(until the game starts)</span><br>
<select id="loadout-class" style="padding:3px;background:#0f3460;color:#e0e0e0;border:1px solid #333;font-family:inherit;font-size:12px">${classOpts}</select>
<select id="loadout-weapon" style="padding:3px;background:#0f3460;color:#e0e0e0;border:1px solid #333;font-family:inherit;font-size:12px">${weaponOpts}</select>
<button name="loadout" style="padding:2px 8px;margin:2px;background:#333;color:white;border:1px solid #888;cursor:pointer;font-size:12px;font-family:Verdana,sans-serif">Apply</button>
</div>`;
  }

  return `${R}<style>${TCSS}</style><div class="bdg wrap" style="margin:35px;font-size:12px;font-family:Verdana,sans-serif;padding-bottom:calc(env(safe-area-inset-bottom, 0px) + 60px)">
  ${map}${pl}
  <b>${esc(entity.num)} ${esc(entity.name)}</b> -- ${esc(entity.className)}/${esc(entity.weaponName)} (${entity.classLevel}/${entity.weaponLevel})${stats}
  ${buildVotePanel(game, entity)}
  ${loadout}
  <hr>${phase}${prompt}${actions}
  ${log}
  ${buildToasts(game)}
</div>`;
}

// -- Map (Host + Player shared logic) -----------------------------------------

function buildMap(game: Game): string {
  return buildMapTable(game, null);
}

function buildMiniMap(game: Game, self: Entity): string {
  return buildMapTable(game, self);
}

function buildMapTable(game: Game, self: Entity | null): string {
  const rows = game.map.length;
  const cols = game.map[0]?.length ?? 0;
  const curNum = game.turnOrder[game.turnIndex];

  let html = `<b>Map</b>`;

  // No map chosen yet (host must %setmap before %start).
  if (rows === 0 || cols === 0) {
    html += `<div style="margin:4px 0;padding:10px;border:1px dashed #888;color:#888;text-align:center">No map selected. Host: %setmap &lt;name&gt; (see %listmaps) or %setmap gen.</div>`;
    return html;
  }

  html += `<div style="overflow-x:auto">`;
  html += `<table align="center" ${TABLE_BORDER}>`;

  // Column header row -- numbers
  html += `<tr><td class="hcell" style="${HEADER_CELL}"></td>`;
  for (let c = 0; c < cols; c++) {
    html += `<td class="hcell" style="${HEADER_CELL}"><b>${c + 1}</b></td>`;
  }
  html += "</tr>";

  // Data rows -- letter labels
  for (let r = 0; r < rows; r++) {
    html += `<tr>`;
    html += `<td style="${HEADER_CELL}"><b>${String.fromCharCode(65 + r)}</b></td>`;

    for (let c = 0; c < cols; c++) {
      html += renderMapCell(game, self, curNum, r, c);
    }
    html += "</tr>";
  }

  html += "</table></div>";
  return html;
}

/** Render one map cell: terrain color, entity label, and highlight. */
function renderMapCell(
  game: Game,
  self: Entity | null,
  curNum: string,
  r: number,
  c: number,
): string {
  const terrain = game.map[r][c];
  const color = TERRAIN_COLORS[terrain] ?? "#99E599";
  const entity = game.entities.find((e) => e.pos[0] === r && e.pos[1] === c);

  let label = "";
  let title = TERRAIN_NAMES[terrain] ?? "Normal";
  let highlight = "";
  let isCur = false;

  if (entity) {
    label = entity.num;
    title = entity.name;
    isCur = entity.num === curNum;
  }

  if (self && entity) {
    const isSelf = entity.num === self.num;
    const isAlly = !isSelf && entity.team === self.team && self.team !== 0;
    if (isSelf) highlight = "outline:2px solid #0a0;";
    else if (isAlly) highlight = "outline:2px solid #08c;";
  } else if (isCur && entity) {
    highlight = "outline:2px solid #cc0;";
  }

  const inner = entity
    ? `><b style="${PLAYER_LABEL}">${label}</b></td>`
    : "></td>";
  return `<td class="mcell" style="background:${color};${MAP_CELL};${highlight}" title="${esc(title)}"${inner}`;
}

// -- Buff/Shield Display Helpers ----------------------------------------------

const DISPLAY_STATS = new Set(["atk", "mag", "pd", "md", "eva", "mp"]);

function statBonus(entity: Entity, stat: string): number {
  let bonus = 0;
  for (const b of entity.buffs) {
    if (b.stat === stat) bonus += b.amount;
    if (b.stat === "def" && (stat === "pd" || stat === "md")) bonus += b.amount;
  }
  return bonus;
}

function buildStatCell(entity: Entity, stat: string, base: number): string {
  const bonus = statBonus(entity, stat);
  const value = Math.max(0, base + bonus);
  if (bonus === 0) return `<td style="padding:0px 8px">${value}</td>`;
  const color = bonus > 0 ? "#c90" : "#c00";
  return `<td style="padding:0px 8px"><i style="color:${color}">${value}</i></td>`;
}

function buildBuffSuffix(entity: Entity): string {
  const parts: string[] = [];
  for (const b of entity.buffs) {
    if (DISPLAY_STATS.has(b.stat) || b.stat === "def") continue;
    const sign = b.amount > 0 ? "+" : "";
    parts.push(`${sign}${b.amount} ${b.stat.toUpperCase()}/${b.rounds}r`);
  }
  if (parts.length === 0) return "";
  return ` <span style="color:#888;font-size:10px">(${parts.join(", ")})</span>`;
}

function buildHpCell(entity: Entity): string {
  const shield = entity.statuses.find((s) => s.name.toLowerCase() === "shield");
  if (!shield || shield.damage <= 0) {
    return `${entity.curhp}/${entity.maxhp}`;
  }
  return `${entity.curhp} + <span style="color:#08c">(${shield.damage})</span>/${entity.maxhp}`;
}

// -- Player Data Table (Host) -------------------------------------------------

function buildPlayerDataTable(game: Game): string {
  let html = `<b>Player Data</b>`;
  html += `<div style="overflow-x:auto">`;

  html += `
<table class="bdinfo" align="center" ${TABLE_BORDER} cellpadding="3">
<colgroup>
<col width="22">
<col>
<col>
<col>
<col width="22">
<col width="22">
<col width="22">
<col width="22">
<col width="22">
</colgroup>
<tbody>
`;

  // Header
  html += `<tr style="height:22px">`;

  const is43 = game.version === "4.3";
  const headers = [
    "#",
    "Name",
    "Class/Weapon",
    "HP",
    "A",
    "M",
    "PD",
    "MD",
    is43 ? "PE/ME" : "EVA",
    "MP",
  ];

  for (const h of headers) {
    html += `<th style="padding:0px 8px">${h}</th>`;
  }

  html += `</tr>`;

  // Players (ordered by turn order if available)
  const ordered =
    game.turnOrder.length > 0
      ? game.turnOrder
          .map((n) => game.entities.find((e) => e.num === n))
          .filter((e): e is Entity => !!e)
      : game.entities;
  for (const e of ordered) {
    html += `<tr style="height:22px">`;

    html += `
<th style="padding:0px 8px" 
title="${esc(e.className)}, ${esc(e.weaponName)}">
<b>${esc(e.num)}</b>
</th>
`;

    html += `<th style="padding:0px 8px">${esc(e.name)}${buildBuffSuffix(e)}</th>`;

    html += `
<th style="padding:0px 8px">
${esc(e.className)}(${e.classLevel})/${esc(e.weaponName)}(${e.weaponLevel})
</th>
`;

    html += `<th style="padding:0px 8px">${buildHpCell(e)}</th>`;
    html += buildStatCell(e, "atk", e.atk);
    html += buildStatCell(e, "mag", e.mag);
    html += buildStatCell(e, "pd", e.pd);
    html += buildStatCell(e, "md", e.md);
    if (is43) {
      const pe = eva43(e, "Physical");
      const me = eva43(e, "Magical");
      html += `<td style="padding:0px 8px">${pe}/${me}</td>`;
    } else {
      html += buildStatCell(e, "eva", e.eva);
    }
    html += buildStatCell(e, "mp", e.mp);

    html += `</tr>`;
  }

  // Turn order
  const turnParts: string[] = [];

  for (const num of game.turnOrder) {
    const e = game.entities.find((x) => x.num === num);

    turnParts.push(e ? e.name : num);
  }

  html += `
<tr style="min-height:22px">
<td colspan="10" style="text-align:center">
<b>
Turn Order: ${turnParts.map(esc).join(", ")}
</b>
</td>
</tr>
`;

  html += `
</tbody>
</table>
</div>
`;

  return html;
}

// -- Action Log ---------------------------------------------------------------

function buildActionLog(game: Game, collapsed = false): string {
  const body =
    game.log.length === 0
      ? `<div style="color:#888"><i>(empty)</i></div>`
      : `<table class="log" align="center" ${TABLE_BORDER} cellpadding="3" style="max-width:600px">` +
        game.log
          .slice(-15)
          .map(
            (entry) =>
              `<tr style="height:22px"><td style="padding:2px 8px"><b>[R${entry.turn}]</b> ${esc(entry.description)}</td></tr>`,
          )
          .join("") +
        `</table>`;

  if (collapsed) {
    return `<details style="margin:4px 0"><summary style="cursor:pointer"><b>Action Log</b></summary>${body}</details>`;
  }
  return `<b>Action Log</b>${body}`;
}

// -- Setup (Host, pre-start) --------------------------------------------------

function buildSetupPanel(game: Game): string {
  // %start only makes sense once the mode is set (%setgame, the vote, or
  // %genpos) — i.e. right after the Set Game button has done its job.
  const startBtn = game.modeChosen
    ? ` <span style="color:#888;margin:0 4px">|</span> ${btn("%start", "Start Game")}`
    : "";

  // While voting is open, the Set Game button ENDS the vote so the winning
  // mode is applied properly — a tie starts a runoff instead of being
  // silently cancelled by %setgame.
  let setBtn: string;
  if (game.voteOpen) {
    const tally = tallyVotes(game.votes);
    const tied = tieModes(tally);
    const leader =
      !tied && tally.length > 0 ? tally[0].mode.toUpperCase() : null;
    setBtn = btn(
      "%endvote",
      leader ? `End Vote: Set ${leader}` : "End Vote & Apply Winner",
    );
  } else {
    const targetMode = game.modeChosen ? game.mode : "FFA";
    setBtn = btn(`%setgame ${targetMode}`, `Set Game: ${targetMode}`);
  }

  // The Set FFA escape hatch (even mid-vote the host can force FFA) is the
  // only control tucked behind a small arrow — the main buttons (Set Game,
  // Level All, Start) stay visible without opening anything. %ffabtn hides
  // the arrow entirely for hosts who never run FFA.
  const ffaShortcut = game.hideFfaShortcut
    ? ""
    : `<details style="display:inline-block;vertical-align:middle"><summary style="cursor:pointer;user-select:none;display:inline-block;color:#888;font-size:10px;padding:1px 6px;margin:2px;border:1px solid #555;border-radius:3px;background:#222">▸ FFA</summary>
<div style="margin-top:4px">${btn("%setgame ffa", "Set FFA", "background:#433;")}</div>
</details>`;
  const ffaToggle = btn(
    "%ffabtn",
    game.hideFfaShortcut ? "Show FFA shortcut" : "Hide FFA shortcut",
    "font-size:10px;padding:1px 6px;color:#888;background:#222;",
  );

  return `<div style="margin-top:4px"><b>Setup</b><div style="margin-top:4px">
  ${setBtn}
  ${btn("%setlevel all, 10", "Level All \u2192 10")}
  ${startBtn}
  ${ffaShortcut}
  <span style="color:#888;font-size:10px">${ffaToggle}</span>
</div></div>`;
}
// -- Controls (Host) ----------------------------------------------------------

function buildControls(game: Game): string {
  return `<details style="margin-top:4px"><summary style="cursor:pointer;user-select:none"><b>Controls</b></summary>
<div style="margin-top:4px">
  ${btn("%next", "Next Turn")}
  ${btn("%back", "Undo")}
  <span style="color:#888;margin:0 4px">|</span>
  ${btn("%r 1d20", "d20")}
</div>
</details>`;
}

// -- Entity Stats (Player) ----------------------------------------------------

function buildEntityStats(entity: Entity): string {
  const hpPct = Math.max(0, (entity.curhp / entity.maxhp) * 100);
  const hpColor = hpPct > 50 ? "#0c0" : hpPct > 25 ? "#cc0" : "#c00";

  let html = `<div class="stat" style="margin:4px 0;padding:4px 8px;border:1px solid #888;background:rgba(120,120,225,0.10)">`;
  html += `<b>HP:</b> <b style="color:${hpColor}">${entity.curhp}/${entity.maxhp}</b>`;
  html += ` <b>ATK:</b> ${entity.atk}`;
  html += ` <b>MAG:</b> ${entity.mag}`;
  html += ` <b>PD:</b> ${entity.pd}`;
  html += ` <b>MD:</b> ${entity.md}`;
  html += ` <b>EVA:</b> ${entity.eva}`;
  html += ` <b>MP:</b> <b style="color:#08c">${entity.mp}</b>`;

  if (entity.statuses.length > 0 || entity.buffs.length > 0) {
    html += `<br>`;
    for (const s of entity.statuses) {
      const color = s.damage > 0 ? "#c00" : "#cc0";
      html += `<span style="display:inline-block;padding:1px 6px;margin:1px;border-radius:3px;background:${color};color:#fff;font-size:10px">${esc(s.name)} ${s.damage > 0 ? s.damage + "/" : ""}${s.rounds}r</span>`;
    }
    for (const b of entity.buffs) {
      const color = b.amount > 0 ? "#0c0" : "#c00";
      const sign = b.amount > 0 ? "+" : "";
      html += `<span style="display:inline-block;padding:1px 6px;margin:1px;border-radius:3px;background:${color};color:#fff;font-size:10px">${sign}${b.amount} ${esc(b.stat)} (${b.rounds}r)</span>`;
    }
  }

  html += "</div>";
  return html;
}

// -- Move Buttons (Player) ----------------------------------------------------

function buildMoveButtons(game: Game, entity: Entity): string {
  const reachable = getReachableTiles(game, entity.pos, entity.mp);
  const tiles: string[] = [];

  for (const [key] of reachable) {
    tiles.push(btn(`%move ${key},${entity.name}`, key));
  }

  if (tiles.length === 0) {
    return `<div style="margin:4px 0;color:#888"><i>No valid moves.</i></div>`;
  }
  return `<div style="margin:4px 0">${tiles.join(" ")}</div>`;
}

function buildDashButtons(game: Game, entity: Entity): string {
  if (entity.dashUsed) return "";

  // Dash spends MP to move up to x1.5 tiles (rounded down). Full action.
  const dashMp = Math.floor(getEffectiveMp(entity) * 1.5);
  const reachable = getReachableTiles(game, entity.pos, dashMp);
  const tiles: string[] = [];

  for (const [key] of reachable) {
    tiles.push(btn(`%dash ${key},${entity.name}`, key));
  }

  if (tiles.length === 0) {
    return `<div style="margin:4px 0;color:#888"><i>No dash targets.</i></div>`;
  }
  return `<div style="margin:2px 0;padding:3px 6px;border-left:2px solid #c60;background:rgba(204,102,0,0.08)"><span style="color:#c60;font-size:10px;font-weight:bold">DASH (1.5x MP, Full)</span><br>${tiles.join(" ")}</div>`;
}

// -- Pre-Move Ability Buttons (Player) ----------------------------------------

function buildPreMoveAbilities(game: Game, entity: Entity): string {
  const available = getPreMoveAbilities(game, entity);
  if (available.length === 0) {
    return `<div style="margin:4px 0;color:#888"><i>No pre-move abilities available.</i></div>`;
  }

  let html = `<div style="margin:4px 0">`;
  const groups: Record<string, AbilityData[]> = {};
  for (const ab of available) {
    const key = ab.actionType;
    if (!groups[key]) groups[key] = [];
    groups[key].push(ab);
  }

  const order = ["Trigger", "Reaction", "Swift", "Free"];
  for (const type of order) {
    const abs = groups[type];
    if (!abs || abs.length === 0) continue;

    const typeColor =
      type === "Swift"
        ? "#0c0"
        : type === "Trigger"
          ? "#cc0"
          : type === "Reaction"
            ? "#f60"
            : "#888";

    html += `<div style="margin:4px 0;padding:3px 6px;border-left:2px solid ${typeColor}">`;
    html += `<span style="color:${typeColor};font-size:10px;font-weight:bold">${type.toUpperCase()}</span><br>`;

    for (const ab of abs) {
      html += buildAbilityButton(game, entity, ab);
    }
    html += "</div>";
  }

  html += "</div>";
  return html;
}

// -- Ability Buttons (Player) -------------------------------------------------

function buildAbilityButtons(game: Game, entity: Entity): string {
  const available = getAvailableAbilities(game, entity);
  if (available.length === 0) {
    return `<div style="margin:4px 0;color:#888"><i>No abilities available.</i></div>`;
  }

  let html = `<div style="margin:4px 0">`;

  const groups: Record<string, AbilityData[]> = {};
  for (const ab of available) {
    const key = ab.actionType;
    if (!groups[key]) groups[key] = [];
    groups[key].push(ab);
  }

  const order = ["Full", "Standard", "Swift", "Free", "Movement"];
  for (const type of order) {
    const abs = groups[type];
    if (!abs || abs.length === 0) continue;

    const typeColor =
      type === "Standard"
        ? "#08c"
        : type === "Swift"
          ? "#0c0"
          : type === "Full"
            ? "#cc0"
            : type === "Free"
              ? "#888"
              : "#333";

    html += `<div style="margin:4px 0;padding:3px 6px;border-left:2px solid ${typeColor}">`;
    html += `<span style="color:${typeColor};font-size:10px;font-weight:bold">${type.toUpperCase()}</span><br>`;

    for (const ab of abs) {
      html += buildAbilityButton(game, entity, ab);
    }
    html += "</div>";
  }

  html += "</div>";
  return html;
}

function buildAbilityButton(
  game: Game,
  entity: Entity,
  ab: AbilityData,
): string {
  const maxUses = ab.maxUses ?? parseFrequency(ab.frequency).uses;
  const usesLeft = maxUses ? maxUses - (entity.usesUsed[ab.name] ?? 0) : null;
  const cooldown = entity.cooldowns[ab.name] ?? 0;

  const usesStr = usesLeft !== null ? ` [${usesLeft}/${maxUses}]` : "";
  const cdStr = cooldown > 0 ? ` CD:${cooldown}` : "";

  const targets = getValidTargets(game, ab, entity);
  const tiles =
    ab.targetGroup === "Tile" ? getValidTiles(game, ab, entity) : [];

  // Single target abilities: show ability + each target as separate buttons
  if (targets.length > 0 && ab.targetAmount !== "AoE") {
    return buildTargetButtons(ab, targets);
  }

  // AoE abilities
  if (ab.targetAmount === "AoE" || targets.length <= 1) {
    const label = `${ab.name}${usesStr}${cdStr}`;
    const cmd =
      targets.length === 1
        ? `%use ${ab.name} @ ${targets[0].num},${entity.name}`
        : `%use ${ab.name},${entity.name}`;
    return btn(cmd, label, "font-size:11px;padding:2px 6px");
  }

  // Tile targeting
  if (tiles.length > 0) {
    return buildTileButtons(ab, entity, tiles);
  }

  // Fallback
  return btn(
    `%use ${ab.name},${entity.name}`,
    `${ab.name}${usesStr}`,
    "font-size:11px;padding:2px 6px",
  );
}

/** One button per valid target for a single-target ability. */
function buildTargetButtons(ab: AbilityData, targets: Entity[]): string {
  let html = "";
  for (const t of targets) {
    html += btn(
      `%use ${ab.name} @ ${t.name}`,
      `${ab.name} -> ${t.num}`,
      "font-size:11px;padding:2px 6px",
    );
  }
  return html + "<br>";
}

/** One small button per valid tile for a Tile-targeting ability. */
function buildTileButtons(
  ab: AbilityData,
  entity: Entity,
  tiles: string[],
): string {
  let html = `<span style="color:#888;font-size:10px">${ab.name}:</span> `;
  for (const t of tiles) {
    html += btn(
      `%use ${ab.name} @ ${t},${entity.name}`,
      t,
      "font-size:10px;padding:1px 4px",
    );
  }
  return html + "<br>";
}

// -- Target Resolution Helpers ------------------------------------------------

/** Shared gate: the entity hasn't used up this ability's level/cooldown/uses. */
function abilityReadyFor(entity: Entity, ab: AbilityData): boolean {
  if (!entity.isJuggernaut && typeof ab.level === "string") return false;

  if (typeof ab.level === "number" && ab.level > 0) {
    if (ab.level > entity.classLevel && ab.level > entity.weaponLevel)
      return false;
  }

  if (entity.cooldowns[ab.name]) return false;

  const maxUses = ab.maxUses ?? parseFrequency(ab.frequency).uses;
  if (maxUses) {
    const used = entity.usesUsed[ab.name] ?? 0;
    if (used >= maxUses) return false;
  }
  return true;
}

function getAvailableAbilities(game: Game, entity: Entity): AbilityData[] {
  return entity.abilities.filter((ab) => {
    if (!abilityReadyFor(entity, ab)) return false;

    if (
      ab.actionType === "Passive" ||
      ab.actionType === "Reaction" ||
      ab.actionType === "Trigger"
    )
      return false;

    if (ab.actionType === "Standard" && entity.standardUsed) return false;
    if (ab.actionType === "Swift" && entity.swiftUsed) return false;
    // Issue #3: Free/Swift must be used before the Standard action.
    if (
      entity.standardUsed &&
      (ab.actionType === "Free" || ab.actionType === "Swift")
    )
      return false;
    if (ab.actionType === "Movement" && entity.movementUsed) return false;
    if (
      ab.actionType === "Full" &&
      (entity.standardUsed || entity.movementUsed)
    )
      return false;

    return true;
  });
}

/** Can be used before the Standard action: Free/Swift/Trigger/Movement, or a triggered Reaction. */
function isPreMoveAction(ab: AbilityData, entity: Entity): boolean {
  const type = ab.actionType;
  return (
    type === "Free" ||
    type === "Swift" ||
    type === "Trigger" ||
    type === "Movement" ||
    (type === "Reaction" && entity.triggered)
  );
}

function getPreMoveAbilities(game: Game, entity: Entity): AbilityData[] {
  return entity.abilities.filter((ab) => {
    if (!abilityReadyFor(entity, ab)) return false;
    if (!isPreMoveAction(ab, entity)) return false;
    if (ab.actionType === "Swift" && entity.swiftUsed) return false;
    return true;
  });
}

/** Whether `e` fits the ability's target group (Foe/Ally/Self/Any/…) from `user`. */
function matchesTargetGroup(
  ab: AbilityData,
  user: Entity,
  e: Entity,
): boolean {
  switch (ab.targetGroup) {
    case "Foe":
      if (user.team === 0) return e.num !== user.num;
      return e.team !== user.team;
    case "Ally":
      if (e.num === user.num) return false;
      if (user.team === 0) return false;
      return e.team === user.team;
    case "Self":
      return e.num === user.num;
    case "Any":
    case "Foe or Ally":
      return true;
    default:
      if (ab.targetGroup.includes("Ally") && !ab.targetGroup.includes("Foe")) {
        if (e.num === user.num) return true;
        if (user.team === 0) return false;
        return e.team === user.team;
      }
      return true;
  }
}

function getValidTargets(game: Game, ab: AbilityData, user: Entity): Entity[] {
  return game.entities.filter((e) => {
    if (
      e.num === user.num &&
      ab.targetGroup !== "Self" &&
      ab.targetGroup !== "Any"
    )
      return false;
    if (e.curhp <= 0) return false;
    if (!matchesTargetGroup(ab, user, e)) return false;

    if (ab.range !== "Global" && ab.range !== "Self") {
      if (!inRange(game, user.pos, e.pos, ab.range)) return false;
    }

    return true;
  });
}

function getValidTiles(game: Game, ab: AbilityData, user: Entity): string[] {
  const tiles: string[] = [];
  const rangeStr = ab.range.toLowerCase();
  const rangeMatch = rangeStr.match(/(?:homing|range)\s*(\d+)/);
  const range = rangeMatch ? parseInt(rangeMatch[1]) : 3;
  const needsLoS = rangeStr.startsWith("range");
  const cols = game.map[0]?.length ?? 0;

  for (let r = 0; r < game.map.length; r++) {
    for (let c = 0; c < cols; c++) {
      const d = dist(user.pos, [r, c]);
      if (d === 0) continue;
      if (d > range) continue;
      if (needsLoS && !hasLineOfSight(game, user.pos, [r, c])) continue;
      tiles.push(posToStr(r, c));
    }
  }
  return tiles;
}

function getCurrentTurnEntity(game: Game): Entity | null {
  const num = game.turnOrder[game.turnIndex];
  return game.entities.find((e) => e.num === num) ?? null;
}
