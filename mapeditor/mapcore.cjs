/**
 * mapcore.js — shared library for Battle Dome maps (bd-autohost-bot-new).
 *
 * Works in Node (module.exports) and in the browser (window.MapCore).
 *
 * A "map" is a plain object:
 *   {
 *     name:        string,   // volunteer-safe id ([a-z0-9_-], <= 40 chars)
 *     displayName: string,   // nice name (optional)
 *     rows:  number,
 *     cols:  number,
 *     tiles: string[][],     // rows x cols of terrain ids
 *     tokens: {              // player tokens (editor-only — not in .txt format)
 *       P1: { row, col, color },
 *       ...
 *     }
 *   }
 *
 * Terrain ids match the bot's game/state.ts TERRAIN_NAMES (lowercase):
 * normal, stop, water, forest, ice, air, sticky, lava, broken, bone,
 * stone, hearth, boost.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";


	// Terrain colors + metadata come from the single source of truth:
	// src/game/terrain-colors.cjs (also imported by the game engine's
	// TERRAIN_COLORS/TERRAIN_NAMES and loaded by the editor/gallery pages).
	// `code` is the volunteer .txt character from src/data/parse-map-file.ts.
	let TERRAIN_JSON;
	if (typeof module === 'object' && module.exports) {
		TERRAIN_JSON = require('../src/game/terrain-colors.cjs');
	} else {
		TERRAIN_JSON =
			(typeof globalThis !== 'undefined' && globalThis.TERRAIN_COLORS) || null;
	}
	if (!TERRAIN_JSON) {
		throw new Error('mapcore.cjs requires src/game/terrain-colors.cjs to be loaded first (add a <script> tag before this one)');
	}
	const TERRAINS = TERRAIN_JSON;

  // Default token colors (P1 green / P2 blue are the classic ones).
  const DEFAULT_TOKEN_COLORS = {
    P1: "#00A000",
    P2: "#0000C0",
    P3: "#B00000",
    P4: "#8B00C0",
    P5: "#E07B00",
    P6: "#555555",
    P7: "#0070A0",
    P8: "#A04000",
  };

  const NAMED_COLORS = {
    black: "#000000",
    white: "#FFFFFF",
    green: "#008000",
    blue: "#0000FF",
    red: "#FF0000",
    purple: "#800080",
    orange: "#FFA500",
    yellow: "#FFFF00",
    gray: "#808080",
    grey: "#808080",
    silver: "#C0C0C0",
  };

  // .txt terrain codes → terrain id ('.' and 'n' are both Normal).
  const CODE_TO_TERRAIN = { n: "normal" };
  for (const t in TERRAINS) CODE_TO_TERRAIN[TERRAINS[t].code] = t;

  const COLOR_TO_TERRAIN = {};
  for (const t in TERRAINS)
    COLOR_TO_TERRAIN[TERRAINS[t].color.toLowerCase()] = t;

  const MIN_DIM = 7;
  const MAX_DIM = 60;

  // Smallest allowed dimension per game mode (mirrors src/data/gamemodes.ts).
  const GAMEMODE_MIN_SIZE = { ffa: 7, ntr: 5, jugg: 7, pvp: 7, "1v1": 7 };

  // Resolve a free-form mode string to a canonical mode id (mirrors modeIdFor
  // in src/data/gamemodes.ts — aliases like duel or 2v2 map to a pool mode).
  const MODE_ALIASES = {
    ffa: "ffa",
    ntr: "ntr",
    jugg: "jugg",
    juggernaut: "jugg",
    pvp: "pvp",
    duel: "1v1",
    "1v1": "1v1",
    "2vj": "jugg",
    "3vj": "jugg",
    "4vj": "jugg",
    pvpj: "pvp",
    "pvp juggernaut": "pvp",
    pvpntr: "ntr",
    "pvp ntr": "ntr",
    "2v2v2": "pvp",
    "4v4": "pvp",
    "2v2v2v2": "pvp",
  };

  function modeIdFor(mode) {
    const key = String(mode).trim().toLowerCase().replace(/\s+/g, " ");
    if (MODE_ALIASES[key]) return MODE_ALIASES[key];
    if (/^\d+v\d+$/.test(key)) return "pvp";
    return undefined;
  }

  // Smallest allowed dimension for a map declaring the given modes (mirrors
  // minDimFor in src/data/parse-map-file.ts — NTR maps may be 5x5, others 7x7).
  function minDimFor(modes) {
    if (!modes || !modes.length) return MIN_DIM;
    return Math.max(...modes.map((m) => GAMEMODE_MIN_SIZE[m] || MIN_DIM));
  }

  function rowLabel(i) {
    return String.fromCharCode(65 + i);
  }

  function colLabel(i) {
    return String(i + 1);
  }

  /**
   * Map names must be usable as volunteer map ids: lowercase letters,
   * digits, '-' or '_', 1-40 chars, and not reserved for %setmap gen.
   */
  function sanitizeName(name) {
    name = String(name || "untitled")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (!name) name = "untitled";
    if (/^gen\d*$/.test(name)) name = "vol-" + name;
    return name;
  }

  const volunteerName = sanitizeName;

  // Same derivation the bot uses (displayFromName in parse-map-file.ts).
  function displayFromName(name) {
    return String(name || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Accept #rrggbb / #rgb / rgb(...) / named colors → '#rrggbb'.
  function normalizeColor(c) {
    if (!c) return null;
    c = String(c).trim();
    if (NAMED_COLORS[c.toLowerCase()]) return NAMED_COLORS[c.toLowerCase()];
    let m = c.match(/^#([0-9a-fA-F]{6})$/);
    if (m) return "#" + m[1].toLowerCase();
    m = c.match(/^#([0-9a-fA-F]{3})$/);
    if (m) {
      return (
        "#" +
        m[1]
          .split("")
          .map((ch) => ch + ch)
          .join("")
          .toLowerCase()
      );
    }
    m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const h = (n) => ("0" + Number(n).toString(16)).slice(-2);
      return "#" + h(m[1]) + h(m[2]) + h(m[3]);
    }
    return null;
  }

  function tokenColorFor(name) {
    return DEFAULT_TOKEN_COLORS[name] || "#333333";
  }

  // Build an all-"normal" map.
  function emptyMap(rows, cols, name) {
    rows = Math.max(1, Math.min(MAX_DIM, Math.floor(rows) || 11));
    cols = Math.max(1, Math.min(MAX_DIM, Math.floor(cols) || 11));
    const tiles = [];
    for (let r = 0; r < rows; r++) tiles.push(new Array(cols).fill("normal"));
    return {
      name: sanitizeName(name),
      displayName: displayFromName(sanitizeName(name)),
      rows,
      cols,
      tiles,
      tokens: {},
    };
  }

  // Ensure a map object is well-formed (padded tiles, valid terrain, tokens in bounds).
  function normalizeMap(map) {
    if (!map || typeof map !== "object") return emptyMap(11, 11, "untitled");
    let rows = Math.max(1, Math.min(MAX_DIM, Math.floor(map.rows) || 11));
    let cols = Math.max(1, Math.min(MAX_DIM, Math.floor(map.cols) || 11));
    const tiles = [];
    for (let r = 0; r < rows; r++) {
      const srcRow =
        Array.isArray(map.tiles) && Array.isArray(map.tiles[r])
          ? map.tiles[r]
          : [];
      const row = [];
      for (let c = 0; c < cols; c++) {
        const t = String(srcRow[c] || "normal").toLowerCase();
        row.push(TERRAINS[t] ? t : "normal");
      }
      tiles.push(row);
    }
    const tokens = {};
    if (map.tokens && typeof map.tokens === "object") {
      for (const name in map.tokens) {
        const tok = map.tokens[name];
        if (!tok || typeof tok !== "object") continue;
        const r = Math.floor(tok.row),
          c = Math.floor(tok.col);
        if (isNaN(r) || isNaN(c) || r < 0 || r >= rows || c < 0 || c >= cols)
          continue;
        tokens[name] = {
          row: r,
          col: c,
          color: normalizeColor(tok.color) || tokenColorFor(name),
        };
      }
    }
    const name = sanitizeName(map.name);
    const modes = Array.isArray(map.modes)
      ? map.modes
          .map(modeIdFor)
          .filter(Boolean)
          .filter((m, i, a) => a.indexOf(m) === i)
      : [];
    return {
      name,
      // CR/LF are stripped like parseTxt does; cap at the same 60 chars.
      displayName:
        (map.displayName &&
          String(map.displayName)
            .replace(/[\r\n]+/g, " ")
            .trim()
            .slice(0, 60)) ||
        displayFromName(name),
      rows,
      cols,
      tiles,
      tokens,
      modes,
    };
  }

  // ------------------------------------------------------------------
  // Parsing: game HTML → map object
  // ------------------------------------------------------------------

  function parseCell(attrs, inner) {
    let terrain = null;
    let tm = attrs.match(/title="([^"]+)"/);
    if (tm) terrain = tm[1].toLowerCase();
    else {
      const bg = attrs.match(/background:\s*(#[0-9a-fA-F]{3,6}|[a-z]+)/i);
      if (bg) terrain = COLOR_TO_TERRAIN[normalizeColor(bg[1]) || ""];
    }
    if (!terrain || !TERRAINS[terrain]) terrain = "normal";

    let token = null,
      color = null;
    const bt = inner.match(/<b[^>]*>\s*(P\d+)\s*<\/b>/i);
    if (bt) {
      token = bt[1].toUpperCase();
      const cm = inner.match(/color:\s*(#[0-9a-fA-F]{3,6}|[a-z]+)/i);
      if (cm) color = normalizeColor(cm[1]);
    }
    return { terrain, token, color };
  }

  /**
   * Parse a Battle Dome map HTML string (the <table> inside
   * <details><summary>Map</summary>…</details>). Also accepts the full
   * "/uhtml <ts>,<div …>…" message or a bare <table> fragment.
   */
  function parseHTML(html) {
    if (!html) throw new Error("No HTML given");
    html = String(html);

    let section = html;
    const marker = html.indexOf("<summary>Map</summary>");
    if (marker !== -1) {
      const end = html.indexOf("</details>", marker);
      section = html.slice(marker, end === -1 ? html.length : end);
    }
    const ts = section.indexOf("<table");
    if (ts === -1) throw new Error("No <table> found in HTML");
    const te = section.indexOf("</table>", ts);
    if (te === -1) throw new Error("Unclosed <table> in HTML");
    section = section.slice(ts, te + 8);

    const rowsRaw = section.split(/<tr\b/i).slice(1);
    const grid = [];
    let cols = 0;

    for (const raw of rowsRaw) {
      const cells = [];
      const re = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
      let m;
      while ((m = re.exec(raw)) !== null) {
        const full = m[0];
        cells.push({ attrs: full.slice(0, full.indexOf(">")), inner: m[1] });
      }
      if (!cells.length) continue;

      // Header row: cells contain <b>N</b> column numbers.
      const isHeader = cells.some((c) =>
        /<b[^>]*>\s*\d+\s*<\/b>/i.test(c.inner),
      );
      if (isHeader) {
        cols = cells.length - 1;
        continue;
      }

      const tileCells = cells.slice(1); // skip the row letter label
      if (!tileCells.length) continue;
      grid.push(tileCells.map((c) => parseCell(c.attrs, c.inner)));
    }

    if (cols === 0) cols = grid.reduce((mx, r) => Math.max(mx, r.length), 0);
    if (cols === 0) throw new Error("Could not determine map size");

    const tiles = [];
    const tokens = {};
    for (let r = 0; r < grid.length; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c] || { terrain: "normal", token: null };
        row.push(cell.terrain);
        if (cell.token) {
          tokens[cell.token] = {
            row: r,
            col: c,
            color: cell.color || tokenColorFor(cell.token),
          };
        }
      }
      tiles.push(row);
    }

    return normalizeMap({
      name: "imported",
      rows: tiles.length,
      cols,
      tiles,
      tokens,
    });
  }

  // ------------------------------------------------------------------
  // Parsing: volunteer .txt → map object
  // Mirrors src/data/parse-map-file.ts (same rules, same error text).
  // ------------------------------------------------------------------

  function parseTxt(text, file) {
    file = file || "map";
    if (!text) throw new Error(file + ":0: no content");
    let name = "";
    let disp;
    const modes = [];
    const rows = [];
    let n = 0;

    for (const raw of String(text).split(/\r?\n/)) {
      n++;
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;

      const head = line.match(/^(name|display|modes)\s*:\s*(.*)$/);
      if (head) {
        const val = head[2].trim();
        if (head[1] === "name") {
          name = val.toLowerCase();
          if (!/^[a-z0-9_-]{1,40}$/.test(name)) {
            throw new Error(
              file +
                ":" +
                n +
                ': bad map name "' +
                name +
                '" — use lowercase letters, digits, - or _ (up to 40 chars, no spaces)',
            );
          }
          if (/^gen\d*$/.test(name)) {
            throw new Error(
              file +
                ":" +
                n +
                ': "' +
                name +
                '" is reserved for %setmap gen (procedural maps)',
            );
          }
        } else if (head[1] === "display") {
          disp = val;
          if (!disp || disp.length > 60)
            throw new Error(
              file + ":" + n + ": display name must be 1-60 chars",
            );
        } else {
          for (const part of val.split(",")) {
            const entry = part.trim();
            if (!entry) continue;
            const whole = modeIdFor(entry);
            if (whole) {
              if (modes.indexOf(whole) === -1) modes.push(whole);
            } else {
              for (const word of entry.split(/\s+/)) {
                const id = modeIdFor(word);
                if (!id)
                  throw new Error(
                    file +
                      ":" +
                      n +
                      ': unknown game mode "' +
                      word +
                      '" — use ffa, ntr, jugg, pvp or 1v1',
                  );
                if (modes.indexOf(id) === -1) modes.push(id);
              }
            }
          }
          if (!modes.length)
            throw new Error(file + ":" + n + ": modes list is empty");
        }
        continue;
      }

      rows.push({ text: line, line: n });
    }

    if (!name) throw new Error(file + ":0: missing a `name: <id>` line");
    const minDim = minDimFor(modes);
    if (rows.length < minDim || rows.length > MAX_DIM) {
      throw new Error(
        file +
          ":0: map has " +
          rows.length +
          " row(s), need " +
          minDim +
          "-" +
          MAX_DIM,
      );
    }

    const cols = rows[0].text.length;
    if (cols < minDim || cols > MAX_DIM) {
      throw new Error(
        file +
          ":" +
          rows[0].line +
          ": map has " +
          cols +
          " columns, need " +
          minDim +
          "-" +
          MAX_DIM,
      );
    }

    const tiles = rows.map(({ text, line }) => {
      if (text.length !== cols) {
        throw new Error(
          file +
            ":" +
            line +
            ": row has " +
            text.length +
            " cells, expected " +
            cols +
            " — every row must be the same length",
        );
      }
      return text.split("").map((code) => {
        const t = CODE_TO_TERRAIN[code];
        if (t === undefined) {
          throw new Error(
            file +
              ":" +
              line +
              ': unknown terrain code "' +
              code +
              '" — see maps/README.md for the legend',
          );
        }
        return t;
      });
    });

    return normalizeMap({
      name,
      displayName: disp || displayFromName(name),
      rows: tiles.length,
      cols,
      tiles,
      tokens: {},
      modes,
    });
  }

  // ------------------------------------------------------------------
  // Exporting: map object → volunteer .txt / game HTML / JSON / text
  // ------------------------------------------------------------------

  function tokenAt(map, r, c) {
    for (const name in map.tokens) {
      const t = map.tokens[name];
      if (t.row === r && t.col === c)
        return { name, color: t.color || tokenColorFor(name) };
    }
    return null;
  }

  /**
   * Move a rectangular block of tiles (and any tokens inside it) by (dr, dc).
   * Mutates `map` in place. Returns the selection box at its new position
   * ({r0, c0, r1, c1}, inclusive) or null if the move would go out of bounds.
   * A token from outside the block sitting on a destination cell is displaced
   * (the moved token wins).
   */
  function translateBlock(map, sel, dr, dc) {
    dr = Math.round(dr) || 0;
    dc = Math.round(dc) || 0;
    if (!dr && !dc) return { r0: sel.r0, c0: sel.c0, r1: sel.r1, c1: sel.c1 };
    const s = {
      r0: Math.min(sel.r0, sel.r1),
      c0: Math.min(sel.c0, sel.c1),
      r1: Math.max(sel.r0, sel.r1),
      c1: Math.max(sel.c0, sel.c1),
    };
    const hgt = s.r1 - s.r0 + 1,
      wid = s.c1 - s.c0 + 1;
    const nr0 = s.r0 + dr,
      nc0 = s.c0 + dc;
    if (nr0 < 0 || nc0 < 0 || nr0 + hgt > map.rows || nc0 + wid > map.cols)
      return null;

    // Snapshot the block (tiles + tokens inside it).
    const block = [];
    for (let r = s.r0; r <= s.r1; r++)
      for (let c = s.c0; c <= s.c1; c++) block.push(map.tiles[r][c]);
    const blockTokens = [];
    for (const name in map.tokens) {
      const t = map.tokens[name];
      if (t.row >= s.r0 && t.row <= s.r1 && t.col >= s.c0 && t.col <= s.c1) {
        blockTokens.push({
          name,
          row: t.row - s.r0,
          col: t.col - s.c0,
          color: t.color,
        });
      }
    }

    // Cut: clear the source region.
    for (let r = s.r0; r <= s.r1; r++)
      for (let c = s.c0; c <= s.c1; c++) map.tiles[r][c] = "normal";
    for (const bt of blockTokens) delete map.tokens[bt.name];

    // Paste at the destination.
    let i = 0;
    for (let r = s.r0; r <= s.r1; r++)
      for (let c = s.c0; c <= s.c1; c++)
        map.tiles[nr0 + (r - s.r0)][nc0 + (c - s.c0)] = block[i++];
    for (const bt of blockTokens) {
      const tr = nr0 + bt.row,
        tc = nc0 + bt.col;
      for (const name in map.tokens) {
        const o = map.tokens[name];
        if (o.row === tr && o.col === tc) delete map.tokens[name];
      }
      map.tokens[bt.name] = {
        row: tr,
        col: tc,
        color: bt.color || tokenColorFor(bt.name),
      };
    }

    return { r0: nr0, c0: nc0, r1: nr0 + hgt - 1, c1: nc0 + wid - 1 };
  }

  /**
   * Volunteer .txt format for maps/ in this repo. Note: player tokens are
   * editor-only and not representable in this format (they're ignored).
   */
  function toTxt(map) {
    map = normalizeMap(map);
    const minDim = minDimFor(map.modes);
    if (map.rows < minDim || map.cols < minDim) {
      throw new Error(
        "Volunteer maps must be at least " +
          minDim +
          "x" +
          minDim +
          " — this map is " +
          map.rows +
          "x" +
          map.cols,
      );
    }
    const name = sanitizeName(map.name);
    const display =
      (map.displayName && String(map.displayName).trim()) ||
      displayFromName(name);
    const lines = [];
    lines.push("# Battle Dome volunteer map — made with the map editor");
    lines.push("name: " + name);
    lines.push("display: " + String(display).slice(0, 60));
    if (map.modes && map.modes.length)
      lines.push("modes: " + map.modes.join(", "));
    for (let r = 0; r < map.rows; r++) {
      let row = "";
      for (let c = 0; c < map.cols; c++) {
        const t =
          map.tiles[r] && TERRAINS[map.tiles[r][c]]
            ? map.tiles[r][c]
            : "normal";
        row += TERRAINS[t].code;
      }
      lines.push(row);
    }
    return lines.join("\n") + "\n";
  }

  /**
   * Generate HTML in the format the game / bot uses (a <table> inside
   * <details><summary>Map</summary>…</details>). The bot's parser
   * (src/html/parse.ts) reads title="…" for terrain and <b>P#</b> for players.
   */
  function esc(s) {
    return String(s).replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  }

  function toHTML(map) {
    map = normalizeMap(map);
    const rows = map.rows,
      cols = map.cols,
      tiles = map.tiles;
    let out =
      '<div class="infobox"><details open><summary>Map</summary><div style="overflow-x:auto">';
    out +=
      '<table align="center" style="border-spacing:0px;border-collapse:collapse;border:1px solid #888; background:rgba(120, 120, 225, 0.10)" border="1" bordercolor="#888">';
    out +=
      '<tr style="min-height:28px;height:24px"><td style="min-width:22px"></td>';
    for (let c = 0; c < cols; c++)
      out +=
        '<td style="min-width:22px" align="center"><b>' +
        colLabel(c) +
        "</b></td>";
    out += "</tr>";
    for (let r = 0; r < rows; r++) {
      out +=
        '<tr style="min-height:24px;height:24px"><td align="center"><b>' +
        rowLabel(r) +
        "</b></td>";
      for (let c = 0; c < cols; c++) {
        const terrain =
          tiles[r] && TERRAINS[tiles[r][c]] ? tiles[r][c] : "normal";
        const color = TERRAINS[terrain].color;
        const tok = tokenAt(map, r, c);
        if (tok) {
          out +=
            '<td style="background:' +
            color +
            '" title="' +
            terrain +
            '" align="center"><b style="color:' +
            tok.color +
            '">' +
            esc(tok.name) +
            "</b></td>";
        } else {
          out +=
            '<td style="background:' +
            color +
            '" title="' +
            terrain +
            '"></td>';
        }
      }
      out += "</tr>";
    }
    out += "</table></div></details></div>";
    return out;
  }

  // Plain JSON serializable form (identical to the saved file format).
  function toJSON(map) {
    return normalizeMap(map);
  }

  // Compact text grid — rows of comma-separated terrain ids (like lastMap).
  function toTextGrid(map) {
    return map.tiles.map((row) => row.join(", ")).join("\n");
  }

  /**
   * Copy a rectangular block out of a map as a self-contained mini-map
   * (tiles + any tokens inside it). `sel` is {r0,c0,r1,c1} inclusive.
   * The block rows/cols are indices into `sel`, so it can be pasted back
   * at any anchor with pasteBlock().
   */
  function sliceBlock(map, sel) {
    const s = normalizeSel(sel);
    const hgt = s.r1 - s.r0 + 1,
      wid = s.c1 - s.c0 + 1;
    const tiles = [];
    for (let r = s.r0; r <= s.r1; r++)
      tiles.push(map.tiles[r].slice(s.c0, s.c1 + 1));
    const tokens = {};
    for (const name in map.tokens) {
      const t = map.tokens[name];
      if (t.row >= s.r0 && t.row <= s.r1 && t.col >= s.c0 && t.col <= s.c1) {
        tokens[name] = { row: t.row - s.r0, col: t.col - s.c0, color: t.color };
      }
    }
    return { rows: hgt, cols: wid, tiles, tokens };
  }

  /** Paste a block produced by sliceBlock() into map at (r0,c0), anchored at
   * its top-left. Clamps to the map bounds; tiles/past-only (out-of-bounds
   * cells are dropped). Returns the box actually written, or null if nothing
   * could be placed.
   */
  function pasteBlock(map, block, r0, c0) {
    if (!block || !block.tiles || !block.tiles.length) return null;
    // Clamp to non-negative integers — a negative r0/c0 would index
    // map.tiles[-1] and throw. Math.max also replaces NaN with 0.
    r0 = Math.max(0, Math.round(Number(r0) || 0));
    c0 = Math.max(0, Math.round(Number(c0) || 0));
    const hgt = block.rows,
      wid = block.cols;
    const nr1 = Math.min(map.rows, r0 + hgt) - 1;
    const nc1 = Math.min(map.cols, c0 + wid) - 1;
    if (r0 >= map.rows || c0 >= map.cols || nr1 < r0 || nc1 < c0) return null;
    for (let r = 0; r < hgt; r++) {
      for (let c = 0; c < wid; c++) {
        const pr = r0 + r,
          pc = c0 + c;
        if (pr >= map.rows || pc >= map.cols) continue;
        map.tiles[pr][pc] = TERRAINS[block.tiles[r] && block.tiles[r][c]]
          ? block.tiles[r][c]
          : "normal";
      }
    }
    // Paste tokens: displace any token already on a destination cell.
    for (const name in block.tokens || {}) {
      const t = block.tokens[name];
      const pr = r0 + t.row,
        pc = c0 + t.col;
      if (pr >= map.rows || pc >= map.cols) continue;
      for (const on in map.tokens) {
        const o = map.tokens[on];
        if (o.row === pr && o.col === pc) delete map.tokens[on];
      }
      map.tokens[name] = { row: pr, col: pc, color: t.color };
    }
    return { r0, c0, r1: nr1, c1: nc1 };
  }

  function normalizeSel(sel) {
    return {
      r0: Math.min(sel.r0, sel.r1),
      c0: Math.min(sel.c0, sel.c1),
      r1: Math.max(sel.r0, sel.r1),
      c1: Math.max(sel.c0, sel.c1),
    };
  }

  /**
   * Export a rectangular selection as host-chat %tile commands, the form the
   * user pastes to set the map in-game. Coordinates are grouped per terrain
   * and concatenated (letter row + number col, e.g. "a1"):
   *
   *   %tile water,a1b2b3
   *   %tile forest,c1c2
   *
   * Normal (empty) cells are skipped. Returns an array of lines.
   */
  function selectionToTileCmds(map, sel, prefix) {
    const s = normalizeSel(
      sel || { r0: 0, c0: 0, r1: map.rows - 1, c1: map.cols - 1 },
    );
    prefix = prefix == null ? "%tile" : String(prefix);
    const byTerrain = {};
    const order = [];
    for (let r = s.r0; r <= s.r1; r++) {
      for (let c = s.c0; c <= s.c1; c++) {
        const t =
          map.tiles[r] && TERRAINS[map.tiles[r][c]]
            ? map.tiles[r][c]
            : "normal";
        if (t === "normal") continue;
        const ref = String.fromCharCode(97 + r) + (c + 1);
        if (byTerrain[t] === undefined) {
          byTerrain[t] = [];
          order.push(t);
        }
        byTerrain[t].push(ref);
      }
    }
    return order.map((t) => prefix + " " + t + "," + byTerrain[t].join(""));
  }

  /**
   * Apply %tile / %settile command lines onto a map (mutates in place).
   * Accepts lines like "%tile water,a1b2b3" or "%settile forest, c1 c2" and
   * comma/space-separated coords. Returns the number of tiles set, or throws
   * a helpful Error on a malformed line.
   */
  function applyTileCmds(map, text, prefix) {
    prefix = prefix == null ? "%tile" : String(prefix).toLowerCase();
    let total = 0;
    const lines = String(text).split(/\r?\n/);
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const m = line.match(/^%(?:tile|settile)\s+([a-z]+)\s*,\s*(.+)$/i);
      if (!m)
        throw new Error(
          "line " + (i + 1) + ": expected %tile <terrain>,<coords>",
        );
      const terrain = m[1].toLowerCase();
      if (!TERRAINS[terrain])
        throw new Error(
          "line " + (i + 1) + ': unknown terrain "' + terrain + '"',
        );
      const coords = m[2];
      const refs = coords.match(/[a-z]\d+/gi) || [];
      if (!refs.length)
        throw new Error("line " + (i + 1) + ": no tile coordinates found");
      for (const ref of refs) {
        const rm = ref.match(/^([a-z])(\d+)$/i);
        if (!rm) continue;
        const r = rm[1].toLowerCase().charCodeAt(0) - 97;
        const c = parseInt(rm[2], 10) - 1;
        if (r < 0 || r >= map.rows || c < 0 || c >= map.cols) continue;
        map.tiles[r][c] = terrain;
        total++;
      }
    });
    return total;
  }

  function tileCounts(map) {
    const counts = {};
    for (const t in TERRAINS) counts[t] = 0;
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const t =
          map.tiles[r] && TERRAINS[map.tiles[r][c]]
            ? map.tiles[r][c]
            : "normal";
        counts[t]++;
      }
    }
    return counts;
  }

  // Rotate the map 90° clockwise, turns times (1-3). Returns a new map object (tiles + tokens + dims).
  function rotateMap(map, turns) {
    const m = normalizeMap(map);
    turns = (((Math.floor(turns) || 0) % 4) + 4) % 4;
    let tiles = m.tiles,
      rows = m.rows,
      cols = m.cols,
      tokens = m.tokens;
    for (let i = 0; i < turns; i++) {
      const nt = [];
      for (let c = 0; c < cols; c++) {
        const row = [];
        for (let r = rows - 1; r >= 0; r--) row.push(tiles[r][c]);
        nt.push(row);
      }
      const ntoks = {};
      for (const name in tokens) {
        const t = tokens[name];
        ntoks[name] = { row: t.col, col: rows - 1 - t.row, color: t.color };
      }
      tiles = nt;
      tokens = ntoks;
      const oldRows = rows;
      rows = cols;
      cols = oldRows;
    }
    return normalizeMap({
      name: m.name,
      displayName: m.displayName,
      rows,
      cols,
      tiles,
      tokens,
    });
  }

  // Mirror the map: 'h' = left-right, 'v' = top-bottom. Returns a new map object.
  function flipMap(map, axis) {
    const m = normalizeMap(map);
    const tiles = [];
    const tokens = {};
    if (axis === "h") {
      for (let r = 0; r < m.rows; r++) tiles.push(m.tiles[r].slice().reverse());
      for (const name in m.tokens) {
        const t = m.tokens[name];
        tokens[name] = { row: t.row, col: m.cols - 1 - t.col, color: t.color };
      }
    } else {
      for (let r = m.rows - 1; r >= 0; r--) tiles.push(m.tiles[r].slice());
      for (const name in m.tokens) {
        const t = m.tokens[name];
        tokens[name] = { row: m.rows - 1 - t.row, col: t.col, color: t.color };
      }
    }
    return normalizeMap({
      name: m.name,
      displayName: m.displayName,
      rows: m.rows,
      cols: m.cols,
      tiles,
      tokens,
    });
  }

  return {
    TERRAINS,
    DEFAULT_TOKEN_COLORS,
    CODE_TO_TERRAIN,
    COLOR_TO_TERRAIN,
    MIN_DIM,
    MAX_DIM,
    GAMEMODE_MIN_SIZE,
    modeIdFor,
    minDimFor,
    rowLabel,
    colLabel,
    sanitizeName,
    volunteerName,
    displayFromName,
    normalizeColor,
    emptyMap,
    normalizeMap,
    parseHTML,
    parseTxt,
    toTxt,
    toHTML,
    toJSON,
    toTextGrid,
    tileCounts,
    tokenAt,
    translateBlock,
    sliceBlock,
    pasteBlock,
    selectionToTileCmds,
    applyTileCmds,
    rotateMap,
    flipMap,
  };
});
