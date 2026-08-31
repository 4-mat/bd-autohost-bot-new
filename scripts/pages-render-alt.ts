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

// -- Premove Mode Tracking -----------------------------------------------------

export const premoveSet = new Set<string>();

// -- Movement Path / Reach Preview Tracking ------------------------------------
// Both keyed by entity.num. Server-side state, same pattern as premoveSet --
// it survives across page re-renders since this module stays loaded.

// The path a player is building this movement phase, as an ordered list of
// tiles clicked so far (not including their starting position).
export const pathState = new Map<string, Array<[number, number]>>();

// viewer entity.num -> the entity.num whose reachable tiles they're
// currently previewing in red (set by clicking another character on the map).
export const reachPreview = new Map<string, string>();

export function clearMovementState(entityNum: string) {
  pathState.delete(entityNum);
  reachPreview.delete(entityNum);
}

// -- BD / PS Style Constants --------------------------------------------------

const CELL_SIZE = 34; // was 22 -- bumped up per request

const TILE = `width:${CELL_SIZE}px;height:${CELL_SIZE}px;padding:0;text-align:center;vertical-align:middle`;

const HEADER_CELL = `width:${CELL_SIZE}px;min-width:${CELL_SIZE}px;padding:0;text-align:center;vertical-align:middle`;

const MAP_CELL = `width:${CELL_SIZE}px;height:${CELL_SIZE}px;padding:0;text-align:center;vertical-align:middle`;

const TABLE_STYLE =
  "border-spacing:0px;border-collapse:collapse;border:1px solid #888;background:rgba(120,120,225,0.10)";

const TABLE_BORDER = `style="${TABLE_STYLE}"`;

const PLAYER_LABEL =
  "font-size:12px;font-weight:bold;color:black;text-shadow:-1px -1px 0 #BBB,1px -1px 0 #BBB,-1px 1px 0 #BBB,1px 1px 0 #BBB";

// Overlay colors for the interactive map
const OVERLAY_REACHABLE = "rgba(110,190,255,0.55)"; // light blue: in range, unpressed
const OVERLAY_PATH = "rgba(20,70,190,0.80)"; // darker blue: already pressed into the path
const OVERLAY_ENEMY_REACH = "rgba(230,60,60,0.45)"; // red: another character's reach preview

// -- Helpers ------------------------------------------------------------------

function btn(value: string, label: string, extra = ""): string {
  return `<button 
name="send" 
value="${esc(value)}"
style="padding:2px 8px;margin:2px;background:#333;color:white;border:1px solid #888;cursor:pointer;font-size:12px;font-family:Verdana,sans-serif;${extra}">
${esc(label)}
</button>`;
}

