// Quick diagnostic: parse every ability effect in the real data and report
// clauses that fall through to `unknown` (parser gaps), plus top-level stats.
import { classes, weapons, loadGameData } from "../src/data/index.js";
import { parseEffects } from "../src/game/effects.js";

loadGameData();

type Entry = { name: string; effect: string };

const entries: Entry[] = [];
for (const c of classes.values()) {
  for (const a of c.abilities) entries.push({ name: `${c.name}/${a.name}`, effect: a.effect });
}
for (const w of weapons.values()) {
  for (const a of w.abilities) entries.push({ name: `${w.name}/${a.name}`, effect: a.effect });
}

const gaps = new Map<string, { count: number; examples: string[] }>();
let totalEffects = 0;
let totalUnknown = 0;

for (const e of entries) {
  const effects = parseEffects(e.effect);
  const unknowns = effects.filter((ef) => ef.type === "unknown");
  totalEffects += effects.length;
  totalUnknown += unknowns.length;
  for (const u of unknowns) {
    if (u.type !== "unknown") continue;
    const key = u.text;
    if (!gaps.has(key)) gaps.set(key, { count: 0, examples: [] });
    const rec = gaps.get(key)!;
    rec.count++;
    if (rec.examples.length < 2) rec.examples.push(e.name);
  }
}

console.log(`\n=== SCAN RESULTS ===`);
console.log(`entries: ${entries.length}, parsed effects: ${totalEffects}, unknown clauses: ${totalUnknown}`);
console.log(`unknown rate: ${((totalUnknown / Math.max(1, totalEffects)) * 100).toFixed(1)}%`);
console.log(`distinct unknown clause texts: ${gaps.size}`);

const sorted = [...gaps.entries()].sort((a, b) => b[1].count - a[1].count);
console.log(`\n=== TOP 60 UNKNOWN CLAUSES (by count) ===`);
for (const [text, { count, examples }] of sorted.slice(0, 60)) {
  console.log(`${String(count).padStart(4)}x  "${text.slice(0, 120)}"   [e.g. ${examples.join(", ")}]`);
}

console.log(`\n=== ALL CLAUSE TYPES (top 25) ===`);
const types = new Map<string, number>();
for (const e of entries) {
  for (const ef of parseEffects(e.effect)) {
    types.set(ef.type, (types.get(ef.type) ?? 0) + 1);
  }
}
for (const [t, n] of [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`${String(n).padStart(4)}x  ${t}`);
}
