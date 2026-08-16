import { describe, expect, test } from "bun:test";
import { loadGameData } from "../data/index.js";
import { wtLookup, chunkBlocks } from "../commands/info.js";

loadGameData();

// Every <details> block is atomic: chunks must never split one mid-tag, and
// each sent chunk must have balanced open/close tags.
function assertBalanced(chunks: string[]) {
  for (const c of chunks) {
    const open = (c.match(/<details>/g) || []).length;
    const close = (c.match(/<\/details>/g) || []).length;
    expect(open, `chunk has unbalanced <details>:\n${c.slice(0, 120)}`).toBe(close);
  }
}

describe("wtLookup %wt two-token lookup", () => {
  test("class + ability prints only that ability", () => {
    const out = wtLookup("bard dissonance");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("<b>Dissonance</b>");
    // The single-ability reply must not drag in the class's other abilities.
    expect(out[0]).not.toContain("<b>Duet</b>");
  });

  test("weapon + ability prints only that ability", () => {
    const out = wtLookup("gladius breach");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("<b>Breach</b>");
    expect(out[0]).not.toContain("<b>Triumvirate</b>");
  });

  test("known owner with unknown ability reports it", () => {
    const out = wtLookup("bard zzzz");
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('No ability "zzzz" on Bard.');
  });

  test("unknown owner falls through to the no-data message", () => {
    const out = wtLookup("zzzz zzzz");
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('No data for "zzzz zzzz".');
  });
});

describe("wtLookup %wt lookups", () => {
  test("ability-only search still works", () => {
    const out = wtLookup("dissonance");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("<b>Dissonance</b>");
  });

  test("class dump blocks are atomic and chunked without splitting <details>", () => {
    const blocks = wtLookup("bard");
    // Header + one block per ability.
    expect(blocks.length).toBeGreaterThan(3);
    for (const b of blocks) {
      expect(b.match(/<details>/g)?.length ?? 0).toBe(b.match(/<\/details>/g)?.length ?? 0);
    }
    const chunks = chunkBlocks(blocks);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(900);
    }
    assertBalanced(chunks);
  });

  test("single oversized ability block stays intact in one chunk", () => {
    const blocks = wtLookup("cards");
    const dump = blocks.find((b) => b.length > 900);
    if (dump) {
      const chunks = chunkBlocks(blocks);
      expect(chunks.some((c) => c === dump || c.includes(dump))).toBe(true);
      assertBalanced(chunks);
    }
  });

  test("modes listing chunks keep each mode's <details> whole", () => {
    const blocks = wtLookup("modes");
    expect(blocks.length).toBeGreaterThan(1);
    const chunks = chunkBlocks(blocks);
    assertBalanced(chunks);
  });

  test("unknown single token reports no data", () => {
    const out = wtLookup("zzzz");
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('No data for "zzzz".');
  });

  test("empty args reports usage", () => {
    const out = wtLookup("");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Usage:");
  });
});
