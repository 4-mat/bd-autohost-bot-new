// abilityeditor/server.ts
//
// Battle Dome Ability Editor — local server.
//
//   npm run editor            → http://localhost:4700
//   PORT=8080 npm run editor  → http://localhost:8080
//   HOST=0.0.0.0 npm run editor → bind all interfaces (default: 127.0.0.1)
//
// The server loads the same game data the bot uses (src/data/index.ts) and
// keeps the authoritative in-memory `classes`/`weapons` Maps:
//
//   - Edit any built-in class/weapon's stats or abilities → applied to the
//     running Maps immediately and mirrored to abilityeditor/runtime-data.json
//     so the test client (and the bot) can pick the edits up live.
//   - "Save to Bot" regenerates src/data/index.ts, rewriting ONLY the entries
//     that actually changed (minimal-diff codegen), so the git diff in a PR
//     shows exactly what was edited.
//   - Custom test classes/weapons live in memory + abilityeditor/
//     customs.local.json (gitignored). They are NEVER written to
//     src/data/index.ts, so they never become part of the bot permanently.

import http from "http";
import fs from "fs";
import path from "path";
import {
  loadGameData,
  classes,
  weapons,
  branches,
  type ClassData,
  type WeaponData,
} from "../src/data/index.js";
import { writeEditorSnapshot } from "../src/data/overrides.js";

const PORT = Number(process.env.PORT) || 4700;
const ROOT = path.join(import.meta.dirname, "..");
const SRC_PATH = path.join(ROOT, "src", "data", "index.ts");
const CUSTOMS_PATH = path.join(import.meta.dirname, "customs.local.json");

// The source file uses CRLF line endings; preserve whatever the file already
// uses so a regenerate keeps the git diff minimal on any machine.
function detectSourceEol(): "\r\n" | "\n" {
  try {
    const head = fs.readFileSync(SRC_PATH, "utf8").slice(0, 1 << 16);
    return head.includes("\r\n") ? "\r\n" : "\n";
  } catch {
    return "\n";
  }
}
const SOURCE_EOL = detectSourceEol();

function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Custom test class/weapon tracking (in-memory + gitignored local file)
// ---------------------------------------------------------------------------

const customNames = new Set<string>();
let pendingRegen = false;

function loadCustoms() {
  if (!fs.existsSync(CUSTOMS_PATH)) return;
  try {
    const data = JSON.parse(fs.readFileSync(CUSTOMS_PATH, "utf8"));
    for (const c of data.classes ?? []) {
      if (c?.name) {
        classes.set(toId(c.name), c);
        customNames.add(toId(c.name));
      }
    }
    for (const w of data.weapons ?? []) {
      if (w?.name) {
        weapons.set(toId(w.name), w);
        customNames.add(toId(w.name));
      }
    }
  } catch (e) {
    console.error("[ability-editor] failed to load customs:", e);
  }
}

function saveCustoms() {
  const data = {
    classes: [...classes.values()].filter((c) => customNames.has(toId(c.name))),
    weapons: [...weapons.values()].filter((w) => customNames.has(toId(w.name))),
  };
  fs.writeFileSync(CUSTOMS_PATH, JSON.stringify(data, null, 2) + "\n");
}

function isCustom(name: string): boolean {
  return customNames.has(toId(name));
}

// ---------------------------------------------------------------------------
// Codegen: rewrite src/data/index.ts with minimal diffs
// ---------------------------------------------------------------------------

interface Block {
  varName: string;
  type: "ClassData" | "WeaponData";
  name: string;
  chunkStart: number;
  chunkEnd: number;
  literalText: string;
}

