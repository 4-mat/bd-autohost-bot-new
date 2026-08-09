import { describe, it, expect } from "bun:test";
import {
  applyProposalText,
  type Proposal,
} from "../../scripts/apply-editor-proposal.js";

// ---------------------------------------------------------------------------
// Fixture: a tiny src/data/index.ts in the serializer's exact source format
// (2-space block indent, wrapped descriptions, abilities inline, the
// "// Build branches" marker at the insertion point).
// ---------------------------------------------------------------------------

const SRC = [
  "",
  "  const bard: ClassData = {",
  "    name: \"Bard\",",
  "    stats: {",
  "      hp: \"80\",",
  "      atk: \"7\",",
  "      mag: \"7\",",
  "      pd: \"0\",",
  "      md: \"0\",",
  "      eva: \"1.7\",",
  "      mp: \"3\",",
  "    },",
  "    description:",
  "      \"A support class.\",",
  "    abilities: [],",
  "  };",
  "  classes.set(toId(\"Bard\"), bard);",
  "",
  "  const blacksmith: ClassData = {",
  "    name: \"Blacksmith\",",
  "    stats: {",
  "      hp: \"95\",",
  "      atk: \"9\",",
  "      mag: \"2\",",
  "      pd: \"4\",",
  "      md: \"2\",",
  "      eva: \"0.5\",",
  "      mp: \"0\",",
  "    },",
  "    description:",
  "      \"Heavy.\",",
  "    abilities: [],",
  "  };",
  "  classes.set(toId(\"Blacksmith\"), blacksmith);",
  "",
  "  // Build branches",
  "",
].join("\n");

function bardEntry(hp: string) {
  return {
    name: "Bard",
    stats: { hp, atk: "7", mag: "7", pd: "0", md: "0", eva: "1.7", mp: "3" },
    description: "A support class.",
    abilities: [],
  };
}

function customClass(name: string) {
  return {
    name,
    stats: { hp: "50", atk: "2", mag: "0", pd: "0", md: "0", eva: "0", mp: "0" },
    description: "",
    abilities: [],
  };
}

// ---------------------------------------------------------------------------
// Apply: minimal diff + insertions
// ---------------------------------------------------------------------------

