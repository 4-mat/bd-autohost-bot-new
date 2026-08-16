import { describe, expect, test } from "bun:test";
import { loadGameData } from "../data/index.js";
import { wtLookup } from "../commands/info.js";

loadGameData();

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

  test("class dump is chunked and every chunk stays under the PM limit", () => {
    const out = wtLookup("bard");
    expect(out).toHaveLength(1);
    expect(out[0].length).toBeGreaterThan(900);
    // sendPmChunks splits on newlines into <=900-char pieces — verify the
    // dump would actually chunk (the anti-truncation requirement).
    const chunks: string[] = [];
    let start = 0;
    while (start < out[0].length) {
      let end = start + 900;
      if (end < out[0].length) {
        const newline = out[0].lastIndexOf("\n", end);
        if (newline > start) end = newline + 1;
      }
      chunks.push(out[0].slice(start, end).trim());
      start = end;
    }
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(900);
    }
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
