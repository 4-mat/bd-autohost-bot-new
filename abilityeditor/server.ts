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
import {
  readSourceText,
  writeSourceText,
  regenerateSourceText,
  normalizeLevel,
  sanitizeAbility,
  toId,
  STAT_KEYS,
  isPlainObject,
  type EntryLike,
} from "./serializer.js";

const PORT = Number(process.env.PORT) || 4700;
const ROOT = path.join(import.meta.dirname, "..");
const SRC_PATH = path.join(ROOT, "src", "data", "index.ts");
const CUSTOMS_PATH = path.join(import.meta.dirname, "customs.local.json");

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

function regenerateSource(): { changed: string[]; inserted: string[]; out: string } {
  const text = readSourceText(SRC_PATH);
  const entries: EntryLike[] = [];
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
  return regenerateSourceText(text, entries);
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
      writeSourceText(SRC_PATH, out);
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
