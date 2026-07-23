import {
  TERRAIN_COLORS,
  TERRAIN_NAMES,
  getReachableTiles,
  hasLineOfSight,
  inRange,
  dist,
  type Game,
  type Entity,
  type AbilityData,
} from "../game/state.js";
import { posToStr } from "../utils.js";

// ── Style Constants ──────────────────────────────────────────────────────────

const C = {
  bg: "#1a1a2e",
  bgLight: "#16213e",
  bgCard: "#0f3460",
  text: "#e0e0e0",
  textDim: "#8888aa",
  accent: "#00aaff",
  green: "#00cc00",
  yellow: "#cccc00",
  red: "#cc0000",
  gold: "#ffcc00",
  enemy: "#ff4444",
  ally: "#4488ff",
  self: "#44cc44",
  btnBg: "#2a2a4e",
  btnBorder: "#00aaff",
  border: "#333355",
  headerBg: "#0f3460",
};

const FONT = "font-family:'Courier New',monospace;font-size:11px";
const FONT_SM = "font-family:'Courier New',monospace;font-size:10px";
const FONT_XS = "font-family:'Courier New',monospace;font-size:9px";

function btn(value: string, label: string, extra = ""): string {
  return `<button name="send" value="${value}" style="padding:3px 8px;margin:2px;background:${C.btnBg};color:#fff;border:1px solid ${C.btnBorder};cursor:pointer;font-size:11px;font-family:'Courier New',monospace;${extra}">${label}</button>`;
}

function pill(text: string, bg: string): string {
  return `<span style="display:inline-block;padding:1px 6px;margin:1px;border-radius:3px;background:${bg};color:#fff;font-size:10px;font-family:'Courier New',monospace">${text}</span>`;
}

// ── Host Page ────────────────────────────────────────────────────────────────

export function buildHostPage(game: Game): string {
  const map = buildMap(game);
  const pl = buildPlayerList(game);
  const to = buildTurnOrder(game);
  const log = buildActionLog(game);
  const controls = buildControls(game);

  return `<div style="max-width:900px;${FONT};color:${C.text};background:${C.bg};padding:8px;border:1px solid ${C.border}">
  <div style="background:${C.headerBg};padding:6px 10px;border-radius:4px;margin-bottom:8px;border-left:3px solid ${C.accent}">
    <b style="color:${C.accent};font-size:13px">Game: ${esc(game.id)}</b>
    <span style="color:${C.textDim};margin:0 8px">|</span>
    <span style="color:${C.gold}">${esc(game.mode)}</span>
    <span style="color:${C.textDim};margin:0 8px">|</span>
    <span>Round <b style="color:${C.accent}">${game.round}</b></span>
    <span style="color:${C.textDim};margin:0 8px">|</span>
    <span style="color:${C.textDim}">Phase: ${game.phase}</span>
  </div>
  ${map}
  ${pl}
  ${to}
  ${log}
  ${controls}
</div>`;
}

// ── Player Page ──────────────────────────────────────────────────────────────

