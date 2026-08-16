import { send, sendPm, sendPmChunks, toId, posToStr } from "../utils.js";
import type { User } from "../users.js";
import {
  games,
  parseFrequency,
  type Game,
  type Entity,
} from "../game/state.js";
import { items } from "../data/index.js";

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

export function playerCommand(user: User, cmd: string, args: string) {
  const target = user.name;

  switch (cmd) {
    case "vs":
    case "viewstats": {
      const name = args.trim() || user.name;
      const result = findEntityInGames(name);
      if (!result) return sendPm(target, `No character found for ${name}.`);

      const { entity: e } = result;
      const hpPct = Math.max(0, (e.curhp / e.maxhp) * 100);
      const hpBar = hpPct > 50 ? "[+]" : hpPct > 25 ? "[~]" : "[-]";

      const lines = [
        `**${e.num} ${e.name}** -- ${e.className}/${e.weaponName} (Lv.${e.classLevel}/${e.weaponLevel})`,
        `${hpBar} **HP**: ${e.curhp}/${e.maxhp}`,
        `**ATK**: ${e.atk} | **MAG**: ${e.mag} | **PD**: ${e.pd} | **MD**: ${e.md} | **EVA**: ${e.eva} | **MP**: ${e.mp}`,
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
          (b) =>
            `${b.amount > 0 ? "+" : ""}${b.amount} ${b.stat} (${b.rounds}r)`,
        );
        lines.push(`**Buffs**: ${buffs.join(", ")}`);
      }
      if (Object.keys(e.cooldowns).length > 0) {
        const cds = Object.entries(e.cooldowns)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        lines.push(`**Cooldowns**: ${cds}`);
      }

      sendPm(target, lines.join("\n"));
      break;
    }

    case "vl":
    case "viewlevels": {
      const name = args.trim() || user.name;
      const result = findEntityInGames(name);
      if (!result) return sendPm(target, `No character found for ${name}.`);

      const { entity: e } = result;
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

      sendPm(target, lines.join("\n"));
      break;
    }

    case "vi":
    case "viewitems": {
      const list = [...items.values()];
      if (list.length === 0) {
        return sendPm(target, "Items (beta): none defined yet. Add them in the ability editor.");
      }
      const lines = list.map(
        (it) =>
          `${it.name} (${it.rank || "-"}) — ${it.slots} slot${it.slots === 1 ? "" : "s"}, ${it.gold} gold${it.materials ? ", " + it.materials : ""}`,
      );
      sendPmChunks(target, `Items (beta):\n${lines.join("\n")}`);
      break;
    }

    case "regp": {
      // Register player -- host assigns a player to a PS user
      send(
        target,
        `Register player: (not yet implemented -- use .addp instead)`,
      );
      break;
    }

    case "sc": {
      // Switch class -- not yet implemented
      sendPm(target, `Switch class: (not yet implemented)`);
      break;
    }

    case "sw": {
      // Switch weapon -- not yet implemented
      sendPm(target, `Switch weapon: (not yet implemented)`);
      break;
    }

    case "score": {
      const game = findGameForUser(user.name);
      if (!game) return sendPm(target, "You are not in any active game.");

      const entity = game.entities.find(
        (e) => toId(e.name) === toId(user.name),
      );
      if (!entity) return sendPm(target, "You are not in any active game.");

      const lines = [
        `**${entity.num} ${entity.name}** -- Score`,
        `HP: ${entity.curhp}/${entity.maxhp}`,
        `Abilities used: ${
          Object.entries(entity.usesUsed)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ") || "None"
        }`,
      ];

      sendPm(target, lines.join("\n"));
      break;
    }

    case "loot": {
      send(target, `Loot: (not yet implemented)`);
      break;
    }

    case "xp": {
      sendPm(target, `XP: (not yet implemented)`);
      break;
    }

    case "gold": {
      sendPm(target, `Gold: (not yet implemented)`);
      break;
    }

    default:
      sendPm(target, `Unknown player command: ${cmd}`);
  }
}
