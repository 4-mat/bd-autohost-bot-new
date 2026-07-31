import { describe, expect, it } from "bun:test";
import { applyFrequencyDefaults } from "../data/frequency.js";
import type { AbilityData } from "../data/index.js";

function mk(frequency: string): AbilityData {
  return {
    name: "Test",
    level: 1,
    frequency,
    mr: 0,
    roll: "",
    damageType: "",
    actionType: "Standard",
    targetAmount: 1,
    targetGroup: "Foe",
    range: "Melee",
    effect: "",
  };
}

describe("applyFrequencyDefaults", () => {
  it("derives maxUses from frequency words", () => {
    const once = [mk("Once")];
    const twice = [mk("Twice/EoT")];
    const thrice = [mk("Thrice / E3T")];
    applyFrequencyDefaults(once);
    applyFrequencyDefaults(twice);
    applyFrequencyDefaults(thrice);
    expect(once[0].maxUses).toBe(1);
    expect(twice[0].maxUses).toBe(2);
    expect(thrice[0].maxUses).toBe(3);
  });

  it("leaves unlimited and pre-set values alone", () => {
    const free = [mk("Every Turn")];
    const passive = [mk("Passive")];
    const set = [mk("Twice")];
    set[0].maxUses = 5;
    applyFrequencyDefaults(free);
    applyFrequencyDefaults(passive);
    applyFrequencyDefaults(set);
    expect(free[0].maxUses).toBeUndefined();
    expect(passive[0].maxUses).toBeUndefined();
    expect(set[0].maxUses).toBe(5);
  });
});