export function buildPlayerPage(game: Game, entity: Entity): string {
  const isTurn = game.turnOrder[game.turnIndex] === entity.num;
  const curEntity = isTurn ? entity : null;

  const map = buildMiniMap(game, entity);
  const stats = buildEntityStats(entity);
  const statusEffects = buildStatusEffects(entity);

  let phase = "";
  let actions = "";

  if (isTurn) {
    if (!entity.movementUsed) {
      phase = `<div style="background:${C.bgCard};padding:4px 8px;border-radius:3px;margin:6px 0;border-left:3px solid ${C.gold}"><b style="color:${C.gold}">MOVEMENT PHASE</b> <span style="color:${C.textDim}">Click a tile to move</span></div>`;
      actions = buildMoveButtons(game, entity);
      actions += buildDashButton(entity);
    } else {
      phase = `<div style="background:${C.bgCard};padding:4px 8px;border-radius:3px;margin:6px 0;border-left:3px solid ${C.accent}"><b style="color:${C.accent}">ACTION PHASE</b> <span style="color:${C.textDim}">Choose an ability</span></div>`;
      actions = buildAbilityButtons(game, entity);
    }
    actions += `<div style="margin-top:6px">${btn("%endturn", "End Turn", "border-color:#cc0000")}</div>`;
  } else {
    const cur = getCurrentTurnEntity(game);
    const curLabel = cur ? `${cur.num} (${cur.name})` : "...";
    phase = `<div style="background:${C.bgCard};padding:4px 8px;border-radius:3px;margin:6px 0;border-left:3px solid ${C.textDim}"><i style="color:${C.textDim}">Waiting for your turn...</i> <span style="color:${C.accent}">Current: ${esc(curLabel)}</span></div>`;
  }

  return `<div style="max-width:600px;${FONT};color:${C.text};background:${C.bg};padding:8px;border:1px solid ${C.border}">
  <div style="background:${C.headerBg};padding:6px 10px;border-radius:4px;margin-bottom:6px;border-left:3px solid ${C.self}">
    <b style="font-size:12px">${esc(entity.num)} ${esc(entity.name)}</b>
    <span style="color:${C.textDim};margin:0 6px">—</span>
    <span style="color:${C.accent}">${esc(entity.className)}</span>
    <span style="color:${C.textDim}">/</span>
    <span style="color:${C.accent}">${esc(entity.weaponName)}</span>
    <span style="color:${C.textDim};margin-left:4px">(Lv.${entity.classLevel}/${entity.weaponLevel})</span>
  </div>
  ${stats}
  ${statusEffects}
  ${map}
  ${phase}
  ${actions}
</div>`;
}

// ── Map (Host) ───────────────────────────────────────────────────────────────

function buildMap(game: Game): string {
  const rows = game.map.length;
  const cols = game.map[0]?.length ?? 0;
  const curNum = game.turnOrder[game.turnIndex];

  let html = `<div style="margin:6px 0"><b style="color:${C.accent}">Map</b></div>`;
  html += `<table style="border-collapse:collapse">`;

  // Column headers
  html += `<tr><td style="width:18px;height:14px"></td>`;
  for (let c = 0; c < cols; c++) {
    html += `<td style="width:22px;height:14px;text-align:center;${FONT_XS};color:${C.textDim}">${String.fromCharCode(97 + c)}</td>`;
  }
  html += "</tr>";

  for (let r = 0; r < rows; r++) {
    html += `<tr><td style="width:18px;text-align:center;${FONT_XS};color:${C.textDim}">${r + 1}</td>`;
    for (let c = 0; c < cols; c++) {
      const terrain = game.map[r][c];
      const color = TERRAIN_COLORS[terrain] ?? "#ffffff";
      const entity = game.entities.find(
        (e) => e.pos[0] === r && e.pos[1] === c,
      );
      const isCur = entity?.num === curNum;
      const label = entity ? entity.num : "";
      const bg = entity ? (isCur ? C.gold : "#ff6600") : color;
      const border = isCur ? `2px solid ${C.gold}` : `1px solid ${C.border}`;
      const textColor = entity ? "#000" : "#000";
      html += `<td style="width:22px;height:22px;background:${bg};border:${border};text-align:center;${FONT_XS};font-weight:bold;color:${textColor}" title="${TERRAIN_NAMES[terrain] ?? "Normal"}">${label}</td>`;
    }
    html += "</tr>";
  }
  html += "</table>";
  return html;
}

// ── Mini Map (Player) ────────────────────────────────────────────────────────

