// abilityeditor/serializer.ts
//
// Pure helpers for reading/writing the bot's data source file
// (src/data/index.ts) with MINIMAL diffs. Shared by:
//   - abilityeditor/server.ts          -> "Save to Bot" (local)
//   - scripts/apply-editor-proposal.ts -> "Ability: ..." issue -> PR

import fs from "fs";

export interface Block {
  varName: string;
  type: EntryType;
  name: string;
  chunkStart: number;
  chunkEnd: number;
  literalText: string;
}

export type EntryType = "ClassData" | "WeaponData" | "ItemData";

export interface EntryLike {
  name: string;
  type: EntryType;
  entry: Record<string, unknown>;
  /** Original name in src/data/index.ts when the entry was renamed in the editor. */
  sourceName?: string;
}

export function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const CLASS_KEYS = ["name", "stats", "description", "abilities"];
export const WEAPON_KEYS = ["name", "branch", "stats", "description", "abilities"];
export const STAT_KEYS = ["hp", "atk", "mag", "pd", "md", "eva", "mp"];
export const ABILITY_KEYS = [
  "name", "level", "frequency", "mr", "roll", "damageType", "actionType",
  "targetAmount", "targetGroup", "range", "effect", "maxUses", "cost", "choices",
];
export const ITEM_KEYS = [
  "name", "slots", "rank", "gold", "materials", "statBoosts",
  "statNerfs", "frequency", "actionType", "effect",
];
export const COST_KEYS = ["type", "resource", "amount", "prompt"];
export const CHOICE_KEYS = ["id", "label"];

function indentStr(n: number): string {
  return " ".repeat(n);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Only run `new Function` on text that is clearly a plain object literal. */
function looksLikeObjectLiteral(text: string): boolean {
  return /^\{[\s\S]*\}$/.test(text.trim());
}

function primitive(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function inlineObj(o: Record<string, unknown>, keys: string[]): string {
  const parts = keys
    .filter((k) => o[k] !== undefined)
    .map((k) => `${k}: ${primitive(o[k])}`);
  return `{ ${parts.join(", ")} }`;
}

function fieldValue(key: string, v: unknown, indent: number): string {
  if (key === "cost" && isPlainObject(v)) return inlineObj(v, COST_KEYS);
  if (key === "choices" && Array.isArray(v)) {
    const items = v.map(
      (c) => `${indentStr(indent + 2)}${inlineObj(c, CHOICE_KEYS)},`,
    );
    return `[\n${items.join("\n")}\n${indentStr(indent)}]`;
  }
  if (Array.isArray(v)) return serializeArray(v, indent);
  if (isPlainObject(v)) return serializeObject(v, STAT_KEYS, indent);
  return primitive(v);
}


export function serializeObject(
  obj: Record<string, unknown>,
  keys: string[],
  indent: number,
): string {
  const lines: string[] = ["{"];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    if (
      (k === "effect" || k === "description") &&
      typeof v === "string" &&
      v !== ""
    ) {
      lines.push(
        `${indentStr(indent + 2)}${k}:\n${indentStr(indent + 4)}${primitive(v)},`,
      );
    } else {
      lines.push(`${indentStr(indent + 2)}${k}: ${fieldValue(k, v, indent + 2)},`);
    }
  }
  lines.push(`${indentStr(indent)}}`);
  return lines.join("\n");
}

export function serializeArray(arr: unknown[], indent: number): string {
  if (arr.length === 0) return "[]";
  const items = arr.map((it) =>
    indentStr(indent + 2) +
      serializeObject(it as Record<string, unknown>, ABILITY_KEYS, indent + 2) +
      ",",
  );
  return `[\n${items.join("\n")}\n${indentStr(indent)}]`;
}

export function serializeBlock(
  entry: Record<string, unknown>,
  type: EntryType,
  varName: string,
): string {
  const keys =
    type === "ClassData" ? CLASS_KEYS : type === "WeaponData" ? WEAPON_KEYS : ITEM_KEYS;
  const setter =
    type === "ClassData" ? "classes" : type === "WeaponData" ? "weapons" : "items";
  const body = serializeObject(entry, keys, 2);
  // The name is emitted via JSON.stringify so quotes/backslashes can never
  // break out of the string literal (arbitrary names must stay inert).
  const nameLit = JSON.stringify(String(entry.name ?? ""));
  return [
    `  const ${varName}: ${type} = ${body};`,
    `  ${setter}.set(toId(${nameLit}), ${varName});`,
  ].join("\n");
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka
        .filter((k) => a[k] !== undefined)
        .every((k) => deepEqual(a[k], b[k])) &&
      kb
        .filter((k) => b[k] !== undefined)
        .every((k) => deepEqual(b[k], a[k]))
    );
  }
  return false;
}

