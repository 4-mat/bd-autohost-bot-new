import { describe, it, expect } from "bun:test";
import {
  buildProposalPayload,
  isObjectEntry,
  normalizeKind,
  normalizeMode,
  parseEntryJson,
  proposalIssueBody,
  proposalTitle,
} from "../proposal.js";

describe("normalizeKind", () => {
  it("defaults to class for empty input", () => {
    expect(normalizeKind(undefined)).toBe("class");
    expect(normalizeKind("")).toBe("class");
  });
  it("rejects unrecognized kinds instead of coercing", () => {
    expect(normalizeKind("bogus")).toBeNull();
    expect(normalizeKind("wepon")).toBeNull();
  });
  it("accepts class, weapon and shorthand", () => {
    expect(normalizeKind("class")).toBe("class");
    expect(normalizeKind("weapon")).toBe("weapon");
    expect(normalizeKind("Weapon")).toBe("weapon");
    expect(normalizeKind("w")).toBe("weapon");
  });
});

describe("normalizeMode", () => {
  it("defaults to add for empty input", () => {
    expect(normalizeMode(undefined)).toBe("add");
    expect(normalizeMode("")).toBe("add");
  });
  it("rejects unrecognized modes instead of coercing", () => {
    expect(normalizeMode("bogus")).toBeNull();
    expect(normalizeMode("remov")).toBeNull();
  });
  it("accepts add, update and shorthands", () => {
    expect(normalizeMode("add")).toBe("add");
    expect(normalizeMode("update")).toBe("update");
    expect(normalizeMode("upd")).toBe("update");
    expect(normalizeMode("u")).toBe("update");
    expect(normalizeMode("edit")).toBe("update");
  });
});

describe("buildProposalPayload", () => {
  const entry = { stats: { hp: "80", atk: "7" }, abilities: [] };

  it("builds an adds payload for mode=add", () => {
    const payload = buildProposalPayload({
      mode: "add",
      kind: "class",
      name: "Bard",
      entry,
    });
    expect(payload.updates).toEqual([]);
    expect(payload.adds).toHaveLength(1);
    expect(payload.adds[0].kind).toBe("class");
    expect(payload.adds[0].entry).toMatchObject({ name: "Bard" });
  });

  it("builds an updates payload for mode=update and keeps the name at top level", () => {
    const payload = buildProposalPayload({
      mode: "update",
      kind: "weapon",
      name: "Gladius",
      entry: { ...entry },
    });
    expect(payload.adds).toEqual([]);
    expect(payload.updates).toHaveLength(1);
    expect(payload.updates[0]).toMatchObject({
      kind: "weapon",
      name: "Gladius",
    });
    expect(payload.updates[0].entry).toMatchObject({ name: "Gladius" });
  });

  it("overrides any name in the entry with the proposal name", () => {
    const payload = buildProposalPayload({
      mode: "add",
      kind: "class",
      name: "Bard",
      entry: { ...entry, name: "WRONG" },
    });
    expect(payload.adds[0].entry.name).toBe("Bard");
  });
});

describe("proposalIssueBody / proposalTitle", () => {
  it("embeds the payload in a ```json code block", () => {
    const proposal = {
      mode: "add" as const,
      kind: "class" as const,
      name: "Bard",
      entry: { stats: { hp: "80" } },
    };
    const body = proposalIssueBody(proposal, buildProposalPayload(proposal));
    expect(body).toContain("```json");
    expect(body).toContain('"kind": "class"');
    expect(body).toContain('"Bard"');
  });

  it("title starts with 'Ability: ' (workflow trigger)", () => {
    expect(proposalTitle("Bard")).toBe("Ability: Bard");
  });
});

describe("parseEntryJson / isObjectEntry", () => {
  it("accepts a JSON object", () => {
    expect(parseEntryJson('{"stats":{"hp":"80"}}')).toEqual({
      stats: { hp: "80" },
    });
    expect(isObjectEntry({ a: 1 })).toBe(true);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseEntryJson("{not json")).toThrow(
      /didn't parse/,
    );
  });

  it("rejects null, arrays, and scalars as entry", () => {
    expect(() => parseEntryJson("null")).toThrow(/must be an object/);
    expect(() => parseEntryJson("[1,2]")).toThrow(/must be an object/);
    expect(() => parseEntryJson("\"hi\"")).toThrow(/must be an object/);
    expect(() => parseEntryJson("42")).toThrow(/must be an object/);
    expect(isObjectEntry(null)).toBe(false);
    expect(isObjectEntry([])).toBe(false);
    expect(isObjectEntry("x")).toBe(false);
  });

  it("buildProposalPayload rejects a non-object entry", () => {
    expect(() =>
      buildProposalPayload({
        mode: "add",
        kind: "class",
        name: "Bard",
        entry: null as unknown as Record<string, unknown>,
      }),
    ).toThrow(/must be a JSON object/);
  });
});