function buildMiniMap(game: Game, self: Entity): string {
  const rows = game.map.length;
  const cols = game.map[0]?.length ?? 0;

  let html = `<div style="margin:6px 0"><b style="color:${C.accent}">Map</b></div>`;
  html += `<table style="border-collapse:collapse">`;

  // Column headers
  html += `<tr><td style="width:14px;height:12px"></td>`;
  for (let c = 0; c < cols; c++) {
    html += `<td style="width:18px;height:12px;text-align:center;font-size:8px;color:${C.textDim}">${String.fromCharCode(97 + c)}</td>`;
  }
  html += "</tr>";

  for (let r = 0; r < rows; r++) {
    html += `<tr><td style="width:14px;text-align:center;font-size:8px;color:${C.textDim}">${r + 1}</td>`;
    for (let c = 0; c < cols; c++) {
      const terrain = game.map[r][c];
      const color = TERRAIN_COLORS[terrain] ?? "#ffffff";
      const entity = game.entities.find(
        (e) => e.pos[0] === r && e.pos[1] === c,
      );
      const isSelf = entity?.num === self.num;
      const isAlly =
        entity && !isSelf && entity.team === self.team && self.team !== 0;
      const isEnemy = entity && !isSelf && !isAlly;
      const label = entity ? entity.num : "";

      let bg = color;
      if (isSelf) bg = C.self;
      else if (isAlly) bg = C.ally;
      else if (isEnemy) bg = C.enemy;
      else if (entity) bg = "#ff6600";

      html += `<td style="width:18px;height:18px;background:${bg};border:1px solid ${C.border};text-align:center;font-size:8px;font-weight:bold;color:#000" title="${entity ? entity.name : (TERRAIN_NAMES[terrain] ?? "Normal")}">${label}</td>`;
    }
    html += "</tr>";
  }
  html += "</table>";
  return html;
}

// ── Player List (Host) ───────────────────────────────────────────────────────

function buildPlayerList(game: Game): string {
  const curNum = game.turnOrder[game.turnIndex];

  let html = `<div style="margin:6px 0"><b style="color:${C.accent}">Players</b></div>`;
  html += `<table style="border-collapse:collapse;width:100%;${FONT_SM}">`;

  // Header
  html += `<tr style="background:${C.headerBg}">`;
  for (const h of [
    "#",
    "Name",
    "Class/Weapon",
    "HP",
    "ATK",
    "MAG",
    "PD",
    "MD",
    "EVA",
    "MP",
    "Pos",
  ]) {
    html += `<th style="padding:3px 6px;text-align:left;border-bottom:1px solid ${C.border};color:${C.accent};font-size:10px">${h}</th>`;
  }
  html += "</tr>";

  for (const e of game.entities) {
    const isCur = e.num === curNum;
    const hpPct = Math.max(0, (e.curhp / e.maxhp) * 100);
    const hpColor = hpPct > 50 ? C.green : hpPct > 25 ? C.yellow : C.red;
    const rowBg = isCur ? C.bgCard : "transparent";
    const rowStyle = isCur ? `background:${rowBg}` : "";

    html += `<tr style="${rowStyle}">`;
    html += `<td style="padding:2px 6px;border-bottom:1px solid ${C.border};${isCur ? `color:${C.gold};font-weight:bold` : ""}">${e.num}</td>`;
    html += `<td style="padding:2px 6px;border-bottom:1px solid ${C.border}">${esc(e.name)}</td>`;
    html += `<td style="padding:2px 6px;border-bottom:1px solid ${C.border};color:${C.textDim}">${esc(e.className)}/${esc(e.weaponName)} (${e.classLevel}/${e.weaponLevel})</td>`;
    html += `<td style="padding:2px 6px;border-bottom:1px solid ${C.border};color:${hpColor};font-weight:bold">${e.curhp}/${e.maxhp}</td>`;
    html += `<td style="padding:2px 6px;border-bottom:1px solid ${C.border}">${e.atk}</td>`;
    html += `<td style="padding:2px 6px;border-bottom:1px solid ${C.border}">${e.mag}</td>`;
    html += `<td style="padding:2px 6px;border-bottom:1px solid ${C.border}">${e.pd}</td>`;
    html += `<td style="padding:2px 6px;border-bottom:1px solid ${C.border}">${e.md}</td>`;
    html += `<td style="padding:2px 6px;border-bottom:1px solid ${C.border}">${e.eva}</td>`;
    html += `<td style="padding:2px 6px;border-bottom:1px solid ${C.border}">${e.mp}</td>`;
    html += `<td style="padding:2px 6px;border-bottom:1px solid ${C.border};color:${C.accent}">${posToStr(e.pos[0], e.pos[1])}</td>`;
    html += "</tr>";
  }
  html += "</table>";
  return html;
}

