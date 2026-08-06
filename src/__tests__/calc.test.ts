import { describe, it, expect } from "bun:test";
import { evaluate } from "../commands/calc.js";

describe("calc", () => {
  it("adds", () => {
    expect(evaluate("2+2")).toBe(4);
  });

  it("obeys operator precedence", () => {
    expect(evaluate("2+3*4")).toBe(14);
    expect(evaluate("(2+3)*4")).toBe(20);
  });

  it("handles division and unary minus", () => {
    expect(evaluate("10/4")).toBe(2.5);
    expect(evaluate("-5+3")).toBe(-2);
  });

  it("supports exponents", () => {
    expect(evaluate("2^10")).toBe(1024);
  });

  it("handles decimals", () => {
    expect(evaluate("1.5*2")).toBe(3);
  });

  it("rejects invalid input", () => {
    expect(evaluate("2+")).toBeNull();
    expect(evaluate("abc")).toBeNull();
    expect(evaluate("2+3)")).toBeNull();
    expect(evaluate("")).toBeNull();
  });
});
