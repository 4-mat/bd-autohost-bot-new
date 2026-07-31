import type { AbilityData } from "./index.js";

const maxUses = new Map<string, number>([
  ["once", 1],
  ["twice", 2],
  ["thrice", 3],
]);

export function applyFrequencyDefaults(abilities: AbilityData[]): void {
  for (const a of abilities) {
    if (a.maxUses !== undefined) continue;
    const freq = a.frequency.toLowerCase();
    for (const [word, n] of maxUses) {
      if (freq.includes(word)) {
        a.maxUses = n;
        break;
      }
    }
  }
}
