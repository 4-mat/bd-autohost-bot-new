import {
  Terrain,
  games,
  startingSubweapon,
  findGameForRoom,
  type Game,
  type Entity,
} from "../game/state.js";
import { classes, weapons } from "../data/index.js";
import { toId } from "../utils.js";
import { broadcastPages } from "../commands/game.js";

type StateAbility = import("../game/state.js").AbilityData;
type DataAbility = import("../data/index.js").AbilityData;

const TERRAIN_MAP: Record<string, Terrain> = {
  stop: Terrain.Stop,
  ice: Terrain.Ice,
  normal: Terrain.Normal,
  water: Terrain.Water,
  forest: Terrain.Forest,
  air: Terrain.Air,
  sticky: Terrain.Sticky,
  lava: Terrain.Lava,
  broken: Terrain.Broken,
  bone: Terrain.Bone,
  stone: Terrain.Stone,
  hearth: Terrain.Hearth,
  boost: Terrain.Boost,
};

interface ParsedPlayer {
  num: string;
  name: string;
  className: string;
  weaponName: string;
  classLevel: number;
  weaponLevel: number;
  hp: number;
  maxhp: number;
  atk: number;
  mag: number;
  pd: number;
  md: number;
  eva: number;
  mp: number;
}

export interface KyubsInfo {
  map: { grid: Terrain[][]; positions: Map<string, [number, number]> };
  players: ParsedPlayer[];
  turnOrderNames: string[];
}

