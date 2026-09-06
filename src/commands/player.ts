import { send, sendPm, toId, posToStr } from "../utils.js";
import { eva43 } from "../game/resolve.js";
import type { User } from "../users.js";
import {
  games,
  parseFrequency,
  type Game,
  type Entity,
} from "../game/state.js";

function findGameForUser(userName: string): Game | null {
  for (const game of games.values()) {
    if (game.entities.some((e) => toId(e.name) === toId(userName))) {
      return game;
    }
  }
  return null;
}

function findEntityInGames(
  userName: string,
): { game: Game; entity: Entity } | null {
  for (const game of games.values()) {
    const entity = game.entities.find((e) => toId(e.name) === toId(userName));
    if (entity) return { game, entity };
  }
  return null;
}

/** Build the %vs character sheet. */
function buildStats(e: Entity, version?: string): string {
  const hpPct = Math.max(0, (e.curhp / e.maxhp) * 100);
  const hpBar = hpPct > 50 ? "[+]" : hpPct > 25 ? "[~]" : "[-]";
  const lines = [
    `**${e.num} ${e.name}** -- ${e.className}/${e.weaponName} (Lv.${e.classLevel}/${e.weaponLevel})`,
    `${hpBar} **HP**: ${e.curhp}/${e.maxhp}`,
    `**ATK**: ${e.atk} | **MAG**: ${e.mag} | **PD**: ${e.pd} | **MD**: ${e.md} | ${evaLine(e, version)} | **MP**: ${e.mp}`,
    `**Position**: ${posToStr(e.pos[0], e.pos[1])} | **Team**: ${e.team}`,
  ];
  if (e.statuses.length > 0) {
    const statuses = e.statuses.map(
      (s) => `${s.name} ${s.damage > 0 ? s.damage + "/" : ""}${s.rounds}r`,
    );
    lines.push(`**Statuses**: ${statuses.join(", ")}`);
  }
  if (e.buffs.length > 0) {
    const buffs = e.buffs.map(
      (b) => `${b.amount > 0 ? "+" : ""}${b.amount} ${b.stat} (${b.rounds}r)`,
    );
    lines.push(`**Buffs**: ${buffs.join(", ")}`);
  }
  if (Object.keys(e.cooldowns).length > 0) {
    const cds = Object.entries(e.cooldowns)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    lines.push(`**Cooldowns**: ${cds}`);
  }
  return lines.join("\n");
}

/** EVA/PE/ME display — 4.3 games show PE/ME (with buffs) instead of EVA. */
function evaLine(e: Entity, version?: string): string {
  return version === "4.3"
    ? `**PE**: ${eva43(e, "Physical")} | **ME**: ${eva43(e, "Magical")}`
    : `**EVA**: ${e.eva}`;
}

/** Build the %vl level + ability list. */
function buildLevels(e: Entity): string {
  const lines = [
    `**${e.num} ${e.name}** -- Levels`,
    `Class: ${e.className} (Lv.${e.classLevel})`,
    `Weapon: ${e.weaponName} (Lv.${e.weaponLevel})`,
    `Abilities:`,
  ];
  for (const a of e.abilities) {
    const maxUses = a.maxUses ?? parseFrequency(a.frequency).uses;
    const uses = maxUses
      ? ` [${maxUses - (e.usesUsed[a.name] ?? 0)}/${maxUses}]`
      : "";
    const cd = e.cooldowns[a.name] ? ` CD:${e.cooldowns[a.name]}` : "";
    lines.push(
      `  Lv.${a.level} ${a.name} (${a.actionType}/${a.frequency})${uses}${cd}`,
    );
  }
  return lines.join("\n");
}

/** Build the %score summary. */
function buildScore(game: Game, userName: string): string | null {
  const entity = game.entities.find((e) => toId(e.name) === toId(userName));
  if (!entity) return null;
  return [
    `**${entity.num} ${entity.name}** -- Score`,
    `HP: ${entity.curhp}/${entity.maxhp}`,
    `Abilities used: ${
      Object.entries(entity.usesUsed)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ") || "None"
    }`,
  ].join("\n");
}

const PLAYER_CMDS: Record<
  string,
  (user: User, args: string, send: (msg: string) => void) => void
> = {
  vs: (u, args, out) => {
    const name = args.trim() || u.name;
    const result = findEntityInGames(name);
    if (!result) return out(`No character found for ${name}.`);
    out(buildStats(result.entity, result.game.version));
  },
  viewstats: (u, args, out) => {
    const name = args.trim() || u.name;
    const result = findEntityInGames(name);
    if (!result) return out(`No character found for ${name}.`);
    out(buildStats(result.entity, result.game.version));
  },
  vl: (u, args, out) => {
    const name = args.trim() || u.name;
    const result = findEntityInGames(name);
    if (!result) return out(`No character found for ${name}.`);
    out(buildLevels(result.entity));
  },
  viewlevels: (u, args, out) => {
    const name = args.trim() || u.name;
    const result = findEntityInGames(name);
    if (!result) return out(`No character found for ${name}.`);
    out(buildLevels(result.entity));
  },
  vi: (u, args, out) => {
    const name = args.trim() || u.name;
    const result = findEntityInGames(name);
    if (!result) return out(`No character found for ${name}.`);
    out(`Items for ${name}: (item system not yet implemented)`);
  },
  viewitems: (u, args, out) => {
    const name = args.trim() || u.name;
    const result = findEntityInGames(name);
    if (!result) return out(`No character found for ${name}.`);
    out(`Items for ${name}: (item system not yet implemented)`);
  },
  regp: (_u, _args, out) =>
    out(`Register player: (not yet implemented -- use .addp instead)`),
  sc: (_u, _args, out) => out(`Switch class: (not yet implemented)`),
  sw: (_u, _args, out) => out(`Switch weapon: (not yet implemented)`),
  loot: (u, _args) => send(u.name, `Loot: (not yet implemented)`),
  xp: (_u, _args, out) => out(`XP: (not yet implemented)`),
  gold: (_u, _args, out) => out(`Gold: (not yet implemented)`),
  score: (u, _args, out) => {
    const game = findGameForUser(u.name);
    if (!game) return out("You are not in any active game.");
    const lines = buildScore(game, u.name);
    out(lines ?? "You are not in any active game.");
  },
};

export function playerCommand(user: User, cmd: string, args: string) {
  const target = user.name;
  const handler = PLAYER_CMDS[cmd];
  if (handler) {
    handler(user, args, (msg) => sendPm(target, msg));
    return;
  }
  sendPm(target, `Unknown player command: ${cmd}`);
}