/** Locate every `const x: ClassData = { ... }; classes.set(...)` chunk. */
function findBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const re = /\n  const ([A-Za-z0-9_]+): (ClassData|WeaponData) = \{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const varName = m[1];
    const type = m[2] as Block["type"];
    const literalStart = m.index + m[0].length - 1; // the '{'
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
      if (ch === "'" || ch === '"') { inStr = ch; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) break; }
    }
    const literalEnd = i;
    let chunkEnd = literalEnd + 1;
    if (text[chunkEnd] === ";") chunkEnd++;
    const rest = text.slice(chunkEnd);
    const setMatch = rest.match(
      /^\n[ \t]*(?:classes|weapons)\.set\(toId\("[^"]*"\),[ \t]*\w+\);/,
    );
    let name = "";
    if (setMatch) {
      const nm = setMatch[0].match(/toId\("([^"]*)"\)/);
      name = nm ? nm[1] : "";
      chunkEnd += setMatch[0].length;
    }
    const literalText = text.slice(literalStart, literalEnd + 1);
    if (!name) {
      try {
        const parsed = new Function("return " + literalText)();
        name = parsed?.name ?? "";
      } catch { /* leave empty */ }
    }
    blocks.push({ varName, type, name, chunkStart: m.index + 1, chunkEnd, literalText });
  }
  return blocks;
}

const CLASS_KEYS = ["name", "stats", "description", "abilities"];
const WEAPON_KEYS = ["name", "branch", "stats", "description", "abilities"];
const STAT_KEYS = ["hp", "atk", "mag", "pd", "md", "eva", "mp"];
const ABILITY_KEYS = [
  "name", "level", "frequency", "mr", "roll", "damageType", "actionType",
  "targetAmount", "targetGroup", "range", "effect", "maxUses", "cost", "choices",
];
const COST_KEYS = ["type", "resource", "amount", "prompt"];
const CHOICE_KEYS = ["id", "label"];

