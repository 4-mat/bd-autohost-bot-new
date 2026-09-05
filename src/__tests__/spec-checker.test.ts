import { describe, it, expect } from "bun:test";
import { checkAbility, checkSheet } from "../sheets/spec-checker.js";

function violations(effect: string, action?: string) {
  return checkAbility({ Name: "Test", Effect: effect, Action: action || "" })
    .violations;
}

describe("spec-checker Rule 8 (Duration Notation)", () => {
  it("allows canonical 'until start of user's next turn'", () => {
    const v = violations(
      "Inflict 3 Bleed/1 on the target until start of user's next turn.",
    );
    expect(v).toHaveLength(0);
  });

  it("allows canonical 'until end of target's next turn'", () => {
    const v = violations("Gain +2 ATK/1 until end of target's next turn.");
    expect(v).toHaveLength(0);
  });

  it("flags 'the' article variant", () => {
    const v = violations(
      "Inflict 3 Bleed/1 on the target until start of the user's next turn.",
    );
    const d = v.find((x) => x.rule === "Duration Notation");
    expect(d?.found).toBe("until start of the user's next turn");
  });

  it("flags 'their' pronoun variant", () => {
    const v = violations("Deal 10 damage until end of their next turn.");
    expect(v.some((x) => x.rule === "Duration Notation")).toBe(true);
  });

  it("flags bare forms without start/end of", () => {
    const v = violations("Gain +2 DEF/1 until their next turn.");
    expect(v.some((x) => x.rule === "Duration Notation")).toBe(true);
  });

  it("flags 'the target's next turn'", () => {
    const v = violations(
      "Inflict 3 Slow/1 on the target until the target's next turn.",
    );
    expect(v.some((x) => x.rule === "Duration Notation")).toBe(true);
  });
});

describe("spec-checker Rule 16 (Status Application)", () => {
  it("flags passive 'is inflicted with'", () => {
    const v = violations("The target is inflicted with 3 Curse/1.");
    const s = v.find((x) => x.rule === "Status Application");
    expect(s?.found).toBe("is inflicted with 3 Curse");
    expect(s?.severity).toBe("error");
  });

  it("flags passive 'are inflicted with'", () => {
    const v = violations("The targets are inflicted with 3 Poison/1.");
    expect(v.some((x) => x.rule === "Status Application")).toBe(true);
  });

  it("flags object-first 'inflict the target with'", () => {
    const v = violations("Inflict the target with 3 Stun/1.");
    expect(v.some((x) => x.rule === "Status Application")).toBe(true);
  });

  it("flags object-first 'inflicts them with'", () => {
    const v = violations("Inflicts them with 3 Cripple/1.");
    expect(v.some((x) => x.rule === "Status Application")).toBe(true);
  });

  it("allows negated immunity wording", () => {
    const v = violations("The target cannot be inflicted with Curse.");
    expect(v).toHaveLength(0);
  });

  it("does not suppress detection when a prior sentence contains 'no'", () => {
    const v = violations(
      "The target takes no damage. It is inflicted with 3 Bleed/1.",
    );
    expect(v.some((x) => x.rule === "Status Application")).toBe(true);
  });

  it("allows active 'Inflict X on the target'", () => {
    const v = violations("Inflict 3 Bleed/1 on the target.");
    expect(v.some((x) => x.rule === "Status Application")).toBe(false);
  });
});

describe("spec-checker checkSheet", () => {
  it("only returns rows with violations", () => {
    const rows = [
      { Name: "Clean", Effect: "Inflict 3 Bleed/1 on the target." },
      { Name: "Dirty", Effect: "The target is inflicted with 3 Curse/1." },
    ];
    const out = checkSheet(rows);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Dirty");
  });
});
