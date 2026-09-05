import { describe, expect, it } from "bun:test";
import {
  DARK_PASTEL_BACKGROUNDS,
  backgroundForVersion,
  isDarkOrPastelBackground,
  nextBackgroundIndex,
} from "../theme/background-rotation.js";

describe("test-client background rotation", () => {
  it("keeps the same background for repeated renders of one version", () => {
    const first = backgroundForVersion("v1", undefined);
    expect(backgroundForVersion("v1", first)).toEqual(first);
  });

  it("changes versions without selecting an adjacent palette entry", () => {
    const first = backgroundForVersion("v1", undefined);
    const second = backgroundForVersion("v2", first);
    expect(second.index).not.toBe(first.index);
    expect(Math.abs(second.index - first.index)).toBeGreaterThan(1);
  });

  it("uses only dark or pastel backgrounds", () => {
    for (const color of DARK_PASTEL_BACKGROUNDS) {
      expect(isDarkOrPastelBackground(color)).toBe(true);
    }
  });

  it("handles negative and oversized previous indexes", () => {
    expect(nextBackgroundIndex(-1)).toBeGreaterThanOrEqual(0);
    expect(nextBackgroundIndex(100)).toBeLessThan(DARK_PASTEL_BACKGROUNDS.length);
  });
});