function indentStr(n: number): string {
  return " ".repeat(n);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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

function serializeObject(
  obj: Record<string, unknown>,
  keys: string[],
  indent: number,
): string {
  // Matches the file's existing style: `effect`/`description` strings that
  // are non-empty go on their own (deeper-indented) line, everything else
  // stays inline; `cost` is a single-line object and `choices` a multi-line
  // array of single-line objects.
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

function serializeArray(arr: unknown[], indent: number): string {
  if (arr.length === 0) return "[]";
  const items = arr.map((it) =>
    indentStr(indent + 2) +
      serializeObject(it as Record<string, unknown>, ABILITY_KEYS, indent + 2) +
      ",",
  );
  return `[\n${items.join("\n")}\n${indentStr(indent)}]`;
}

function serializeBlock(
  entry: Record<string, unknown>,
  type: "ClassData" | "WeaponData",
  varName: string,
): string {
  const keys = type === "ClassData" ? CLASS_KEYS : WEAPON_KEYS;
  const setter = type === "ClassData" ? "classes" : "weapons";
  const body = serializeObject(entry, keys, 2);
  return [
    `  const ${varName}: ${type} = ${body};`,
    `  ${setter}.set(toId("${entry.name}"), ${varName});`,
  ].join("\n");
}

function deepEqual(a: unknown, b: unknown): boolean {
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

function uniqueVar(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(base + i)) return base + i;
}

function regenerateSource(): { changed: string[]; inserted: string[]; out: string } {
  // Normalize to LF: the working copy may be CRLF (core.autocrlf), which
  // would break the set-call scan and produce mixed line endings on write.
  const text = fs.readFileSync(SRC_PATH, "utf8").replace(/\r\n/g, "\n");
  const blocks = findBlocks(text);
  const byName = new Map<string, Block>();
  for (const b of blocks) byName.set(b.name, b);
  const usedVars = new Set(blocks.map((b) => b.varName));

  const changed: string[] = [];
  const inserted: string[] = [];
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const appendTexts: string[] = [];

  const entries: Array<{
    name: string;
    type: "ClassData" | "WeaponData";
    entry: Record<string, unknown>;
  }> = [];
  for (const c of classes.values()) {
    if (!isCustom(c.name)) {
      entries.push({ name: c.name, type: "ClassData", entry: c as unknown as Record<string, unknown> });
    }
  }
  for (const w of weapons.values()) {
    if (!isCustom(w.name)) {
      entries.push({ name: w.name, type: "WeaponData", entry: w as unknown as Record<string, unknown> });
    }
  }

  for (const e of entries) {
    let block = byName.get(e.name);
    if (!block) {
      block = blocks.find((b) => toId(b.name) === toId(e.name));
    }
    if (block) {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = new Function("return " + block.literalText)() as Record<string, unknown>;
      } catch { /* fall through to rewrite */ }
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
// Mutations (all applied to the in-memory Maps + mirrored for game processes)
// ---------------------------------------------------------------------------

function touch() {
  pendingRegen = true;
  writeEditorSnapshot();
}

function entryMap(kind: string): Map<string, any> | null {
  if (kind === "class") return classes as Map<string, any>;
  if (kind === "weapon") return weapons as Map<string, any>;
  return null;
}

function normalizeLevel(v: unknown): number | "EX1" | "EX2" {
  const s = String(v ?? "1").trim().toUpperCase();
  if (s === "EX1" || s === "EX2") return s as "EX1" | "EX2";
  const n = parseInt(s, 10);
  return isNaN(n) ? 1 : Math.max(1, Math.min(10, n));
}

function sanitizeAbility(raw: any): Record<string, unknown> {
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

function defaultClass(name: string, item: any): ClassData {
  const s = item?.stats ?? {};
  const stats: ClassData["stats"] = { hp: "0", atk: "0", mag: "0", pd: "0", md: "0", eva: "0", mp: "0" };
  for (const k of STAT_KEYS) if (s[k] !== undefined) stats[k] = String(s[k]);
  return {
    name,
    stats,
    abilities: (item?.abilities ?? []) as ClassData["abilities"],
    description: item?.description ?? "",
  };
}

function defaultWeapon(name: string, item: any): WeaponData {
  const w = defaultClass(name, item);
  return {
    name,
    branch: item?.branch ?? "",
    stats: w.stats,
    abilities: w.abilities,
    description: item?.description ?? "",
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function send(res: http.ServerResponse, code: number, body: unknown, type?: string) {
  const h: Record<string, string> = {
    "Content-Type": type ?? "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  res.writeHead(code, h);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 5e6) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Mutations are only accepted from this local server's own origin.
function localOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return (
      (o.hostname === "localhost" || o.hostname === "127.0.0.1") &&
      (!o.port || o.port === String(PORT))
    );
  } catch {
    return false;
  }
}

function snapshot() {
  return {
    classes: [...classes.values()],
    weapons: [...weapons.values()],
    customs: [...customNames],
  };
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;

  if (p === "/" || p === "/index.html") {
    const html = fs.readFileSync(path.join(import.meta.dirname, "index.html"), "utf8");
    send(res, 200, html, "text/html; charset=utf-8");
    return;
  }

  if (p === "/api/data" && req.method === "GET") {
    send(res, 200, snapshot());
    return;
  }
  if (p === "/api/status" && req.method === "GET") {
    send(res, 200, { pendingRegen, customCount: customNames.size });
    return;
  }

  if (req.method !== "POST") {
    send(res, 404, { error: "not found" });
    return;
  }
  if (!localOrigin(req.headers.origin)) {
    send(res, 403, { error: "forbidden origin" });
    return;
  }

  let body: any = {};
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    send(res, 400, { error: "invalid JSON body" });
    return;
  }

  try {
    if (p === "/api/update") {
      const { kind, name, patch } = body;
      const map = entryMap(kind);
      const entry = map?.get(toId(name));
      if (!map || !entry) {
        send(res, 404, { error: `${kind ?? "?"} '${name ?? "?"}' not found` });
        return;
      }
      if (patch && isPlainObject(patch)) {
        if (patch.name !== undefined) {
          const newName = String(patch.name).trim();
          if (!newName) {
            send(res, 400, { error: "name cannot be empty" });
            return;
          }
          if (toId(newName) !== toId(name)) {
            if (map.has(toId(newName))) {
              send(res, 400, { error: `A ${kind} named '${newName}' already exists` });
              return;
            }
            map.delete(toId(name));
            entry.name = newName;
            if (customNames.has(toId(name))) {
              customNames.delete(toId(name));
              customNames.add(toId(newName));
            }
            map.set(toId(newName), entry);
          }
        }
        for (const [k, v] of Object.entries(patch)) {
          if (k === "name") continue;
          if (k === "stats" && isPlainObject(v)) {
            for (const sk of STAT_KEYS) {
              if (v[sk] !== undefined) entry.stats[sk] = String(v[sk]);
            }
          } else if (k === "description" || k === "branch") {
            entry[k] = String(v);
          } else if (k === "abilities" && Array.isArray(v)) {
            entry.abilities = v.map(sanitizeAbility);
          }
        }
      }
      touch();
      send(res, 200, { ok: true, name: entry.name });
      return;
    }

    if (p === "/api/ability") {
      const { kind, owner, action, name, ability } = body;
      const map = entryMap(kind);
      const entry = map?.get(toId(owner));
      if (!map || !entry) {
        send(res, 404, { error: `${kind ?? "?"} '${owner ?? "?"}' not found` });
        return;
      }
      const abilities = entry.abilities ?? (entry.abilities = []);
      if (action === "add") {
        const a = sanitizeAbility(ability ?? {});
        if (!a.name) {
          send(res, 400, { error: "ability needs a name" });
          return;
        }
        abilities.push(a);
      } else if (action === "remove") {
        const idx = abilities.findIndex((x: any) => toId(x.name) === toId(name));
        if (idx === -1) {
          send(res, 404, { error: `ability '${name ?? "?"}' not found` });
          return;
        }
        abilities.splice(idx, 1);
      } else if (action === "save") {
        const clean = sanitizeAbility(ability ?? {});
        const idx = abilities.findIndex((x: any) => toId(x.name) === toId(name));
        if (idx === -1) {
          send(res, 404, { error: `ability '${name ?? "?"}' not found` });
          return;
        }
        abilities[idx] = clean;
      } else {
        send(res, 400, { error: "action must be add|save|remove" });
        return;
      }
      touch();
      send(res, 200, { ok: true });
      return;
    }

    if (p === "/api/custom") {
      const { kind, item } = body;
      const map = entryMap(kind);
      const nm = String(item?.name ?? "").trim();
      if (!map || !nm) {
        send(res, 400, { error: "name is required" });
        return;
      }
      if (map.has(toId(nm))) {
        send(res, 400, { error: `A ${kind} named '${nm}' already exists` });
        return;
      }
      const built = kind === "class" ? defaultClass(nm, item) : defaultWeapon(nm, item);
      map.set(toId(nm), built);
      customNames.add(toId(nm));
      saveCustoms();
      touch();
      send(res, 200, { ok: true, name: nm });
      return;
    }

    if (p === "/api/custom/remove") {
      const { kind, name } = body;
      const map = entryMap(kind);
      const key = toId(name);
      if (!map || !customNames.has(key)) {
        send(res, 400, { error: `'${name ?? "?"}' is not a custom ${kind ?? "item"}` });
        return;
      }
      map.delete(key);
      customNames.delete(key);
      saveCustoms();
      touch();
      send(res, 200, { ok: true });
      return;
    }

    if (p === "/api/regenerate") {
      const { changed, inserted, out } = regenerateSource();
      if (changed.length === 0 && inserted.length === 0) {
        pendingRegen = false;
        send(res, 200, { ok: true, noChanges: true, changed: [], inserted: [] });
        return;
      }
      fs.writeFileSync(SRC_PATH, SOURCE_EOL === "\r\n" ? out.replace(/\n/g, "\r\n") : out);
      pendingRegen = false;
      send(res, 200, { ok: true, changed, inserted });
      return;
    }

    if (p === "/api/reset") {
      for (const k of customNames) {
        classes.delete(k);
        weapons.delete(k);
      }
      branches.clear();
      loadGameData();
      customNames.clear();
      loadCustoms();
      pendingRegen = false;
      writeEditorSnapshot();
      send(res, 200, { ok: true });
      return;
    }
  } catch (e) {
    console.error("[ability-editor] request failed:", e);
    send(res, 500, { error: String(e) });
    return;
  }

  send(res, 404, { error: "not found" });
}

loadGameData();
loadCustoms();
writeEditorSnapshot();

http.createServer(handle).listen(PORT, process.env.HOST || "127.0.0.1", () => {
  console.log(`BD Ability Editor running on http://localhost:${PORT}`);
  console.log(
    `Loaded ${classes.size} classes, ${weapons.size} weapons (${customNames.size} custom)`,
  );
});