function varNameFor(id: string): string {
  if (!id) return "entry";
  return /^\d/.test(id) ? "e" + id : id;
}

function uniqueVar(base: string, used: Set<string>): string {
  base = varNameFor(base);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(base + i)) return base + i;
}

/** Locate every `const x: ClassData = { ... }; classes.set(...)` chunk. */
export function findBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const re = /\n  const ([A-Za-z0-9_]+): (ClassData|WeaponData|ItemData) = \{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const varName = m[1];
    const type = m[2] as EntryType;
    const literalStart = m.index + m[0].length - 1;
    let i = literalStart;
    let depth = 0;
    let inStr: string | null = null;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (ch === "\\") { i++; continue; }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === "/" && text[i + 1] === "/") {
        const nl = text.indexOf("\n", i);
        i = nl === -1 ? text.length : nl;
        continue;
      }
      if (ch === "/" && text[i + 1] === "*") {
        const close = text.indexOf("*/", i + 2);
        i = close === -1 ? text.length : close + 1;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) break; }
    }
    const literalEnd = i;
    let chunkEnd = literalEnd + 1;
    if (text[chunkEnd] === ";") chunkEnd++;
    const rest = text.slice(chunkEnd);
    const setMatch = rest.match(
      /^\n[ \t]*(?:classes|weapons|items)\.set\(toId\("(?:[^"\\]|\\.)*"\),[ \t]*\w+\);/,
    );
    let name = "";
    if (setMatch) {
      const nm = setMatch[0].match(/toId\("((?:[^"\\]|\\.)*)"\)/);
      name = nm ? JSON.parse('"' + nm[1] + '"') : "";
      chunkEnd += setMatch[0].length;
    }
    const literalText = text.slice(literalStart, literalEnd + 1);
    if (!name && looksLikeObjectLiteral(literalText)) {
      try {
        const parsed = new Function("return " + literalText)();
        name = parsed?.name ?? "";
      } catch { /* leave empty */ }
    }
    blocks.push({ varName, type, name, chunkStart: m.index + 1, chunkEnd, literalText });
  }
  return blocks;
}


// ---------------------------------------------------------------------------
// Minimal-diff regeneration
// ---------------------------------------------------------------------------

export interface RegenResult {
  changed: string[];
  inserted: string[];
  out: string;
}

/**
 * Rewrite `text` so the given entries replace their existing blocks. Only
 * entries whose serialized form differs are rewritten (minimal diff); entries
 * with no matching block are appended before the "// Build branches" marker
 * (used for newly-inserted built-ins).
 */
export function regenerateSourceText(
  text: string,
  entries: EntryLike[],
): RegenResult {
  const blocks = findBlocks(text);
  const byName = new Map<string, Block>();
  for (const b of blocks) byName.set(b.name, b);
  const usedVars = new Set(blocks.map((b) => b.varName));

  const changed: string[] = [];
  const inserted: string[] = [];
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const appendTexts: string[] = [];

  for (const e of entries) {
    // A renamed built-in keeps its original source name for block lookup.
    let block = e.sourceName ? byName.get(e.sourceName) : undefined;
    if (!block) block = byName.get(e.name);
    if (!block) block = blocks.find((b) => toId(b.name) === toId(e.name));
    if (block) {
      let parsed: Record<string, unknown> | null = null;
      if (looksLikeObjectLiteral(block.literalText)) {
        try {
          parsed = new Function("return " + block.literalText)() as Record<string, unknown>;
        } catch { /* fall through to rewrite */ }
      }
      if (parsed && deepEqual(parsed, e.entry)) continue;
      let varName = block.varName;
      if (toId(block.name) !== toId(e.name)) {
        varName = uniqueVar(toId(e.name), usedVars);
        usedVars.add(varName);
      }
      edits.push({
        start: block.chunkStart,
        end: block.chunkEnd,
        text: serializeBlock(e.entry, e.type, varName),
      });
      changed.push(e.name);
    } else {
      const varName = uniqueVar(toId(e.name), usedVars);
      usedVars.add(varName);
      appendTexts.push(serializeBlock(e.entry, e.type, varName));
      inserted.push(e.name);
    }
  }

  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const ed of edits) {
    out = out.slice(0, ed.start) + ed.text + out.slice(ed.end);
  }

  if (appendTexts.length) {
    const marker = "  // Build branches";
    const idx = out.indexOf(marker);
    if (idx === -1) {
      throw new Error("Could not find insertion point in src/data/index.ts");
    }
    out = out.slice(0, idx) + appendTexts.join("\n\n") + "\n\n" + out.slice(idx);
  }

  return { changed, inserted, out };
}