// ── Turn Order ───────────────────────────────────────────────────────────────

function buildTurnOrder(game: Game): string {
  let html = `<div style="margin:6px 0"><b style="color:${C.accent}">Turn Order:</b> `;

  const parts: string[] = [];
  for (let i = 0; i < game.turnOrder.length; i++) {
    const entity = game.entities.find((e) => e.num === game.turnOrder[i]);
    if (!entity) continue;
    if (i === game.turnIndex) {
      parts.push(
        `<span style="color:${C.gold};font-weight:bold">${entity.num}</span>`,
      );
    } else {
      parts.push(`<span style="color:${C.textDim}">${entity.num}</span>`);
    }
  }
  html += parts.join(` <span style="color:${C.textDim}">→</span> `);
  html += "</div>";
  return html;
}

// ── Action Log ───────────────────────────────────────────────────────────────

function buildActionLog(game: Game): string {
  if (game.log.length === 0) {
    return `<div style="margin:6px 0"><b style="color:${C.accent}">Action Log:</b> <span style="color:${C.textDim}">(empty)</span></div>`;
  }
  const recent = game.log.slice(-12);
  let html = `<div style="margin:6px 0;max-height:160px;overflow-y:auto;border:1px solid ${C.border};border-radius:3px;padding:4px;background:${C.bgLight}">`;
  html += `<b style="color:${C.accent}">Action Log</b><br>`;
  for (const entry of recent) {
    html += `<div style="margin:2px 0;padding:2px 0;border-bottom:1px solid ${C.border}"><span style="color:${C.textDim}">[${entry.turn}]</span> ${esc(entry.description)}</div>`;
  }
  html += "</div>";
  return html;
}

// ── Controls (Host) ──────────────────────────────────────────────────────────

function buildControls(game: Game): string {
  return `<div style="margin:8px 0;padding:6px;background:${C.bgCard};border-radius:4px;border:1px solid ${C.border}">
  <b style="color:${C.accent}">Controls</b><br>
  <div style="margin-top:4px">
    ${btn("%next", "Next ▶", `border-color:${C.green}`)}
    ${btn("%back", "◀ Back", `border-color:${C.yellow}`)}
    <span style="color:${C.textDim};margin:0 4px">|</span>
    ${btn("%r 1d20", "Roll 1d20")}
    ${btn("%r 2d8+5", "Roll 2d8+5")}
    ${btn("%r 1d10+2", "Roll 1d10+2")}
    ${btn("%r 2d6+0", "Roll 2d6")}
  </div>
</div>`;
}

// ── Entity Stats (Player) ────────────────────────────────────────────────────

function buildEntityStats(entity: Entity): string {
  const hpPct = Math.max(0, (entity.curhp / entity.maxhp) * 100);
  const hpColor = hpPct > 50 ? C.green : hpPct > 25 ? C.yellow : C.red;
  const hpBar = hpPct > 50 ? C.green : hpPct > 25 ? C.yellow : C.red;

  return `<div style="margin:4px 0;padding:6px;background:${C.bgLight};border:1px solid ${C.border};border-radius:3px">
  <div style="margin-bottom:4px">
    <b>HP:</b>
    <span style="color:${hpColor};font-weight:bold">${entity.curhp}/${entity.maxhp}</span>
    <span style="display:inline-block;width:80px;height:6px;background:#333;border-radius:3px;vertical-align:middle;margin:0 4px">
      <span style="display:block;width:${hpPct}%;height:100%;background:${hpBar};border-radius:3px"></span>
    </span>
  </div>
  <div style="color:${C.textDim}">
    ATK: <b style="color:${C.text}">${entity.atk}</b>
    MAG: <b style="color:${C.text}">${entity.mag}</b>
    PD: <b style="color:${C.text}">${entity.pd}</b>
    MD: <b style="color:${C.text}">${entity.md}</b>
    EVA: <b style="color:${C.text}">${entity.eva}</b>
    MP: <b style="color:${C.accent}">${entity.mp}</b>
  </div>
</div>`;
}