// A button meant to fill an entire map cell edge-to-edge (movement tiles,
// clickable entity portraits) rather than sit inline like a normal control.
function cellBtn(value: string, label: string, extra = ""): string {
  return `<button
name="send"
value="${esc(value)}"
style="width:100%;height:100%;padding:0;margin:0;border:none;background:transparent;cursor:pointer;${extra}">
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

// Returns a stable string key for a [row, col] tile, matching the format
// that getReachableTiles uses for its map keys (posToStr: "a,1" style).
// Defensive against bad inputs so a stray non-tuple never crashes a render.
function posKey(pos: [number, number]): string {
  if (!Array.isArray(pos) || pos.length < 2) return "";
  return posToStr(pos[0], pos[1]);
}

// -- Host Page ----------------------------------------------------------------

export function buildHostPage(game: Game): string {
  const map = buildMap(game);
  const pl = buildPlayerDataTable(game);
  const log = buildActionLog(game);
  const controls = buildControls(game);

  return `<div style="margin:35px;font-size:12px;font-family:Verdana,sans-serif">
  <b>Game: ${esc(game.id)}</b> -- ${esc(game.mode)} -- Round <b>${game.round}</b> -- Phase: ${esc(game.phase)}
  <hr>
  ${map}
  <hr>
  ${pl}
  <hr>
  ${log}
  <hr>
  ${controls}
</div>`;
}

// -- Player Page --------------------------------------------------------------

export function buildPlayerPage(game: Game, entity: Entity): string {
  const isTurn = game.turnOrder[game.turnIndex] === entity.num;

  let phase = "";
  let actions = "";
  let interactive = false;

  if (isTurn) {
    const inPremove = premoveSet.has(entity.num);

    if (!entity.movementUsed && inPremove) {
      phase = `<div style="margin:6px 0;padding:4px 8px;border-left:3px solid #00cc00;background:rgba(0,204,0,0.10)"><b style="color:#00cc00">PRE-MOVE ABILITIES</b> <span style="color:#888">Free / Swift / Trigger before movement</span></div>`;
      actions = buildPreMoveAbilities(game, entity);
      actions += `<div style="margin-top:6px">${btn("%premove", "Back to Movement")}</div>`;
    } else if (!entity.movementUsed) {
      phase = `<div style="margin:6px 0;padding:4px 8px;border-left:3px solid #cc0;background:rgba(204,204,0,0.10)"><b style="color:#cc0">MOVEMENT PHASE</b> <span style="color:#888">Click a tile to move, or click a character to preview their reach</span></div>`;
      interactive = true;
      actions = buildMovementControls(game, entity);
      actions += buildDashButton(entity);
      actions += `<div style="margin-top:4px">${btn("%premove", "Abilities Before Move")}</div>`;
    } else {
      phase = `<div style="margin:6px 0;padding:4px 8px;border-left:3px solid #08c;background:rgba(0,136,204,0.10)"><b style="color:#08c">ACTION PHASE</b> <span style="color:#888">Choose an ability</span></div>`;
      actions = buildAbilityButtons(game, entity);
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

  const stats = buildEntityStats(entity);
  const map = buildMiniMap(game, entity, interactive);

  return `<div style="margin:35px;font-size:12px;font-family:Verdana,sans-serif">
  <b>${esc(entity.num)} ${esc(entity.name)}</b> -- ${esc(entity.className)}/${esc(entity.weaponName)} (${entity.classLevel}/${entity.weaponLevel})
  <hr>
  ${stats}
  ${map}
  <hr>
  ${phase}
  ${actions}
</div>`;
}

// -- Map (Host + Player shared logic) -----------------------------------------

function buildMap(game: Game): string {
  return buildMapTable(game, null, false);
}

function buildMiniMap(game: Game, self: Entity, interactive: boolean): string {
  return buildMapTable(game, self, interactive);
}

function buildMapTable(
  game: Game,
  self: Entity | null,
  interactive: boolean,
): string {
  const rows = game.map.length;
  const cols = game.map[0]?.length ?? 0;
  const curNum = game.turnOrder[game.turnIndex];

  // -- Compute reachable/path/preview tile sets for self, if interactive --
  const reachableSet = new Set<string>();
  const pathSet = new Set<string>();
  const previewSet = new Set<string>();

  if (interactive && self) {
    const path = pathState.get(self.num) ?? [];
    for (const p of path) pathSet.add(posKey(p));

    const remainingMp = self.mp - path.length;
    if (remainingMp > 0) {
      const tip = path.length > 0 ? path[path.length - 1] : self.pos;
      // getReachableTiles returns Map<string, number> where the KEYS are
      // posToStr-formatted tiles (e.g. "a,1") and the values are movement
      // costs. We only need the tiles themselves, so iterate the keys
      // directly -- the previous version's `for (const [, pos] of map)`
      // wrongly treated the cost (a number) as a position, then handed it to
      // posKey which destructured it -- producing "number is not iterable".
      const reachable = getReachableTiles(game, tip, remainingMp);
      for (const key of reachable.keys()) {
        reachableSet.add(key);
      }
    }

    const previewNum = reachPreview.get(self.num);
    if (previewNum) {
      const target = game.entities.find((e) => e.num === previewNum);
      if (target) {
        const reach = getReachableTiles(game, target.pos, target.mp);
        for (const key of reach.keys()) {
          previewSet.add(key);
        }
      }
    }
  }

  let html = `<b>Map</b>`;
  html += `<div style="overflow-x:auto">`;
  html += `<table align="center" ${TABLE_BORDER}>`;

  html += `<tr><td style="${HEADER_CELL}"></td>`;
  for (let c = 0; c < cols; c++) {
    html += `<td style="${HEADER_CELL}"><b>${c + 1}</b></td>`;
  }
  html += "</tr>";

  for (let r = 0; r < rows; r++) {
    html += `<tr>`;
    html += `<td style="${HEADER_CELL}"><b>${String.fromCharCode(65 + r)}</b></td>`;

    for (let c = 0; c < cols; c++) {
      const terrain = game.map[r][c];
      // Unknown terrain falls back to Normal's color from the shared palette.
      const color = TERRAIN_COLORS[terrain] ?? TERRAIN_COLORS[0];
      const entity = game.entities.find(
        (e) => e.pos[0] === r && e.pos[1] === c,
      );
      const key = posKey([r, c]);
      const tileStr = posToStr(r, c);

      let title = TERRAIN_NAMES[terrain] ?? "Normal";
      let outline = "";
      let isCur = false;

      if (entity) {
        title = entity.name;
        isCur = entity.num === curNum;
      }

      if (self && entity) {
        const isSelf = entity.num === self.num;
        const isAlly = !isSelf && entity.team === self.team && self.team !== 0;
        if (isSelf) outline = "outline:2px solid #0a0;";
        else if (isAlly) outline = "outline:2px solid #08c;";
      } else if (isCur && entity) {
        outline = "outline:2px solid #cc0;";
      }

      // Overlay priority: path (darkest) > reachable > enemy reach preview.
      // Occupied tiles never get the movement overlay -- you can't move onto
      // a tile that's occupied, so only the reach-preview overlay (for
      // clicking a character) can show there.
      let overlay = "";
      if (!entity && pathSet.has(key)) overlay = OVERLAY_PATH;
      else if (!entity && reachableSet.has(key)) overlay = OVERLAY_REACHABLE;
      else if (previewSet.has(key)) overlay = OVERLAY_ENEMY_REACH;

      const overlayDiv = overlay
        ? `<div style="position:absolute;inset:0;background:${overlay};pointer-events:none"></div>`
        : "";

      let inner: string;
      if (entity) {
        if (interactive && self && entity.num !== self.num) {
          // Clicking another character previews their reach in red.
          inner = cellBtn(
            `%viewreach ${entity.num},${self.name}`,
            entity.num,
            `${PLAYER_LABEL};position:relative;z-index:1`,
          );
        } else {
          inner = `<b style="${PLAYER_LABEL};position:relative;z-index:1">${entity.num}</b>`;
        }
      } else if (interactive && self && reachableSet.has(key)) {
        // Empty, in range, not yet pressed into the path -- clickable.
        inner = cellBtn(`%pathstep ${tileStr},${self.name}`, "", "z-index:1");
      } else {
        inner = "";
      }

      html += `<td style="position:relative;background:${color};${outline}${MAP_CELL}" title="${esc(title)}">${overlayDiv}${inner}</td>`;
    }
    html += "</tr>";
  }

  html += "</table></div>";
  return html;
}

// -- Movement Controls (Player, movement phase) --------------------------------

function buildMovementControls(game: Game, entity: Entity): string {
  const path = pathState.get(entity.num) ?? [];

  if (path.length === 0) {
    return `<div style="margin:4px 0;color:#888"><i>Click a highlighted tile to start moving.</i></div>`;
  }

  const remaining = entity.mp - path.length;
  let html = `<div style="margin:4px 0">Path: ${path.length} tile${path.length > 1 ? "s" : ""} (${remaining} MP left)</div>`;
  html += `<div style="margin-top:4px">${btn(`%confirmmove ${entity.name}`, "Confirm Move")} ${btn(`%cancelpath ${entity.name}`, "Cancel Path")}</div>`;
  return html;
}

function buildDashButton(entity: Entity): string {
  if (entity.dashUsed) return "";
  return `<div style="margin:2px 0">${btn(`%dash ${entity.name}`, "Dash (1.5x MP)")}</div>`;
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

  html += `<tr style="height:22px">`;

  const headers = [
    "#",
    "Name",
    "Class/Weapon",
    "HP",
    "A",
    "M",
    "PD",
    "MD",
    "EVA",
    "MP",
  ];

  for (const h of headers) {
    html += `<th style="padding:0px 8px">${h}</th>`;
  }

  html += `</tr>`;

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

    html += `<th style="padding:0px 8px">${esc(e.name)}</th>`;

    html += `
<th style="padding:0px 8px">
${esc(e.className)}(${e.classLevel})/${esc(e.weaponName)}(${e.weaponLevel})
</th>
`;

    html += `<th style="padding:0px 8px">${e.curhp}/${e.maxhp}</th>`;
    html += `<th style="padding:0px 8px">${e.atk}</th>`;
    html += `<th style="padding:0px 8px">${e.mag}</th>`;
    html += `<th style="padding:0px 8px">${e.pd}</th>`;
    html += `<th style="padding:0px 8px">${e.md}</th>`;
    html += `<th style="padding:0px 8px">${e.eva}</th>`;
    html += `<th style="padding:0px 8px">${e.mp}</th>`;

    html += `</tr>`;
  }

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

function buildActionLog(game: Game): string {
  let html = `<b>Action Log</b>`;
  if (game.log.length === 0) {
    html += `<div style="color:#888"><i>(empty)</i></div>`;
    return html;
  }

  const recent = game.log.slice(-15);
  html += `<table align="center" ${TABLE_BORDER} cellpadding="3" style="max-width:600px">`;
  for (const entry of recent) {
    html += `<tr style="height:22px"><td style="padding:2px 8px"><b>[R${entry.turn}]</b> ${esc(entry.description)}</td></tr>`;
  }
  html += "</table>";
  return html;
}

// -- Controls (Host) ----------------------------------------------------------

function buildControls(game: Game): string {
  return `<b>Controls</b><br>
<div style="margin-top:4px">
  ${btn("%next", "Next Turn")}
  ${btn("%back", "Undo")}
  <span style="color:#888;margin:0 4px">|</span>
  ${btn("%r 1d20", "1d20")}
  ${btn("%r 2d8+5", "2d8+5")}
  ${btn("%r 1d10+2", "1d10+2")}
  ${btn("%r 2d6+0", "2d6")}
</div>`;
}

// -- Entity Stats (Player) ----------------------------------------------------

function buildEntityStats(entity: Entity): string {
  const hpPct = Math.max(0, (entity.curhp / entity.maxhp) * 100);
  const hpColor = hpPct > 50 ? "#0c0" : hpPct > 25 ? "#cc0" : "#c00";

  let html = `<div style="margin:4px 0;padding:4px 8px;border:1px solid #888;background:rgba(120,120,225,0.10)">`;
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

  const order = ["Trigger", "Swift", "Free"];
  for (const type of order) {
    const abs = groups[type];
    if (!abs || abs.length === 0) continue;

    const typeColor =
      type === "Swift" ? "#0c0" : type === "Trigger" ? "#cc0" : "#888";

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
  const usesLeft = ab.maxUses
    ? ab.maxUses - (entity.usesUsed[ab.name] ?? 0)
    : null;
  const cooldown = entity.cooldowns[ab.name] ?? 0;

  const usesStr = usesLeft !== null ? ` [${usesLeft}/${ab.maxUses}]` : "";
  const cdStr = cooldown > 0 ? ` CD:${cooldown}` : "";

  const targets = getValidTargets(game, ab, entity);
  const tiles =
    ab.targetGroup === "Tile" ? getValidTiles(game, ab, entity) : [];

  if (targets.length > 0 && ab.targetAmount !== "AoE") {
    let html = "";
    for (const t of targets) {
      const label = `${ab.name} -> ${t.num}`;
      const cmd = `%use ${ab.name} @ ${t.name}`;
      html += btn(cmd, label, "font-size:11px;padding:2px 6px");
    }
    html += `<br>`;
    return html;
  }

  if (ab.targetAmount === "AoE" || targets.length <= 1) {
    const label = `${ab.name}${usesStr}${cdStr}`;
    const cmd =
      targets.length === 1
        ? `%use ${ab.name} @ ${targets[0].num},${entity.name}`
        : `%use ${ab.name},${entity.name}`;
    return btn(cmd, label, "font-size:11px;padding:2px 6px");
  }

  if (tiles.length > 0) {
    let html = `<span style="color:#888;font-size:10px">${ab.name}:</span> `;
    for (const t of tiles) {
      html += btn(
        `%use ${ab.name} @ ${t},${entity.name}`,
        t,
        "font-size:10px;padding:1px 4px",
      );
    }
    html += "<br>";
    return html;
  }

  return btn(
    `%use ${ab.name},${entity.name}`,
    `${ab.name}${usesStr}`,
    "font-size:11px;padding:2px 6px",
  );
}

// -- Target Resolution Helpers ------------------------------------------------

function getAvailableAbilities(game: Game, entity: Entity): AbilityData[] {
  return entity.abilities.filter((ab) => {
    if (
      ab.actionType === "Passive" ||
      ab.actionType === "Reaction" ||
      ab.actionType === "Trigger"
    )
      return false;

    if (typeof ab.level === "number" && ab.level > 0) {
      if (ab.level > entity.classLevel && ab.level > entity.weaponLevel)
        return false;
    }

    if (entity.cooldowns[ab.name]) return false;

    if (ab.maxUses) {
      const used = entity.usesUsed[ab.name] ?? 0;
      if (used >= ab.maxUses) return false;
    }

    if (ab.actionType === "Standard" && entity.standardUsed) return false;
    if (ab.actionType === "Swift" && entity.swiftUsed) return false;
    if (ab.actionType === "Movement" && entity.movementUsed) return false;
    if (
      ab.actionType === "Full" &&
      (entity.standardUsed || entity.movementUsed)
    )
      return false;

    return true;
  });
}

function getPreMoveAbilities(game: Game, entity: Entity): AbilityData[] {
  return entity.abilities.filter((ab) => {
    if (
      ab.actionType !== "Free" &&
      ab.actionType !== "Swift" &&
      ab.actionType !== "Trigger"
    )
      return false;

    if (typeof ab.level === "number" && ab.level > 0) {
      if (ab.level > entity.classLevel && ab.level > entity.weaponLevel)
        return false;
    }

    if (entity.cooldowns[ab.name]) return false;

    if (ab.maxUses) {
      const used = entity.usesUsed[ab.name] ?? 0;
      if (used >= ab.maxUses) return false;
    }

    if (ab.actionType === "Swift" && entity.swiftUsed) return false;

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

    switch (ab.targetGroup) {
      case "Foe":
        if (caster.team === 0) {
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
        break;
      default:
        if (
          ab.targetGroup.includes("Ally") &&
          !ab.targetGroup.includes("Foe")
        ) {
          if (e.num === caster.num) return true;
          if (caster.team === 0) return false;
          if (e.team !== caster.team) return false;
        }
        break;
    }

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