// ---------------------------------------------------------------------------
// File helpers (preserve whatever line endings the source already uses)
// ---------------------------------------------------------------------------

export function detectEol(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** Read a source file and normalize to LF (CRLF working copies break scans). */
export function readSourceText(srcPath: string): string {
  return fs.readFileSync(srcPath, "utf8").replace(/\r\n/g, "\n");
}

/** Write regenerated source back, preserving the file's existing line endings. */
export function writeSourceText(srcPath: string, out: string): void {
  const eol = detectEol(fs.readFileSync(srcPath, "utf8"));
  fs.writeFileSync(srcPath, eol === "\r\n" ? out.replace(/\n/g, "\r\n") : out);
}

// ---------------------------------------------------------------------------
// Sanitizers (shared by the local server and the proposal workflow)
// ---------------------------------------------------------------------------

export function normalizeLevel(v: unknown): number | "EX1" | "EX2" {
  const s = String(v ?? "1").trim().toUpperCase();
  if (s === "EX1" || s === "EX2") return s as "EX1" | "EX2";
  const n = parseInt(s, 10);
  return isNaN(n) ? 1 : Math.max(1, Math.min(10, n));
}

export function sanitizeAbility(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const clean: Record<string, unknown> = {};
  for (const k of ABILITY_KEYS) {
    let v = raw[k];
    if (v === undefined || v === null || v === "") {
      if (k === "name") continue;
      if (k === "cost" || k === "choices") continue;
      if (k === "maxUses") continue;
    }
    if (k === "level") v = normalizeLevel(v);
    else if (k === "mr") v = Number(v) || 0;
    else if (k === "maxUses") v = Number(v) || 1;
    else if (k === "targetAmount") {
      v = typeof v === "string" && isNaN(Number(v)) ? v : Number(v);
    } else if (k === "cost" && isPlainObject(v)) {
      const cost: Record<string, unknown> = {};
      for (const ck of COST_KEYS) if (v[ck] !== undefined) cost[ck] = v[ck];
      if (Object.keys(cost).length) v = cost;
      else continue;
    } else if (k === "choices" && Array.isArray(v)) {
      const ch = v
        .filter((c) => c?.id && c?.label)
        .map((c) => ({ id: String(c.id), label: String(c.label) }));
      if (!ch.length) continue;
      v = ch;
    }
    clean[k] = v;
  }
  return clean;
}

/**
 * Normalize a proposal entry (from a public "Ability: ..." issue) into the
 * shape the source file expects: string stats, sanitized abilities, and only
 * the keys that exist in the source format.
 */
export function normalizeProposalEntry(
  raw: Record<string, unknown>,
  type: EntryType,
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    name: String(raw.name ?? "").trim(),
  };
  if (type === "WeaponData") entry.branch = String(raw.branch ?? "");
  const stats: Record<string, string> = {};
  const rawStats = isPlainObject(raw.stats) ? raw.stats : {};
  // Fill every stat key (default "0") so the regenerated source always
  // satisfies the ClassData/WeaponData types even for partial payloads.
  for (const k of STAT_KEYS) {
    stats[k] = rawStats[k] !== undefined ? String(rawStats[k]) : "0";
  }
  entry.stats = stats;
  entry.abilities = Array.isArray(raw.abilities)
    ? raw.abilities.map(sanitizeAbility).filter((a) => a.name)
    : [];
  entry.description = String(raw.description ?? "");
  return entry;
}
