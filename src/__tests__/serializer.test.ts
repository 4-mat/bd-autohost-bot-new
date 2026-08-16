import { describe, it, expect } from "bun:test";
import {
  moveAbility,
  duplicateAbility,
  sanitizeAbility,
} from "../../abilityeditor/serializer.js";

// ---------------------------------------------------------------------------
// moveAbility / duplicateAbility (used by /api/ability move|duplicate and the
// demo's static mirror)
// ---------------------------------------------------------------------------

function ab(name: string) {
  return { name };
}

describe("moveAbility", () => {
  it("moves an ability up (dir -1)", () => {
    const arr = [ab("A"), ab("B"), ab("C")];
    expect(moveAbility(arr, "B", -1)).toBe(0);
    expect(arr.map((a) => a.name)).toEqual(["B", "A", "C"]);
  });

  it("moves an ability down (dir 1)", () => {
    const arr = [ab("A"), ab("B"), ab("C")];
    expect(moveAbility(arr, "A", 1)).toBe(1);
    expect(arr.map((a) => a.name)).toEqual(["B", "A", "C"]);
  });

  it("matches names case-insensitively via toId", () => {
    const arr = [ab("A"), ab("B"), ab("C")];
    expect(moveAbility(arr, "b", -1)).toBe(0);
    expect(arr.map((a) => a.name)).toEqual(["B", "A", "C"]);
  });

  it("refuses to move the first ability up", () => {
    const arr = [ab("A"), ab("B")];
    expect(moveAbility(arr, "A", -1)).toBe(-1);
    expect(arr.map((a) => a.name)).toEqual(["A", "B"]);
  });

  it("refuses to move the last ability down", () => {
    const arr = [ab("A"), ab("B")];
    expect(moveAbility(arr, "B", 1)).toBe(-1);
    expect(arr.map((a) => a.name)).toEqual(["A", "B"]);
  });

  it("returns -1 for an unknown name without mutating", () => {
    const arr = [ab("A")];
    expect(moveAbility(arr, "Nope", 1)).toBe(-1);
    expect(arr.map((a) => a.name)).toEqual(["A"]);
  });
});

describe("duplicateAbility", () => {
  it("inserts a deep copy right after the original with a Copy suffix", () => {
    const arr = [ab("A"), ab("B")];
    const copy = duplicateAbility(arr, "A");
    expect(copy).toEqual({ name: "A Copy" });
    expect(arr.map((a) => a.name)).toEqual(["A", "A Copy", "B"]);
    // The copy must be a distinct object — editing it never touches the source.
    expect(arr[0]).not.toBe(arr[1]);
  });

  it("deep-copies nested fields (effect text, cost, choices)", () => {
    const src = { name: "Burst", effect: "Deal 2d6 damage", cost: { type: "MP", amount: 2 } };
    const arr = [src];
    const copy = duplicateAbility(arr, "Burst") as typeof src;
    expect(copy.effect).toBe("Deal 2d6 damage");
    copy.cost.amount = 99;
    expect(src.cost.amount).toBe(2); // original untouched
  });

  it("numbers duplicates when the Copy name is taken", () => {
    const arr = [ab("A"), ab("A Copy"), ab("A Copy 2")];
    const copy = duplicateAbility(arr, "A");
    expect(copy).toEqual({ name: "A Copy 3" });
    // The copy goes right after the original (index 1), shifting the rest.
    expect(arr.map((a) => a.name)).toEqual(["A", "A Copy 3", "A Copy", "A Copy 2"]);
  });

  it("returns null for an unknown name", () => {
    const arr = [ab("A")];
    expect(duplicateAbility(arr, "Nope")).toBeNull();
    expect(arr.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// sanitizeAbility: maxUses and choices edge cases (GUI clear + structured rows)
// ---------------------------------------------------------------------------

describe("duplicateAbility naming", () => {
  it("returns the copy name the GUI can open directly", () => {
    const arr = [ab("A")];
    const copy = duplicateAbility(arr, "A");
    expect(String((copy as { name?: unknown }).name)).toBe("A Copy");
  });

  it("numbers the copy when the plain Copy name is taken", () => {
    const arr = [ab("A"), ab("A Copy")];
    const copy = duplicateAbility(arr, "A");
    expect(String((copy as { name?: unknown }).name)).toBe("A Copy 2");
  });
});

describe("sanitizeAbility maxUses", () => {
  it("drops an empty maxUses instead of coercing it to 1", () => {
    const clean = sanitizeAbility({ name: "X", maxUses: "" });
    expect(clean).not.toHaveProperty("maxUses");
  });

  it("drops a missing maxUses", () => {
    const clean = sanitizeAbility({ name: "X" });
    expect(clean).not.toHaveProperty("maxUses");
  });

  it("keeps a numeric maxUses", () => {
    expect(sanitizeAbility({ name: "X", maxUses: 3 }).maxUses).toBe(3);
    expect(sanitizeAbility({ name: "X", maxUses: "5" }).maxUses).toBe(5);
  });
});

describe("sanitizeAbility choices", () => {
  it("keeps complete {id,label} choices", () => {
    const clean = sanitizeAbility({
      name: "X",
      choices: [{ id: "a", label: "Attack" }],
    });
    expect(clean.choices).toEqual([{ id: "a", label: "Attack" }]);
  });

  it("drops incomplete rows (missing id or label)", () => {
    const clean = sanitizeAbility({
      name: "X",
      choices: [
        { id: "a", label: "Attack" },
        { id: "b", label: "" },
        { id: "", label: "Nothing" },
      ],
    });
    expect(clean.choices).toEqual([{ id: "a", label: "Attack" }]);
  });

  it("drops choices entirely when nothing valid remains", () => {
    const clean = sanitizeAbility({
      name: "X",
      choices: [{ id: "", label: "" }],
    });
    expect(clean).not.toHaveProperty("choices");
  });
});