function strip(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

function extractCells(rowHtml: string): string[] {
  return [
    ...rowHtml.matchAll(/<(?:td|th)([^>]*)>([\s\S]*?)<\/(?:td|th)>/g),
  ].map((m) => m[0]);
}

function parseMapGrid(
  html: string,
): { grid: Terrain[][]; positions: Map<string, [number, number]> } | null {
  const section = html.match(/<summary>Map<\/summary>([\s\S]*?)<\/details>/);
  if (!section) return null;

  const table = section[1].match(/<table[^>]*>([\s\S]*?)<\/table>/);
  if (!table) return null;

  const rows = [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  if (rows.length < 2) return null;

  const grid: Terrain[][] = [];
  const positions = new Map<string, [number, number]>();

  for (let i = 1; i < rows.length; i++) {
    const cells = extractCells(rows[i][1]);
    if (cells.length < 2) continue;

    const letter = strip(cells[0]).match(/^([A-Z])$/);
    if (!letter) continue;
    const rowIdx = letter[1].charCodeAt(0) - 65;

    grid[rowIdx] = [];

    for (let j = 1; j < cells.length; j++) {
      const title = cells[j].match(/title="([^"]+)"/);
      const terrain = title ? title[1].toLowerCase() : "normal";
      grid[rowIdx][j - 1] = TERRAIN_MAP[terrain] ?? Terrain.Normal;

      const player = strip(cells[j]).match(/^(P\d+)$/);
      if (player) {
        positions.set(player[1], [rowIdx, j - 1]);
      }
    }
  }

  return { grid, positions };
}

function parsePlayerRows(html: string): ParsedPlayer[] {
  const table = html.match(/<table class="bdinfo"[^>]*>([\s\S]*?)<\/table>/);
  if (!table) return [];

  const rows = [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  if (rows.length < 2) return [];

  const players: ParsedPlayer[] = [];

  for (let i = 1; i < rows.length; i++) {
    const player = parsePlayerRow(rows[i][1]);
    if (player) players.push(player);
  }

  return players;
}

/** Parse one player row into a ParsedPlayer, or null when the row is malformed. */
function parsePlayerRow(rowHtml: string): ParsedPlayer | null {
  const cells = extractCells(rowHtml);
  if (cells.length < 10) return null;

  const num = strip(cells[0]).match(/^(P\d+)$/);
  if (!num) return null;

  const { className, weaponName, classLevel, weaponLevel } = parseCw(
    strip(cells[2]),
  );
  const { hp, maxhp } = parseHp(strip(cells[3]));

  return {
    num: num[1],
    name: strip(cells[1]),
    className,
    weaponName,
    classLevel,
    weaponLevel,
    hp,
    maxhp,
    atk: parseInt(strip(cells[4])) || 0,
    mag: parseInt(strip(cells[5])) || 0,
    pd: parseInt(strip(cells[6])) || 0,
    md: parseInt(strip(cells[7])) || 0,
    eva: parseInt(strip(cells[8])) || 0,
    mp: parseInt(strip(cells[9])) || 0,
  };
}

/** Parse a "Class (Lv)/Weapon (Lv)" cell into its four parts. */
function parseCw(
  cw: string,
): {
  className: string;
  weaponName: string;
  classLevel: number;
  weaponLevel: number;
} {
  const m = cw.match(/^(.+?)\((\d+)\)\/(.+?)\((\d+)\)$/);
  if (!m) {
    const [className, weaponName = ""] = cw
      .split("/")
      .map((part) => part.trim());
    return { className: className || cw, weaponName, classLevel: 1, weaponLevel: 1 };
  }
  return {
    className: m[1].trim(),
    classLevel: parseInt(m[2]),
    weaponName: m[3].trim(),
    weaponLevel: parseInt(m[4]),
  };
}

/** Parse a "cur/max" HP cell. */
function parseHp(hpCell: string): { hp: number; maxhp: number } {
  const m = hpCell.match(/(\d+)\/(\d+)/);
  return { hp: m ? parseInt(m[1]) : 0, maxhp: m ? parseInt(m[2]) : 0 };
}

function parseTurnOrder(html: string): string[] {
  const match = html.match(/<b>Turn Order:\s*([\s\S]*?)<\/b>/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getAbilities(className: string, weaponName: string): StateAbility[] {
  const cls = classes.get(toId(className));
  const wpn = weapons.get(toId(weaponName));
  const abs: DataAbility[] = [];
  if (cls) abs.push(...cls.abilities);
  if (wpn) abs.push(...wpn.abilities);
  return abs as StateAbility[];
}

export function parseKyubsInfo(html: string): KyubsInfo | null {
  const map = parseMapGrid(html);
  if (!map) return null;
  const players = parsePlayerRows(html);
  if (players.length === 0) return null;
  const turnOrderNames = parseTurnOrder(html);
  return { map, players, turnOrderNames };
}

export function handleKyubsInfo(roomid: string, html: string) {
  const info = parseKyubsInfo(html);
  if (!info) return;

  let game = findGameForRoom(roomid);

  if (!game) {
    game = {
      id: `kyubs-${roomid}-${Date.now()}`,
      room: roomid,
      host: "Ice Kyubs",
      version: "4.4",
      entities: [],
      map: info.map.grid,
      mapName: "kyubs",
      turnOrder: [],
      turnIndex: 0,
      round: 1,
      log: [],
      snapshots: [],
      mode: "unknown",
      phase: "playing",
      started: true,
      kills: {},
      winner: null,
      chatLog: [],
      toasts: [],
      signupsOpen: false,
      votes: {},
      voteOpen: false,
      voteRunoff: null,
    };
    games.set(game.id, game);
  } else {
    game.map = info.map.grid;
  }

  if (!game) return;

  const nameToNum = new Map<string, string>();
  for (const p of info.players) {
    nameToNum.set(toId(p.name), p.num);
  }

  for (const p of info.players) {
    let entity = game.entities.find((e) => e.num === p.num);
    const pos = info.map.positions.get(p.num) ?? [0, 0];

    if (!entity) {
      entity = {
        num: p.num,
        name: p.name,
        id: toId(p.name),
        isMonster: false,
        curhp: p.hp,
        maxhp: p.maxhp,
        atk: p.atk,
        mag: p.mag,
        pd: p.pd,
        md: p.md,
        eva: p.eva,
        mp: p.mp,
        pos,
        team: 0,
        className: p.className,
        weaponName: p.weaponName,
        subweapon: startingSubweapon(p.weaponName),
        classLevel: p.classLevel,
        weaponLevel: p.weaponLevel,
        abilities: getAbilities(p.className, p.weaponName),
        statuses: [],
        buffs: [],
        cooldowns: {},
        usesUsed: {},
        resources: {},
        pendingAction: null,
        dashUsed: false,
        standardUsed: false,
        movementUsed: false,
        swiftUsed: false,
      };
      game.entities.push(entity);
    } else {
      entity.name = p.name;
      entity.curhp = p.hp;
      entity.maxhp = p.maxhp;
      entity.atk = p.atk;
      entity.mag = p.mag;
      entity.pd = p.pd;
      entity.md = p.md;
      entity.eva = p.eva;
      entity.mp = p.mp;
      entity.pos = pos;
      entity.className = p.className;
      entity.weaponName = p.weaponName;
      // Backfill the subweapon on re-import only when missing -- never
      // stomp an in-game swapped stance.
      if (!entity.subweapon) entity.subweapon = startingSubweapon(p.weaponName);
      entity.classLevel = p.classLevel;
      entity.weaponLevel = p.weaponLevel;
      entity.abilities = getAbilities(p.className, p.weaponName);
    }
  }

  const kyubsNums = new Set(info.players.map((p) => p.num));
  game.entities = game.entities.filter((e) => kyubsNums.has(e.num));

  game.turnOrder = info.turnOrderNames
    .map((name) => nameToNum.get(toId(name)))
    .filter((n): n is string => !!n);
  game.turnIndex = 0;

  broadcastPages(game);
}
