import { toId } from "../utils.js";
import { items, type ItemData } from "../data/index.js";

export type StatKey = "hp" | "atk" | "mag" | "pd" | "md" | "eva" | "mp";

export interface StatBlock {
  maxhp: number;
  curhp: number;
  atk: number;
  mag: number;
  pd: number;
  md: number;
  eva: number;
  mp: number;
}

const STAT_ALIASES: Record<string, StatKey> = {
  hp: "hp",
  maxhp: "hp",
  health: "hp",
  atk: "atk",
  attack: "atk",
  mag: "mag",
  magic: "mag",
  pd: "pd",
  pdef: "pd",
  physdef: "pd",
  md: "md",
  mdef: "md",
  magdef: "md",
  eva: "eva",
  evasion: "eva",
  mp: "mp",
};

// Parse an item's statBoosts/statNerfs into stat deltas. Accepts both
// "ATK +2, MAG +1" and "+2 ATK, -1 PD" forms, comma- or semicolon-separated.
// Unsigned entries are positive in boosts and negative in nerfs.
export function parseItemStats(item: {
  statBoosts?: string;
  statNerfs?: string;
}): { stat: StatKey; amount: number }[] {
  const out: { stat: StatKey; amount: number }[] = [];
  const fields: [string, number][] = [
    [item.statBoosts ?? "", 1],
    [item.statNerfs ?? "", -1],
  ];
  for (const [text, fallback] of fields) {
    if (!text) continue;
    for (const chunk of text.split(/[,;]/)) {
      const t = chunk.trim();
      if (!t) continue;
      let m = t.match(/^([a-zA-Z][a-zA-Z .]*?)\s*([+-]?\d+(?:\.\d+)?)$/);
      let statStr = m?.[1] ?? null;
      let numStr = m?.[2] ?? null;
      if (!m) {
        m = t.match(/^([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z][a-zA-Z .]*?)$/);
        numStr = m?.[1] ?? null;
        statStr = m?.[2] ?? null;
      }
      if (!statStr || !numStr) continue;
      const stat = STAT_ALIASES[toId(statStr)];
      if (!stat) continue;
      const n = parseFloat(numStr);
      if (isNaN(n)) continue;
      const signed = /^[+-]/.test(numStr);
      const amount = (signed ? Math.sign(n) || 1 : fallback) * Math.abs(n);
      if (amount !== 0) out.push({ stat, amount });
    }
  }
  return out;
}

// Apply (sign=1) or revert (sign=-1) an item's stat mods on a stat block.
export function applyItemMods(
  e: StatBlock,
  item: { statBoosts?: string; statNerfs?: string },
  sign: 1 | -1,
): void {
  for (const m of parseItemStats(item)) {
    const d = m.amount * sign;
    switch (m.stat) {
      case "hp":
        e.maxhp += d;
        e.curhp = sign > 0 ? e.curhp + m.amount : Math.min(e.curhp, e.maxhp);
        break;
      case "atk":
        e.atk += d;
        break;
      case "mag":
        e.mag += d;
        break;
      case "pd":
        e.pd += d;
        break;
      case "md":
        e.md += d;
        break;
      case "eva":
        e.eva += d;
        break;
      case "mp":
        e.mp += d;
        break;
    }
  }
}

// Item by exact (normalized) name, or null.
export function findItem(name: string): ItemData | null {
  return items.get(toId(name)) ?? null;
}

// Sum of slots used by an entity's equipped items.
export function usedSlots(e: { equipped?: string[] }): number {
  let n = 0;
  for (const name of e.equipped ?? []) {
    n += findItem(name)?.slots ?? 0;
  }
  return n;
}

// Heal amount implied by a free-text effect ("Heal 20 HP", "Restore 15"), or 0.
export function parseHeal(effect: string): number {
  if (!effect) return 0;
  const m = effect.match(/(?:heal|restore|recover|regenerate)\D{0,12}(\d+)/i);
  if (m) return parseInt(m[1], 10);
  const m2 = effect.match(/(\d+)\s*(?:hp|health)\b/i);
  if (m2) return parseInt(m2[1], 10);
  return 0;
}