// ── Status Effects (Player) ──────────────────────────────────────────────────

function buildStatusEffects(entity: Entity): string {
  const parts: string[] = [];

  for (const s of entity.statuses) {
    const isDmg = s.damage > 0;
    const color = isDmg ? C.red : C.yellow;
    parts.push(
      pill(
        `${s.name} ${s.damage > 0 ? s.damage + "/" : ""}${s.rounds}r`,
        color,
      ),
    );
  }

  for (const b of entity.buffs) {
    const color = b.amount > 0 ? C.green : C.enemy;
    const sign = b.amount > 0 ? "+" : "";
    parts.push(pill(`${sign}${b.amount} ${b.stat} (${b.rounds}r)`, color));
  }

  if (parts.length === 0) return "";
  return `<div style="margin:4px 0">${parts.join(" ")}</div>`;
}

// ── Move Buttons (Player) ────────────────────────────────────────────────────

function buildMoveButtons(game: Game, entity: Entity): string {
  const reachable = getReachableTiles(game, entity.pos, entity.mp);
  const tiles: string[] = [];

  for (const [key] of reachable) {
    tiles.push(btn(`%move ${key}`, key));
  }

  if (tiles.length === 0) {
    return `<div style="margin:4px 0;color:${C.textDim}"><i>No valid moves.</i></div>`;
  }
  return `<div style="margin:4px 0">${tiles.join(" ")}</div>`;
}

function buildDashButton(entity: Entity): string {
  if (entity.dashUsed) return "";
  return `<div style="margin:2px 0">${btn("%dash", "Dash (1.5x MP)", `border-color:${C.yellow}`)}</div>`;
}

// ── Ability Buttons (Player) ─────────────────────────────────────────────────

function buildAbilityButtons(game: Game, entity: Entity): string {
  const available = getAvailableAbilities(game, entity);
  if (available.length === 0) {
    return `<div style="margin:4px 0;color:${C.textDim}"><i>No abilities available.</i></div>`;
  }

  let html = `<div style="margin:4px 0">`;

  // Group by action type
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
        ? C.accent
        : type === "Swift"
          ? C.green
          : type === "Full"
            ? C.yellow
            : type === "Free"
              ? C.textDim
              : C.text;

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
  const usesLeft = ab.maxUses
    ? ab.maxUses - (entity.usesUsed[ab.name] ?? 0)
    : null;
  const cooldown = entity.cooldowns[ab.name] ?? 0;

  const usesStr = usesLeft !== null ? ` [${usesLeft}/${ab.maxUses}]` : "";
  const cdStr = cooldown > 0 ? ` CD:${cooldown}` : "";

  const targets = getValidTargets(game, ab, entity);
  const tiles =
    ab.targetGroup === "Tile" ? getValidTiles(game, ab, entity) : [];

  // Single target abilities: show ability + each target as separate buttons
  if (targets.length > 0 && ab.targetAmount !== "AoE") {
    let html = "";
    for (const t of targets) {
      const label = `${ab.name} → ${t.num}`;
      const cmd = `%attack ${ab.name} @ ${t.num}`;
      html += btn(cmd, label, `font-size:10px;padding:2px 6px`);
    }
    // Also add a "no target" button for self-targeting or AoE
    html += `<br>`;
    return html;
  }

  // AoE abilities: single button (no target needed, or targets all in range)
  if (ab.targetAmount === "AoE" || targets.length <= 1) {
    const label = `${ab.name}${usesStr}${cdStr}`;
    const cmd =
      targets.length === 1
        ? `%attack ${ab.name} @ ${targets[0].num}`
        : `%attack ${ab.name}`;
    return btn(cmd, label, `font-size:10px;padding:2px 6px`);
  }

  // Tile targeting
  if (tiles.length > 0) {
    let html = `<span style="color:${C.textDim};font-size:10px">${ab.name}:</span> `;
    for (const t of tiles) {
      html += btn(
        `%attack ${ab.name} @ ${t}`,
        t,
        `font-size:9px;padding:1px 4px`,
      );
    }
    html += "<br>";
    return html;
  }

  // Fallback: just the ability name
  return btn(
    `%attack ${ab.name}`,
    `${ab.name}${usesStr}`,
    `font-size:10px;padding:2px 6px`,
  );
}

