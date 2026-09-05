// Quick diagnostic: parse every ability effect in the real data and report
// clauses that fall through to `unknown` (parser gaps), plus top-level stats.
// Metrics walk the WHOLE effect tree: conditional then/else branches, per /
// trigger / phase blocks, apex / thirst blocks, and choose options all nest
// sub-effects that a flat top-level count would otherwise miss.
import { classes, weapons, loadGameData } from "../src/data/index.js";
import { parseEffects } from "../src/game/effects.js";
import type { Effect } from "../src/game/effects.js";

loadGameData();

type Entry = { name: string; effect: string };

const entries: Entry[] = [];
for (const c of classes.values()) {
  for (const a of c.abilities) entries.push({ name: `${c.name}/${a.name}`, effect: a.effect });
}
for (const w of weapons.values()) {
  for (const a of w.abilities) entries.push({ name: `${w.name}/${a.name}`, effect: a.effect });
}

// Recursively walk an effect tree in one pass: count every node, collect the
// unknowns (which are leaves, so they terminate the recursion), and tally the
// type distribution. Nested blocks -- conditional then/else branches, choose
// options, and per/trigger/phase/apex/thirst `effects` arrays -- are all
// visited so the metrics reflect the WHOLE tree, not just top-level clauses.
function walkTree(effects: Effect[]): {
  count: number;
  unknowns: Extract<Effect, { type: "unknown" }>[];
  types: Map<string, number>;
} {
  let count = 0;
  const unknowns: Extract<Effect, { type: "unknown" }>[] = [];
  const types = new Map<string, number>();
  const visit = (list: Effect[]) => {
    for (const ef of list) {
      count++;
      types.set(ef.type, (types.get(ef.type) ?? 0) + 1);
      if (ef.type === "unknown") {
        unknowns.push(ef);
        continue;
      }
      if (ef.type === "conditional") {
        visit(ef.thenEffects);
        if (ef.elseEffects) visit(ef.elseEffects);
      } else if (ef.type === "choose") {
        for (const opts of ef.options) visit(opts);
      } else if ("effects" in ef && Array.isArray(ef.effects)) {
        visit(ef.effects);
      }
    }
  };
  visit(effects);
  return { count, unknowns, types };
}

const gaps = new Map<string, { count: number; examples: string[] }>();
const types = new Map<string, number>();
let totalEffects = 0;
let totalUnknown = 0;

for (const e of entries) {
  const effects = parseEffects(e.effect);
  const { count, unknowns, types: treeTypes } = walkTree(effects);
  totalEffects += count;
  totalUnknown += unknowns.length;
  for (const u of unknowns) {
    const key = u.text;
    if (!gaps.has(key)) gaps.set(key, { count: 0, examples: [] });
    const rec = gaps.get(key)!;
    rec.count++;
    if (rec.examples.length < 2) rec.examples.push(e.name);
  }
  for (const [t, n] of treeTypes) types.set(t, (types.get(t) ?? 0) + n);
}

console.log(`\n=== SCAN RESULTS ===`);
console.log(`entries: ${entries.length}, parsed effects (recursive): ${totalEffects}, unknown clauses: ${totalUnknown}`);
console.log(`unknown rate: ${((totalUnknown / Math.max(1, totalEffects)) * 100).toFixed(1)}%`);
console.log(`distinct unknown clause texts: ${gaps.size}`);

const sorted = [...gaps.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`\n=== TOP 60 UNKNOWN CLAUSES (by count) ===`);
for (const [text, { count, examples }] of sorted.slice(0, 60)) {
  console.log(`${String(count).padStart(4)}x  "${text.slice(0, 120)}"   [e.g. ${examples.join(", ")}]`);
}

console.log(`\n=== ALL CLAUSE TYPES (top 25) ===`);
for (const [t, n] of [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`${String(n).padStart(4)}x  ${t}`);
}
