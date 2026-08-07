import { sendPm } from "../utils.js";
import type { User } from "../users.js";

export function calcCommand(user: User, expr: string) {
  const result = evaluate(expr);
  if (result === null) return sendPm(user.name, "Invalid expression.");
  sendPm(user.name, `${expr.trim()} = ${fmt(result)}`);
}

function fmt(n: number): string {
  if (!isFinite(n)) return "undefined";
  return String(Math.round(n * 1e6) / 1e6);
}

export function evaluate(src: string): number | null {
  let i = 0;

  function skip() {
    while (i < src.length && /\s/.test(src[i])) i++;
  }

  function primary(): number | null {
    skip();
    if (src[i] === "(") {
      i++;
      const v = add();
      if (v === null) return null;
      skip();
      if (src[i] !== ")") return null;
      i++;
      return v;
    }
    if (src[i] === "-") {
      i++;
      const v = primary();
      return v === null ? null : -v;
    }
    const m = /^\d*\.?\d+/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  }

  function pow(): number | null {
    let v = primary();
    while (true) {
      skip();
      if (src[i] !== "^") break;
      i++;
      const r = primary();
      if (v === null || r === null) return null;
      v = Math.pow(v, r);
    }
    return v;
  }

  function mul(): number | null {
    let v = pow();
    while (true) {
      skip();
      const op = src[i];
      if (op !== "*" && op !== "/") break;
      i++;
      const r = pow();
      if (v === null || r === null) return null;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }

  function add(): number | null {
    let v = mul();
    while (true) {
      skip();
      const op = src[i];
      if (op !== "+" && op !== "-") break;
      i++;
      const r = mul();
      if (v === null || r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const v = add();
  if (v === null) return null;
  skip();
  if (i !== src.length) return null;
  return v;
}