// ── Target Resolution Helpers ────────────────────────────────────────────────

function getAvailableAbilities(game: Game, entity: Entity): AbilityData[] {
  return entity.abilities.filter((ab) => {
    // Skip passive, reaction, trigger
    if (
      ab.actionType === "Passive" ||
      ab.actionType === "Reaction" ||
      ab.actionType === "Trigger"
    )
      return false;

    // Level requirement: basic abilities (level 0) always available;
    // higher-level abilities need matching classLevel or weaponLevel
    if (ab.level > 0) {
      if (ab.level > entity.classLevel && ab.level > entity.weaponLevel)
        return false;
    }

    // Cooldown check
    if (entity.cooldowns[ab.name]) return false;

    // Uses check
    if (ab.maxUses) {
      const used = entity.usesUsed[ab.name] ?? 0;
      if (used >= ab.maxUses) return false;
    }

    // Action type restrictions
    if (ab.actionType === "Standard" && entity.standardUsed) return false;
    if (ab.actionType === "Movement" && entity.movementUsed) return false;
    if (
      ab.actionType === "Full" &&
      (entity.standardUsed || entity.movementUsed)
    )
      return false;

    return true;
  });
}

function getValidTargets(
  game: Game,
  ab: AbilityData,
  caster: Entity,
): Entity[] {
  return game.entities.filter((e) => {
    if (
      e.num === caster.num &&
      ab.targetGroup !== "Self" &&
      ab.targetGroup !== "Any"
    )
      return false;
    if (e.curhp <= 0) return false;

    // Group filter
    switch (ab.targetGroup) {
      case "Foe":
        if (caster.team === 0) {
          // FFA: everyone else is a foe
          if (e.num === caster.num) return false;
        } else {
          if (e.team === caster.team) return false;
        }
        break;
      case "Ally":
        if (e.num === caster.num) return false;
        if (caster.team === 0) return false;
        if (e.team !== caster.team) return false;
        break;
      case "Self":
        if (e.num !== caster.num) return false;
        break;
      case "Any":
        break;
      case "Foe or Ally":
        // Can target anyone
        break;
      default:
        // "Self or Ally", "Self or Foe", etc.
        if (
          ab.targetGroup.includes("Ally") &&
          !ab.targetGroup.includes("Foe")
        ) {
          if (e.num === caster.num) return true; // self is ok
          if (caster.team === 0) return false;
          if (e.team !== caster.team) return false;
        }
        break;
    }

    // Range check
    if (ab.range !== "Global" && ab.range !== "Self") {
      if (!inRange(game, caster.pos, e.pos, ab.range)) return false;
    }

    return true;
  });
}

function getValidTiles(game: Game, ab: AbilityData, caster: Entity): string[] {
  const tiles: string[] = [];
  const rangeStr = ab.range.toLowerCase();
  const rangeMatch = rangeStr.match(/(?:homing|range)\s*(\d+)/);
  const range = rangeMatch ? parseInt(rangeMatch[1]) : 3;
  const needsLoS = rangeStr.startsWith("range");

  for (let r = 0; r < game.map.length; r++) {
    for (let c = 0; c < game.map[0].length; c++) {
      const d = dist(caster.pos, [r, c]);
      if (d === 0) continue;
      if (d > range) continue;
      if (needsLoS && !hasLineOfSight(game, caster.pos, [r, c])) continue;
      tiles.push(posToStr(r, c));
    }
  }
  return tiles;
}

function getCurrentTurnEntity(game: Game): Entity | null {
  const num = game.turnOrder[game.turnIndex];
  return game.entities.find((e) => e.num === num) ?? null;
}

// ── Utility ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