describe("applyProposalText", () => {
  it("rewrites only the changed block for a stat edit (minimal diff)", () => {
    const p: Proposal = {
      updates: [{ kind: "class", name: "Bard", entry: bardEntry("85") }],
      adds: [],
    };
    const r = applyProposalText(SRC, p);
    expect(r.changed).toEqual(["Bard"]);
    expect(r.inserted).toEqual([]);
    expect(r.out).toContain('      hp: "85",');
    expect(r.out).not.toContain('      hp: "80",');
    // Untouched entry is left exactly as-is.
    expect(r.out).toContain('name: "Blacksmith"');
    expect(r.out).toContain('      hp: "95",');
  });

  it("inserts new entries before the // Build branches marker", () => {
    const p: Proposal = {
      updates: [],
      adds: [{ kind: "class", entry: customClass("TestClass") }],
    };
    const r = applyProposalText(SRC, p);
    expect(r.changed).toEqual([]);
    expect(r.inserted).toEqual(["TestClass"]);
    const insertAt = r.out.indexOf('name: "TestClass"');
    const markerAt = r.out.indexOf("// Build branches");
    expect(insertAt).toBeGreaterThan(-1);
    expect(insertAt).toBeLessThan(markerAt);
    // Both original entries are untouched.
    expect(r.out).toContain('name: "Bard"');
    expect(r.out).toContain('name: "Blacksmith"');
  });

  it("applies an update and an add together", () => {
    const p: Proposal = {
      updates: [{ kind: "class", name: "Bard", entry: bardEntry("90") }],
      adds: [{ kind: "class", entry: customClass("TestClass") }],
    };
    const r = applyProposalText(SRC, p);
    expect(r.changed).toEqual(["Bard"]);
    expect(r.inserted).toEqual(["TestClass"]);
    expect(r.out).toContain('      hp: "90",');
    expect(r.out).toContain('name: "TestClass"');
  });

  it("is a no-op when the entry already matches the source", () => {
    const p: Proposal = {
      updates: [{ kind: "class", name: "Bard", entry: bardEntry("80") }],
      adds: [],
    };
    const r = applyProposalText(SRC, p);
    expect(r.changed).toEqual([]);
    expect(r.inserted).toEqual([]);
    expect(r.out).toBe(SRC);
  });

  it("fills missing stat keys with defaults so the source always typechecks", () => {
    const p: Proposal = {
      updates: [],
      adds: [
        {
          kind: "class",
          entry: { name: "PartialStats", stats: { hp: "50" }, description: "", abilities: [] },
        },
      ],
    };
    const r = applyProposalText(SRC, p);
    expect(r.inserted).toEqual(["PartialStats"]);
    expect(r.out).toContain('      hp: "50",');
    expect(r.out).toContain('      atk: "0",');
    expect(r.out).toContain('      mp: "0",');
  });

  it("handles weapon entries (branch field)", () => {
    const p: Proposal = {
      updates: [],
      adds: [
        {
          kind: "weapon",
          entry: {
            name: "TestBow",
            branch: "Bow",
            stats: { hp: "1", atk: "3" },
            description: "",
            abilities: [],
          },
        },
      ],
    };
    const r = applyProposalText(SRC, p);
    expect(r.inserted).toEqual(["TestBow"]);
    expect(r.out).toContain('    branch: "Bow",');
    expect(r.out).toContain("weapons.set(toId(\"TestBow\"), testbow);");
  });
});

  it("escapes names containing quotes in the generated setter line", () => {
    const p: Proposal = {
      updates: [],
      adds: [{ kind: "class", entry: customClass('Test"Class') }],
    };
    const r = applyProposalText(SRC, p);
    expect(r.inserted).toEqual(['Test"Class']);
    expect(r.out).toContain('classes.set(toId("Test\\"Class"), testclass);');
    // Round-trip: the regenerated source parses back to the same entry.
    const r2 = applyProposalText(r.out, {
      updates: [{ kind: "class", name: 'Test"Class', entry: customClass('Test"Class') }],
      adds: [],
    } as Proposal);
    expect(r2.changed).toEqual([]);
    expect(r2.inserted).toEqual([]);
    expect(r2.out).toBe(r.out);
  });

  it("scans blocks containing comments and template literals with braces", () => {
    const srcWithComments = [
      "",
      "  const bard: ClassData = {",
      '    name: "Bard",',
      "    // } inside a comment must not end the block",
      "    /* neither should this } */",
      "    stats: {",
      '      hp: "80",',
      '      atk: "7",',
      '      mag: "7",',
      '      pd: "0",',
      '      md: "0",',
      '      eva: "1.7",',
      '      mp: "3",',
      "    },",
      "    description:",
      "      `desc with } brace`,",
      "    abilities: [],",
      "  };",
      '  classes.set(toId("Bard"), bard);',
      "",
      "  // Build branches",
      "",
    ].join("\n");
    const p: Proposal = {
      updates: [
        {
          kind: "class",
          name: "Bard",
          entry: { ...bardEntry("80"), description: "desc with } brace" },
        },
      ],
      adds: [],
    };
    const r = applyProposalText(srcWithComments, p);
    expect(r.changed).toEqual([]);
    expect(r.inserted).toEqual([]);
    expect(r.out).toBe(srcWithComments);
  });

// ---------------------------------------------------------------------------
// Rejection cases
// ---------------------------------------------------------------------------

