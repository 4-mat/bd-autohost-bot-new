import { describe, it, expect, beforeEach } from "bun:test";
import { recordGame, getRecords, resetRecords } from "../records.js";

describe("records", () => {
  beforeEach(() => resetRecords());

  it("accumulates kills, wins, and games", () => {
    recordGame({
      winner: "P1",
      kills: { P1: 2, P2: 1 },
      entities: [
        { num: "P1", name: "Alice", isMonster: false },
        { num: "P2", name: "Bob", isMonster: false },
      ],
    });
    recordGame({
      winner: "P2",
      kills: { P2: 1 },
      entities: [
        { num: "P1", name: "Alice", isMonster: false },
        { num: "P2", name: "Bob", isMonster: false },
      ],
    });

    const rows = getRecords();
    expect(rows).toHaveLength(2);
    // Alice: 1 win, 2 kills, 2 games. Bob: 1 win, 2 kills, 2 games.
    // Tied on wins/kills/games, so sort falls back to name (Alice first).
    expect(rows[0].name).toBe("Alice");
    expect(rows[0].wins).toBe(1);
    expect(rows[0].kills).toBe(2);
    expect(rows[0].games).toBe(2);
    expect(rows[1].name).toBe("Bob");
  });

  it("skips monsters", () => {
    recordGame({
      winner: "P1",
      kills: { M1: 5 },
      entities: [
        { num: "P1", name: "Alice", isMonster: false },
        { num: "M1", name: "Goblin", isMonster: true },
      ],
    });
    const names = getRecords(100).map((r) => r.name);
    expect(names).toContain("Alice");
    expect(names).not.toContain("Goblin");
  });

  it("honors the limit", () => {
    for (let i = 0; i < 5; i++) {
      recordGame({
        winner: `P${i + 1}`,
        kills: {},
        entities: [{ num: `P${i + 1}`, name: `Player${i}`, isMonster: false }],
      });
    }
    expect(getRecords(2)).toHaveLength(2);
    expect(getRecords()).toHaveLength(5);
  });
});