describe("applyProposalText validation", () => {
  it("rejects a malformed payload", () => {
    expect(() => applyProposalText(SRC, {} as Proposal)).toThrow(/updates\[\] and adds\[\]/);
  });

  it("rejects updates for entries that do not exist in the source", () => {
    const p: Proposal = {
      updates: [{ kind: "class", name: "NoSuchClass", entry: customClass("NoSuchClass") }],
      adds: [],
    };
    expect(() => applyProposalText(SRC, p)).toThrow(/does not exist/);
  });

  it("rejects adds whose name already exists in the source", () => {
    const p: Proposal = {
      updates: [],
      adds: [{ kind: "class", entry: customClass("Bard") }],
    };
    expect(() => applyProposalText(SRC, p)).toThrow(/already exists/);
  });

  it("rejects duplicate names within a single proposal (adds)", () => {
    const p: Proposal = {
      updates: [],
      adds: [
        { kind: "class", entry: customClass("DupClass") },
        { kind: "class", entry: customClass("DupClass") },
      ],
    };
    expect(() => applyProposalText(SRC, p)).toThrow(/duplicate name 'DupClass'/);
  });

  it("rejects adds that differ only by case from an existing entry or another add", () => {
    const p: Proposal = {
      updates: [],
      adds: [{ kind: "class", entry: customClass("bard") }], // collides with "Bard"
    };
    expect(() => applyProposalText(SRC, p)).toThrow(/already exists/);

    const p2: Proposal = {
      updates: [],
      adds: [
        { kind: "class", entry: customClass("Foo") },
        { kind: "class", entry: customClass("foo") },
      ],
    };
    expect(() => applyProposalText(SRC, p2)).toThrow(/duplicate name 'foo'/);
  });

  it("rejects an update+add collision on the same name", () => {
    const p: Proposal = {
      updates: [{ kind: "class", name: "Bard", entry: bardEntry("85") }],
      adds: [{ kind: "class", entry: customClass("Bard") }],
    };
    expect(() => applyProposalText(SRC, p)).toThrow(/duplicate name 'Bard'/);
  });

  it("rejects entries with an invalid kind", () => {
    const p = {
      updates: [{ kind: "monster", name: "Bard", entry: bardEntry("85") }],
      adds: [],
    } as Proposal;
    expect(() => applyProposalText(SRC, p)).toThrow(/invalid kind/);
  });

  it("rejects an update whose payload name does not match its entry name", () => {
    const p: Proposal = {
      updates: [{ kind: "class", name: "Bard", entry: customClass("OtherName") }],
      adds: [],
    };
    expect(() => applyProposalText(SRC, p)).toThrow(/name mismatch/);
  });
});

// ---------------------------------------------------------------------------
// Code-injection + identifier-safety regressions
// ---------------------------------------------------------------------------

describe("applyProposalText codegen safety", () => {
  it("emits a name containing a quote/backtick break-out inertly", () => {
    const evil = 'a"); console.log("PWN"); //';
    const p: Proposal = {
      updates: [],
      adds: [{ kind: "class", entry: customClass(evil) }],
    };
    const r = applyProposalText(SRC, p);
    // The escaped name must appear inside the toId() string literal...
    expect(r.out).toContain('toId("a\\"); console.log(\\"PWN\\"); //")');
    // ...and never as runnable statements.
    expect(r.out).not.toContain('); console.log("PWN"); //")');
    // The varName must be a valid identifier even for a hostile name.
    expect(r.out).toMatch(/const [a-zA-Z_][a-zA-Z0-9_]*: ClassData = \{/);
  });

  it("generates a valid identifier for digit-leading and all-symbol names", () => {
    const p: Proposal = {
      updates: [],
      adds: [
        { kind: "class", entry: customClass("2Handed Sword") },
        { kind: "class", entry: customClass("!!!") },
      ],
    };
    const r = applyProposalText(SRC, p);
    expect(r.out).toContain("const e2handedsword: ClassData = {");
    expect(r.out).toContain("const entry: ClassData = {");
  });
});
